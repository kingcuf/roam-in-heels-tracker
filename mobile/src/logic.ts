// Client-side computations ported 1:1 from the web dashboard (index.html).
// These run over the raw getLogs() blocks, exactly like the website does.

export type LogBlock = { headers: string[]; rows: { r: number; cells: any[] }[] };
export type Logs = { bookings: LogBlock; expenses: LogBlock; savings?: LogBlock; tasks?: LogBlock; enquiries?: LogBlock; checklist?: ChecklistData; messages?: MessagesData; photos?: UnitAlbum[] };
/* A unit's photo album: photos stream via getAttachment; `album` is the public page for guests. */
export type UnitAlbum = { property: string; album: string; photos: { id: number; type: string; name: string }[] };

export const CI_MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function ciParse(s: any): Date | null {
  if (s == null) return null;
  s = String(s).trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  /* Slash dates are day-first here. Left to new Date(), '11/08/2026' parsed as
     8 November (US order) and silently landed in the wrong month's bucket. */
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) return new Date(+dmy[3], +dmy[2] - 1, +dmy[1]);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
export function ciNum(v: any): number {
  if (v == null) return 0;
  const raw = String(v).trim();
  if (!raw) return 0;
  /* The old strip deleted every unrecognised character, which silently rewrote
     values instead of rejecting them: '1e3' collapsed to '13'. Only formatting
     is removed now — currency, separators, spaces — so real numeric syntax
     survives. '(500)' is the accounting negative and kept its sign flipped. */
  const paren = /^\(.*\)$/.test(raw);
  const n = parseFloat(raw.replace(/[(),\s\u20B9$£€]/g, ''));
  if (!isFinite(n)) return 0;
  return paren ? -Math.abs(n) : n;
}
/* Minutes since midnight for a 12/24-hour clock string, for ordering only.
   Unparseable or blank sorts last so a missing time never leads the list. */
export function ciMinutes(v: any): number {
  const m = String(v ?? '').trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (!m) return Number.MAX_SAFE_INTEGER;
  let h = parseInt(m[1], 10);
  const ap = (m[3] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return h * 60 + parseInt(m[2], 10);
}

// hide non-time values (e.g. epoch "1899-12-30")
export function ciTime(s: any): string {
  s = String(s == null ? '' : s).trim();
  return /\d{1,2}:\d{2}/.test(s) || /\b[AP]M\b/i.test(s) ? s : '';
}
export function ciFmtDay(dt: Date) { return dt.getDate() + ' ' + CI_MON[dt.getMonth()]; }
export function ciMonthLabel(c: any[]) { const dt = ciParse(c[0]); return dt ? CI_MON[dt.getMonth()] + ' ' + dt.getFullYear() : ''; }
export function ciMonthOf(v: any) { const dt = ciParse(v); return dt ? CI_MON[dt.getMonth()] + ' ' + dt.getFullYear() : ''; }
export function ciDayKey(v: any) {
  const dt = ciParse(v);
  if (!dt) return '';
  const z = (n: number) => (n < 10 ? '0' : '') + n;
  return dt.getFullYear() + '-' + z(dt.getMonth() + 1) + '-' + z(dt.getDate());
}
export function ciCurMonth() { const d = new Date(); return CI_MON[d.getMonth()] + ' ' + d.getFullYear(); }
export function ciRepeat(v: any) {
  v = String(v == null ? '' : v).trim().toLowerCase();
  return v === '1' || v === 'yes' || v === 'true' || v === 'y' || v === 'repeat';
}
/* Savings status, normalised. Matching was case- and whitespace-exact, so a row
   saved as 'active' counted in the totals but landed in neither the Active nor
   the Matured branch — its principal vanished from both the Invested card and
   the bank balance. */
export function ciSaveStatus(v: any): 'Active' | 'Matured' | 'Withdrawn' | '' {
  const t = String(v == null ? '' : v).trim().toLowerCase();
  if (t === 'active') return 'Active';
  if (t === 'matured') return 'Matured';
  if (t === 'withdrawn') return 'Withdrawn';
  return '';
}

export function ciInitInvest(v: any) {
  v = String(v == null ? '' : v).trim().toLowerCase();
  return v === '1' || v === 'yes' || v === 'true' || v === 'y';
}
export function ciMonthSort(s: string) {
  const i = CI_MON.indexOf(String(s).split(' ')[0]);
  return (parseInt(String(s).split(' ')[1], 10) || 0) * 100 + (i < 0 ? 0 : i + 1);
}

/* ── Cross-unit split ────────────────────────────────────────────────────────
   Both flats are ours. A booking that came in on one unit's listing but housed
   the guest in the other earns the receiving unit a flat fee and credits the
   rest to the unit the guest actually slept in. The Worker resolves that at
   save time and stores it on the booking (cells 28/29) — nothing here re-derives
   it, so the ₹500 rate can change without restating a closed month.

   Two different questions run off it, and they do NOT give the same answer:
     * MONEY — scopeBooking(): the receiving unit keeps its fee, the stay unit
       earns the remainder. Shares always sum to the booking's net, so the two
       per-unit views still add up to the all-properties total.
     * PRESENCE — inStayScope(): nights, occupancy and check-ins follow the
       GUEST, so the receiving unit never looks booked on a night it could have
       sold and the stay unit's calendar shows who is actually in the flat. */
export const SPLIT_PROP_COL = 28;
export const SPLIT_FEE_COL = 29;

export type BookingSplit = { stayProp: string; fee: number };
export function splitOf(c: any[]): BookingSplit | null {
  const sp = String(c[SPLIT_PROP_COL] ?? '').trim();
  const fee = c[SPLIT_FEE_COL];
  /* A blank fee is the only "no split" test; the two cells are always written
     together. Rows saved before the column existed read undefined here. */
  if (!sp || fee === '' || fee === null || fee === undefined) return null;
  return { stayProp: sp, fee: ciNum(fee) };
}
/* The receiving unit's share of one money figure. The fee is a CAP, never a
   transfer: on a booking worth less than the fee the receiving unit keeps all
   of it and the stay unit earns nothing rather than going negative. */
export function receiverShare(amount: number, fee: number) {
  if (amount <= 0 || fee <= 0) return amount;
  return Math.min(fee, amount);
}
/* Where the guest physically was. */
export function stayPropOf(c: any[]) {
  const sp = splitOf(c);
  return sp ? sp.stayProp : String(c[1] || '');
}
/* Presence test — for calendars, stays and occupancy. */
export function inStayScope(c: any[], filter: string) {
  return !filter || filter === 'All' || stayPropOf(c) === String(filter);
}
/* Money test. Null means this row earns the view nothing at all.
   `own` is true for the unit that TOOK the booking: counts stay with it, so a
   booking is never counted twice across the two per-unit views. */
export type MoneyScope = { own: boolean; share: (amount: number) => number };
export function scopeBooking(c: any[], filter: string): MoneyScope | null {
  const whole = (a: number) => a;
  if (!filter || filter === 'All') return { own: true, share: whole };
  const sp = splitOf(c);
  if (String(c[1]) === String(filter)) {
    return { own: true, share: sp ? (a: number) => receiverShare(a, sp.fee) : whole };
  }
  if (sp && sp.stayProp === String(filter)) {
    return { own: false, share: (a: number) => a - receiverShare(a, sp.fee) };
  }
  return null;
}

/* The rate the FORM previews with. The Worker is the authority — it resolves
   the split and freezes the fee onto the booking at save time — so this is only
   ever used to show what is about to happen, never to read a stored booking.
   Keep it equal to SPLIT_FEE in worker/src/index.js. */
export const SPLIT_FEE_RATE = 500;

const unitKeyOf = (v: any) => String(v ?? '').trim().toLowerCase();
/* The number a flat is known by: 'Spira 2212' -> '2212'. That is what the host
   types into Stay unit, so it is what a one-tap choice writes. */
export const unitNumberOf = (v: any) => { const m = String(v ?? '').match(/(\d+)\s*$/); return m ? m[1] : ''; };
const unitNoOf = unitNumberOf;
/* STRICT, and deliberately so. The units are 3028 and 2212 and the host also
   writes real third-party flats into this box — 2121, 3130, 4217. A
   transposition is both a plausible typo AND a genuine other flat, so nothing
   here guesses: the whole trimmed value must BE an owned unit ('2212',
   'Spira 2212', 'SPIRA-2212', with surrounding spaces). '2212 studio' and
   '3103, 3028' identify no single owned unit and are rejected, which silently
   means "no split" exactly as before. Mirrors ownedProperty() in the Worker. */
export function ownedPropertyName(props: { id?: string; name: string }[], unit: any): string {
  const u = unitKeyOf(unit);
  if (!u) return '';
  for (const p of props || []) {
    if (unitKeyOf(p.name) === u || unitKeyOf(p.id) === u) return p.name;
    if (unitNoOf(p.name) && unitNoOf(p.name) === u) return p.name;
    if (unitNoOf(p.id) && unitNoOf(p.id) === u) return p.name;
  }
  return '';
}
/* What the form shows before saving: null whenever there is no split to show. */
export function splitPreview(
  props: { id?: string; name: string }[], property: string, stayUnit: any, net: number | null
): { stayProp: string; keep: number; give: number; known: boolean } | null {
  const stayProp = ownedPropertyName(props, stayUnit);
  if (!stayProp || !ownedPropertyName(props, property)) return null;
  if (unitKeyOf(stayProp) === unitKeyOf(property)) return null;
  if (net === null || !isFinite(net)) return { stayProp, keep: SPLIT_FEE_RATE, give: 0, known: false };
  const keep = receiverShare(net, SPLIT_FEE_RATE);
  return { stayProp, keep, give: net - keep, known: true };
}

/* ── The booking card ────────────────────────────────────────────────────────
   Every Action queue shows the same booking, so they show the same card. This
   is that card's data, read once from the raw row: the queues differ in which
   fields they put forward and what you can do from them, never in what a
   booking IS. Before this each queue carried its own subset and they drifted —
   one showed the unit, another the booking id, a third neither. */
export type CardData = {
  row: number; id: string;
  guest: string; coGuest: string; prop: string; unit: string;
  type: string; channel: string; referrer: string; notes: string;
  paid: number; listPrice: number; net: number; pending: number; guests: number;
  inD: Date | null; inT: string; outD: Date | null; outT: string;
  nights: number | null;          // null when either end is missing
  bookedOn: string;
};
export function cardOf(o: { r: number; cells: any[] }): CardData {
  const c = o.cells;
  const inD = ciParse(c[20]), outD = ciParse(c[21]);
  return {
    row: o.r, id: String(c[18] || ''),
    guest: c[2] || '', coGuest: c[15] || '', prop: c[1] || '', unit: String(c[24] ?? ''),
    type: c[3] || '', channel: c[4] || '', referrer: c[5] || '', notes: c[12] || '',
    paid: ciNum(c[8]), listPrice: ciNum(c[6]), net: ciNum(c[9]), pending: ciNum(c[11]),
    guests: ciNum(c[17]),
    inD, inT: ciTime(c[22]), outD, outT: ciTime(c[23]),
    nights: inD && outD ? Math.max(0, Math.round((outD.getTime() - inD.getTime()) / 86400000)) : null,
    bookedOn: String(c[0] || ''),
  };
}

/* ── Bookings by check-in (Today / Upcoming) ── */
export type CiItem = {
  row: number; id: string;
  date: Date; hasCi: boolean; inT: string; outT: string;
  guest: string; prop: string; type: string; net: number;
  unit: string;
  /* Both ends of the stay, so a card can show the other one: an arrival is only
     half the picture without the departure it implies. Either may be null —
     the record genuinely may not hold it, and a blank says so. */
  inD: Date | null; outD: Date | null;
  /* What the guest paid vs what we keep, and who the booking came through.
     For a Resold booking the referrer column is the person it was resold to,
     which is the one thing you need at the door and was not on the card. */
  paid: number; listPrice: number; pending: number; referrer: string;
  card: CardData;
};
export function computeCheckins(block: LogBlock | null, filter: string) {
  const DAY = 86400000;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const tdy: CiItem[] = [], up: CiItem[] = [], out: CiItem[] = [];
  if (block && block.rows) {
    block.rows.forEach((o) => {
      const c = o.cells;
      if (!c || !c[18]) return; // need a real Booking ID
      /* An arrival happens at the flat the guest was given, so a cross-unit
         booking shows on the stay unit's door list, not the listing's. */
      if (!inStayScope(c, filter)) return;
      const hasCi = !!(c[20] && String(c[20]).trim());
      const ci = ciParse(c[20]) || ciParse(c[0]); // check-in date, fallback booking date
      const mk = (d: Date): CiItem => ({
        row: o.r, id: String(c[18] || ''), date: d, hasCi,
        inT: ciTime(c[22]), outT: ciTime(c[23]),
        guest: c[2] || '', prop: c[1] || '', type: c[3] || '', net: ciNum(c[9]),
        unit: String(c[24] ?? ''),
        inD: ciParse(c[20]), outD: ciParse(c[21]),
        paid: ciNum(c[8]), listPrice: ciNum(c[6]), pending: ciNum(c[11]),
        referrer: c[5] || '',
        card: cardOf(o),
      });
      if (ci) {
        const diff = Math.round((ci.getTime() - today) / DAY);
        if (diff === 0) tdy.push(mk(ci));
        else if (diff > 0) up.push(mk(ci));
      }
      /* Departures bucket on the checkout date (col V). Unlike check-ins there is
         no fallback to the booking date — a blank checkout genuinely means we do
         not know when they leave, and inventing a date would put the wrong guests
         on today's list. */
      const co = ciParse(c[21]);
      if (co && Math.round((co.getTime() - today) / DAY) === 0) out.push(mk(co));
    });
  }
  /* Times are 12-hour strings ("9:00 AM"), so localeCompare ordered them
     lexically and put 1:00 PM above 9:00 AM. Sorted on minutes-since-midnight
     instead; blanks sink to the end rather than sorting as "before midnight". */
  tdy.sort((a, b) => ciMinutes(a.inT) - ciMinutes(b.inT));
  out.sort((a, b) => ciMinutes(a.outT) - ciMinutes(b.outT));
  up.sort((a, b) => a.date.getTime() - b.date.getTime());
  return { today: tdy, checkoutsToday: out, upcoming: up };
}

/* ── Pending payouts (Pending amount > 0) ── */
export type PayoutItem = {
  row: number; id: string; guest: string; prop: string; date: string; pending: number;
  /* The same context the check-in and review cards carry, so the three read as
     one family: which flat, which platform, and when the stay actually was. */
  unit: string; channel: string; type: string; net: number; paid: number;
  inD: Date | null; inT: string; outD: Date | null; outT: string;
  card: CardData;
};
export function computePayouts(block: LogBlock | null, filter: string) {
  const list: PayoutItem[] = [];
  let total = 0;
  if (block && block.rows) {
    block.rows.forEach((o) => {
      const c = o.cells;
      if (!c || !c[18]) return;
      /* Cash owed splits the same way the revenue does, so each unit chases the
         part of the payout it is actually waiting on. Settling still settles
         the whole booking — it is one payment — so the total never moves. */
      const sc = scopeBooking(c, filter);
      if (!sc) return;
      const pend = sc.share(ciNum(c[11]));
      if (!(pend > 0)) return;
      total += pend;
      list.push({
        row: o.r, id: c[18], guest: c[2] || '', prop: c[1] || '',
        date: String(c[0] || ''), pending: pend,
        unit: String(c[24] ?? ''), channel: c[4] || '', type: c[3] || '',
        net: sc.share(ciNum(c[9])), paid: ciNum(c[8]),
        inD: ciParse(c[20]), inT: ciTime(c[22]), outD: ciParse(c[21]), outT: ciTime(c[23]),
        card: cardOf(o),
      });
    });
  }
  list.sort((a, b) => b.pending - a.pending);
  return { list, total };
}

/* ── Actions (the to-do list) ──────────────────────────────────────────────
   Cells: 0 name · 1 end date · 2 description · 3 done · 4 done at · 5 created.

   The end date is the only thing that decides urgency, so it is the only thing
   this sorts on. `days` counts whole days from today to the end date, using
   local midnights on both sides — comparing timestamps instead would make an
   action created this afternoon read as due "in 0 days" tomorrow morning. */
export type TaskState = 'overdue' | 'today' | 'upcoming';
export type TaskItem = {
  row: number;
  name: string;
  end: Date | null;
  endIso: string;
  desc: string;
  done: boolean;
  doneAt: string;
  days: number | null;      // <0 overdue, 0 today, >0 upcoming; null = unparseable date
  state: TaskState;
};
export type TaskData = {
  all: TaskItem[];      // open first (by end date), then done
  open: TaskItem[];
  due: TaskItem[];      // open and already reached its end date — the count the Action tab shows
  done: TaskItem[];
};

export function computeTasks(block: LogBlock | null): TaskData {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const DAY = 86400000;

  const all: TaskItem[] = [];
  if (block && block.rows) {
    block.rows.forEach((o) => {
      const c = o.cells || [];
      const name = String(c[0] ?? '').trim();
      if (!name) return;                       // a nameless row is not an action
      const end = ciParse(c[1]);
      let days: number | null = null;
      if (end) {
        const e = new Date(end.getTime());
        e.setHours(0, 0, 0, 0);
        days = Math.round((e.getTime() - midnight.getTime()) / DAY);
      }
      all.push({
        row: o.r,
        name,
        end,
        endIso: String(c[1] ?? ''),
        desc: String(c[2] ?? ''),
        done: ciNum(c[3]) === 1,
        doneAt: String(c[4] ?? ''),
        days,
        /* No end date sorts and reads as upcoming rather than overdue: an
           action with nothing to be late against should not shout. */
        state: days === null ? 'upcoming' : days < 0 ? 'overdue' : days === 0 ? 'today' : 'upcoming',
      });
    });
  }

  /* Soonest first, undated last — an action with no date can never be more
     urgent than one with a deadline. */
  const byDate = (a: TaskItem, b: TaskItem) => {
    if (a.days === null && b.days === null) return a.row - b.row;
    if (a.days === null) return 1;
    if (b.days === null) return -1;
    return a.days - b.days;
  };
  const open = all.filter((t) => !t.done).sort(byDate);
  /* Most recently ticked first: the done pile is history, and the useful end of
     history is the recent one. */
  const done = all.filter((t) => t.done).sort((a, b) => b.row - a.row);
  const due = open.filter((t) => t.days !== null && t.days <= 0);
  return { all: [...open, ...done], open, due, done };
}

/* "Overdue by 2 days" / "Due today" / "Due in 5 days" — the card's whole
   status line, so no screen has to reinvent the wording. */
export function taskWhen(t: TaskItem): string {
  if (t.done) return t.doneAt ? 'Done · ' + t.doneAt : 'Done';
  if (t.days === null) return t.endIso ? 'Ends ' + t.endIso : 'No end date';
  if (t.days < 0) {
    const n = -t.days;
    return 'Overdue by ' + n + ' day' + (n === 1 ? '' : 's');
  }
  if (t.days === 0) return 'Due today';
  return 'Due in ' + t.days + ' day' + (t.days === 1 ? '' : 's');
}

/* ── Repeat customers by month ── */
export function computeRepeatByMonth(block: LogBlock | null, filter: string) {
  const m: Record<string, { rep: number; tot: number }> = {};
  if (block && block.rows) {
    block.rows.forEach((o) => {
      const c = o.cells;
      if (!c || !c[18]) return;
      if (filter && filter !== 'All' && String(c[1]) !== String(filter)) return;
      const mk = ciMonthLabel(c);
      if (!mk) return;
      m[mk] = m[mk] || { rep: 0, tot: 0 };
      m[mk].tot++;
      if (ciRepeat(c[25])) m[mk].rep++;
    });
  }
  const keys = Object.keys(m).sort((a, b) => ciMonthSort(a) - ciMonthSort(b));
  return keys.map((k) => ({ month: k, rep: m[k].rep, tot: m[k].tot }));
}

/* ── Earnings calendar (per-day rollup for the Airbnb-style calendar) ──
   Earnings anchor on the Booking Date (col A) — same basis as Daily Earnings.
   Check-ins anchor on the Check-in Date (col U) so today/upcoming stay visible. */
export type CalBooking = {
  row: number; id: string; guest: string; prop: string; type: string; channel: string;
  net: number; comm: number; pending: number;
};
export type CalCheckin = { id: string; guest: string; prop: string; inT: string; outT: string; net: number };
export type CalDay = { net: number; comm: number; pending: number; bookings: CalBooking[]; checkins: CalCheckin[] };
export type CalData = { days: Record<string, CalDay>; minMonth: string; maxMonth: string }; // month keys 'yyyy-MM'
export function computeCalendar(block: LogBlock | null, filter: string): CalData {
  const days: Record<string, CalDay> = {};
  let minMonth = '', maxMonth = '';
  const get = (k: string) => (days[k] = days[k] || { net: 0, comm: 0, pending: 0, bookings: [], checkins: [] });
  const seen = (mk: string) => {
    if (!minMonth || mk < minMonth) minMonth = mk;
    if (!maxMonth || mk > maxMonth) maxMonth = mk;
  };
  if (block && block.rows) {
    block.rows.forEach((o) => {
      const c = o.cells;
      if (!c || !c[18]) return;
      /* The two halves of this loop answer different questions and so use
         different tests: the money follows the attribution, the arrival follows
         the guest. On a cross-unit booking the fee lands on one unit's earnings
         day and the guest lands on the other unit's calendar. */
      const sc = scopeBooking(c, filter);
      const bk = sc ? ciDayKey(c[0]) : '';
      if (bk && sc) {
        const d = get(bk);
        const net = sc.share(ciNum(c[9])), comm = sc.share(ciNum(c[10])), pend = sc.share(ciNum(c[11]));
        d.net += net; d.comm += comm; d.pending += pend;
        d.bookings.push({
          row: o.r, id: String(c[18]), guest: c[2] || '', prop: c[1] || '', type: c[3] || '',
          channel: c[4] || '', net, comm, pending: pend,
        });
        seen(bk.slice(0, 7));
      }
      const ck = inStayScope(c, filter) ? ciDayKey(c[20]) : '';
      if (ck) {
        get(ck).checkins.push({
          id: String(c[18]), guest: c[2] || '', prop: stayPropOf(c),
          inT: ciTime(c[22]), outT: ciTime(c[23]), net: ciNum(c[9]),
        });
        seen(ck.slice(0, 7));
      }
    });
  }
  return { days, minMonth, maxMonth };
}

/* ── Savings (global — not per-property) ──
   Savings cells: 0 Date · 1 Amount · 2 Scheme · 3 Platform · 4 Status ·
   5 Amount Received (TOTAL credited back on exit) · 6 Notes/Ref No · 7 Created At · 8 Exit Date
   An exited saving (Matured / Withdrawn) has paid its principal back plus a
   gain — or less, on a loss — so its contribution to the bank is
   received − amount. */
export type Savings = {
  invested: number;            // Σ amount where status === 'Active'
  returnsRealized: number;     // Σ (received − amount) over exited entries; negative = loss
  receivedBack: number;        // Σ received over exited entries
  byScheme: Record<string, { c: number; amt: number }>;    // Active only
  byPlatform: Record<string, { c: number; amt: number }>;  // Active only
  counts: { active: number; matured: number; withdrawn: number; total: number };
  entries: { row: number; date: string; amount: number; scheme: string; platform: string; status: string; returns: number; notes: string; exitDate: string }[];
};
export function computeSavings(block: LogBlock | null): Savings {
  let invested = 0, returnsRealized = 0, receivedBack = 0;
  const byScheme: Savings['byScheme'] = {};
  const byPlatform: Savings['byPlatform'] = {};
  const counts = { active: 0, matured: 0, withdrawn: 0, total: 0 };
  const entries: Savings['entries'] = [];
  if (block && block.rows) {
    block.rows.forEach((o) => {
      const c = o.cells;
      if (!c) return;
      const amount = ciNum(c[1]), status = ciSaveStatus(c[4]), returns = ciNum(c[5]);
      counts.total++;
      if (status === 'Active') {
        counts.active++;
        invested += amount;
        const sc = c[2] || 'Other', pf = c[3] || 'Others';
        byScheme[sc] = byScheme[sc] || { c: 0, amt: 0 }; byScheme[sc].c++; byScheme[sc].amt += amount;
        byPlatform[pf] = byPlatform[pf] || { c: 0, amt: 0 }; byPlatform[pf].c++; byPlatform[pf].amt += amount;
      } else if (status === 'Matured' || status === 'Withdrawn') {
        if (status === 'Matured') counts.matured++; else counts.withdrawn++;
        returnsRealized += returns - amount;
        receivedBack += returns;
      }
      entries.push({
        row: o.r, date: String(c[0] || ''), amount, scheme: String(c[2] || ''),
        platform: String(c[3] || ''), status, returns, notes: String(c[6] || ''),
        exitDate: String(c[8] || ''),
      });
    });
  }
  entries.sort((a, b) => b.date.localeCompare(a.date));   // newest first
  return { invested, returnsRealized, receivedBack, byScheme, byPlatform, counts, entries };
}

/* ── Cash position: bank balance, awaiting payout, monthly cash, daily curve ── */
export type Cash = {
  netPnL: number; pending: number; bank: number; totalNet: number; totalExp: number;
  curUnpaid: number; curM: string;
  /* The savings leg of the bank, exposed so a caller can show the balance both
     before and after it. `bank` folds these in, but the monthly table sums to
     bankBeforeSavings — without these the total row could not be reconciled,
     and per-property views (where savings are deliberately not applied) looked
     like they simply disagreed with the All view. */
  svInvested: number; svReturns: number; bankBeforeSavings: number;
  /* One-time spend that is NOT flagged initial investment — setup bought out
     of the business's own cash (e.g. the 685 Gurgaon fit-out). It is a cash
     outflow, so it reduces the bank, but it is not trading opex: netPnL and
     Monthly P&L stay on the Recurring + Operating basis. Flagged rows remain
     external capital and stay out of the bank entirely. */
  oneTime: number;
  monthly: { month: string; recv: number; opex: number; oneTime: number; cash: number }[];
  curMatrix: Record<string, { Stay: number; Resold: number; Pass: number }>;
  dayMap: Record<string, number>;
};
export function computeCash(b: LogBlock | null, e: LogBlock | null, filter: string, sv?: LogBlock | null): Cash {
  const curM = ciCurMonth();
  let totalNet = 0, pending = 0, curUnpaid = 0, totalExp = 0, oneTime = 0;
  const M: Record<string, { recv: number; opex: number; oneTime: number }> = {};
  const curMatrix: Cash['curMatrix'] = {};
  const dayMap: Record<string, number> = {};
  const bucket = (mk: string) => { if (!mk) return null; M[mk] = M[mk] || { recv: 0, opex: 0, oneTime: 0 }; return M[mk]; };
  const day = (dk: string, v: number) => { if (dk) dayMap[dk] = (dayMap[dk] || 0) + v; };
  if (b && b.rows) {
    b.rows.forEach((o) => {
      const c = o.cells;
      /* Money earned is money earned: a booking with no Booking ID used to be
         dropped from every cash figure here, while the server's own revenue KPI
         counted it — so the two would disagree the moment a row lacked an ID. */
      if (!c) return;
      const sc = scopeBooking(c, filter);
      if (!sc) return;
      const net = sc.share(ciNum(c[9])), mlbl = ciMonthLabel(c);
      /* Clamped at 0: `pending` only ever counted positives, but `recv`
         subtracted the raw value, so a negative pending added money that was
         never received (net 5,000 with pending −1,000 showed Received 6,000). */
      const pend = Math.max(0, sc.share(ciNum(c[11])));
      totalNet += net;
      if (pend > 0) { pending += pend; if (mlbl === curM) curUnpaid += pend; }
      const mk = bucket(mlbl); if (mk) mk.recv += net - pend;
      day(ciDayKey(c[0]), net - pend);
      if (mlbl === curM) {
        const ch = c[4] || '(none)', ty = c[3] as 'Stay' | 'Resold' | 'Pass';
        curMatrix[ch] = curMatrix[ch] || { Stay: 0, Resold: 0, Pass: 0 };
        if (curMatrix[ch][ty] !== undefined) curMatrix[ch][ty] += net;
      }
    });
  }
  if (e && e.rows) {
    e.rows.forEach((o) => {
      const c = o.cells;
      if (!c) return;
      if (filter && filter !== 'All' && String(c[3]) !== String(filter)) return;
      const type = String(c[7] || '');
      // bank-balance basis: Recurring/Operating opex that is NOT initial investment
      if ((type === 'Recurring' || type === 'Operating') && !ciInitInvest(c[12])) {
        const amt = ciNum(c[6]);
        totalExp += amt;
        const mk = bucket(ciMonthOf(c[1])); if (mk) mk.opex += amt;
        day(ciDayKey(c[0]) || ciDayKey(c[1]), -amt);
      } else if (type === 'One-time' && !ciInitInvest(c[12])) {
        // paid from business cash: leaves the bank, but is not opex
        const amt = ciNum(c[6]);
        oneTime += amt;
        const mk = bucket(ciMonthOf(c[1])); if (mk) mk.oneTime += amt;
        day(ciDayKey(c[0]) || ciDayKey(c[1]), -amt);
      }
    });
  }
  // Savings are global (never per-property): adjust bank + day curve only on the All view.
  // Balance-sheet move only — netPnL / monthly are untouched.
  let svInvested = 0, svReturns = 0;
  if (sv && sv.rows && filter === 'All') {
    sv.rows.forEach((o) => {
      const c = o.cells;
      if (!c) return;
      const status = ciSaveStatus(c[4]);
      if (status === 'Active') {
        const amt = ciNum(c[1]);
        svInvested += amt;
        day(ciDayKey(c[0]), -amt);
      } else if (status === 'Matured' || status === 'Withdrawn') {
        /* Exited: the principal left on the investment date and the total
           received came back on the exit date. Net effect on the bank is the
           gain (received − amount), which is what svReturns carries; the day
           curve books both legs on their real days so it still ends on `bank`.
           Rows exited before exit_date existed fall back to the investment day. */
        const amt = ciNum(c[1]), recv = ciNum(c[5]);
        svReturns += recv - amt;
        day(ciDayKey(c[0]), -amt);
        day(ciDayKey(c[8]) || ciDayKey(c[0]), recv);
      }
    });
  }
  const netPnL = totalNet - totalExp;
  const bankBeforeSavings = netPnL - pending - oneTime;
  const bank = bankBeforeSavings - svInvested + svReturns;
  const monthly = Object.keys(M)
    .sort((a, b) => ciMonthSort(a) - ciMonthSort(b))
    .map((k) => ({ month: k, recv: M[k].recv, opex: M[k].opex, oneTime: M[k].oneTime,
                   cash: M[k].recv - M[k].opex - M[k].oneTime }));
  return { netPnL, pending, bank, totalNet, totalExp, curUnpaid, curM, monthly, curMatrix, dayMap,
           svInvested, svReturns, bankBeforeSavings, oneTime };
}

/* ── Initial investment payback ──
   "Have we made the setup capital back yet?"

   The setup capital is exactly the expense rows flagged Initial investment
   (cell 12). Those rows are deliberately kept out of the bank balance and out
   of Monthly P&L — see computeCash — precisely because they are capital, not
   opex. That is what makes a payback card meaningful: everything else on the
   Dashboard is trading performance, and this is the one place the capital shows.

   Recovered is the operating profit to date (Cash.netPnL — revenue less
   recurring/operating opex, on the SAME basis as the Net P&L card), so the two
   agree. `received` is the stricter, cash-in-hand variant: profit less money
   still awaiting payout — a booking that has not paid yet has not paid back
   anything. Both are shown; only the accrual figure drives `covered`, matching
   the headline Net P&L a reader is comparing against.

   Follows the property filter (expense cell 3), so a per-property view answers
   the payback question for that property alone. */
export type Payback = {
  invested: number;      // Σ flagged expense amount
  profit: number;        // operating profit to date (accrual)
  received: number;      // profit less amounts still awaiting payout
  recovered: number;     // profit clamped to [0, invested] — the bar's fill
  remaining: number;     // max(0, invested − profit)
  pct: number;           // recovered / invested, 0–100 (0 when nothing invested)
  covered: boolean;
  surplus: number;       // profit beyond the capital, once covered
  count: number;
  byCategory: Record<string, { c: number; amt: number }>;
  items: { date: string; item: string; category: string; property: string; amt: number }[];
};
export function computePayback(e: LogBlock | null, cash: Cash, filter: string): Payback {
  let invested = 0, count = 0;
  const byCategory: Payback['byCategory'] = {};
  const items: Payback['items'] = [];
  if (e && e.rows) {
    e.rows.forEach((o) => {
      const c = o.cells;
      if (!c) return;
      if (filter && filter !== 'All' && String(c[3]) !== String(filter)) return;
      if (!ciInitInvest(c[12])) return;
      const amt = ciNum(c[6]);
      invested += amt; count++;
      const cat = String(c[4] || 'Other');
      byCategory[cat] = byCategory[cat] || { c: 0, amt: 0 };
      byCategory[cat].c++; byCategory[cat].amt += amt;
      items.push({
        date: String(c[0] || c[1] || ''), item: String(c[2] || '(no label)'),
        category: cat, property: String(c[3] || ''), amt,
      });
    });
  }
  items.sort((a, b) => b.amt - a.amt);
  const profit = cash.netPnL;
  const received = profit - cash.pending;
  const recovered = Math.max(0, Math.min(profit, invested));
  const remaining = Math.max(0, invested - profit);
  const pct = invested > 0 ? (recovered / invested) * 100 : 0;
  return {
    invested, profit, received, recovered, remaining, pct,
    covered: invested > 0 && profit >= invested,
    surplus: Math.max(0, profit - invested),
    count, byCategory, items,
  };
}

/* ── Monthly P&L per-month drill (same basis as the table) ── */
export function computeMonthDrill(
  ci: LogBlock | null, ex: LogBlock | null, filter: string, mk: string
) {
  const all = mk === '*';
  const byType: Record<string, { c: number; net: number }> = {
    Stay: { c: 0, net: 0 }, Resold: { c: 0, net: 0 }, Pass: { c: 0, net: 0 },
  };
  const byChan: Record<string, { c: number; net: number }> = {};
  const mx: Record<string, { Stay: number; Resold: number; Pass: number }> = {};
  let bk = 0, rev = 0;
  if (ci && ci.rows) {
    ci.rows.forEach((o) => {
      const c = o.cells;
      /* Money earned is money earned: a booking with no Booking ID used to be
         dropped from every cash figure here, while the server's own revenue KPI
         counted it — so the two would disagree the moment a row lacked an ID. */
      if (!c) return;
      const sc = scopeBooking(c, filter);
      if (!sc) return;
      const mlbl = ciMonthLabel(c);
      if (!mlbl) return;
      if (!all && mlbl !== mk) return;
      const net = sc.share(ciNum(c[9])), ty = c[3], ch = c[4] || '(none)';
      /* Money is attributed, the booking is not: it stays counted against the
         unit that took it, so the per-unit counts still add up to the real
         total while the revenue moves to whoever earned it. */
      if (sc.own) bk++;
      rev += net;
      if (byType[ty]) { if (sc.own) byType[ty].c++; byType[ty].net += net; }
      byChan[ch] = byChan[ch] || { c: 0, net: 0 }; if (sc.own) byChan[ch].c++; byChan[ch].net += net;
      mx[ch] = mx[ch] || { Stay: 0, Resold: 0, Pass: 0 };
      if ((mx[ch] as any)[ty] !== undefined) (mx[ch] as any)[ty] += net;
    });
  }
  let rec = 0, op = 0;
  const byCat: Record<string, number> = {};
  const items: { item: string; type: string; amt: number }[] = [];
  if (ex && ex.rows) {
    ex.rows.forEach((o) => {
      const c = o.cells;
      if (!c) return;
      if (filter && filter !== 'All' && String(c[3]) !== String(filter)) return;
      const type = String(c[7] || '');
      /* Same basis as computeCash: setup capital is excluded. Without the
         ciInitInvest guard this drill counted the initial-investment rows that
         the Bank figure leaves out, so the two panels on the same screen
         disagreed (₹337,839 vs ₹240,919 across the live book). */
      if ((type !== 'Recurring' && type !== 'Operating') || ciInitInvest(c[12])) return;
      const mlbl = ciMonthOf(c[1]);
      if (!all && mlbl !== mk) return;
      const amt = ciNum(c[6]);
      if (type === 'Recurring') rec += amt; else op += amt;
      const cat = c[4] || 'Other';
      byCat[cat] = (byCat[cat] || 0) + amt;
      items.push({ item: c[2] || '(no label)', type, amt });
    });
  }
  items.sort((a, b) => b.amt - a.amt);
  return { byType, byChan, mx, bk, rev, rec, op, exp: rec + op, net: rev - (rec + op), byCat, items };
}

/* ── Review follow-ups ──────────────────────────────────────────────────────
   Approach B (tracked state): bookings.review_status lives in D1 and arrives as
   the 27th booking cell. Older rows predate the column and read as '' — treated
   as 'pending' so nothing is silently skipped.

   Trigger: 4 hours after check-out. That needs a checkout TIME, which many
   historical bookings lack; those fall back to end-of-day on the checkout date
   so a blank time can never make a follow-up appear early. */
export const REVIEW_COL = 26;
export type ReviewStatus = 'pending' | 'requested' | 'received' | 'skipped';
export type ReviewItem = {
  row: number; id: string; guest: string; unit: string; prop: string;
  channel: string;
  /* Both ends of the stay in full. `out` is the checkout INSTANT used for the
     due-date arithmetic (it assumes end-of-day when no time was recorded);
     outD/outT are what was actually written down, which is what the card shows —
     the two must not be confused or the card would display an invented 11:59pm. */
  inD: Date | null; inT: string; outD: Date | null; outT: string;
  out: Date; due: Date; status: ReviewStatus;
  card: CardData;
};

/* Only a guest who booked through a platform has somewhere to leave a review, so
   only they are worth chasing. Written as a list of the channels that are NOT
   online rather than a list of the ones that are: a new OTA added to the booking
   form should start producing follow-ups on its own, whereas the handful of
   direct routes is a closed set. A blank channel is not chased either — nothing
   is known about where it came from. */
const OFFLINE_CHANNELS = new Set(['offline', 'direct/referral', 'pass', '']);
export function isOnlineChannel(v: any) {
  return !OFFLINE_CHANNELS.has(String(v ?? '').trim().toLowerCase());
}
const REVIEW_DELAY_MS = 4 * 3600 * 1000;
/* Follow-ups also expire. Without this, every historical booking that ever had a
   checkout date shows as pending forever — 111 of them on the first run against
   live data, which is exactly the unactionable backlog tracked state was meant
   to avoid. 14 days matches the window in which a guest can still leave a
   review, so a departure older than that is genuinely no longer chaseable. */
const REVIEW_WINDOW_MS = 14 * 86400 * 1000;

export function reviewStatusOf(c: any[]): ReviewStatus {
  const v = String(c[REVIEW_COL] ?? '').trim().toLowerCase();
  return (v === 'requested' || v === 'received' || v === 'skipped') ? v : 'pending';
}

/* Checkout instant = checkout date + checkout time, or end of that day when the
   time is blank. Returns null when there is no checkout date at all. */
export function checkoutInstant(c: any[]): Date | null {
  const d = ciParse(c[21]);
  if (!d) return null;
  const t = String(c[23] ?? '').trim();
  const m = t.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (!m) return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ap = (m[3] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, min, 0);
}

export function computeReviews(block: LogBlock | null, filter: string): ReviewItem[] {
  const now = Date.now();
  const out: ReviewItem[] = [];
  if (!block || !block.rows) return out;
  block.rows.forEach((o) => {
    const c = o.cells;
    if (!c || !c[18]) return;
    if (filter && filter !== 'All' && String(c[1]) !== String(filter)) return;
    /* Offline and direct guests have no listing to review — chasing them was
       noise on a list that is meant to be entirely actionable. */
    if (!isOnlineChannel(c[4])) return;
    const status = reviewStatusOf(c);
    if (status === 'received' || status === 'skipped') return;   // done — off the list
    const co = checkoutInstant(c);
    if (!co) return;
    const due = new Date(co.getTime() + REVIEW_DELAY_MS);
    if (due.getTime() > now) return;                             // not due yet
    if (now - co.getTime() > REVIEW_WINDOW_MS) return;           // too old to chase
    out.push({
      row: o.r, id: String(c[18]), guest: c[2] || '', unit: String(c[24] ?? ''),
      prop: c[1] || '', channel: c[4] || '',
      inD: ciParse(c[20]), inT: ciTime(c[22]), outD: ciParse(c[21]), outT: ciTime(c[23]),
      out: co, due, status, card: cardOf(o),
    });
  });
  out.sort((a, b) => b.out.getTime() - a.out.getTime());         // most recent departure first
  return out;
}

/* ── IDs pending ────────────────────────────────────────────────────────────
   Container model: one row per BOOKING showing an aggregate status, with the
   per-guest detail (lead / co-guest) revealed on tap.

   Expected guests = lead (always) + co-guest when the booking names one. The
   `guests` count column is deliberately NOT used: it counts occupants, which is
   often higher than the number of people we hold names for, and that would make
   the list permanently unsatisfiable. */
/* An ID has two sides, and a booking has up to two guests, so a document is
   addressed by both: 'lead'/'co' are the FRONT of each guest's ID (the side that
   is always needed), '-back' the reverse where one exists. Only the fronts are
   counted as required — an Aadhaar back is often wanted but a passport page or a
   driving licence photo may be the whole document. */
export type IdFront = 'lead' | 'co' | `g${number}`;
export type IdSlot = IdFront | `${IdFront}-back`;
export const ID_FRONTS: IdSlot[] = ['lead', 'co'];
export const backSlot = (front: IdFront): IdSlot => `${front}-back` as IdSlot;
/* Guest n (1-based) → the front slot of their ID: guests 1–2 keep the
   original lead/co slots, the rest are g3, g4 … */
export const frontForGuest = (n: number): IdFront => (n === 1 ? 'lead' : n === 2 ? 'co' : (`g${n}` as IdFront));
/* The front slot a document belongs to: 'lead-back' -> 'lead'. */
export const frontOf = (slot: IdSlot): IdFront => String(slot).replace(/-back$/, '') as IdFront;
/* How a guest slot reads to a person: 'lead' -> 'Lead guest', 'g3' -> 'Guest 3'. */
export const guestLabel = (front: IdFront): string =>
  front === 'lead' ? 'Lead guest' : front === 'co' ? 'Co-guest' : 'Guest ' + String(front).slice(1);
/* Guests 3+ stored on the booking (logs cell 27) as JSON text. */
export type ExtraGuest = { name: string; birthYr: string };
export function parseExtraGuests(v: any): ExtraGuest[] {
  let a = v;
  if (typeof a === 'string') { try { a = a ? JSON.parse(a) : []; } catch { a = []; } }
  return Array.isArray(a) ? a.map((g: any) => ({ name: String(g?.name || ''), birthYr: String(g?.birthYr || '') })) : [];
}
export type IdItem = {
  row: number; id: string; prop: string; guest: string; coGuest: string;
  ci: Date | null; expected: number; have: number; missing: IdSlot[];
  /* How many people are actually staying, and whether the second one was ever
     named — a blank co-guest field on a two-guest booking is a gap in the
     record, not evidence that only one person turned up. */
  guests: number; coNamed: boolean;
  card: CardData;
};
export type IdMap = Record<string, IdSlot[]>;   // booking row id -> slots already uploaded
/* booking row id -> the documents themselves. `id` addresses the object through
   the Worker's PIN-checked proxy; the bucket is never exposed. */
export type IdDoc = { id: number; slot: IdSlot; type: string };
export type IdDocMap = Record<string, IdDoc[]>;

/* Which ID fronts a booking needs. Shared by the IDs queue and the checklist's
   linked "Guest IDs collected" step, so both agree on what complete means. */
export function idSlotsOf(c: any[]): IdSlot[] {
  const coGuest = String(c[15] ?? '').trim();
  const guests = ciNum(c[17]);
  /* Two guests means two IDs, whether or not anyone typed the second name.
     Keying this off the co-guest FIELD (as it used to) under-counted 42 live
     bookings — Amegh's two-guest stay asked for one ID because the name box
     was empty. */
  const needsCo = !!coGuest || guests >= 2;
  const slots: IdSlot[] = needsCo ? ['lead', 'co'] : ['lead'];
  /* Named guests beyond the second each need an ID too. */
  parseExtraGuests(c[27]).forEach((g, i) => { if (g.name.trim()) slots.push(frontForGuest(i + 3)); });
  return slots;
}
export function computeIdsPending(
  block: LogBlock | null, filter: string, have: IdMap | null
): IdItem[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const out: IdItem[] = [];
  if (!block || !block.rows) return out;
  block.rows.forEach((o) => {
    const c = o.cells;
    if (!c || !c[18]) return;
    if (filter && filter !== 'All' && String(c[1]) !== String(filter)) return;
    /* Only bookings checking in today or later: a historical booking with no ID
       is not an action worth surfacing, it is an archive gap. */
    const ci = ciParse(c[20]) || ciParse(c[0]);
    if (!ci || ci.getTime() < today) return;
    const coGuest = String(c[15] ?? '').trim();
    const guests = ciNum(c[17]);
    const slots = idSlotsOf(c);
    const got = (have && have[String(o.r)]) || [];
    const missing = slots.filter((sl) => got.indexOf(sl) < 0);
    if (!missing.length) return;
    out.push({
      row: o.r, id: String(c[18]), prop: c[1] || '', guest: c[2] || '', coGuest,
      ci, expected: slots.length, have: slots.length - missing.length, missing,
      guests, coNamed: !!coGuest,
      card: cardOf(o),
    });
  });
  out.sort((a, b) => (a.ci?.getTime() || 0) - (b.ci?.getTime() || 0));  // soonest arrival first
  return out;
}


/* ── Inventory (IMS workbook) ──────────────────────────────────────────────
   Shapes returned by the invData action. `low` is derived server-side in SQL
   (Consumable AND a reorder level is set AND stock <= that level) — the app
   never recomputes it, so the Action tab and Inventory tab cannot disagree. */
export type InvItem = {
  r: number; id: string; property: string; category: string; item: string; type: string; key: string;
  required: number; inStock: number; pending: number; reorder: number | ''; low: boolean;
  unitPrice: number | ''; vendor: string; remarks: string;
};
export type InvMove = {
  r: number; date: string; key: string; movement: string; qty: number;
  unitCost: number | ''; totalCost: number; vendor: string; by: string; remarks: string;
};
export type InvLists = { properties: string[]; categories: string[]; types: string[]; movements: string[]; vendors: string[] };
export type InvData = { items: InvItem[]; movements: InvMove[]; lists: InvLists; generatedAt: string };


/* ── Estimated usage rates ─────────────────────────────────────────────────
   None of these items record a volume (ml/g), and no consumption has ever been
   logged, so a purely measured burn rate is unavailable. What IS available is
   real occupancy: 174 bookings. Amenity usage in a short-stay rental tracks
   stays and guests, not the calendar — an empty flat consumes no shampoo — so
   rates are expressed per STAY or per GUEST and multiplied by actual booking
   volume for that property.

   These are ESTIMATES and are labelled as such in the UI. A measured rate, once
   consumption is logged, always takes precedence over them.

   `every` = how many stays one unit is expected to last.
   `perGuest` = issued to each guest individually rather than once per stay. */
type Usage = { every: number; perGuest?: boolean; note: string };

const USAGE_BY_ITEM: { match: RegExp; use: Usage }[] = [
  // issued to each guest, every stay
  { match: /dental/i,            use: { every: 1, perGuest: true, note: '1 per guest per stay' } },
  { match: /slipper/i,           use: { every: 1, perGuest: true, note: '1 pair per guest per stay' } },
  // consumed every stay, or close to it
  { match: /garbage bag|dustbin|bin bag/i, use: { every: 1, note: '1 per stay' } },
  { match: /toilet roll/i,       use: { every: 1, note: '~1 per stay' } },
  { match: /tissue/i,            use: { every: 3, note: '1 per 3 stays' } },
  // bottles and packets — last across many stays
  { match: /shampoo|body wash/i, use: { every: 15, note: '1 bottle per ~15 stays' } },
  { match: /hand wash/i,         use: { every: 20, note: '1 bottle per ~20 stays' } },
  { match: /harpic|colin|airwick|room freshener|freshener/i,
                                 use: { every: 20, note: '1 per ~20 stays' } },
  { match: /dish washing|dishwash/i, use: { every: 20, note: '1 per ~20 stays' } },
  { match: /scrubber/i,          use: { every: 15, note: '1 per ~15 stays' } },
  { match: /candle/i,            use: { every: 10, note: '1 per ~10 stays' } },
  { match: /coffee|sugar|tea|spice|pepper|masala|salt/i,
                                 use: { every: 25, note: '1 pack per ~25 stays' } },
];
/* Fallback when nothing matches, so a newly added consumable still projects. */
const USAGE_BY_CATEGORY: Record<string, Usage> = {
  'Personal Care': { every: 10, note: 'est. 1 per ~10 stays' },
  Cleaning:        { every: 20, note: 'est. 1 per ~20 stays' },
  Kitchen:         { every: 25, note: 'est. 1 per ~25 stays' },
  Decoration:      { every: 10, note: 'est. 1 per ~10 stays' },
};
const USAGE_DEFAULT: Usage = { every: 20, note: 'est. 1 per ~20 stays' };

export function usageFor(item: InvItem): Usage {
  const hit = USAGE_BY_ITEM.find((u) => u.match.test(item.item));
  if (hit) return hit.use;
  return USAGE_BY_CATEGORY[item.category] || USAGE_DEFAULT;
}

/* Stays per day and average guests per stay, per property, from real bookings.
   Uses a trailing window so a quiet launch month does not depress the rate
   forever. Falls back to the whole history when the window is empty. */
export type Occupancy = { staysPerDay: number; guestsPerStay: number };
export function computeOccupancy(block: LogBlock | null, windowDays = 60): Record<string, Occupancy> {
  const out: Record<string, Occupancy> = {};
  if (!block || !block.rows) return out;
  const now = Date.now();
  const cut = now - windowDays * 86400000;
  const acc: Record<string, { recent: number; guests: number; all: number; firstAll: number }> = {};
  block.rows.forEach((o) => {
    const c = o.cells;
    if (!c || !c[18]) return;
    const d = ciParse(c[20]) || ciParse(c[0]);
    if (!d) return;
    /* Occupancy follows the guest: a cross-unit booking consumed a night in the
       stay unit, and counting it against the listing it arrived on would both
       overstate that unit's usage and hide the other's. */
    const prop = stayPropOf(c);
    const a = acc[prop] || (acc[prop] = { recent: 0, guests: 0, all: 0, firstAll: d.getTime() });
    a.all++;
    if (d.getTime() < a.firstAll) a.firstAll = d.getTime();
    if (d.getTime() >= cut && d.getTime() <= now) {
      a.recent++;
      a.guests += Math.max(1, ciNum(c[17]) || 1);
    }
  });
  Object.keys(acc).forEach((k) => {
    const a = acc[k];
    let staysPerDay = a.recent / windowDays;
    if (a.recent === 0 && a.all > 0) {
      const span = Math.max(1, Math.round((now - a.firstAll) / 86400000));
      staysPerDay = a.all / span;                 // fall back to lifetime average
    }
    out[k] = {
      staysPerDay,
      guestsPerStay: a.recent > 0 ? a.guests / a.recent : 2,
    };
  });
  return out;
}

/* Low-stock items for the Action tab, with a projected run-out date.

   The projection is a burn rate: everything consumed to date divided by the days
   over which it was consumed. It is deliberately conservative about admitting
   ignorance — a run-out date is only produced when there is real consumption
   history for that item. With none, `runOut` stays null and the UI says so
   rather than inventing a date, which would be worse than showing nothing. */
const NEG_MOVE = /Consumption|Damage|Transfer Out|Adjustment -/;

export type LowItem = InvItem & {
  runOut: Date | null;      // projected exhaustion date, null when unknowable
  daysLeft: number | null;
  outNow: boolean;          // already at zero — nothing left to project
  perDay: number | null;    // units consumed per day
  estimated: boolean;       // true = modelled from occupancy, false = measured
  rateNote: string;         // human-readable basis, shown in the UI
};

export function computeLowStock(
  inv: InvData | null, filter: string, bookings?: LogBlock | null
): LowItem[] {
  if (!inv || !inv.items) return [];
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const occ = computeOccupancy(bookings || null);

  /* Measured consumption, when any exists. */
  const used: Record<string, { qty: number; first: number }> = {};
  (inv.movements || []).forEach((m) => {
    if (!NEG_MOVE.test(m.movement)) return;
    const d = ciParse(m.date);
    if (!d) return;
    const u = used[m.key] || (used[m.key] = { qty: 0, first: d.getTime() });
    u.qty += Math.abs(ciNum(m.qty));
    if (d.getTime() < u.first) u.first = d.getTime();
  });

  return inv.items
    .filter((i) => i.low)
    .filter((i) => !filter || filter === 'All' || String(i.property) === String(filter))
    .map((i) => {
      const outNow = !(i.inStock > 0);
      let perDay: number | null = null;
      let estimated = true;
      let rateNote = '';

      /* Measured always wins: real consumption beats a model of it. */
      const u = used[i.key];
      if (u && u.qty > 0) {
        const days = Math.max(1, Math.round((today.getTime() - u.first) / 86400000));
        perDay = u.qty / days;
        estimated = false;
        rateNote = 'measured · ' + round2(u.qty / days) + '/day';
      } else {
        /* Estimated from occupancy: units per stay x stays per day. */
        const usage = usageFor(i);
        const o = occ[i.property] || occ['All'] || { staysPerDay: 0, guestsPerStay: 2 };
        const perStay = (usage.perGuest ? o.guestsPerStay : 1) / usage.every;
        perDay = perStay * o.staysPerDay;
        rateNote = usage.note;
        if (!(perDay > 0)) perDay = null;          // no bookings for this property yet
      }

      let runOut: Date | null = null;
      let daysLeft: number | null = null;
      if (!outNow && perDay && perDay > 0) {
        daysLeft = Math.floor(i.inStock / perDay);
        runOut = new Date(today.getTime() + daysLeft * 86400000);
      }
      return { ...i, runOut, daysLeft, outNow, perDay, estimated, rateNote };
    })
    .sort((a, b) => {
      if (a.outNow !== b.outNow) return a.outNow ? -1 : 1;
      if (a.daysLeft !== null && b.daysLeft !== null) return a.daysLeft - b.daysLeft;
      if (a.daysLeft !== null) return -1;
      if (b.daysLeft !== null) return 1;
      return (a.inStock - a.required) - (b.inStock - b.required);
    });
}

function round2(n: number) { return Math.round(n * 100) / 100; }

/* ── Stays: the occupancy view of a booking (check-in → check-out) ──────────
   The earnings calendar buckets money on the BOOKING date; this buckets nights
   on the STAY dates, which is what an availability calendar has to show. Two
   different questions, so deliberately two computations over the same rows.

   A booking with no check-in date is not placed on the calendar at all — the
   booking date is when money moved, not when someone slept there, and guessing
   would paint occupancy that never happened. Those rows are counted instead, so
   the gap is visible rather than silent. */
export type Stay = {
  row: number; id: string; guest: string; prop: string; unit: string;
  type: string; channel: string; net: number; pending: number; guests: number;
  inK: string; outK: string;          // 'yyyy-MM-dd', outK = departure day
  nights: number; inT: string; outT: string;
  assumedOut: boolean;                // no usable check-out date: shown as a single night
  /* Checked out the same day they arrived — a real, recorded departure with
     zero nights, not a missing one. */
  sameDay: boolean;
  /* Carried so the calendar can show a booking without a second lookup into the
     raw rows — the detail sheet is read-only and this is everything it shows. */
  paid: number; referrer: string; notes: string; coGuest: string;
};
export type StayData = { stays: Stay[]; undated: number; minMonth: string; maxMonth: string };

const DAY_MS = 86400000;
export function dayKeyOf(d: Date) {
  const z = (n: number) => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
}
/* The one place a form asks for "today".
   Every form used to build its own with `new Date().toISOString().slice(0,10)`,
   which is the UTC day, and UTC LAGS IST by 5:30 — so between midnight and
   05:30 IST it is still the previous date. Anything filed in that window (a
   late check-in written up at 01:00, the morning's first entry before dawn)
   was dated a day early, and an expense filed in those hours on the 1st landed
   in the previous MONTH. From 05:30 IST onwards the two agree, so the working
   day was never affected. getFullYear/getMonth/getDate read the phone's own
   clock and are right at every hour. */
export function todayIso() { return dayKeyOf(new Date()); }
export function thisMonthIso() { return todayIso().slice(0, 7); }
export function keyToDate(k: string) {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(k: string, n: number) {
  const d = keyToDate(k);
  d.setDate(d.getDate() + n);
  return dayKeyOf(d);
}
export function nightsBetween(inK: string, outK: string) {
  return Math.max(1, Math.round((keyToDate(outK).getTime() - keyToDate(inK).getTime()) / DAY_MS));
}

export function computeStays(block: LogBlock | null, filter: string): StayData {
  const stays: Stay[] = [];
  let undated = 0, minMonth = '', maxMonth = '';
  if (block && block.rows) {
    block.rows.forEach((o) => {
      const c = o.cells;
      if (!c || !c[18]) return;
      /* Nights belong to the flat the guest slept in — see inStayScope. The
         money carried along for the detail sheet is still this view's share. */
      if (!inStayScope(c, filter)) return;
      const sc = scopeBooking(c, filter);
      const share = sc ? sc.share : (a: number) => a;
      const inK = ciDayKey(c[20]);
      if (!inK) { undated++; return; }
      /* Three cases here, not two.
           no date        → assume one night: the guest was certainly there the
                            night they arrived, and nothing beyond that is known
           same day       → a REAL day-use booking (in at 2:30pm, out at 9pm).
                            This used to be lumped in with "missing" by an
                            `outK <= inK` test, which threw away a checkout the
                            user had just typed in and displayed "not recorded"
           before check-in → contradictory data; fall back to the assumption */
      const outRaw = ciDayKey(c[21]);
      const assumedOut = !outRaw || outRaw < inK;
      const sameDay = !!outRaw && outRaw === inK;
      const outK = assumedOut ? addDays(inK, 1) : (outRaw as string);
      stays.push({
        row: o.r, id: String(c[18]), guest: c[2] || '', prop: stayPropOf(c),
        unit: String(c[24] ?? ''), type: c[3] || '', channel: c[4] || '',
        net: share(ciNum(c[9])), pending: share(ciNum(c[11])), guests: ciNum(c[17]),
        inK, outK,
        /* A day-use booking is zero nights. nightsBetween() floors at 1, which
           is right for an assumed stay and wrong for this one. */
        nights: sameDay ? 0 : nightsBetween(inK, outK),
        inT: ciTime(c[22]), outT: ciTime(c[23]), assumedOut, sameDay,
        paid: ciNum(c[8]), referrer: c[5] || '', notes: c[12] || '', coGuest: c[15] || '',
      });
      const a = inK.slice(0, 7), b = outK.slice(0, 7);
      if (!minMonth || a < minMonth) minMonth = a;
      if (!maxMonth || b > maxMonth) maxMonth = b;
    });
  }
  stays.sort((x, y) => (x.inK === y.inK ? x.prop.localeCompare(y.prop) : x.inK.localeCompare(y.inK)));
  return { stays, undated, minMonth, maxMonth };
}

/* Nights of a stay that fall inside [fromK, toK) — the basis for occupancy.
   A departure day is not an occupied night, so the range is half-open at both
   ends and a same-day turnaround is counted once, not twice. */
export function nightsInRange(s: Stay, fromK: string, toK: string) {
  const a = s.inK > fromK ? s.inK : fromK;
  const b = s.outK < toK ? s.outK : toK;
  if (b <= a) return 0;
  return Math.round((keyToDate(b).getTime() - keyToDate(a).getTime()) / DAY_MS);
}


/* ─────────────── WEBSITE ENQUIRIES ───────────────
   Rows the public site (roam-in-heels.com) writes via the Worker's
   submitEnquiry. Cells follow ENQUIRY_COLS in worker/src/index.js:
   0 received · 1 property · 2 name · 3 mobile · 4 check-in · 5 check-out ·
   6 guests · 7 message · 8 heard via · 9 status · 10 status at · 11 notes */
export type EnquiryStatus = 'new' | 'contacted' | 'booked' | 'closed';
export type EnquiryItem = {
  row: number; received: string; property: string; name: string; mobile: string;
  checkIn: string; checkOut: string; guests: number; message: string; referral: string;
  status: EnquiryStatus; notes: string;
};
export type EnquiryData = { all: EnquiryItem[]; fresh: EnquiryItem[] };

export function computeEnquiries(block: LogBlock | null | undefined, prop: string): EnquiryData {
  const all: EnquiryItem[] = [];
  for (const o of block?.rows || []) {
    const c = o.cells;
    const property = String(c[1] ?? '');
    if (prop !== 'All' && property && property !== prop) continue;
    const st = String(c[9] || 'new').toLowerCase();
    all.push({
      row: o.r, received: String(c[0] ?? ''), property, name: String(c[2] ?? ''), mobile: String(c[3] ?? ''),
      checkIn: String(c[4] ?? ''), checkOut: String(c[5] ?? ''), guests: Number(c[6]) || 0,
      message: String(c[7] ?? ''), referral: String(c[8] ?? ''),
      status: (['new', 'contacted', 'booked', 'closed'].includes(st) ? st : 'new') as EnquiryStatus,
      notes: String(c[11] ?? ''),
    });
  }
  all.sort((a, b) => (a.received < b.received ? 1 : a.received > b.received ? -1 : 0));   // newest first
  return { all, fresh: all.filter((e) => e.status === 'new') };
}

/* '2026-10-10T14:00' → '10 Oct, 2:00 PM'. The guest typed it in their own
   local time, so it is shown as typed — never shifted through a timezone. */
export function fmtEnquiryWhen(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(s || ''));
  if (!m) return String(s || '');
  const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(m[2]) - 1];
  let out = Number(m[3]) + ' ' + mon;
  if (m[4] !== undefined) {
    const h = Number(m[4]); const ap = h >= 12 ? 'PM' : 'AM';
    out += ', ' + (((h + 11) % 12) + 1) + ':' + m[5] + ' ' + ap;
  }
  return out;
}

/* ── Daily revenue vs target ─────────────────────────────────────────────────
   Two ways to put a booking's money on a calendar day, and they answer
   different questions:
     * 'booked' — the whole net lands on the Booking Date (col A). "How much
       business did we close today?" Same basis as the Calendar's earnings and
       the server's Total Revenue card.
     * 'stay'   — the net is spread evenly over the nights the guest stays,
       check-in (col U) up to but not including check-out (col V). "How much did
       the flats earn today?" A booking with no check-out, or one that checks
       out the day it checks in (a Pass), puts its whole net on check-in day.
       A booking with no check-in date cannot be placed at all; it is counted
       in `unplaced` so the screen can say so rather than quietly dropping it.
   Money follows the cross-unit split exactly as everywhere else
   (scopeBooking), and only rows with a Booking ID count — the same rule as the
   server's revenue KPI and the Calendar, so the figures agree with both. */
export type RevBasis = 'booked' | 'stay';
/* `items` = the bookings behind a day's figure, so a tapped bar can list them:
   `amt` is what this booking contributed to THIS day (its whole net on the
   booking-date basis, one night's share on the stay basis), `night` is which
   night of `nights` that was (stay basis only). */
export type DayItem = { r: number; amt: number; night?: number; nights?: number };
export type DayRev = { key: string; rev: number; n: number; items: DayItem[] };
export type RevByDay = { days: Record<string, DayRev>; unplaced: number; unplacedAmt: number };

/* Local-calendar day arithmetic on a Date (addDays above works on day keys).
   new Date(y, m, d + i) rather than adding 86 400 000 ms, which lands on the
   wrong day across a DST change. */
export const shiftDay = (dt: Date, i: number) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + i);

export function revenueByDay(block: LogBlock | null, filter: string, basis: RevBasis): RevByDay {
  const days: Record<string, DayRev> = {};
  let unplaced = 0, unplacedAmt = 0;
  const add = (k: string, it: DayItem) => {
    const d = (days[k] = days[k] || { key: k, rev: 0, n: 0, items: [] });
    d.rev += it.amt; d.n++; d.items.push(it);
  };
  for (const o of (block && block.rows) || []) {
    const c = o.cells;
    if (!c || !c[18]) continue;
    const sc = scopeBooking(c, filter);
    if (!sc) continue;
    const net = sc.share(ciNum(c[9]));
    if (basis === 'booked') {
      const k = ciDayKey(c[0]);
      if (k) add(k, { r: o.r, amt: net }); else { unplaced++; unplacedAmt += net; }
      continue;
    }
    const inD = ciParse(c[20]);
    if (!inD) { unplaced++; unplacedAmt += net; continue; }
    const outD = ciParse(c[21]);
    const nights = outD ? Math.round((outD.getTime() - inD.getTime()) / 86400000) : 0;
    if (nights <= 0) { add(dayKeyOf(inD), { r: o.r, amt: net }); continue; }
    const per = net / nights;
    for (let i = 0; i < nights; i++) add(dayKeyOf(shiftDay(inD, i)), { r: o.r, amt: per, night: i + 1, nights });
  }
  return { days, unplaced, unplacedAmt };
}

/* The run of `count` consecutive days ending on `end`, oldest first, with
   empty days present as zero — a day nobody booked is a day that missed. */
export function dayWindow(by: RevByDay, end: Date, count: number): DayRev[] {
  const out: DayRev[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const k = dayKeyOf(shiftDay(end, -i));
    out.push(by.days[k] ? { ...by.days[k] } : { key: k, rev: 0, n: 0, items: [] });
  }
  return out;
}

/* Summary over complete days only. `target` null/0 = no target set: the hit
   count and gap are then null rather than a misleading 0. */
export type TargetSummary = {
  n: number; total: number; avg: number | null;
  hit: number | null; gap: number | null; pct: number | null;
  best: DayRev | null;
};
export function targetSummary(days: DayRev[], target: number | null): TargetSummary {
  const n = days.length;
  const total = days.reduce((a, d) => a + d.rev, 0);
  const avg = n ? total / n : null;
  const t = target && target > 0 ? target : null;
  let best: DayRev | null = null;
  for (const d of days) if (!best || d.rev > best.rev) best = d;
  return {
    n, total, avg,
    hit: t === null ? null : days.filter((d) => d.rev >= t).length,
    gap: t === null ? null : total - t * n,
    pct: t === null || avg === null ? null : (avg / t) * 100,
    best: best && best.rev > 0 ? best : null,
  };
}


/* ── Booking checklists ──────────────────────────────────────────────────────
   Property-wide steps (set by an Admin on the property) plus one-off steps
   added to a single booking, grouped by stage. Steps and ticks come from
   logs.checklist (worker: checklistData).

   Which property's steps a booking gets: the property the guest STAYS in —
   a cross-unit booking follows the guest (stayPropOf), as the calendar does,
   because rules like entry passes belong to the building.

   Which bookings a property step applies to: "edits apply to upcoming
   bookings". A step added after a booking had already checked out is not on
   that booking; a step removed after a booking checked out stays on it. Any
   step that was ticked always stays. The booking's end is its check-out day
   (falling back to check-in, then the booking date).

   Linked steps are never ticked by hand: 'ids' is done when every ID the
   booking needs is uploaded (idSlotsOf — same rule as the IDs queue), and
   'review' when the review was requested, received or deliberately skipped. */
export type ChecklistStage = 'before' | 'checkin' | 'stay' | 'checkout';
export const CHECKLIST_STAGES: { key: ChecklistStage; label: string }[] = [
  { key: 'before', label: 'Before check-in' },
  { key: 'checkin', label: 'Check-in' },
  { key: 'stay', label: 'During stay' },
  { key: 'checkout', label: 'Check-out' },
];
export const CHECKLIST_PRESETS: { key: string; label: string; stage: ChecklistStage; linked?: string }[] = [
  { key: 'ids', label: 'Guest IDs collected', stage: 'checkin', linked: 'Ticks itself when every guest’s ID is uploaded.' },
  { key: 'unit_details', label: 'Unit details shared', stage: 'before' },
  { key: 'entry_pass', label: 'Entry passes created & sent', stage: 'before' },
  { key: 'campaign', label: 'Campaign message shared', stage: 'stay' },
  { key: 'extend', label: 'Asked about extending the stay', stage: 'checkout' },
  { key: 'review', label: 'Asked for review', stage: 'checkout', linked: 'Ticks itself when the review is marked requested.' },
];
/* Steps a message can tick when sent — the linked ones tick themselves. */
export const LINKABLE_PRESETS = CHECKLIST_PRESETS.filter((p) => !p.linked);
export type ChecklistItemRow = {
  id: number; property: string; booking_row: number; preset: string; label: string;
  stage: ChecklistStage; sort: number; created_at: string; removed_at: string;
};
export type ChecklistTickRow = { booking_row: number; item_id: number; done_by: string; done_at: string };
export type ChecklistData = { items: ChecklistItemRow[]; ticks: ChecklistTickRow[] };
export type ChecklistEntry = {
  id: number; label: string; stage: ChecklistStage; preset: string;
  own: boolean;              // a one-off step on this booking (removable from the booking)
  linked: string;            // '' = tick by hand; otherwise why it ticks itself
  done: boolean; doneBy: string; doneAt: string;
  note: string;              // e.g. '1 of 2 IDs uploaded'
};

const isoDay = (iso: string) => { const d = iso ? new Date(iso) : null; return d && !isNaN(d.getTime()) ? dayKeyOf(d) : ''; };
const STAGE_ORDER: Record<string, number> = { before: 0, checkin: 1, stay: 2, checkout: 3 };

/* Live property steps, in display order — the property's checklist as set up. */
export function propertySteps(data: ChecklistData | null | undefined, property: string): ChecklistItemRow[] {
  return ((data && data.items) || [])
    .filter((it) => !it.booking_row && it.property === property && !it.removed_at)
    .sort((a, b) => (STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage]) || (a.sort - b.sort) || (a.id - b.id));
}

export function checklistFor(
  o: { r: number; cells: any[] }, data: ChecklistData | null | undefined, have: Record<string, string[]> | null | undefined,
): ChecklistEntry[] {
  const c = o.cells;
  if (!c || !data) return [];
  const prop = stayPropOf(c);
  const endKey = ciDayKey(c[21]) || ciDayKey(c[20]) || ciDayKey(c[0]);
  const ticks = new Map<number, ChecklistTickRow>();
  for (const t of data.ticks || []) if (t.booking_row === o.r) ticks.set(t.item_id, t);
  const out: ChecklistEntry[] = [];
  for (const it of data.items || []) {
    const own = it.booking_row === o.r;
    if (!own) {
      if (it.booking_row || it.property !== prop) continue;
      const tick = ticks.has(it.id);
      const added = isoDay(it.created_at), removed = isoDay(it.removed_at);
      const addedInTime = !endKey || !added || endKey >= added;
      const stillOn = !removed || (!!endKey && endKey < removed);
      if (!tick && !(addedInTime && stillOn)) continue;
    }
    const t = ticks.get(it.id);
    let done = !!t, note = '', linked = '';
    if (it.preset === 'ids') {
      linked = (CHECKLIST_PRESETS.find((p) => p.key === 'ids')!.linked as string);
      const need = idSlotsOf(c), got = (have && have[String(o.r)]) || [];
      const n = need.filter((sl) => got.indexOf(sl) >= 0).length;
      done = n >= need.length;
      note = n + ' of ' + need.length + ' ID' + (need.length === 1 ? '' : 's') + ' uploaded';
    } else if (it.preset === 'review') {
      linked = (CHECKLIST_PRESETS.find((p) => p.key === 'review')!.linked as string);
      const rs = reviewStatusOf(c);
      done = rs !== 'pending';
      note = rs === 'pending' ? 'Not asked yet' : 'Review ' + rs;
    }
    out.push({
      id: it.id, label: it.label, stage: it.stage, preset: it.preset, own, linked, done,
      doneBy: t ? t.done_by : '', doneAt: t ? t.done_at : '', note,
    });
  }
  return out.sort((a, b) =>
    (STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage]) || (Number(a.own) - Number(b.own)) || (a.id - b.id));
}

/* ── Booking page ──────────────────────────────────────────────────────────
   The number on the banner is where the guest actually sleeps: the stay unit
   when one was typed (it can be a flat we don't own — a resold stay in 3130),
   otherwise the unit number inside the stay property's name ("Spira 3028",
   "403, Plot no 685, Sector 45"). */
export function bannerUnitOf(c: any[]): string {
  const typed = String(c[24] ?? '').trim();
  if (typed) return typed;
  const m = stayPropOf(c).match(/\d{3,4}/);
  return m ? m[0] : '';
}

/* Where the stay is relative to today, in the words a manager would use. */
export type StayPhase = 'none' | 'upcoming' | 'arriving' | 'inhouse' | 'leaving' | 'past';
export function stayPhase(inD: Date | null, outD: Date | null, now: Date = new Date()): { phase: StayPhase; label: string } {
  if (!inD) return { phase: 'none', label: 'No stay dates' };
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const t = day(now), a = day(inD), b = outD ? day(outD) : a;
  const DAY = 86400000;
  if (t < a) {
    const n = Math.round((a - t) / DAY);
    return { phase: 'upcoming', label: n === 1 ? 'Arrives tomorrow' : 'Arrives in ' + n + ' days' };
  }
  if (t === a) return { phase: 'arriving', label: b === a ? 'Day use today' : 'Arriving today' };
  if (t < b) {
    const nights = Math.round((b - a) / DAY), k = Math.round((t - a) / DAY) + 1;
    return { phase: 'inhouse', label: 'In-house · night ' + k + ' of ' + nights };
  }
  if (t === b) return { phase: 'leaving', label: 'Checking out today' };
  return { phase: 'past', label: 'Checked out' };
}

/* Age from a birth year cell, '' when the year is missing or implausible. */
export function ageFrom(birthYr: any, now: Date = new Date()): string {
  const y = parseInt(String(birthYr ?? '').trim(), 10);
  if (!y || y < 1900 || y > now.getFullYear()) return '';
  return String(now.getFullYear() - y);
}

/* ── Message library ───────────────────────────────────────────────────────
   A template is text with {variables}. Booking variables come off the booking
   row; unit variables are the "guest info" facts an Admin keeps on each unit.
   A booking value wins over the unit's (a booked 1 pm arrival beats the
   standard 2 pm), and a variable with no value anywhere is reported as
   missing — never sent as a raw {wifi_password}. */
export type MessageStage = 'before' | 'checkin' | 'stay' | 'checkout' | 'any';
export type MessageAudience = 'guest' | 'host';
export const MESSAGE_STAGES: { key: MessageStage; label: string }[] = [
  { key: 'before', label: 'Before check-in' },
  { key: 'checkin', label: 'Check-in' },
  { key: 'stay', label: 'During stay' },
  { key: 'checkout', label: 'Check-out' },
  { key: 'any', label: 'Anytime' },
];
export type MessageTemplate = {
  id: number; title: string; body: string; stage: MessageStage; audience: MessageAudience;
  properties: string[]; preset: string; sort: number; updated_at?: string; updated_by?: string;
  /* Photos sent along with the text (served by getAttachment). */
  images?: MessageImage[];
};
export type MessageImage = { id: number; type: string; name: string };
export type PropertyFact = { property: string; key: string; label: string; value: string };
export type MessageSend = { booking_row: number; template_id: number; recipient: string; sent_by: string; sent_at: string };
export type MessagesData = { templates: MessageTemplate[]; facts: PropertyFact[]; sends: MessageSend[] };

/* The unit facts the app knows by name. Anything else an Admin adds is a
   custom fact ({door_code}, {parking_slot} …). */
export const UNIT_FACTS: { key: string; label: string; hint: string; multiline?: boolean }[] = [
  { key: 'address', label: 'Address', hint: 'Tower B, Flat 3028, Spira, Sector 68', multiline: true },
  { key: 'map_link', label: 'Google Maps link', hint: 'https://maps.app.goo.gl/…' },
  { key: 'wifi_name', label: 'Wi-Fi name', hint: 'Spira_3028' },
  { key: 'wifi_password', label: 'Wi-Fi password', hint: '' },
  { key: 'checkin_time', label: 'Standard check-in time', hint: '2:00 PM' },
  { key: 'checkout_time', label: 'Standard check-out time', hint: '11:00 AM' },
  { key: 'host_name', label: 'Host name', hint: '' },
  { key: 'host_phone', label: 'Host mobile', hint: '98XXXXXXXX' },
  { key: 'manager_name', label: 'Property manager name', hint: '' },
  { key: 'manager_phone', label: 'Property manager mobile', hint: '98XXXXXXXX' },
];

/* Every variable a template can use, in the order the editor offers them. */
export const MESSAGE_VARS: { key: string; label: string; group: 'Guest' | 'Stay' | 'Unit' }[] = [
  { key: 'guest_first_name', label: 'Guest first name', group: 'Guest' },
  { key: 'guest_name', label: 'Guest full name', group: 'Guest' },
  { key: 'guest_phone', label: 'Guest mobile', group: 'Guest' },
  { key: 'co_guest', label: 'Co-guest', group: 'Guest' },
  { key: 'guests', label: 'No. of guests', group: 'Guest' },
  { key: 'checkin_date', label: 'Check-in date', group: 'Stay' },
  { key: 'checkin_time', label: 'Check-in time', group: 'Stay' },
  { key: 'checkout_date', label: 'Check-out date', group: 'Stay' },
  { key: 'checkout_time', label: 'Check-out time', group: 'Stay' },
  { key: 'nights', label: 'Nights', group: 'Stay' },
  { key: 'booking_id', label: 'Booking ID', group: 'Stay' },
  { key: 'unit', label: 'Unit number', group: 'Unit' },
  { key: 'property', label: 'Property name', group: 'Unit' },
  ...UNIT_FACTS.filter((f) => f.key !== 'checkin_time' && f.key !== 'checkout_time')
    .map((f) => ({ key: f.key, label: f.label, group: 'Unit' as const })),
];
export const FACT_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
/* 'Door code' -> 'door_code' */
export const factKeyOf = (label: string) =>
  String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^[^a-z]+|_+$/g, '').slice(0, 40);

export const factsOf = (data: MessagesData | undefined, property: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const f of data?.facts || []) if (f.property === property) out[f.key] = f.value;
  return out;
};

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtLong = (d: Date | null) => (d ? DOW[d.getDay()] + ', ' + ciFmtDay(d) : '');

/* The values a booking supplies, unit facts underneath. Blank = not known. */
export function messageValues(o: { r: number; cells: any[] }, facts: Record<string, string>): Record<string, string> {
  const c = o.cells;
  const b = cardOf(o);
  const name = String(b.guest || '').trim();
  const v: Record<string, string> = { ...facts };
  const put = (k: string, x: any) => { const t = String(x ?? '').trim(); if (t) v[k] = t; };
  put('guest_name', name);
  put('guest_first_name', name.split(/\s+/)[0] || '');
  put('guest_phone', c[13]);
  put('co_guest', b.coGuest);
  put('guests', b.guests || '');
  put('checkin_date', fmtLong(b.inD));
  put('checkout_date', fmtLong(b.outD));
  put('checkin_time', b.inT);       // a time on the booking beats the unit's standard one
  put('checkout_time', b.outT);
  put('nights', b.nights ? String(b.nights) : '');
  put('booking_id', b.id);
  put('unit', bannerUnitOf(c));
  put('property', stayPropOf(c));
  return v;
}

/* Fill a template. `missing` lists each unknown variable once, in order. */
export function renderMessage(body: string, values: Record<string, string>): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = String(body || '').replace(/\{([a-z][a-z0-9_]*)\}/g, (m, k) => {
    const x = values[k];
    if (x !== undefined && x !== '') return x;
    if (missing.indexOf(k) < 0) missing.push(k);
    return m;
  });
  return { text, missing };
}
export const varLabel = (key: string, facts?: PropertyFact[]) =>
  (MESSAGE_VARS.find((x) => x.key === key) || UNIT_FACTS.find((x) => x.key === key))?.label
  || facts?.find((f) => f.key === key)?.label || key.replace(/_/g, ' ');

/* Which templates apply to a booking: those for every unit, or naming the
   unit the guest stays in. Ordered with the stage that is due now first. */
export function messagesFor(o: { r: number; cells: any[] }, data: MessagesData | undefined, now: Date = new Date()) {
  if (!data) return { list: [] as MessageTemplate[], due: 'any' as MessageStage };
  const prop = stayPropOf(o.cells);
  const b = cardOf(o);
  const ph = stayPhase(b.inD, b.outD, now).phase;
  const due: MessageStage = ph === 'upcoming' ? 'before' : ph === 'arriving' ? 'checkin'
    : ph === 'inhouse' ? 'stay' : ph === 'leaving' || ph === 'past' ? 'checkout' : 'any';
  const order = MESSAGE_STAGES.map((x) => x.key);
  const rank = (t: MessageTemplate) => (t.stage === due ? -1 : order.indexOf(t.stage));
  const list = data.templates
    .filter((t) => !t.properties.length || t.properties.indexOf(prop) >= 0)
    .sort((a, b2) => rank(a) - rank(b2) || a.sort - b2.sort || a.id - b2.id);
  return { list, due };
}

/* wa.me wants digits with the country code; a bare 10-digit number is Indian. */
export function waNumber(phone: string): string {
  const d = String(phone || '').replace(/[^\d]/g, '').replace(/^0+/, '');
  return d.length === 10 ? '91' + d : d;
}
export const waLink = (phone: string, text: string) =>
  'https://wa.me/' + waNumber(phone) + '?text=' + encodeURIComponent(text);

/* Starter library offered when it is empty — good defaults, edited freely. */
export const STARTER_MESSAGES: Omit<MessageTemplate, 'id' | 'sort'>[] = [
  { title: 'Booking confirmed', stage: 'before', audience: 'guest', properties: [], preset: '',
    body: 'Hi {guest_first_name}! 🙏 Thank you for booking unit {unit} with Roam in Heels.\n\nYour stay: {checkin_date} → {checkout_date} ({nights} nights)\nCheck-in from {checkin_time} · Check-out by {checkout_time}\n\nPlease share a photo of a government ID for each guest before arrival. See you soon!' },
  { title: 'Unit details & directions', stage: 'before', audience: 'guest', properties: [], preset: 'unit_details',
    body: 'Hi {guest_first_name}, here are the details for your stay 🏡\n\n📍 {address}\nMap: {map_link}\n\nCheck-in from {checkin_time} on {checkin_date}.\nFor anything on the day, call {manager_name} on {manager_phone}.' },
  { title: 'Wi-Fi', stage: 'checkin', audience: 'guest', properties: [], preset: '',
    body: 'Welcome in, {guest_first_name}! 📶\n\nWi-Fi: {wifi_name}\nPassword: {wifi_password}\n\nEnjoy your stay!' },
  { title: 'How is your stay?', stage: 'stay', audience: 'guest', properties: [], preset: '',
    body: 'Hi {guest_first_name}, hope you are settling in well at {unit}. Is there anything you need? Just reply here 😊' },
  { title: 'Check-out reminder + extend', stage: 'checkout', audience: 'guest', properties: [], preset: 'extend',
    body: 'Hi {guest_first_name}, a quick reminder that check-out is by {checkout_time} on {checkout_date}.\n\nEnjoying the place? We can extend your stay if the unit is free — just reply and we will check for you.' },
  { title: 'Thank you + review', stage: 'checkout', audience: 'guest', properties: [], preset: '',
    body: 'Thank you for staying with us, {guest_first_name}! 🌟 If you enjoyed it, a review would mean a lot to us. Safe travels!' },
  { title: 'New booking (for host)', stage: 'any', audience: 'host', properties: [], preset: '',
    body: 'New booking for {unit}: {guest_name} ({guests} guests)\n{checkin_date} {checkin_time} → {checkout_date} {checkout_time}\nBooking ID {booking_id} · Guest mobile {guest_phone}' },
];
