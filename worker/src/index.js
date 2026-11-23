/**
 * SPIRA TRACKER — JSON API on Cloudflare Workers + D1
 *
 * A drop-in replacement for the Google Apps Script web app (gas/Code.js).
 * The wire contract is deliberately IDENTICAL, so the existing clients need
 * nothing but a new API URL:
 *
 *   GET /?action=<name>&pin=<pin>[&payload=<json>][&row=<id>][&callback=<fn>]
 *
 *   - ?callback= returns JSONP (spira-tracker/index.html injects a <script>).
 *   - otherwise returns JSON with permissive CORS (the Expo app uses fetch).
 *   - errors come back as HTTP 200 with {error: "..."}, exactly as before —
 *     the clients test for a truthy .error, not for a status code.
 *
 * The `row` parameter used to be a spreadsheet row number; it is now the D1
 * primary key. Clients treat it as an opaque round-tripped value, so this is
 * invisible to them — but unlike sheet rows, ids no longer shift when another
 * row is deleted.
 */

import { runMirror } from './mirror.js';
import { clientIp, throttleCheck, recordFail, clearFails } from './throttle.js';
import { uploadAvatar, deleteAvatar, getAvatar, avatarAt, avatarMap } from './avatars.js';
import { idStatus, idDocs, listAttachments, uploadAttachment, getAttachment, deleteAttachment, sweepExpiredIds, AttachError, deleteBookingAttachments } from './attachments.js';
import { authenticate, whoAmI, ACTION_RIGHTS, OPEN_ACTIONS, rightLabel, listUsers, addUser, updateUser, changePin, setRoleRights } from './auth.js';
import { raiseTicket, listTickets, approveTicket, rejectTicket, withdrawTicket, approverName } from './tickets.js';

const TZ_OFFSET_MIN = 330;                       // Asia/Kolkata, fixed (no DST)
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/* Canonical recurring charges tracked each month (matched by category/item keyword). */
const RECURRING_ITEMS = [
  { name: 'Rent',             kw: ['rent'] },
  { name: 'Police charge',    kw: ['police'] },
  { name: 'Caretaker',        kw: ['caretaker'] },
  { name: 'Laundry',          kw: ['laundry'] },
  { name: 'Wifi',             kw: ['wifi', 'wi-fi', 'internet'] },
  { name: 'Electricity bill', kw: ['electric'] },
  { name: 'Re-stock',         kw: ['restock', 're-stock', 're stock'] }
];

/* ─────────────── date helpers ───────────────
   Dates are ISO 'YYYY-MM-DD' strings end to end. Comparing them
   lexicographically is chronological, so range filters need no parsing — this
   sidesteps the timezone bugs the Date-based Apps Script version was exposed to. */
function todayISO() {
  const d = new Date(Date.now() + TZ_OFFSET_MIN * 60_000);
  return d.toISOString().slice(0, 10);
}
function nowStamp() {                            // 'dd MMM yyyy, HH:mm' in IST
  const d = new Date(Date.now() + TZ_OFFSET_MIN * 60_000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ` +
         `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
function ddMMM(iso) {                            // '2026-05-02' -> '02 May'
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  return `${d} ${MONTHS[Number(m) - 1]}`;
}
function MMMyyyy(ym) {                           // '2026-05' -> 'May 2026'
  if (!ym) return '';
  const [y, m] = ym.split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

/* ─────────────── value helpers ─────────────── */
function num(v) {
  if (v === '' || v === null || v === undefined) return 0;
  if (typeof v === 'string') v = v.replace(/[^0-9.\-]/g, '');
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}
/* Optional numeric: preserves the sheet's distinction between a blank cell and
   a real 0. Blank -> null in the DB, and -> '' on the wire. */
/* ── MONEY ──
   The server half of mobile/src/money.ts. Same grammar, deliberately
   duplicated rather than inferred: digits, at most one decimal point with at
   most two decimals, an optional leading minus. Commas, spaces and ₹ are
   formatting a person types and are removed; everything else is refused.

   num() stays as it is — it swallows NaN and returns 0 so one bad legacy cell
   can never break a total — but that makes it useless as a validator, and the
   validator it replaced (looksNumeric) was no better: it deleted the characters
   it did not recognise and then asked whether the remainder parsed, so '12ab34',
   '1.2.3', '1e3' and '(500)' all passed. All four reached an admin's approval
   queue with a label showing one figure and a payload that stored another.

   moneyNum() is used by every write path AND — because TICKET_SPECS.validate
   runs the same field builders — by every approval request, so a value that a
   form would refuse can no longer be queued by hand-editing the query string. */
const MONEY_STRIP = /[,\s ₹$£€]/g;
/* The same sentence the form says, word for word. The two used to differ —
   "…must be a number like 25000 or 1250.50" here, "…must be a number, like 1500
   or 1500.50" there — so a person who met both rules had no way to know they
   were one rule. Kept in step by hand with MONEY_RULE in mobile/src/money.ts. */
const MONEY_RULE = 'must be a number, like 1500 or 1500.50';
function moneyNum(v, label) {
  if (typeof v === 'number') {
    if (!isFinite(v)) bad(`${label} ${MONEY_RULE}`);
    return v;
  }
  const s = String(v === null || v === undefined ? '' : v).replace(MONEY_STRIP, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) bad(`${label} ${MONEY_RULE}`);
  return parseFloat(s);
}
/* Indian grouping, for anything a person READS rather than a column a machine
   sums. An approval label saying ₹598111 sat one screen away from a KPI saying
   ₹5,98,111 — the same figure, with no two ways about it being the same. */
function inrText(n) {
  const neg = n < 0;
  const abs = Math.abs(n);
  const fixed = Math.round(abs) === abs ? String(abs) : abs.toFixed(2);
  const [i, f] = fixed.split('.');
  const last3 = i.slice(-3);
  const rest = i.slice(0, -3);
  const grouped = (rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' : '') + last3;
  return (neg ? '-' : '') + grouped + (f ? '.' + f : '');
}
/* An expense is a cost. A negative one is not a refund — a refundable deposit
   has its own column, and a credit belongs on the booking it came from. The
   Amount box on the form drops a minus as it is typed (and now says so); this
   is the same rule on the other side of the wire, so a hand-made request can no
   longer store what the form will not accept. The field, the form and the API
   disagreed: '-500' became 500 in the box and −500 through the API. */
function positiveMoney(v, label) {
  const n = moneyNum(v, label);
  if (n < 0) bad(`${label} cannot be negative — an expense is a cost, not a credit`);
  return n;
}
function optPositiveMoney(v, label) {
  return (v === '' || v === null || v === undefined) ? null : positiveMoney(v, label);
}
/* Blank stays blank (null in the DB); anything present must be real money. */
function optMoney(v, label) {
  return (v === '' || v === null || v === undefined) ? null : moneyNum(v, label);
}
function optNum(v) {
  return (v === '' || v === null || v === undefined) ? null : num(v);
}
function cell(v) { return (v === null || v === undefined) ? '' : v; }
function str(v)  { return (v === null || v === undefined) ? '' : String(v); }

class ApiError extends Error {}
function bad(msg) { throw new ApiError(msg); }

/* ─────────────── router ─────────────── */
export default {
  /* Cron trigger (wrangler.toml [triggers]) — pushes a full snapshot to the
     Google Sheet so it stays usable as a read-only view. One-way by design. */
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      await runMirror(env);
      /* 6-month retention on guest ID documents. Runs after the mirror so a
         mirror failure never silently skips the deletion. */
      await sweepExpiredIds(env);
    })());
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const p = Object.fromEntries(url.searchParams);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    try {
      const pin = p.pin;
      const payload = p.payload ? JSON.parse(p.payload) : {};
      const row = p.row === undefined ? null : Number(p.row);
      /* Two Action-tab writes carry their value as a bare query parameter
         rather than inside `payload`. Fold it in, so the approval path and the
         direct path are handed the same object and a ticket can store it. The
         wire contract is unchanged: ?status= and ?done= still work. */
      if (p.action === 'setReviewStatus' && payload.status === undefined) payload.status = p.status;
      if (p.action === 'setTaskDone' && payload.done === undefined) payload.done = p.done;
      let out;

      /* The website's enquiry form. The only write that needs no user: it is
         called server-to-server by roam-in-heels.com's /api/enquiry with the
         ENQUIRY_KEY secret in a header, never by a browser, so the key is not
         in any page source. Handled before sign-in because there is no PIN. */
      if (p.action === 'submitEnquiry') {
        if (request.method !== 'POST') bad('POST only');
        const key = request.headers.get('X-Enquiry-Key') || '';
        if (!env.ENQUIRY_KEY || key !== env.ENQUIRY_KEY) bad('Not allowed');
        return reply(p, await submitEnquiry(env, await request.json()));
      }

      /* Central sign-in + brute-force throttle. `user` is blank for the built-in
         owner account (the PIN secret), so pre-username clients still work. */
      const ip = clientIp(request);
      const blocked = await throttleCheck(env, ip);
      if (blocked) bad(blocked);
      const me = await authenticate(env, p.user, pin);
      if (!me) {
        await recordFail(env, ip);
        bad('Wrong username or PIN');
      }
      await clearFails(env, ip);

      /* Rights gate, before any handler runs. Fails closed: an action in
         neither list is refused rather than silently allowed. */
      const need = ACTION_RIGHTS[p.action];
      if (need) {
        if (!me.can(need)) bad(`Your role (${me.role}) does not have the right: ${rightLabel(need)}`);
      } else if (!OPEN_ACTIONS.has(p.action)) {
        bad('Unknown action: ' + p.action);
      }

      /* Uploads are multipart POSTs — they cannot go through the JSONP path. */
      if (request.method === 'POST' && p.action === 'uploadAttachment') {
        const form = await request.formData();
        out = await uploadAttachment(
          env, Number(form.get('row') || p.row), String(form.get('slot') || p.slot || ''), form.get('file')
        );
        return reply(p, out);
      }
      if (request.method === 'POST' && p.action === 'uploadAvatar') {
        const form = await request.formData();
        return reply(p, await uploadAvatar(env, me, form.get('file')));
      }
      if (p.action === 'getAvatar') {
        return await getAvatar(env, Number(p.id));
      }

      /* Streams a file back; returns a Response directly, not JSON. */
      if (p.action === 'getAttachment') {
        return await getAttachment(env, Number(p.id));
      }

      /* Only an Admin's update or delete is written straight away; anyone
         else's is validated and parked as a ticket for their manager. */
      const spec = TICKET_SPECS[p.action];
      if (spec && !me.isAdmin) {
        /* Settling payouts is the one bulk action: it becomes one request per
           booking (see raisePayoutTickets). */
        if (p.action === 'setPayouts') return reply(p, await raisePayoutTickets(env, me, payload));
        /* `ticket` is set when the app is resubmitting a request that was sent
           back — a new record has no row id to find the old request by. */
        return reply(p, await raiseTicket(env, me, p.action, row, payload, spec, Number(p.ticket) || 0));
      }

      switch (p.action) {
        case 'login':          out = { ...(await whoAmI(env, me)) }; out.user.avatarAt = await avatarAt(env, me.id); break;
        case 'deleteProperty': out = await deleteProperty(env, pin, payload); break;
        case 'tickets':        out = await listTickets(env, me, TICKET_SPECS); break;
        case 'approveTicket':  checkRow(row); out = await approveTicket(env, me, row, p.comment, (a, t, d) => applyGated(env, a, t, d)); break;
        case 'rejectTicket':   checkRow(row); out = await rejectTicket(env, me, row, p.comment); break;
        case 'withdrawTicket': checkRow(row); out = await withdrawTicket(env, me, row); break;
        case 'users': {
          out = await listUsers(env);
          const av = await avatarMap(env);
          for (const u of out.users) u.avatarAt = av[u.id] || 0;
          break;
        }
        case 'deleteAvatar':   out = await deleteAvatar(env, me); break;
        case 'addUser':        out = await addUser(env, me, payload); break;
        case 'updateUser':     checkRow(row); out = await updateUser(env, me, row, payload); break;
        case 'setRoleRights':  out = await setRoleRights(env, payload); break;
        case 'changePin':      out = await changePin(env, me, payload); break;
        case 'dashboard':      out = redactDashboard(await getDashboard(env, pin, p.property, p.from, p.to), me); break;
        case 'targets':        out = await getTargets(env); break;
        case 'addChecklistItem':    out = await addChecklistItem(env, me, payload); break;
        case 'removeChecklistItem': out = await removeChecklistItem(env, me, payload); break;
        case 'tickChecklist':       out = await tickChecklist(env, me, row, payload); break;
        case 'saveTemplate':        out = await saveTemplate(env, me, payload); break;
        case 'removeTemplate':      out = await removeTemplate(env, me, payload); break;
        case 'setPropertyFacts':    out = await setPropertyFacts(env, me, payload); break;
        case 'logMessageSend':      out = await logMessageSend(env, me, row, payload); break;
        case 'setTarget':      out = await setTarget(env, me, payload); break;
        case 'properties':     out = await getProperties(env, pin); break;
        case 'addBooking':     out = await addBooking(env, pin, payload); break;
        case 'addExpense':     out = await addExpense(env, pin, payload); break;
        case 'addProperty':    out = await addProperty(env, pin, payload); break;
        case 'updateProperty': out = await updateProperty(env, pin, payload); break;
        case 'logs':           out = await getLogs(env, pin); break;
        case 'updateBooking':  out = await updateBooking(env, pin, row, payload); break;
        case 'updateExpense':  out = await updateExpense(env, pin, row, payload); break;
        case 'deleteBooking':  out = await deleteRowById(env, pin, 'bookings', row, 'Booking deleted'); break;
        case 'deleteExpense':  out = await deleteRowById(env, pin, 'expenses', row, 'Expense deleted'); break;
        case 'addSaving':      out = await addSaving(env, pin, payload); break;
        case 'updateSaving':   out = await updateSaving(env, pin, row, payload); break;
        case 'deleteSaving':   out = await deleteRowById(env, pin, 'savings', row, 'Saving deleted'); break;
        case 'setPayouts':     out = await setPayouts(env, pin, payload); break;
        case 'addTask':        out = await addTask(env, pin, payload); break;
        case 'updateTask':     out = await updateTask(env, pin, row, payload); break;
        case 'setTaskDone':    out = await setTaskDone(env, pin, row, payload.done); break;
        case 'deleteTask':     out = await deleteRowById(env, pin, 'tasks', row, 'Action deleted'); break;
        case 'setEnquiryStatus': out = await setEnquiryStatus(env, row, payload); break;
        case 'invData':           out = await invData(env, pin); break;
        case 'invAddItem':        out = await invAddItem(env, pin, payload); break;
        case 'invUpdateItem':     out = await invUpdateItem(env, pin, row, payload); break;
        case 'invDeleteItem':     out = await invDeleteItem(env, pin, row); break;
        case 'invAddMovement':    out = await invAddMovement(env, pin, payload); break;
        case 'invUpdateMovement': out = await invUpdateMovement(env, pin, row, payload); break;
        case 'invDeleteMovement': out = await deleteRowById(env, pin, 'inv_movements', row, 'Movement deleted'); break;
        /* Manual mirror run, so the push can be verified without waiting for
           the cron window. PIN-gated like everything else. */
        case 'mirrorNow':      out = await runMirror(env); break;
        case 'setReviewStatus':   out = await setReviewStatus(env, pin, row, payload.status); break;
        case 'idStatus':          out = await idStatus(env); break;
        case 'idDocs':            out = await idDocs(env); break;
        case 'listAttachments':   out = await listAttachments(env, row); break;
        case 'deleteAttachment':  out = await deleteAttachment(env, Number(p.id)); break;
        case 'sweepIds':          out = await sweepExpiredIds(env); break;
        default: bad('Unknown action: ' + p.action);
      }
      return reply(p, out);
    } catch (err) {
      return reply(p, { error: String((err && err.message) || err) });
    }
  }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}
function reply(p, obj) {
  const txt = JSON.stringify(obj);
  /* Every mutation is a GET on a stable URL, so a cached response would report
     a write that never happened. Nothing caches it today — no validators are
     sent and the web build registers no service worker — but the cost of being
     explicit is one header. */
  const noStore = { 'Cache-Control': 'no-store' };
  if (p.callback) {
    return new Response(`${p.callback}(${txt})`, {
      headers: { 'Content-Type': 'application/javascript; charset=utf-8', ...noStore, ...corsHeaders() }
    });
  }
  return new Response(txt, {
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...noStore, ...corsHeaders() }
  });
}

/* Credentials and rights are checked once, in the router (see src/auth.js), so
   handlers no longer re-check the PIN. The `pin` parameter handlers still take
   is unused and kept only so their call sites stay unchanged. The owner PIN
   lives in a Worker secret, never in source. */

function checkRow(row) {
  if (!row || !Number.isFinite(row) || row < 1) bad('Invalid row');
}

/* ─────────────── CROSS-UNIT SPLIT ───────────────
   A booking arrives on one unit's listing (`property`) and the guest is given
   the other flat (`stay_unit`, free text the host types: '2212', ' 3028 ').
   When both are units we own and they differ, the unit that took the booking
   keeps a flat fee and the rest of the net is earned by the unit the guest
   actually slept in.

   Three properties of the rule, all load-bearing:
     * the fee is a CAP, not a transfer — a booking worth less than the fee
       leaves the whole net with the receiving unit and the stay unit at zero,
       so a split can never push a unit negative;
     * the two shares always sum to the booking's net, so every all-properties
       total is unchanged by the split — only the per-unit attribution moves;
     * it never fires for a flat we do not own. A Resold booking into 2012 or
       4230 is already handled by commission and must stay exactly as it is.

   `split_fee` is written at SAVE time and read back verbatim. Nothing here
   re-derives it from SPLIT_FEE afterwards, so changing the rate below only
   affects bookings saved from then on and can never restate a closed month. */
const SPLIT_FEE = 500;

const unitKey = (v) => String(v === null || v === undefined ? '' : v).trim().toLowerCase();
/* The trailing number a flat is known by: 'Spira 2212' -> '2212', and the same
   for the id ('SPIRA-2212'). That is what the host types into Stay unit. */
const unitNo = (v) => { const m = String(v || '').match(/(\d+)\s*$/); return m ? m[1] : ''; };

/* Resolve free-text `stay_unit` to the NAME of a property we own, or '' when it
   is not one of ours. Deliberately an exact match on the whole trimmed value:
   '3103, 3028' is a resale spanning someone else's flat and ours, not a stay in
   3028, and must not be read as a cross-unit move. */
function ownedProperty(props, unit) {
  const u = unitKey(unit);
  if (!u) return '';
  for (const p of props) {
    if (unitKey(p.name) === u || unitKey(p.id) === u) return p.name;
    if (unitNo(p.name) && unitNo(p.name) === u) return p.name;
    if (unitNo(p.id) && unitNo(p.id) === u) return p.name;
  }
  return '';
}

/* The two stored columns for one booking. Returns the no-split pair whenever
   either side is not ours, or the guest stayed in the unit that took it. */
function computeSplit(props, property, stayUnit, net) {
  const stayProp = ownedProperty(props, stayUnit);
  if (!stayProp) return { stay_property: '', split_fee: null };
  if (!ownedProperty(props, property)) return { stay_property: '', split_fee: null };
  if (unitKey(stayProp) === unitKey(property)) return { stay_property: '', split_fee: null };
  return { stay_property: stayProp, split_fee: Math.min(SPLIT_FEE, num(net)) };
}
async function splitFor(env, f) {
  return computeSplit(await readProperties(env), f.property, f.stay_unit, f.net_earned);
}

/* True when a stored row carries a split. `split_fee IS NULL` is the only test
   any read path makes — the columns are always written together. */
const isSplit = (r) => r && r.split_fee !== null && r.split_fee !== undefined && !!r.stay_property;

/* The receiving unit's share of ONE money figure (net, pending, …) on a split
   booking, given the fee stored on it. The stay unit gets the remainder, so the
   two always add back to `amount`. */
function receiverShare(amount, fee) {
  const a = num(amount), f = num(fee);
  if (a <= 0 || f <= 0) return a;   // nothing to share out, or the fee swallows it
  return Math.min(f, a);
}

/* Which rows a property view earns from, and how much of each.
     own:true  — this unit took the booking: its log, its count, its share
     own:false — the guest stayed here: this unit earns the remainder only, and
                 the booking is NOT counted again (it is still the other unit's
                 booking, so per-unit counts still add up to the real total)
   With no filter every row is whole and owned, which is the unsplit total. */
function scopeBookings(rows, fp) {
  const out = [];
  for (const r of rows) {
    const split = isSplit(r);
    if (!fp) { out.push({ r, own: true, share: (v) => num(v) }); continue; }
    if (r.property === fp) {
      out.push({ r, own: true, share: split ? (v) => receiverShare(v, r.split_fee) : (v) => num(v) });
    } else if (split && r.stay_property === fp) {
      out.push({ r, own: false, share: (v) => num(v) - receiverShare(v, r.split_fee) });
    }
  }
  return out;
}

/* ─────────────── PROPERTIES ─────────────── */
async function readProperties(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, name, location, type, status, onboarded, rent, notes
       FROM properties ORDER BY sort, rowid`
  ).all();
  return results.map(r => ({
    id: r.id, name: r.name, location: r.location, type: r.type, status: r.status,
    onboarded: r.onboarded || '', rent: num(r.rent), notes: r.notes
  }));
}
async function getProperties(env, pin) { return readProperties(env); }

/* Same id an add would generate, so a create request can be checked for a
   clash when it is raised rather than only when it is approved. */
const propertyId = (d) => String(d.id || d.name).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');
async function addProperty(env, pin, d) {
  if (!d.name) bad('Property name is required');
  const id = propertyId(d);
  const dupe = await env.DB.prepare('SELECT 1 FROM properties WHERE id = ?').bind(id).first();
  if (dupe) bad(`Property ID "${id}" already exists`);
  const maxSort = await env.DB.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM properties').first();
  await env.DB.prepare(
    `INSERT INTO properties (id, name, location, type, status, onboarded, rent, notes, sort)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, d.name, d.location || '', d.type || '', d.status || 'Active',
         d.onboarded || '', optMoney(d.rent, 'Monthly rent'), d.notes || '', (maxSort.m || 0) + 1).run();
  return { ok: true, message: `Property "${d.name}" added`, properties: await readProperties(env) };
}

/* Every transactional table stores the property NAME, not properties.id (see
   the schema note in 0001_init.sql). A rename therefore has to be cascaded or
   the old rows are orphaned: the dashboard filters `property = <selected name>`
   and a renamed unit reads as a brand-new, empty property. */
const PROPERTY_NAME_REFS = [
  ['bookings',  'property'],
  ['bookings',  'stay_property'],
  ['expenses',  'property'],
  ['inv_items', 'property'],
  ['enquiries', 'property'],
  ['checklist_items', 'property'],
  ['property_facts', 'property'],
  ['revenue_targets', 'scope'],
];

async function renamePropertyRefs(env, oldName, newName) {
  if (!oldName || !newName || oldName === newName) return 0;
  const stmts = PROPERTY_NAME_REFS.map(([t, c]) =>
    env.DB.prepare(`UPDATE ${t} SET ${c} = ? WHERE ${c} = ?`).bind(newName, oldName));
  /* Message templates hold their units as a JSON array of names. */
  stmts.push(env.DB.prepare(
    `UPDATE message_templates SET properties = REPLACE(properties, json_quote(?), json_quote(?))
      WHERE properties LIKE '%' || json_quote(?) || '%'`).bind(oldName, newName, oldName));
  const res = await env.DB.batch(stmts);   // one transaction: all tables move together
  return res.reduce((n, r) => n + ((r.meta && r.meta.changes) || 0), 0);
}

async function updateProperty(env, pin, d) {
  if (!d.origId) bad('Missing property reference');
  if (!d.name)   bad('Property name is required');
  /* addProperty pre-checks this; update did not, so renaming one property's id
     onto another's surfaced a raw D1 UNIQUE-constraint string in the toast. */
  const newId = d.id || d.origId;
  if (newId !== d.origId) {
    const clash = await env.DB.prepare('SELECT id FROM properties WHERE id = ?').bind(newId).first();
    if (clash) bad(`Property id "${newId}" is already in use`);
  }
  const prev = await env.DB.prepare('SELECT name FROM properties WHERE id = ?').bind(d.origId).first();
  if (!prev) bad('Property not found: ' + d.origId);
  const oldName = String(prev.name || '');
  if (d.name !== oldName) {
    const nameClash = await env.DB.prepare(
      'SELECT id FROM properties WHERE name = ? AND id <> ?').bind(d.name, d.origId).first();
    if (nameClash) bad(`Property name "${d.name}" is already used by ${nameClash.id}`);
  }
  const res = await env.DB.prepare(
    `UPDATE properties
        SET id = ?, name = ?, location = ?, type = ?, status = ?, onboarded = ?, rent = ?, notes = ?
      WHERE id = ?`
  ).bind(newId, d.name, d.location || '', d.type || '', d.status || 'Active',
         d.onboarded || '', optMoney(d.rent, 'Monthly rent'), d.notes || '', d.origId).run();
  if (!res.meta.changes) bad('Property not found: ' + d.origId);
  const moved = await renamePropertyRefs(env, oldName, d.name);
  return {
    ok: true,
    message: moved
      ? `Property "${d.name}" updated — ${moved} existing record${moved === 1 ? '' : 's'} re-pointed from "${oldName}"`
      : `Property "${d.name}" updated`,
    properties: await readProperties(env),
  };
}

/* ─────────────── DASHBOARD ───────────────
   Aggregation is done in JS over the full row set rather than in SQL. That is a
   deliberate choice: it keeps this a line-by-line port of the Apps Script
   version, so the response shape and every rounding/bucketing quirk stay
   identical. At a few hundred rows the cost is negligible; if the dataset ever
   grows past ~50k rows, push the sums down into SQL. */
async function getDashboard(env, pin, property, fromISO, toISO) {
  const fp = (property && property !== 'All') ? String(property) : null;
  const curKey = todayISO().slice(0, 7);

  const bAll = (await env.DB.prepare('SELECT * FROM bookings ORDER BY id').all()).results;
  const eAll = (await env.DB.prepare('SELECT * FROM expenses ORDER BY id').all()).results;

  const rFrom = fromISO || null;
  const rTo   = toISO   || null;
  const hasRange = !!(rFrom || rTo);
  const inR = (iso) => {
    if (!iso) return false;
    if (rFrom && iso < rFrom) return false;
    if (rTo   && iso > rTo)   return false;
    return true;
  };
  /* Expenses date on the txn date, falling back to the month bucket — matches
     the sheet's expDate_(), which read col A then col B. */
  const expDate = (r) => r.txn_date || r.expense_month || '';

  /* Per-property revenue is an ATTRIBUTION, not a row filter: a cross-unit
     booking appears in the receiving unit's view for its fee and in the stay
     unit's view for the remainder (see scopeBookings). Every figure below reads
     `x.share(...)` rather than the raw column, and counts only `x.own`, so the
     per-unit views still sum to exactly the all-properties total. */
  const bookings = scopeBookings(bAll.filter(r => r.booking_id), fp);
  const exp      = eAll.filter(r => !fp || r.property === fp);
  const bookingsR = hasRange ? bookings.filter(x => inR(x.r.booking_date)) : bookings;
  const expR      = hasRange ? exp.filter(r => inR(expDate(r)))            : exp;
  const ownCount  = (list) => list.reduce((n, x) => n + (x.own ? 1 : 0), 0);

  /* range-scoped: top KPIs, breakdown tables, drills */
  let stay = 0, resold = 0, pass = 0;
  const byType = { Stay: {c:0,net:0}, Resold: {c:0,net:0}, Pass: {c:0,net:0} };
  const byChannel = {}, dayMap = {}, revMatrix = {};
  for (const x of bookingsR) {
    const r = x.r;
    const type = r.booking_type, ch = r.channel || '(none)', net = x.share(r.net_earned), d = r.booking_date;
    /* Money follows the attribution; the count stays with the unit that took
       the booking, so a booking is never counted twice across the two views. */
    if (byType[type]) { if (x.own) byType[type].c++; byType[type].net += net; }
    if (type === 'Stay') stay += net; else if (type === 'Resold') resold += net; else if (type === 'Pass') pass += net;
    byChannel[ch] = byChannel[ch] || {c:0,net:0}; if (x.own) byChannel[ch].c++; byChannel[ch].net += net;
    if (!revMatrix[ch]) revMatrix[ch] = { Stay: 0, Resold: 0, Pass: 0 };
    if (revMatrix[ch][type] !== undefined) revMatrix[ch][type] += net;
    if (d) {
      dayMap[d] = dayMap[d] || {c:0,stay:0,comm:0}; if (x.own) dayMap[d].c++;
      if (type === 'Stay') dayMap[d].stay += net; else dayMap[d].comm += net;
    }
  }
  const commission = resold + pass, totalRev = stay + commission;
  const daily = Object.keys(dayMap).sort().map(k => ({
    date: ddMMM(k), bookings: dayMap[k].c, stay: dayMap[k].stay,
    commission: dayMap[k].comm, total: dayMap[k].stay + dayMap[k].comm
  }));
  const recent = bookingsR.slice(-8).reverse().map(x => ({
    id: x.r.booking_id, date: ddMMM(x.r.booking_date), guest: x.r.lead_guest,
    type: x.r.booking_type, channel: x.r.channel, net: x.share(x.r.net_earned)
  }));

  let oneTime = 0, recurring = 0, operating = 0, deposits = 0;
  const expenseByCategory = {};
  for (const r of expR) {
    const amt = num(r.amount), type = r.type;
    const ref = String(r.refundable).toLowerCase(), cat = r.category || 'Other';
    if (type === 'One-time')       oneTime   += amt;
    else if (type === 'Recurring') recurring += amt;
    else if (type === 'Operating') operating += amt;
    if (ref === 'yes') deposits += amt;
    if (type === 'One-time' || type === 'Recurring' || type === 'Operating') {
      expenseByCategory[cat] = (expenseByCategory[cat] || 0) + amt;
    }
  }
  const totalExp = oneTime + recurring + operating;

  /* full / month-scoped (independent of the range): current-month row, trend, checklist */
  const monthMap = {}, recurMonthMap = {};
  const monthByType = { Stay: {c:0,net:0}, Resold: {c:0,net:0}, Pass: {c:0,net:0} };
  const monthByChannel = {};
  for (const x of bookings) {
    const r = x.r, d = r.booking_date; if (!d) continue;
    const mk = d.slice(0, 7), type = r.booking_type, ch = r.channel || '(none)', net = x.share(r.net_earned);
    monthMap[mk] = monthMap[mk] || {c:0,stay:0,comm:0}; if (x.own) monthMap[mk].c++;
    if (type === 'Stay') monthMap[mk].stay += net; else monthMap[mk].comm += net;
    if (mk === curKey) {
      if (monthByType[type]) { if (x.own) monthByType[type].c++; monthByType[type].net += net; }
      monthByChannel[ch] = monthByChannel[ch] || {c:0,net:0}; if (x.own) monthByChannel[ch].c++; monthByChannel[ch].net += net;
    }
  }
  let expMonthRecur = 0, expMonthOper = 0; const monthRecur = [];
  for (const r of exp) {
    const amt = num(r.amount), type = r.type, em = r.expense_month;
    if ((type === 'Recurring' || type === 'Operating') && em) {
      const mk = em.slice(0, 7);
      recurMonthMap[mk] = (recurMonthMap[mk] || 0) + amt;   // Monthly P&L opex = Recurring + Operating
      if (mk === curKey) {
        if (type === 'Recurring') { expMonthRecur += amt; monthRecur.push({ cat: r.category || 'Other', item: r.item || '', amt }); }
        else expMonthOper += amt;
      }
    }
  }
  const expMonthTotal = expMonthRecur + expMonthOper;       // This-Month expense card = Recurring + Operating
  const recurringChecklist = RECURRING_ITEMS.map(it => {
    let amt = 0, added = false;
    for (const x of monthRecur) {
      const hay = `${x.cat} ${x.item}`.toLowerCase();
      if (it.kw.some(k => hay.indexOf(k) >= 0)) { added = true; amt += x.amt; }
    }
    return { name: it.name, added, amount: amt };
  });
  const cm = monthMap[curKey] || {c:0,stay:0,comm:0};
  const cmRev = cm.stay + cm.comm;
  const pnlKeys = Object.keys(Object.assign({}, monthMap, recurMonthMap)).sort();
  const monthlyPnl = pnlKeys.map(k => {
    const mm = monthMap[k] || {c:0,stay:0,comm:0};
    const rev = mm.stay + mm.comm, rec = recurMonthMap[k] || 0;
    return { month: MMMyyyy(k), bookings: mm.c, revenue: rev, recurring: rec, netPnl: rev - rec };
  });

  return {
    kpis:    { totalRev, totalExp, netPnL: totalRev - totalExp, bookings: ownCount(bookingsR), deposits },
    revenue: { stay, commission, total: totalRev },
    expenses:{ oneTime, recurring, operating, total: totalExp, deposits },
    byType, byChannel, monthlyPnl, daily, recent,
    recurringChecklist, expenseByCategory, monthByType, monthByChannel, revMatrix,
    kpisMonth: { totalRev: cmRev, totalExp: expMonthTotal, recurExp: expMonthRecur,
                 operExp: expMonthOper, netPnL: cmRev - expMonthTotal, bookings: cm.c },
    currentMonth: MMMyyyy(curKey),
    properties: await readProperties(env), filter: fp || 'All',
    generatedAt: nowStamp()
  };
}

/* Report metric rights: drop what the caller may not see before it leaves the
   Worker, so hiding a figure is not just a client-side courtesy. The figure
   stays in the shape (as null) so the app can tell "hidden" from "zero". */
function redactDashboard(d, me) {
  if (me.isAdmin) return d;
  const money = me.can('metric.money'), cash = me.can('metric.cash');
  const bk = me.can('metric.bookings'), ex = me.can('metric.expenses');
  if (!money) {
    d.kpis.totalRev = d.kpis.totalExp = d.kpis.netPnL = null;
    d.kpisMonth.totalRev = d.kpisMonth.totalExp = d.kpisMonth.recurExp = d.kpisMonth.operExp = d.kpisMonth.netPnL = null;
    d.revenue = null; d.monthlyPnl = []; d.daily = []; d.revMatrix = null;
  }
  if (!bk) {
    d.kpis.bookings = null; d.kpisMonth.bookings = null;
    d.byType = null; d.byChannel = {}; d.monthByType = null; d.monthByChannel = null; d.recent = [];
  }
  if (!ex) { d.expenses = null; d.expenseByCategory = null; d.recurringChecklist = []; }
  if (!cash) { d.kpis.deposits = null; if (d.expenses) d.expenses.deposits = null; }
  return d;
}

/* ─────────────── BOOKINGS ─────────────── */
async function nextBookingId(env) {
  const { results } = await env.DB.prepare(
    `SELECT booking_id FROM bookings WHERE booking_id LIKE 'B%'`
  ).all();
  let max = 0;
  for (const r of results) {
    const m = String(r.booking_id).match(/B(\d+)/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return 'B' + String(max + 1).padStart(3, '0');
}

/* Payload key -> stored column, for rebuilding a payload from an existing row.
   updateBooking/updateExpense write EVERY column, so a caller that sends only
   the fields it means to change used to blank the rest — a PATCH-shaped API
   behaving as PUT. Omitted keys are filled from the stored row instead. */
const BOOKING_FROM_ROW = {
  date: 'booking_date', property: 'property', guest: 'lead_guest', type: 'booking_type',
  channel: 'channel', referrer: 'referrer', listPrice: 'list_price', discount: 'discount',
  guestPaid: 'guest_paid', net: 'net_earned', commission: 'commission_paid',
  pending: 'pending_amount', notes: 'notes', phone: 'phone', leadBirthYr: 'lead_birth_yr',
  coGuest: 'co_guest', coGuestBirthYr: 'co_guest_birth_yr', guests: 'guests',
  checkinDate: 'checkin_date', checkoutDate: 'checkout_date',
  checkinTime: 'checkin_time', checkoutTime: 'checkout_time',
  stayUnit: 'stay_unit', repeat: 'repeat_flag', extraGuests: 'extra_guests'
};
const EXPENSE_FROM_ROW = {
  date: 'txn_date', expenseMonth: 'expense_month', item: 'item', property: 'property',
  category: 'category', quantity: 'quantity', amount: 'amount', type: 'type',
  status: 'status', refundable: 'refundable', vendor: 'vendor', notes: 'notes',
  initInvest: 'init_invest'
};
/* Payload merged over the stored row. A key the caller did not send keeps its
   stored value; a key sent as '' is still an explicit clear and is honoured. */
function mergeWithStored(map, row, d) {
  const base = {};
  for (const [key, col] of Object.entries(map)) {
    const v = row[col];
    base[key] = v === null || v === undefined ? '' : v;
  }
  const out = { ...base };
  for (const k of Object.keys(d)) if (d[k] !== undefined) out[k] = d[k];
  return out;
}

/* Shared validation + normalisation for add/update. */
function bookingFields(d) {
  if (!d.date) bad('Booking date is required');
  /* Unvalidated before, so 'not-a-date' stored as-is and month became
     'undefined not'. Every range filter is lexicographic on this column. */
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.date))) bad('Booking date must be YYYY-MM-DD');
  for (const [k, label] of [['checkinDate', 'Check-in date'], ['checkoutDate', 'Check-out date']]) {
    if (d[k] && !/^\d{4}-\d{2}-\d{2}$/.test(String(d[k]))) bad(`${label} must be YYYY-MM-DD`);
  }
  if (!d.type) bad('Booking type is required');
  /* getDashboard buckets only these three, so an unlisted type silently dropped
     the booking's revenue from the server KPI while the client still counted it. */
  if (!['Stay', 'Resold', 'Pass'].includes(String(d.type))) bad('Booking type must be Stay, Resold or Pass');
  if (d.net === '' || d.net == null) bad('Net Earned is required');
  const guestPaid = optMoney(d.guestPaid, 'Guest paid');
  const net = moneyNum(d.net, 'Net Earned');
  let comm = optMoney(d.commission, 'Commission');
  if (comm === null && guestPaid !== null) comm = guestPaid - net;   // derive when omitted
  return {
    booking_date: d.date,
    property: d.property || '',
    lead_guest: d.guest || '',
    booking_type: d.type,
    channel: d.channel || '',
    referrer: d.referrer || '',
    list_price: optMoney(d.listPrice, 'List price'),
    discount: optMoney(d.discount, 'Discount'),
    guest_paid: guestPaid,
    net_earned: net,
    commission_paid: comm,
    pending_amount: optMoney(d.pending, 'Pending amount'),
    notes: d.notes || '',
    phone: str(d.phone),
    lead_birth_yr: str(d.leadBirthYr),
    co_guest: d.coGuest || '',
    co_guest_birth_yr: str(d.coGuestBirthYr),
    guests: optNum(d.guests),
    month: MMMyyyy(String(d.date).slice(0, 7)),
    checkin_date: d.checkinDate || '',
    checkout_date: d.checkoutDate || '',
    checkin_time: d.checkinTime || '',
    checkout_time: d.checkoutTime || '',
    stay_unit: str(d.stayUnit),
    repeat_flag: d.repeat ? 1 : 0,
    extra_guests: extraGuestsJson(d.extraGuests)
  };
}

/* Guests 3+ — accepts an array or its JSON text (a merged stored row), keeps
   only named or dated entries, and caps the list. */
function extraGuestsJson(v) {
  let a = v;
  if (typeof a === 'string') { try { a = a ? JSON.parse(a) : []; } catch { a = []; } }
  if (!Array.isArray(a)) return '';
  const out = a.slice(0, 10).map((g) => ({
    name: String((g && g.name) || '').trim().slice(0, 80),
    birthYr: String((g && g.birthYr) || '').trim().slice(0, 4),
  }));
  /* Only trailing blanks go: a blank in the middle keeps its place, because a
     guest's position is what their ID document is filed under (g3, g4 …). */
  while (out.length && !out[out.length - 1].name && !out[out.length - 1].birthYr) out.pop();
  return out.length ? JSON.stringify(out) : '';
}

async function addBooking(env, pin, d) {
  if (!d.property) bad('Property is required');
  const f = bookingFields(d);
  /* Resolved and frozen here, never at read time — see the 0008 migration. */
  Object.assign(f, await splitFor(env, f));
  f.booking_id = await nextBookingId(env);
  const extra = checklistExtraOf(d);   // validated before the insert, so a bad step cannot half-save a booking
  const cols = Object.keys(f);
  const r = await env.DB.prepare(
    `INSERT INTO bookings (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  ).bind(...cols.map(c => f[c])).run();
  /* One-off checklist steps typed on the booking form. A manager's new booking
     carries them inside the approval request, so they land when it is approved. */
  if (extra.length) await insertBookingSteps(env, r.meta.last_row_id, extra, '');
  /* row lets the app attach guest IDs picked before the booking existed. */
  return { ok: true, message: `Booking ${f.booking_id} added`, row: r.meta.last_row_id, bookingId: f.booking_id };
}

async function updateBooking(env, pin, row, d) {
  checkRow(row);
  const existing = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(row).first();
  if (!existing) bad('Booking not found');
  /* Every column is written below, so anything the caller omitted has to come
     from the stored row or the update would blank it — property, check-in and
     check-out included. */
  const f = bookingFields(mergeWithStored(BOOKING_FROM_ROW, existing, d));
  /* Recomputed on every edit: changing the stay unit, the property or the net
     is exactly when the attribution has to move with it. */
  Object.assign(f, await splitFor(env, f));
  f.booking_id = d.bookingId || existing.booking_id;
  const cols = Object.keys(f);
  await env.DB.prepare(
    `UPDATE bookings SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`
  ).bind(...cols.map(c => f[c]), row).run();
  return { ok: true, message: `Booking ${f.booking_id} updated` };
}

/* Settle payments: clear the pending amount on one or more bookings.
   The id list is parsed on its own so the approval path can run exactly this
   rule before queueing a request. */
function payoutIds(d) {
  const rows = (d && d.rows) || [];
  if (!rows.length) bad('No rows given');
  const ids = rows.map(Number).filter(r => Number.isFinite(r) && r >= 1);
  if (!ids.length) bad('No rows given');
  return ids;
}
async function setPayouts(env, pin, d) {
  const ids = payoutIds(d);
  const res = await env.DB.prepare(
    `UPDATE bookings SET pending_amount = NULL WHERE id IN (${ids.map(() => '?').join(',')})`
  ).bind(...ids).run();
  const n = res.meta.changes;
  return { ok: true, message: `${n} payment${n === 1 ? '' : 's'} marked paid` };
}

/* ─────────────── EXPENSES ─────────────── */
function expenseFields(d) {
  /* `!d.amount` was a truthiness test: it rejected a numeric 0 while accepting
     the string '0', and let any non-numeric text through to num(). */
  if (d.amount === '' || d.amount == null) bad('Amount is required');
  if (!d.type)         bad('Expense type is required');
  if (!d.expenseMonth) bad('Expense month is required');
  // Unvalidated before: 'junk' stored as 'junk-undefined-01'.
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(String(d.expenseMonth))) bad('Expense month must be YYYY-MM');
  if (d.date && !/^\d{4}-\d{2}-\d{2}$/.test(String(d.date))) bad('Date must be YYYY-MM-DD');
  if (!d.item)         bad('Item / description is required');
  const [yy, mm] = String(d.expenseMonth).split('-');
  return {
    txn_date: d.date || '',
    expense_month: `${yy}-${String(mm).padStart(2, '0')}-01`,
    item: d.item,
    property: d.property || '',
    category: d.category || '',
    quantity: optPositiveMoney(d.quantity, 'Quantity'),
    amount: positiveMoney(d.amount, 'Amount'),
    type: d.type,
    status: d.status || 'Bought',
    refundable: d.refundable || (d.type === 'Deposit' ? 'Yes' : 'No'),
    vendor: d.vendor || '',
    notes: d.notes || '',
    init_invest: d.initInvest ? 1 : 0
  };
}
async function addExpense(env, pin, d) {
  if (!d.property) bad('Property is required');
  const f = expenseFields(d);
  const cols = Object.keys(f);
  await env.DB.prepare(
    `INSERT INTO expenses (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  ).bind(...cols.map(c => f[c])).run();
  return { ok: true, message: 'Expense added' };
}
async function updateExpense(env, pin, row, d) {
  checkRow(row);
  const existing = await env.DB.prepare('SELECT * FROM expenses WHERE id = ?').bind(row).first();
  if (!existing) bad('Expense not found');
  const f = expenseFields(mergeWithStored(EXPENSE_FROM_ROW, existing, d));
  const cols = Object.keys(f);
  const res = await env.DB.prepare(
    `UPDATE expenses SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`
  ).bind(...cols.map(c => f[c]), row).run();
  if (!res.meta.changes) bad('Expense not found');
  return { ok: true, message: 'Expense updated' };
}

/* ─────────────── generic delete ─────────────── */
const DELETABLE = new Set(['bookings', 'expenses', 'savings', 'inv_movements', 'tasks']);
async function deleteRowById(env, pin, table, row, message) {
  checkRow(row);
  if (!DELETABLE.has(table)) bad('Not deletable');      // guards the interpolated identifier
  /* A booking is the container for its guests' ID documents. Deleting the
     booking used to leave them in R2 until the 6-month retention sweep — an
     identity document with nothing left pointing at it. Data minimisation is
     the whole reason that sweep exists, so honour it here too. */
  if (table === 'bookings') await deleteBookingAttachments(env, row);
  const res = await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(row).run();
  if (!res.meta.changes) bad('Row not found');
  /* Its one-off checklist steps and every tick go with it. Property-wide steps
     belong to the property and stay. */
  if (table === 'bookings') {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM checklist_ticks WHERE booking_row = ?').bind(row),
      env.DB.prepare('DELETE FROM checklist_items WHERE booking_row = ?').bind(row),
      env.DB.prepare('DELETE FROM message_sends WHERE booking_row = ?').bind(row),
    ]);
  }
  return { ok: true, message };
}

/* ─────────────── SAVINGS ─────────────── */
const SAVING_SCHEMES   = ['FDs', 'Mutual Funds', 'Stocks', 'Bonds', 'Other'];
const SAVING_PLATFORMS = ['Slice', 'Groww', 'ET Money', 'Grip Invest', 'Others'];
const SAVING_STATUSES  = ['Active', 'Matured', 'Withdrawn'];

function savingFields(d) {
  if (!d.date) bad('Date is required');
  if (d.amount === '' || d.amount == null) bad('Amount is required');
  const amount = moneyNum(d.amount, 'Amount');
  if (!(amount > 0)) bad('Amount must be greater than 0');
  const scheme   = d.scheme   || 'Other';
  const platform = d.platform || 'Others';
  const status   = d.status   || 'Active';
  if (SAVING_SCHEMES.indexOf(scheme) < 0)     bad('Invalid scheme: ' + scheme);
  if (SAVING_PLATFORMS.indexOf(platform) < 0) bad('Invalid platform: ' + platform);
  if (SAVING_STATUSES.indexOf(status) < 0)    bad('Invalid status: ' + status);
  /* Exiting (Matured / Withdrawn) records WHEN the money came back and HOW MUCH
     in total landed in the bank — principal plus gain, or less on a loss.
     `returns` is that total received, not the gain: the bank adds it back on
     exit_date, against the principal that left on `date`. Active entries carry
     neither. */
  let returns = null, exitDate = '';
  if (status !== 'Active') {
    if (d.returns === '' || d.returns == null) bad('Amount received is required to exit');
    returns = moneyNum(d.returns, 'Amount received');
    if (returns < 0) bad('Amount received must be 0 or more');
    exitDate = d.exitDate || '';
    if (!exitDate) bad('Exit date is required');
    if (exitDate < d.date) bad('Exit date cannot be before the investment date');
  }
  return { date: d.date, amount, scheme, platform, status, returns, notes: d.notes || '', exitDate };
}
async function addSaving(env, pin, d) {
  const f = savingFields(d);
  await env.DB.prepare(
    `INSERT INTO savings (date, amount, scheme, platform, status, returns, notes, created_at, exit_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(f.date, f.amount, f.scheme, f.platform, f.status, f.returns, f.notes, todayISO(), f.exitDate).run();
  return { ok: true, message: 'Saving added' };
}
async function updateSaving(env, pin, row, d) {
  checkRow(row);
  const f = savingFields(d);
  const res = await env.DB.prepare(                     // never rewrites created_at
    `UPDATE savings SET date=?, amount=?, scheme=?, platform=?, status=?, returns=?, notes=?, exit_date=? WHERE id=?`
  ).bind(f.date, f.amount, f.scheme, f.platform, f.status, f.returns, f.notes, f.exitDate, row).run();
  if (!res.meta.changes) bad('Saving not found');
  return { ok: true, message: 'Saving updated' };
}


/* ─────────────── ACTIONS (to-dos) ───────────────
   The only Action-tab queue that is not derived from another record, so it is
   the only one that needs storage of its own. Two required fields, because two
   is what makes the list work: what to do, and by when — the end date is what
   decides whether an item is shown as due, and where it sorts. */
function taskFields(d) {
  const name = String(d.name || '').trim();
  if (!name) bad('Action name is required');
  const end = String(d.endDate || '').trim();
  if (!end) bad('End date is required');
  /* Anchored so a half-typed date cannot reach the DB and then sort as if it
     were the year 20. Everything downstream parses this as 'YYYY-MM-DD'. */
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) bad('End date must be YYYY-MM-DD');
  return { name, end_date: end, description: String(d.description || '') };
}

async function addTask(env, pin, d) {
  const f = taskFields(d);
  await env.DB.prepare(
    `INSERT INTO tasks (name, end_date, description, done, done_at, created_at)
     VALUES (?, ?, ?, 0, '', ?)`
  ).bind(f.name, f.end_date, f.description, todayISO()).run();
  return { ok: true, message: 'Action added' };
}

/* Deliberately does not touch `done`: editing the wording of an action is not a
   statement about whether it is finished. setTaskDone owns that column. */
async function updateTask(env, pin, row, d) {
  checkRow(row);
  const f = taskFields(d);
  const res = await env.DB.prepare(
    'UPDATE tasks SET name = ?, end_date = ?, description = ? WHERE id = ?'
  ).bind(f.name, f.end_date, f.description, row).run();
  if (!res.meta.changes) bad('Action not found');
  return { ok: true, message: 'Action updated' };
}

/* Explicit desired state rather than a toggle: a tap that arrives twice — a
   double tap, a retry after a timeout — must not undo itself. */
async function setTaskDone(env, pin, row, done) {
  checkRow(row);
  const on = isOn(done);
  const res = await env.DB.prepare('UPDATE tasks SET done = ?, done_at = ? WHERE id = ?')
    .bind(on ? 1 : 0, on ? todayISO() : '', row).run();
  if (!res.meta.changes) bad('Action not found');
  return { ok: true, message: on ? 'Marked done' : 'Marked not done' };
}

/* ─────────────── WEBSITE ENQUIRIES ───────────────
   Rows arrive from roam-in-heels.com (see submitEnquiry in the router). Every
   field is clipped: the form is public, and a pasted novel should not become
   a row nobody can open. */
const ENQUIRY_STATUSES = new Set(['new', 'contacted', 'booked', 'closed']);
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
async function submitEnquiry(env, d) {
  const name = clip(d.fullName, 120);
  const mobile = clip(d.mobile, 30);
  if (!name || !mobile) bad('Name and mobile are required');
  const referral = d.referralSource === 'Others' && d.referralOther
    ? 'Others — ' + clip(d.referralOther, 100) : clip(d.referralSource, 60);
  const guests = Math.max(0, Math.min(20, parseInt(d.guests, 10) || 0));
  const r = await env.DB.prepare(
    `INSERT INTO enquiries (created_at, property, full_name, mobile, check_in, check_out, guests, message, referral, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')`
  ).bind(new Date().toISOString(), clip(d.property, 80), name, mobile,
    clip(d.checkIn, 16), clip(d.checkOut, 16), guests, clip(d.message, 2000), referral).run();
  return { ok: true, id: r.meta.last_row_id };
}
/* Explicit desired state, like setTaskDone: a repeated tap lands on the same value. */
async function setEnquiryStatus(env, row, d) {
  checkRow(row);
  const st = String(d.status || '').toLowerCase();
  if (!ENQUIRY_STATUSES.has(st)) bad('Invalid enquiry status: ' + d.status);
  const sets = ['status = ?', 'status_at = ?'];
  const vals = [st, new Date().toISOString()];
  if (d.notes !== undefined) { sets.push('notes = ?'); vals.push(clip(d.notes, 2000)); }
  const res = await env.DB.prepare(`UPDATE enquiries SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, row).run();
  if (!res.meta.changes) bad('Enquiry not found');
  return { ok: true, message: 'Enquiry marked ' + st };
}

/* ─────────────── REVENUE TARGETS ───────────────
   A daily ₹ target per Report scope ('All' or a property name). Anyone who can
   open the Report may read them; only an Admin may set one. Not an approval
   ticket: a target is a goal, not a record in the books, and it changes no
   figure anywhere. */
async function getTargets(env) {
  const r = await env.DB.prepare('SELECT scope, daily, updated_at, updated_by FROM revenue_targets').all();
  const targets = {};
  for (const x of r.results || []) {
    targets[x.scope] = { daily: num(x.daily), updatedAt: x.updated_at, updatedBy: x.updated_by };
  }
  return { targets };
}
async function setTarget(env, me, d) {
  if (!me.isAdmin) bad('Only an Admin can set the revenue target');
  const scope = clip(d.scope, 120);
  if (!scope) bad('Missing target scope');
  if (scope !== 'All') {
    const p = await env.DB.prepare('SELECT 1 FROM properties WHERE name = ?').bind(scope).first();
    if (!p) bad('Unknown property: ' + scope);
  }
  /* Blank means "remove the target", not "target of ₹0". */
  if (d.daily === null || d.daily === undefined || String(d.daily).trim() === '') {
    await env.DB.prepare('DELETE FROM revenue_targets WHERE scope = ?').bind(scope).run();
    return { ok: true, message: 'Target removed' };
  }
  const daily = Number(d.daily);
  if (!isFinite(daily) || daily <= 0 || daily > 1e8) bad('The target must be a positive amount');
  await env.DB.prepare(
    `INSERT INTO revenue_targets (scope, daily, updated_at, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(scope) DO UPDATE SET daily = excluded.daily, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  ).bind(scope, Math.round(daily), new Date().toISOString(), me.username).run();
  return { ok: true, message: 'Target saved' };
}

/* ─────────────── BOOKING CHECKLISTS ───────────────
   Steps a property manager works through per booking, grouped by stage.
   Property-wide steps are set up by an Admin on the property; one-off steps
   can be added to a single booking by anyone who can add or edit bookings.
   Ticking is immediate (no approval request) and records who and when — the
   checklist is operations, not the books, and changes no figure.

   'ids' and 'review' are LINKED steps: the app reads them from the guest ID
   uploads and the booking's review status, so they are never ticked here. */
const CHECKLIST_STAGES = new Set(['before', 'checkin', 'stay', 'checkout']);
const CHECKLIST_PRESETS = {
  ids:          { label: 'Guest IDs collected',          stage: 'checkin' },
  unit_details: { label: 'Unit details shared',          stage: 'before' },
  entry_pass:   { label: 'Entry passes created & sent',  stage: 'before' },
  campaign:     { label: 'Campaign message shared',      stage: 'stay' },
  extend:       { label: 'Asked about extending the stay', stage: 'checkout' },
  review:       { label: 'Asked for review',             stage: 'checkout' },
};
const LINKED_PRESETS = new Set(['ids', 'review']);

function checklistStep(d) {
  const preset = String(d.preset || '').trim();
  if (preset && !CHECKLIST_PRESETS[preset]) bad('Unknown checklist step: ' + preset);
  const label = clip(d.label || (preset ? CHECKLIST_PRESETS[preset].label : ''), 120);
  if (!label) bad('Give the checklist step a name');
  const stage = String(d.stage || (preset ? CHECKLIST_PRESETS[preset].stage : 'checkin'));
  if (!CHECKLIST_STAGES.has(stage)) bad('Unknown checklist stage: ' + stage);
  return { preset, label, stage };
}
/* The one-off steps sent with a new booking: [{label, stage}] — custom only. */
function checklistExtraOf(d) {
  const list = Array.isArray(d.checklistExtra) ? d.checklistExtra : [];
  if (list.length > 30) bad('Too many checklist steps on one booking');
  return list.map((x) => checklistStep({ label: x && x.label, stage: x && x.stage }));
}
async function insertBookingSteps(env, row, steps, by) {
  const now = new Date().toISOString();
  await env.DB.batch(steps.map((st, i) => env.DB.prepare(
    `INSERT INTO checklist_items (property, booking_row, preset, label, stage, sort, created_at, created_by)
     VALUES ('', ?, '', ?, ?, ?, ?, ?)`).bind(row, st.label, st.stage, i, now, by)));
}

/* Rides along on `logs`: every step (removed property steps included, so past
   bookings keep theirs) and every tick. */
async function checklistData(env) {
  const items = await env.DB.prepare(
    `SELECT id, property, booking_row, preset, label, stage, sort, created_at, removed_at
       FROM checklist_items ORDER BY sort, id`).all();
  const ticks = await env.DB.prepare('SELECT booking_row, item_id, done_by, done_at FROM checklist_ticks').all();
  return { items: items.results || [], ticks: ticks.results || [] };
}

async function addChecklistItem(env, me, d) {
  const st = checklistStep(d);
  const now = new Date().toISOString();
  if (d.scope === 'property') {
    if (!me.isAdmin) bad('Only an Admin can change a property’s checklist');
    const property = clip(d.property, 120);
    const p = await env.DB.prepare('SELECT 1 FROM properties WHERE name = ?').bind(property).first();
    if (!p) bad('Unknown property: ' + property);
    if (st.preset) {
      const dup = await env.DB.prepare(
        `SELECT 1 FROM checklist_items WHERE property = ? AND preset = ? AND removed_at = ''`).bind(property, st.preset).first();
      if (dup) bad('“' + st.label + '” is already on this checklist');
    }
    const n = await env.DB.prepare(`SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM checklist_items WHERE property = ?`).bind(property).first();
    await env.DB.prepare(
      `INSERT INTO checklist_items (property, booking_row, preset, label, stage, sort, created_at, created_by)
       VALUES (?, 0, ?, ?, ?, ?, ?, ?)`).bind(property, st.preset, st.label, st.stage, n.n, now, me.username).run();
    return { ok: true, message: 'Step added to ' + property };
  }
  if (d.scope === 'booking') {
    if (!me.can('booking.add') && !me.can('booking.update')) bad('You need booking rights to add a checklist step');
    if (st.preset) bad('Presets are set on the property, not on one booking');
    const row = Number(d.row); checkRow(row);
    const b = await env.DB.prepare('SELECT 1 FROM bookings WHERE id = ?').bind(row).first();
    if (!b) bad('Booking not found');
    await insertBookingSteps(env, row, [st], me.username);
    return { ok: true, message: 'Step added to this booking' };
  }
  bad('Missing checklist scope');
}

async function removeChecklistItem(env, me, d) {
  const id = Number(d.id); checkRow(id);
  const it = await env.DB.prepare('SELECT id, property, booking_row FROM checklist_items WHERE id = ?').bind(id).first();
  if (!it) bad('Checklist step not found');
  if (it.booking_row) {
    if (!me.can('booking.add') && !me.can('booking.update')) bad('You need booking rights to remove a checklist step');
    await env.DB.batch([
      env.DB.prepare('DELETE FROM checklist_ticks WHERE item_id = ?').bind(id),
      env.DB.prepare('DELETE FROM checklist_items WHERE id = ?').bind(id),
    ]);
    return { ok: true, message: 'Step removed' };
  }
  if (!me.isAdmin) bad('Only an Admin can change a property’s checklist');
  /* Soft: bookings that were already over keep the step they had. */
  await env.DB.prepare(`UPDATE checklist_items SET removed_at = ? WHERE id = ? AND removed_at = ''`)
    .bind(new Date().toISOString(), id).run();
  return { ok: true, message: 'Step removed from ' + it.property };
}

async function tickChecklist(env, me, row, d) {
  checkRow(row);
  const id = Number(d.item); checkRow(id);
  const it = await env.DB.prepare('SELECT property, booking_row, preset FROM checklist_items WHERE id = ?').bind(id).first();
  if (!it) bad('Checklist step not found');
  if (LINKED_PRESETS.has(it.preset)) bad('This step ticks itself from the booking — upload the IDs or update the review status');
  const b = await env.DB.prepare('SELECT property, stay_property FROM bookings WHERE id = ?').bind(row).first();
  if (!b) bad('Booking not found');
  /* The step must belong to this booking: its own one-off step, or a step of
     the property the guest actually stays in (a cross-unit booking follows the
     guest, like the calendar does). */
  const stayProp = b.stay_property || b.property;
  if (it.booking_row ? it.booking_row !== row : it.property !== stayProp) bad('That step is not on this booking’s checklist');
  if (d.done) {
    await env.DB.prepare(
      `INSERT INTO checklist_ticks (booking_row, item_id, done_by, done_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(booking_row, item_id) DO UPDATE SET done_by = excluded.done_by, done_at = excluded.done_at`
    ).bind(row, id, me.username, new Date().toISOString()).run();
    return { ok: true, message: 'Marked done' };
  }
  await env.DB.prepare('DELETE FROM checklist_ticks WHERE booking_row = ? AND item_id = ?').bind(row, id).run();
  return { ok: true, message: 'Marked not done' };
}

/* ─────────────── MESSAGE LIBRARY ───────────────
   Reusable WhatsApp messages. A template is text with {variables}; the app
   fills them from the booking (guest, dates…) and from the unit's facts
   (Wi-Fi, address, contacts…), so each fact is typed once, on the unit.
   Writing templates and facts is Admin-only. Sending is anyone who can see
   bookings: the app opens WhatsApp and records the send here — WhatsApp
   reports nothing back, so a send means "opened in WhatsApp by <user>". */
const MESSAGE_STAGES = new Set(['before', 'checkin', 'stay', 'checkout', 'any']);
const MESSAGE_AUDIENCES = new Set(['guest', 'host']);
const MESSAGE_RECIPIENTS = new Set(['guest', 'host', 'manager', 'other']);
const FACT_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

async function messagesData(env) {
  const t = await env.DB.prepare(
    `SELECT id, title, body, stage, audience, properties, preset, sort, updated_at, updated_by
       FROM message_templates WHERE removed_at = '' ORDER BY sort, id`).all();
  const f = await env.DB.prepare('SELECT property, key, label, value FROM property_facts ORDER BY property, rowid').all();
  const sends = await env.DB.prepare(
    'SELECT booking_row, template_id, recipient, sent_by, sent_at FROM message_sends ORDER BY id').all();
  const templates = (t.results || []).map((x) => {
    let props = [];
    try { props = JSON.parse(x.properties || '[]'); } catch (e) { props = []; }
    return { ...x, properties: Array.isArray(props) ? props : [] };
  });
  return { templates, facts: f.results || [], sends: sends.results || [] };
}

async function saveTemplate(env, me, d) {
  if (!me.isAdmin) bad('Only an Admin can change the message library');
  const title = clip(d.title, 80);
  if (!title) bad('Give the message a name');
  const body = String(d.body || '').slice(0, 4000);
  if (!body.trim()) bad('The message is empty');
  const stage = String(d.stage || 'any');
  if (!MESSAGE_STAGES.has(stage)) bad('Unknown stage: ' + stage);
  const audience = String(d.audience || 'guest');
  if (!MESSAGE_AUDIENCES.has(audience)) bad('Unknown audience: ' + audience);
  const preset = String(d.preset || '');
  if (preset && (!CHECKLIST_PRESETS[preset] || LINKED_PRESETS.has(preset))) bad('That checklist step cannot be linked to a message');
  const list = Array.isArray(d.properties) ? d.properties.map((x) => clip(x, 120)).filter(Boolean) : [];
  if (list.length) {
    const known = await env.DB.prepare('SELECT name FROM properties').all();
    const names = new Set((known.results || []).map((r) => r.name));
    for (const n of list) if (!names.has(n)) bad('Unknown property: ' + n);
  }
  const now = new Date().toISOString();
  const props = JSON.stringify([...new Set(list)]);
  if (d.id) {
    const id = Number(d.id); checkRow(id);
    const res = await env.DB.prepare(
      `UPDATE message_templates SET title = ?, body = ?, stage = ?, audience = ?, properties = ?, preset = ?,
              updated_at = ?, updated_by = ? WHERE id = ? AND removed_at = ''`)
      .bind(title, body, stage, audience, props, preset, now, me.username, id).run();
    if (!res.meta.changes) bad('Message not found');
    return { ok: true, message: 'Message saved', id };
  }
  const n = await env.DB.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM message_templates').first();
  const r = await env.DB.prepare(
    `INSERT INTO message_templates (title, body, stage, audience, properties, preset, sort, created_at, created_by, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(title, body, stage, audience, props, preset, n.n, now, me.username, now, me.username).run();
  return { ok: true, message: 'Message added', id: r.meta.last_row_id };
}

async function removeTemplate(env, me, d) {
  if (!me.isAdmin) bad('Only an Admin can change the message library');
  const id = Number(d.id); checkRow(id);
  /* Soft, so past sends still name the message they were. */
  const res = await env.DB.prepare(`UPDATE message_templates SET removed_at = ? WHERE id = ? AND removed_at = ''`)
    .bind(new Date().toISOString(), id).run();
  if (!res.meta.changes) bad('Message not found');
  return { ok: true, message: 'Message removed' };
}

/* Replaces a unit's facts wholesale: [{key, label, value}]. */
async function setPropertyFacts(env, me, d) {
  if (!me.isAdmin) bad('Only an Admin can change a unit’s guest info');
  const property = clip(d.property, 120);
  const p = await env.DB.prepare('SELECT 1 FROM properties WHERE name = ?').bind(property).first();
  if (!p) bad('Unknown property: ' + property);
  const list = Array.isArray(d.facts) ? d.facts : [];
  if (list.length > 60) bad('Too many facts on one unit');
  const seen = new Set();
  const now = new Date().toISOString();
  const rows = [];
  for (const x of list) {
    const key = String((x && x.key) || '').trim();
    if (!FACT_KEY_RE.test(key)) bad('Invalid fact name: ' + key);
    if (seen.has(key)) bad('Fact listed twice: ' + key);
    seen.add(key);
    const value = String((x && x.value) || '').slice(0, 1000);
    if (!value.trim()) continue;   // a blank fact is simply not stored
    rows.push(env.DB.prepare(
      'INSERT INTO property_facts (property, key, label, value, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(property, key, clip((x && x.label) || '', 60), value, now, me.username));
  }
  await env.DB.batch([env.DB.prepare('DELETE FROM property_facts WHERE property = ?').bind(property), ...rows]);
  return { ok: true, message: 'Guest info saved for ' + property };
}

async function logMessageSend(env, me, row, d) {
  checkRow(row);
  const id = Number(d.template); checkRow(id);
  const recipient = String(d.recipient || 'guest');
  if (!MESSAGE_RECIPIENTS.has(recipient)) bad('Unknown recipient');
  const t = await env.DB.prepare('SELECT preset FROM message_templates WHERE id = ?').bind(id).first();
  if (!t) bad('Message not found');
  const b = await env.DB.prepare('SELECT property, stay_property FROM bookings WHERE id = ?').bind(row).first();
  if (!b) bad('Booking not found');
  const now = new Date().toISOString();
  const stmts = [env.DB.prepare(
    'INSERT INTO message_sends (booking_row, template_id, recipient, sent_by, sent_at) VALUES (?, ?, ?, ?, ?)')
    .bind(row, id, recipient, me.username, now)];
  /* A message linked to a checklist step ticks that step on this booking —
     only when it went to the guest, which is what the step is about. */
  let ticked = false;
  if (t.preset && recipient === 'guest' && !LINKED_PRESETS.has(t.preset)) {
    const it = await env.DB.prepare(
      `SELECT id FROM checklist_items WHERE property = ? AND preset = ? AND booking_row = 0 AND removed_at = ''`)
      .bind(b.stay_property || b.property, t.preset).first();
    if (it) {
      ticked = true;
      stmts.push(env.DB.prepare(
        `INSERT INTO checklist_ticks (booking_row, item_id, done_by, done_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(booking_row, item_id) DO NOTHING`).bind(row, it.id, me.username, now));
    }
  }
  await env.DB.batch(stmts);
  return { ok: true, message: ticked ? 'Sent · checklist ticked' : 'Sent', ticked };
}

/* ─────────────── REVIEW FOLLOW-UPS ───────────────
   Approach B: the state lives on the booking so a follow-up can be cleared.
   'pending' is stored as '' — the same value every pre-existing row already has,
   so no backfill is needed and nothing is silently marked done. */
const REVIEW_STATUSES = new Set(['pending', 'requested', 'received', 'skipped']);
function reviewStatusOf(status) {
  const st = String(status || '').toLowerCase();
  if (!REVIEW_STATUSES.has(st)) bad('Invalid review status: ' + status);
  return st;
}
async function setReviewStatus(env, pin, row, status) {
  checkRow(row);
  const st = reviewStatusOf(status);
  const res = await env.DB.prepare('UPDATE bookings SET review_status = ? WHERE id = ?')
    .bind(st === 'pending' ? '' : st, row).run();
  if (!res.meta.changes) bad('Booking not found');
  return { ok: true, message: 'Review marked ' + st };
}

/* ─────────────── LOGS ───────────────
   Rebuilds the exact {headers, rows:[{r, cells}]} shape the log views render,
   with `r` now the primary key. Column order matches the original sheets. */
const BOOKING_HEADERS = ['Booking Date','Property','Lead Guest','Booking Type','Channel','Referrer / Source',
  'List Price','Discount','Guest Paid','Net Earned','Commission paid','Pending amount','Notes','Phone',
  'Lead Birth Yr','Co-Guest','Co-Guest Birth Yr','Guests','Booking ID','Month','Check-in Date',
  'Check-out Date','Check-in Time','Check-out Time','Stay unit','Repeat flag','Review status','Extra guests',
  'Stay property','Split fee'];
const BOOKING_COLS = ['booking_date','property','lead_guest','booking_type','channel','referrer',
  'list_price','discount','guest_paid','net_earned','commission_paid','pending_amount','notes','phone',
  'lead_birth_yr','co_guest','co_guest_birth_yr','guests','booking_id','month','checkin_date',
  'checkout_date','checkin_time','checkout_time','stay_unit','repeat_flag','review_status','extra_guests',
  /* Appended, never inserted: both clients address booking cells by index. */
  'stay_property','split_fee'];

const EXPENSE_HEADERS = ['Date','Expense Month','Item / Description','Property','Category','Quantity',
  'Amount','Type','Status','Refundable','Vendor','Notes','Initial investment flag'];
const EXPENSE_COLS = ['txn_date','expense_month','item','property','category','quantity','amount','type',
  'status','refundable','vendor','notes','init_invest'];

const SAVING_HEADERS = ['Date','Amount','Scheme','Platform','Status','Amount Received','Notes / Ref No','Created At','Exit Date'];
const SAVING_COLS = ['date','amount','scheme','platform','status','returns','notes','created_at','exit_date'];

const TASK_HEADERS = ['Action','End Date','Description','Done','Done At','Created At'];
const TASK_COLS = ['name','end_date','description','done','done_at','created_at'];
const ENQUIRY_HEADERS = ['Received','Property','Name','Mobile','Check-in','Check-out','Guests','Message',
  'Heard via','Status','Status At','Notes'];
const ENQUIRY_COLS = ['created_at','property','full_name','mobile','check_in','check_out','guests','message',
  'referral','status','status_at','notes'];

/* Google Sheets silently coerced anything numeric-looking into a number, so
   `logs` used to return 1997 (number) for a birth year and 3028 for a stay
   unit, while '3103, 3028' stayed a string. The DB stores these losslessly as
   TEXT — this reproduces the sheet's coercion at the boundary only, so the wire
   format is unchanged for the clients while the stored value keeps its
   fidelity. The round-trip guard means a value like '0501' is left alone rather
   than being mangled into 501. */
function sheetish(v) {
  if (typeof v !== 'string' || v === '') return v;
  const n = Number(v);
  return (Number.isFinite(n) && String(n) === v) ? n : v;
}
/* Identifier-like columns are never coerced. The Phone column in the sheet was
   internally inconsistent — 25 rows came back as numbers, 12 as strings,
   depending on each cell's format — and numeric phones silently lose leading
   zeros and '+91' prefixes. Emitting phone as TEXT always is the one
   deliberate wire change in this migration; both clients feed it straight into
   a text input, so nothing downstream can observe the difference. */
const NO_COERCE = new Set(['phone', 'extra_guests', 'stay_property', 'mobile', 'created_at', 'check_in', 'check_out', 'status_at']);
async function logBlock(env, table, headers, cols) {
  const { results } = await env.DB.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
  return {
    headers,
    rows: results.map(r => ({
      r: r.id,
      cells: cols.map(c => NO_COERCE.has(c) ? cell(r[c]) : sheetish(cell(r[c])))
    }))
  };
}
async function getLogs(env, pin) {
  return {
    bookings: await logBlock(env, 'bookings', BOOKING_HEADERS, BOOKING_COLS),
    expenses: await logBlock(env, 'expenses', EXPENSE_HEADERS, EXPENSE_COLS),
    savings:  await logBlock(env, 'savings',  SAVING_HEADERS,  SAVING_COLS),
    /* Actions ride along with the other blocks rather than getting a call of
       their own: the Action tab already waits on this response to draw, and a
       second request would only delay the tab it belongs to. */
    tasks:    await logBlock(env, 'tasks',    TASK_HEADERS,    TASK_COLS),
    /* Website enquiries, for the same reason: the Action tab lists them. */
    enquiries: await logBlock(env, 'enquiries', ENQUIRY_HEADERS, ENQUIRY_COLS),
    /* Which ID documents exist, folded into the same call the app already makes
       on load — otherwise the Action tab would need one request per booking. */
    idStatus: await idStatus(env),
    /* Same trip, with the attachment ids: the Action tab renders the lead
       guest's ID document as the card's avatar and would otherwise need one
       request per card to find out which object to ask for. */
    idDocs: await idDocs(env),
    /* Booking checklists: steps and ticks, for the booking page. */
    checklist: await checklistData(env),
    /* Message library, unit facts and sends, for the booking page's Messages tab. */
    /* Guarded: a missing table must never take the whole logs call down. */
    messages: await messagesData(env).catch(() => undefined)
  };
}

/* ─────────────── INVENTORY ───────────────
   In the IMS sheet these were ARRAYFORMULAs pinned to row 2 (Item Key, In
   Stock, Pending, Low Stock, Total Cost, Signed Qty), which forced the Apps
   Script to skip cols F/H/I/K on write and to *clear* row 2 instead of deleting
   it. Here they are derived in SQL, so those constraints are gone. */
const INV_NEG = /Consumption|Damage|Transfer Out|Adjustment -/;   // movements that reduce stock

async function invReadLists(env) {
  const { results } = await env.DB.prepare('SELECT kind, value FROM inv_lists ORDER BY kind, sort').all();
  const out = { properties: [], categories: [], types: [], movements: [], vendors: [] };
  for (const r of results) if (out[r.kind]) out[r.kind].push(r.value);
  return out;
}

async function invData(env, pin) {
  /* in_stock = SUMIF over Signed Qty, replicating the sheet formula. SQLite has
     no REGEXP by default, so the movement-type test is spelled out as LIKEs —
     the sheet's pattern was a plain alternation with no regex metacharacters,
     so the two are equivalent. */
  const { results: items } = await env.DB.prepare(`
    SELECT i.*,
           i.item_id || ' · ' || i.item AS item_key,
           COALESCE((
             SELECT SUM(CASE WHEN m.movement LIKE '%Consumption%'
                              OR m.movement LIKE '%Damage%'
                              OR m.movement LIKE '%Transfer Out%'
                              OR m.movement LIKE '%Adjustment -%'
                             THEN -m.qty ELSE m.qty END)
               FROM inv_movements m
              WHERE m.item_key = i.item_id || ' · ' || i.item
           ), 0) AS in_stock
      FROM inv_items i
     ORDER BY i.id`
  ).all();

  const mapped = items.map(r => {
    const required = num(r.required_qty);
    const inStock = num(r.in_stock);
    const pending = Math.max(required - inStock, 0);
    const reorder = r.reorder_level === null ? '' : num(r.reorder_level);
    return {
      r: r.id, id: r.item_id, property: cell(r.property), category: cell(r.category),
      item: cell(r.item), type: cell(r.type), key: r.item_key,
      required, inStock, pending, reorder,
      low: r.type === 'Consumable' && reorder !== '' && inStock <= reorder,
      unitPrice: r.unit_price === null ? '' : num(r.unit_price),
      vendor: cell(r.vendor), remarks: cell(r.remarks)
    };
  });

  const { results: mv } = await env.DB.prepare('SELECT * FROM inv_movements ORDER BY id').all();
  const movements = mv.map(r => ({
    r: r.id, date: r.date || '', key: r.item_key, movement: cell(r.movement),
    qty: num(r.qty), unitCost: r.unit_cost === null ? '' : num(r.unit_cost),
    totalCost: r.unit_cost === null ? 0 : num(r.qty) * num(r.unit_cost),
    vendor: cell(r.vendor), by: cell(r.logged_by), remarks: cell(r.remarks)
  }));

  return { items: mapped, movements, lists: await invReadLists(env), generatedAt: nowStamp() };
}

const INV_PREFIX = { Lights:'LGT', Decoration:'DEC', Linen:'LIN', Kitchen:'KIT',
                     Cleaning:'CLN', 'Personal Care':'PER' };
async function invNextId(env, category) {
  const pfx = INV_PREFIX[category] ||
    String(category).replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'GEN';
  const { results } = await env.DB.prepare(
    'SELECT item_id FROM inv_items WHERE item_id LIKE ?'
  ).bind(pfx + '-%').all();
  let max = 0;
  const re = new RegExp('^' + pfx + '-(\\d+)$');
  for (const r of results) {
    const m = String(r.item_id).match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return pfx + '-' + String(max + 1).padStart(2, '0');
}

function invItemFields(d) {
  if (!d.item) bad('Item name is required');
  return {
    property: d.property || '',
    category: d.category || '',
    item: d.item,
    type: d.type || 'Asset',
    required_qty: optMoney(d.requiredQty, 'Required qty'),
    reorder_level: optMoney(d.reorderLevel, 'Reorder level'),
    unit_price: optMoney(d.unitPrice, 'Unit price'),
    vendor: d.vendor || '',
    remarks: d.remarks || ''
  };
}

async function invAddItem(env, pin, d) {
  if (!d.item)     bad('Item name is required');
  if (!d.property) bad('Property is required');
  if (!d.category) bad('Category is required');
  const id = await invNextId(env, d.category);
  const f = invItemFields(d);
  f.item_id = id;
  const cols = Object.keys(f);
  await env.DB.prepare(
    `INSERT INTO inv_items (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  ).bind(...cols.map(c => f[c])).run();

  const key = `${id} · ${d.item}`;
  if (d.openingQty !== '' && d.openingQty != null && num(d.openingQty) > 0) {
    await invInsertMovement(env, {
      date: d.openingDate || '', itemKey: key, movement: 'Opening Balance',
      qty: num(d.openingQty), unitCost: '', vendor: d.vendor || '',
      loggedBy: d.loggedBy || 'App', remarks: 'Opening stock'
    });
  }
  return { ok: true, message: `Item ${id} added`, id, key };
}

async function invUpdateItem(env, pin, row, d) {
  checkRow(row);
  const existing = await env.DB.prepare('SELECT item_id, item FROM inv_items WHERE id = ?').bind(row).first();
  if (!existing) bad('Item not found');
  const f = invItemFields(d);
  const id = d.id || existing.item_id;
  f.item_id = id;
  const cols = Object.keys(f);
  await env.DB.prepare(
    `UPDATE inv_items SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`
  ).bind(...cols.map(c => f[c]), row).run();

  /* Movements join to items by the composite 'ID · Name' key, so renaming an
     item would orphan its stock history. Re-point it in the same breath. */
  const oldKey = `${existing.item_id} · ${existing.item}`;
  const newKey = `${id} · ${f.item}`;
  if (oldKey !== newKey) {
    await env.DB.prepare('UPDATE inv_movements SET item_key = ? WHERE item_key = ?')
      .bind(newKey, oldKey).run();
  }
  return { ok: true, message: `Item ${id} updated` };
}

async function invDeleteItem(env, pin, row) {
  checkRow(row);
  const existing = await env.DB.prepare('SELECT item_id, item FROM inv_items WHERE id = ?').bind(row).first();
  if (!existing) bad('Item not found');
  /* invUpdateItem re-points inv_movements on rename for exactly this reason;
     delete used to leave them orphaned. Worse, invNextId recomputes the next id
     from surviving items only, so the id was reissued and the next item created
     under it inherited the deleted item's stock history. */
  const key = `${existing.item_id} · ${existing.item}`;
  const mv = await env.DB.prepare('DELETE FROM inv_movements WHERE item_key = ?').bind(key).run();
  await env.DB.prepare('DELETE FROM inv_items WHERE id = ?').bind(row).run();
  const n = mv.meta.changes || 0;
  return { ok: true, message: `Item ${existing.item_id || ''} deleted${n ? ` with ${n} stock entr${n === 1 ? 'y' : 'ies'}` : ''}` };
}

function invMovementFields(d) {
  if (!d.itemKey)  bad('Item is required');
  if (!d.movement) bad('Movement type is required');
  const qty = moneyNum(d.qty, 'Qty');
  if (!(qty > 0)) bad('Qty must be greater than 0');
  return {
    date: d.date || todayISO(),
    item_key: d.itemKey,
    movement: d.movement,
    qty,
    unit_cost: optMoney(d.unitCost, 'Unit cost'),
    vendor: d.vendor || '',
    logged_by: d.loggedBy || 'App',
    remarks: d.remarks || ''
  };
}
async function invInsertMovement(env, d) {
  const f = invMovementFields(d);
  const cols = Object.keys(f);
  await env.DB.prepare(
    `INSERT INTO inv_movements (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  ).bind(...cols.map(c => f[c])).run();
}
async function invAddMovement(env, pin, d) {
  await invInsertMovement(env, d);
  return { ok: true, message: `${d.movement} logged` };
}
async function invUpdateMovement(env, pin, row, d) {
  checkRow(row);
  const f = invMovementFields(d);
  const cols = Object.keys(f);
  const res = await env.DB.prepare(
    `UPDATE inv_movements SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`
  ).bind(...cols.map(c => f[c]), row).run();
  if (!res.meta.changes) bad('Movement not found');
  return { ok: true, message: 'Movement updated' };
}

/* ─────────────── PROPERTY DELETE ───────────────
   Bookings, expenses and stock refer to a property by name (older rows) or id,
   with no foreign key, so deleting a property in use would silently orphan its
   history from every per-property view. Refuse instead; Inactive exists for
   exactly that case. */
async function deleteProperty(env, pin, d) {
  const id = String((d && (d.id || d.origId)) || '');
  if (!id) bad('Missing property reference');
  const prop = await env.DB.prepare('SELECT id, name FROM properties WHERE id = ?').bind(id).first();
  if (!prop) bad('Property not found: ' + id);
  const used = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM bookings  WHERE property IN (?1, ?2))
          + (SELECT COUNT(*) FROM expenses  WHERE property IN (?1, ?2))
          + (SELECT COUNT(*) FROM inv_items WHERE property IN (?1, ?2)) AS n`
  ).bind(prop.id, prop.name).first();
  if (used && used.n) bad(`"${prop.name}" is used by ${used.n} booking/expense/inventory record${used.n === 1 ? '' : 's'} — set it Inactive instead`);
  await env.DB.prepare('DELETE FROM properties WHERE id = ?').bind(id).run();
  return { ok: true, message: `Property "${prop.name}" deleted`, properties: await readProperties(env) };
}

/* ─────────────── APPROVAL TICKETS ───────────────
   What a non-Admin update/delete turns into (see src/tickets.js). Each spec
   says which row the action touches, how its payload keys map onto columns for
   the "what changed" view, and runs the same validation the real write does, so
   a manager is never asked to approve something that would then fail. */
const SAVING_FROM_ROW = { date: 'date', amount: 'amount', scheme: 'scheme', platform: 'platform',
  status: 'status', returns: 'returns', notes: 'notes', exitDate: 'exit_date' };
const PROPERTY_FROM_ROW = { id: 'id', name: 'name', location: 'location', type: 'type', status: 'status',
  onboarded: 'onboarded', rent: 'rent', notes: 'notes' };
const INV_ITEM_FROM_ROW = { item: 'item', property: 'property', category: 'category', type: 'type',
  requiredQty: 'required_qty', reorderLevel: 'reorder_level', unitPrice: 'unit_price', vendor: 'vendor', remarks: 'remarks' };
const INV_MOVE_FROM_ROW = { date: 'date', itemKey: 'item_key', movement: 'movement', qty: 'qty',
  unitCost: 'unit_cost', vendor: 'vendor', loggedBy: 'logged_by', remarks: 'remarks' };
const TASK_FROM_ROW = { name: 'name', endDate: 'end_date', description: 'description' };
const FIELD_LABELS = {
  date: 'Date', property: 'Property', guest: 'Lead guest', type: 'Type', channel: 'Channel', referrer: 'Referrer',
  listPrice: 'List price', discount: 'Discount', guestPaid: 'Guest paid', net: 'Net earned', commission: 'Commission',
  pending: 'Pending', notes: 'Notes', phone: 'Phone', leadBirthYr: 'Lead birth yr', coGuest: 'Co-guest',
  coGuestBirthYr: 'Co-guest birth yr', guests: 'Guests', checkinDate: 'Check-in date', checkoutDate: 'Check-out date',
  checkinTime: 'Check-in time', checkoutTime: 'Check-out time', stayUnit: 'Stay unit', repeat: 'Repeat customer', extraGuests: 'More guests',
  expenseMonth: 'Expense month', item: 'Item', category: 'Category', quantity: 'Quantity', amount: 'Amount',
  status: 'Status', refundable: 'Refundable', vendor: 'Vendor', initInvest: 'Initial investment', scheme: 'Scheme',
  platform: 'Platform', returns: 'Amount received', exitDate: 'Exit date', id: 'ID', name: 'Name', location: 'Location', onboarded: 'Onboarded',
  rent: 'Rent', requiredQty: 'Required qty', reorderLevel: 'Reorder level', unitPrice: 'Unit price',
  remarks: 'Remarks', itemKey: 'Item', movement: 'Movement', qty: 'Qty', unitCost: 'Unit cost', loggedBy: 'Logged by',
  endDate: 'End date', description: 'Description', done: 'Done',
};
/* `name` is a property's name everywhere else; on an action it is the action. */
const TASK_LABELS = { ...FIELD_LABELS, name: 'Action' };

const bookingLabel  = (r) => `${r.booking_id || 'Booking #' + r.id}${r.lead_guest ? ' · ' + r.lead_guest : ''}${r.property ? ' · ' + r.property : ''}`;
const expenseLabel  = (r) => `Expense #${r.id} · ${r.item}${r.amount !== null ? ' · ' + rupees(r.amount) : ''}`;
const savingLabel   = (r) => `Saving #${r.id} · ${rupees(r.amount)} · ${r.scheme}`;
const propertyLabel = (r) => `Property ${r.name} (${r.id})`;
const itemLabel     = (r) => `Item ${r.item_id} · ${r.item}`;
const moveLabel     = (r) => `Stock entry #${r.id} · ${r.movement} ${r.qty} × ${r.item_key}`;
const taskLabel     = (r) => `Action #${r.id} · ${r.name}`;
/* Action-tab labels. An approver reads only this line and the change rows
   before pressing yes, so the money and the record both have to be in it. */
const payoutLabel   = (r) => `${bookingLabel(r)} · ${rupees(r.pending_amount)} pending`;
const taskDoneLabel = (r, d) => `Action #${r.id} · ${isOn(d && d.done) ? 'Mark done' : 'Mark not done'} · ${r.name}`;
const isOn = (v) => v === true || v === 1 || v === '1' || v === 'true';
const titleCase = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);

/* A ticket label is what an approver reads before pressing yes, so it must be
   the figure that will actually be stored — not the raw string. '₹25,000' typed
   into an amount used to render as '₹₹25,000' here, because the symbol was
   stored and then prefixed again. Labels run after spec.validate(), so the
   value is already known to be money by the time this parses it. */
const rupees = (v) => (v === '' || v === null || v === undefined) ? '' : '₹' + inrText(moneyNum(v, 'Amount'));
/* The money keys each kind carries, so a request stores the FIGURE and not the
   string it was typed as. Without this the payload and the "Amount" row of the
   diff kept the raw text — '₹25,000', '1 000' — while the label showed the
   normalised ₹25,000 and storage got 25000. Three readings of one number, and
   the one the approver reads before pressing yes was the only one that was not
   what would be written. Normalising runs AFTER spec.validate, so anything here
   is already known to be money. */
const MONEY_KEYS = {
  booking: ['listPrice', 'discount', 'guestPaid', 'net', 'commission', 'pending'],
  expense: ['amount', 'quantity'],
  saving: ['amount', 'returns'],
  property: ['rent'],
  inventory: ['requiredQty', 'reorderLevel', 'unitPrice'],
  stock: ['qty', 'unitCost'],
};
const normMoney = (kind) => {
  const keys = MONEY_KEYS[kind];
  if (!keys) return undefined;
  return (d) => {
    const o = { ...d };
    for (const k of keys) {
      const v = o[k];
      if (v === '' || v === null || v === undefined) continue;
      o[k] = moneyNum(v, FIELD_LABELS[k] || k);
    }
    return o;
  };
};
/* The split is not a form field, so it never appears in the payload diff — yet
   it decides which unit earns the money the approver is being asked to approve.
   This appends it as its own row, on a create and on an edit alike, so the
   owner never approves a split she cannot see. Returns nothing when the
   booking is not cross-unit, which is every booking but a handful. */
async function splitChangeRows(env, row, d) {
  const merged = (row && row.id) ? mergeWithStored(BOOKING_FROM_ROW, row, d) : d;
  const net = moneyNum(merged.net, 'Net Earned');
  const s = computeSplit(await readProperties(env), merged.property || '', merged.stayUnit, net);
  if (!s.stay_property) return [];
  const share = (v) => {
    const a = moneyNum(v === '' || v === null || v === undefined ? 0 : v, 'Amount');
    const keep = receiverShare(a, s.split_fee);
    return `${merged.property} ${rupees(keep)} · ${s.stay_property} ${rupees(a - keep)}`;
  };
  const out = [{ field: 'Cross-unit split',
                 from: `${merged.property} ${rupees(net)}`, to: share(net) }];
  const pend = merged.pending;
  if (pend !== '' && pend !== null && pend !== undefined && moneyNum(pend, 'Pending') > 0) {
    out.push({ field: 'Pending split',
               from: `${merged.property} ${rupees(pend)}`, to: share(pend) });
  }
  return out;
}

const tspec = (kind, op, table, label, extra = {}) => ({ kind, op, table, label, labels: FIELD_LABELS, normalize: normMoney(kind), ...extra });
/* A create has no stored row to read, diff or label from: its label comes from
   what was typed, and the "changes" list is simply the values it would be
   created with (diffed against nothing). */
const cspec = (kind, table, newLabel, map, extra = {}) =>
  ({ kind, op: 'create', table, newLabel, map, labels: FIELD_LABELS, normalize: normMoney(kind), ...extra });
const TICKET_SPECS = {
  addBooking: cspec('booking', 'bookings', (d) => `New booking${d.guest ? ' · ' + d.guest : ''}${d.property ? ' · ' + d.property : ''}`,
    BOOKING_FROM_ROW, { bools: ['repeat'], append: splitChangeRows, validate: (env, row, d) => {
      if (!d.property) bad('Property is required');
      bookingFields(d);
    } }),
  addExpense: cspec('expense', 'expenses', (d) => `New expense · ${d.item || ''}${d.amount ? ' · ' + rupees(d.amount) : ''}`,
    EXPENSE_FROM_ROW, { bools: ['initInvest'], validate: (env, row, d) => {
      if (!d.property) bad('Property is required');
      expenseFields(d);
    } }),
  addSaving: cspec('saving', 'savings', (d) => `New saving · ${rupees(d.amount)}${d.scheme ? ' · ' + d.scheme : ''}`,
    SAVING_FROM_ROW, { validate: (env, row, d) => savingFields(d) }),
  addProperty: cspec('property', 'properties', (d) => `New property · ${d.name || ''}`,
    PROPERTY_FROM_ROW, { validate: async (env, row, d) => {
      if (!d.name) bad('Property name is required');
      const id = propertyId(d);
      if (await env.DB.prepare('SELECT 1 FROM properties WHERE id = ?').bind(id).first()) {
        bad(`Property ID "${id}" already exists`);
      }
    } }),
  invAddItem: cspec('inventory', 'inv_items', (d) => `New item · ${d.item || ''}${d.property ? ' · ' + d.property : ''}`,
    INV_ITEM_FROM_ROW, { validate: (env, row, d) => {
      if (!d.property) bad('Property is required');
      if (!d.category) bad('Category is required');
      invItemFields(d);
    } }),
  invAddMovement: cspec('stock', 'inv_movements', (d) => `New stock entry · ${d.movement || ''} ${d.qty || ''} × ${d.itemKey || ''}`,
    INV_MOVE_FROM_ROW, { validate: (env, row, d) => invMovementFields(d) }),
  updateBooking: tspec('booking', 'update', 'bookings', bookingLabel, {
    map: BOOKING_FROM_ROW, bools: ['repeat'], append: splitChangeRows,
    validate: (env, row, d) => bookingFields(mergeWithStored(BOOKING_FROM_ROW, row, d)),
  }),
  deleteBooking: tspec('booking', 'delete', 'bookings', bookingLabel),
  updateExpense: tspec('expense', 'update', 'expenses', expenseLabel, {
    map: EXPENSE_FROM_ROW, bools: ['initInvest'],
    validate: (env, row, d) => expenseFields(mergeWithStored(EXPENSE_FROM_ROW, row, d)),
  }),
  deleteExpense: tspec('expense', 'delete', 'expenses', expenseLabel),
  updateSaving: tspec('saving', 'update', 'savings', savingLabel, {
    map: SAVING_FROM_ROW, validate: (env, row, d) => savingFields(d),
  }),
  deleteSaving: tspec('saving', 'delete', 'savings', savingLabel),
  updateProperty: tspec('property', 'update', 'properties', propertyLabel, {
    keyCol: 'id', map: PROPERTY_FROM_ROW,
    validate: async (env, row, d) => {
      if (!d.name) bad('Property name is required');
      const newId = d.id || d.origId;
      if (newId !== d.origId && await env.DB.prepare('SELECT 1 FROM properties WHERE id = ?').bind(newId).first()) {
        bad(`Property id "${newId}" is already in use`);
      }
    },
  }),
  deleteProperty: tspec('property', 'delete', 'properties', propertyLabel, { keyCol: 'id' }),
  invUpdateItem: tspec('inventory', 'update', 'inv_items', itemLabel, {
    map: INV_ITEM_FROM_ROW, validate: (env, row, d) => invItemFields(d),
  }),
  invDeleteItem: tspec('inventory', 'delete', 'inv_items', itemLabel),
  /* Its own kind: items and movements are separate tables whose ids overlap,
     and a ticket is keyed by kind + row id. Rights are still inventory.*. */
  invUpdateMovement: tspec('stock', 'update', 'inv_movements', moveLabel, {
    map: INV_MOVE_FROM_ROW, validate: (env, row, d) => invMovementFields(d),
  }),
  invDeleteMovement: tspec('stock', 'delete', 'inv_movements', moveLabel),

  /* ── Action tab ──
     These change a record without sending the column they change as a form
     field, so each builds its own change row. `watch` narrows the stale check
     to the column at stake: a payout request must not go orange because
     somebody fixed a typo in the guest's name. */
  setPayouts: tspec('payout', 'update', 'bookings', payoutLabel, {
    watch: ['pending_amount'],
    validate: (env, row, d) => { payoutIds(d); },
    changes: (row) => (row.pending_amount === null || row.pending_amount === undefined || Number(row.pending_amount) === 0)
      ? [] : [{ field: 'Pending payout', from: rupees(row.pending_amount), to: 'Paid (₹0)' }],
  }),
  setReviewStatus: tspec('review', 'update', 'bookings', bookingLabel, {
    watch: ['review_status'],
    validate: (env, row, d) => { reviewStatusOf(d.status); },
    changes: (row, d) => {
      /* 'pending' is stored as '' — see setReviewStatus. */
      const from = String(row.review_status || '') || 'pending';
      const to = reviewStatusOf(d.status);
      return from === to ? [] : [{ field: 'Review status', from: titleCase(from), to: titleCase(to) }];
    },
  }),
  addTask: cspec('task', 'tasks', (d) => `New action · ${String(d.name || '').trim()}`,
    TASK_FROM_ROW, { labels: TASK_LABELS, validate: (env, row, d) => taskFields(d) }),
  updateTask: tspec('task', 'update', 'tasks', taskLabel, {
    map: TASK_FROM_ROW, labels: TASK_LABELS, validate: (env, row, d) => taskFields(d),
  }),
  deleteTask: tspec('task', 'delete', 'tasks', taskLabel),
  /* Its own kind, not a `task` update: ticking an action off and rewording it
     are separate requests on the same row, and a shared kind would merge the
     two payloads into one ticket and then apply only the later action. */
  setTaskDone: tspec('taskdone', 'update', 'tasks', taskDoneLabel, {
    watch: ['done'],
    changes: (row, d) => {
      const from = isOn(row.done), to = isOn(d.done);
      return from === to ? [] : [{ field: 'Done', from: from ? 'Yes' : 'No', to: to ? 'Yes' : 'No' }];
    },
  }),
};

/* Settling payouts is the only bulk write in the app: the Action tab sends a
   list of bookings at once. It becomes ONE REQUEST PER BOOKING, because a
   ticket is keyed by the record it changes — that is what lets an approver take
   three of five, what keeps the one-live-request-per-record rule working, and
   what makes the stale check meaningful. The whole list is checked before any
   request is raised, so a batch is never half-queued. */
async function raisePayoutTickets(env, me, d) {
  const ids = payoutIds(d);
  for (const id of ids) {
    const b = await env.DB.prepare('SELECT pending_amount FROM bookings WHERE id = ?').bind(id).first();
    if (!b) bad(`Booking #${id} not found`);
    if (b.pending_amount === null || Number(b.pending_amount) === 0) bad(`Booking #${id} has no pending payment`);
  }
  const out = [];
  for (const id of ids) out.push(await raiseTicket(env, me, 'setPayouts', id, { rows: [id] }, TICKET_SPECS.setPayouts));
  if (out.length === 1) return out[0];
  const who = await approverName(env, me.managerId === null || me.managerId === undefined ? 0 : me.managerId);
  return {
    ok: true, pendingApproval: true, ticket: out[0].ticket, tickets: out.map((o) => o.ticket),
    message: `${out.length} payments sent to ${who} for approval (requests ${out.map((o) => '#' + o.ticket).join(', ')})`,
  };
}

/* Replays an approved ticket through the exact handler an Admin's edit uses. */
async function applyGated(env, action, target, d) {
  const row = Number(target);
  switch (action) {
    case 'addBooking':        return addBooking(env, null, d);
    case 'addExpense':        return addExpense(env, null, d);
    case 'addSaving':         return addSaving(env, null, d);
    case 'addProperty':       return addProperty(env, null, d);
    case 'invAddItem':        return invAddItem(env, null, d);
    case 'invAddMovement':    return invAddMovement(env, null, d);
    case 'updateBooking':     return updateBooking(env, null, row, d);
    case 'deleteBooking':     return deleteRowById(env, null, 'bookings', row, 'Booking deleted');
    case 'updateExpense':     return updateExpense(env, null, row, d);
    case 'deleteExpense':     return deleteRowById(env, null, 'expenses', row, 'Expense deleted');
    case 'updateSaving':      return updateSaving(env, null, row, d);
    case 'deleteSaving':      return deleteRowById(env, null, 'savings', row, 'Saving deleted');
    case 'updateProperty':    return updateProperty(env, null, d);
    case 'deleteProperty':    return deleteProperty(env, null, d);
    case 'invUpdateItem':     return invUpdateItem(env, null, row, d);
    case 'invDeleteItem':     return invDeleteItem(env, null, row);
    case 'invUpdateMovement': return invUpdateMovement(env, null, row, d);
    case 'invDeleteMovement': return deleteRowById(env, null, 'inv_movements', row, 'Movement deleted');
    /* One ticket = one booking, so the payload is rebuilt from the target the
       ticket is keyed by; approving one can never settle another. */
    case 'setPayouts':        return setPayouts(env, null, { rows: [row] });
    case 'setReviewStatus':   return setReviewStatus(env, null, row, d.status);
    case 'addTask':           return addTask(env, null, d);
    case 'updateTask':        return updateTask(env, null, row, d);
    case 'setTaskDone':       return setTaskDone(env, null, row, d.done);
    case 'deleteTask':        return deleteRowById(env, null, 'tasks', row, 'Action deleted');
    default: bad('Not an approvable action: ' + action);
  }
}

export { INV_NEG };
