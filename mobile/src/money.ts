/* ── What a money box accepts, in one place ──────────────────────────────────
   Round 2 shipped three different opinions about the same string. Typing
   "25,000" into Guest paid and "21,000" into Net earned auto-filled Commission
   as ₹4, because the form's arithmetic used a bare parseFloat (stops at the
   comma → 25) while the worker's num() stripped the comma first (→ 25000).
   Seven of eight malformed amounts then reached an admin's approval queue, and
   ciNum() coerced them a fourth way at render time ('1.2.3'→1.2, '1e3'→1000,
   '(500)'→−500) — so the figure an admin approved was not the figure the label
   showed.

   The fix is not a smarter parser. It is refusing to have more than one:

     moneyText()  filters what may appear in the box AS IT IS TYPED
     moneyNum()   is the only way a money string becomes a number on the client
     isMoneyText() is what the forms check before sending
     worker/src/index.js money() applies the SAME grammar server-side, so a
     request forged past the form is refused instead of queued.

   ACCEPTED: digits; at most one decimal point with at most two decimals
   (paise); an optional leading minus, and only on a field where a negative is
   meaningful (a loss-making booking). Commas, spaces and ₹ are how a person
   writes money, so they are swallowed as you type — "₹25,000" becomes 25000 in
   the box, visibly, before anything is sent.

   REJECTED, at the keystroke, never after a round trip: letters (so no
   '12ab34'), exponent notation ('1e3'), accounting parens ('(500)'), a second
   decimal point ('1.2.3'), and a minus anywhere but the front. None of these is
   how a rupee figure is entered on a phone, and each one previously meant a
   different number to a different part of the app.

   Nothing here parses values coming OUT of the database — that is ciNum() in
   logic.ts, which stays deliberately forgiving so one bad legacy cell can never
   break a total. After this change nothing new can become such a cell. */

const STRIP = /[,\s ₹$£€]/g;

/* What the box did to the keystroke, in the words it says out loud.
   Filtering silently was its own bug: '12ab34' became 1234 and '1.2.3' became
   1.23 — valid figures nobody typed, which the server then accepted quite
   legitimately. Swallowing a comma, a space or a rupee sign is not a change of
   value and stays silent; that is the whole point of letting money be typed the
   way it is written. Anything actually dropped is said out loud. */
export type MoneyNote = string;

/** Filter for onChangeText: what the box may show, and what it refused. */
export function moneyFilter(raw: string, signed?: boolean): { text: string; note: MoneyNote } {
  const s0 = String(raw ?? '').replace(STRIP, '');
  const neg = s0.startsWith('-');
  let note = '';
  let s = s0.replace(/^-/, '');
  if (neg && !signed) note = 'This amount cannot be negative.';
  /* A minus anywhere but the front is a stray character, not a sign. */
  if (/[^0-9.]/.test(s)) note = 'Letters and symbols are not part of an amount.';
  s = s.replace(/[^0-9.]/g, '');
  /* Keep the first '.', drop the rest, so '1.2.3' can never be typed. */
  const i = s.indexOf('.');
  if (i >= 0) {
    if (s.slice(i + 1).indexOf('.') >= 0) note = 'One decimal point only.';
    s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, '');
    /* Rupees and paise. A third decimal is not a price anyone enters here, and
       the extra digit is refused as it is typed rather than rounded: rounding
       under the finger ('1250.505' -> 1250.51) leaves a figure that cannot be
       corrected without deleting back past it. */
    if (s.length > i + 3) note = 'Rupees and paise - two decimals at most.';
    s = s.slice(0, i + 3);
  }
  return { text: (neg && signed ? '-' : '') + s, note };
}

/** Filter for onChangeText: returns what the box is allowed to show. */
export function moneyText(raw: string, signed?: boolean): string {
  return moneyFilter(raw, signed).text;
}

/* One rule, one sentence. The client said "Amount must be a number, like 1500
   or 1500.50" and the worker said "Amount must be a number like 25000 or
   1250.50" — different examples, different comma, the same rule, and a person
   who met both had no way to know it was one rule. Kept in step by hand with
   MONEY_RULE in worker/src/index.js: two deployments of one sentence. */
export const MONEY_RULE = 'must be a number, like 1500 or 1500.50';
export const moneyRule = (label: string) => label + ' ' + MONEY_RULE;

/** The only client-side money string → number. */
export function moneyNum(v: string | number | null | undefined): number {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const n = parseFloat(moneyText(String(v ?? ''), true));
  return isFinite(n) ? n : 0;
}

/** Is this a complete, sendable amount? '' and a lone '-' are not. */
export function isMoneyText(v: string | number | null | undefined): boolean {
  if (typeof v === 'number') return isFinite(v);
  return /^-?\d+(\.\d{1,2})?$/.test(moneyText(String(v ?? ''), true));
}
