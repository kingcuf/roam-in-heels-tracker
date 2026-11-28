/* ─────────────── AI ANALYST ───────────────
   Plain-English questions → a report (summary, KPIs, charts, insights,
   follow-up questions).

   The model never sees the database and never writes SQL. It gets two tools:
     run_query     — one aggregate (measure × group_by, with filters), computed
                     HERE with the same attribution rules as the Report tab
                     (property splits, booking-date vs stay-date basis);
     list_records  — a short list of individual bookings or expenses;
   and finishes by calling submit_report. Charts in the report point at a
   query id, and the rows are attached from what this file computed, so every
   number on a chart is ours, not the model's.

   Rights: the caller needs reports.view (router). Each measure is further
   checked against the same metric.* rights that redact the Report tab, so the
   AI cannot show a Viewer a figure their role hides. */

/* Gemini 3.1 Flash-Lite: tested on real questions (28-Nov-2026) — right figures,
   ~4 s, ~₹0.2 a question. 2.5 Flash is closed to new keys. Override per
   deployment with the GEMINI_MODEL var. */
import { checkBudget, recordUsage, costUsd, cacheKey, cachedReport } from './aibudget.js';

const MODEL_DEFAULT = 'gemini-3.1-flash-lite';
const MAX_TURNS = 6;

const MEASURES = ['revenue', 'bookings', 'nights', 'avg_booking_value', 'pending', 'guest_paid',
  'commission', 'expenses', 'net_pnl'];
const GROUPS = ['none', 'month', 'week', 'day', 'weekday', 'property', 'channel', 'booking_type',
  'expense_category', 'expense_type'];
const BOOKING_ONLY_GROUPS = new Set(['channel', 'booking_type']);
const EXPENSE_ONLY_GROUPS = new Set(['expense_category', 'expense_type']);
const EXP_TYPES = new Set(['One-time', 'Recurring', 'Operating']);
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const RIGHT_OF = {
  revenue: ['metric.money'], avg_booking_value: ['metric.money'], pending: ['metric.money'],
  guest_paid: ['metric.money'], commission: ['metric.money'],
  bookings: ['metric.bookings'], nights: ['metric.bookings'],
  expenses: ['metric.expenses'], net_pnl: ['metric.money', 'metric.expenses'],
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const r0 = (v) => Math.round(v);

class Refuse extends Error {}
const refuse = (m) => { throw new Refuse(m); };

/* ── data, loaded once per question ── */
async function loadData(env, deps) {
  const [bQ, eQ, props] = await Promise.all([
    env.DB.prepare('SELECT * FROM bookings ORDER BY id').all(),
    env.DB.prepare('SELECT * FROM expenses ORDER BY id').all(),
    deps.readProperties(env),
  ]);
  return { bookings: bQ.results.filter((r) => r.booking_id), expenses: eQ.results, props };
}

function nightsOf(r) {
  const ci = String(r.checkin_date || '').slice(0, 10), co = String(r.checkout_date || '').slice(0, 10);
  if (!ISO.test(ci) || !ISO.test(co) || co <= ci) return 0;
  return Math.round((Date.parse(co) - Date.parse(ci)) / 86400000);
}

function keyOf(group, iso, rec) {
  switch (group) {
    case 'none': return 'Total';
    case 'month': return iso ? iso.slice(0, 7) : '(no date)';
    case 'day': return iso || '(no date)';
    case 'week': {
      if (!iso) return '(no date)';
      const d = new Date(iso + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));   // Monday
      return d.toISOString().slice(0, 10);
    }
    case 'weekday': return iso ? WD[new Date(iso + 'T00:00:00Z').getUTCDay()] : '(no date)';
    case 'property': return rec.property || '(none)';
    case 'channel': return rec.channel || '(none)';
    case 'booking_type': return rec.booking_type || '(none)';
    case 'expense_category': return rec.category || 'Other';
    case 'expense_type': return rec.type || '(none)';
  }
  return 'Total';
}

const inRange = (iso, a) => {
  if (!a.from && !a.to) return true;
  if (!iso) return false;
  if (a.from && iso < a.from) return false;
  if (a.to && iso > a.to) return false;
  return true;
};

/* Booking pieces with the Report tab's rules: scopeBookings for the property
   attribution, pieceDates for the basis. Each piece: rec, date, frac (its
   share of the booking's money), first (counts the booking once). */
function bookingPieces(data, a, deps) {
  const scoped = deps.scopeBookings(data.bookings, a.property || null);
  const out = [];
  for (const x of scoped) {
    const r = x.r;
    if (a.channel && String(r.channel || '').toLowerCase() !== a.channel.toLowerCase()) continue;
    if (a.booking_type && String(r.booking_type || '').toLowerCase() !== a.booking_type.toLowerCase()) continue;
    const { list } = deps.pieceDates(r, a.basis);
    const each = list.length ? 1 / list.length : 0;
    list.forEach((d, i) => {
      const iso = ISO.test(String(d).slice(0, 10)) ? String(d).slice(0, 10) : '';
      if (!inRange(iso, a)) return;
      out.push({ x, r, iso, frac: each, first: i === 0 && x.own });
    });
  }
  return out;
}

function expenseRows(data, a) {
  return data.expenses.filter((r) => {
    if (!EXP_TYPES.has(r.type)) return false;           // deposits etc. are not expenses
    if (a.property && r.property !== a.property) return false;
    if (a.expense_category && String(r.category || '').toLowerCase() !== a.expense_category.toLowerCase()) return false;
    return inRange(String(r.txn_date || r.expense_month || '').slice(0, 10), a);
  });
}

function normArgs(raw, propNames) {
  const a = {
    measure: String(raw.measure || ''), group_by: String(raw.group_by || 'none'),
    basis: raw.basis === 'stay' ? 'stay' : 'booked',
    from: ISO.test(String(raw.from || '')) ? raw.from : '', to: ISO.test(String(raw.to || '')) ? raw.to : '',
    property: String(raw.property || ''), channel: String(raw.channel || ''),
    booking_type: String(raw.booking_type || ''), expense_category: String(raw.expense_category || ''),
    sort: ['key', 'value_desc', 'value_asc'].includes(raw.sort) ? raw.sort : '',
    limit: Math.max(1, Math.min(60, Number(raw.limit) || 60)),
  };
  if (!MEASURES.includes(a.measure)) refuse('Unknown measure "' + a.measure + '". Use one of: ' + MEASURES.join(', '));
  if (!GROUPS.includes(a.group_by)) refuse('Unknown group_by "' + a.group_by + '". Use one of: ' + GROUPS.join(', '));
  if (a.property === 'All') a.property = '';
  if (a.property) {
    const hit = propNames.find((n) => n.toLowerCase() === a.property.toLowerCase());
    if (!hit) refuse('Unknown property "' + a.property + '". Properties: ' + propNames.join(', '));
    a.property = hit;
  }
  return a;
}

function runQuery(data, raw, me, deps) {
  const a = normArgs(raw, data.props.map((p) => p.name));
  for (const r of RIGHT_OF[a.measure]) if (!me.isAdmin && !me.can(r)) refuse('The user’s role cannot see ' + a.measure + '. Tell them so.');
  const isExp = a.measure === 'expenses', isPnl = a.measure === 'net_pnl';
  if ((isExp || isPnl) && BOOKING_ONLY_GROUPS.has(a.group_by)) refuse(a.measure + ' cannot be grouped by ' + a.group_by);
  if (!isExp && EXPENSE_ONLY_GROUPS.has(a.group_by)) refuse(a.measure + ' cannot be grouped by ' + a.group_by);
  if (isPnl && (a.channel || a.booking_type)) refuse('net_pnl cannot be filtered by channel or booking type');

  const acc = new Map();   // key -> {v, n}
  const add = (k, v, n = 0) => { const o = acc.get(k) || { v: 0, n: 0 }; o.v += v; o.n += n; acc.set(k, o); };

  if (!isExp) {
    for (const p of bookingPieces(data, a, deps)) {
      const k = keyOf(a.group_by, p.iso, p.r), sh = (v) => p.x.share(v) * p.frac;
      switch (a.measure) {
        case 'revenue': case 'net_pnl': add(k, sh(p.r.net_earned)); break;
        case 'bookings': add(k, p.first ? 1 : 0); break;
        case 'nights': add(k, nightsOf(p.r) * p.frac); break;
        case 'avg_booking_value': add(k, sh(p.r.net_earned), p.first ? 1 : 0); break;
        case 'pending': add(k, Math.max(0, sh(p.r.pending_amount))); break;
        case 'guest_paid': add(k, sh(p.r.guest_paid)); break;
        case 'commission': add(k, sh(p.r.commission_paid)); break;
      }
    }
  }
  if (isExp || isPnl) {
    for (const r of expenseRows(data, a)) {
      const iso = String(r.txn_date || r.expense_month || '').slice(0, 10);
      add(keyOf(a.group_by, ISO.test(iso) ? iso : (/^\d{4}-\d{2}$/.test(iso.slice(0, 7)) ? iso.slice(0, 7) + '-01' : ''), r),
        isPnl ? -Number(r.amount || 0) : Number(r.amount || 0));
    }
  }

  let rows = [...acc.entries()].map(([key, o]) => ({
    key, value: a.measure === 'avg_booking_value' ? (o.n ? r0(o.v / o.n) : 0) : (a.measure === 'nights' ? Math.round(o.v * 10) / 10 : r0(o.v)),
  }));
  const timeGroup = ['month', 'week', 'day'].includes(a.group_by);
  if (a.group_by === 'weekday') rows.sort((x, y) => WD.indexOf(x.key) - WD.indexOf(y.key));
  else if (a.sort === 'value_desc' || (!a.sort && !timeGroup)) rows.sort((x, y) => y.value - x.value);
  else if (a.sort === 'value_asc') rows.sort((x, y) => x.value - y.value);
  else rows.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  const truncated = rows.length > a.limit;
  if (truncated) rows = timeGroup && !a.sort ? rows.slice(-a.limit) : rows.slice(0, a.limit);

  let total = rows.reduce((s, r) => s + r.value, 0);
  if (a.measure === 'avg_booking_value') {
    let v = 0, n = 0; for (const o of acc.values()) { v += o.v; n += o.n; } total = n ? r0(v / n) : 0;
  }
  const unit = ['bookings'].includes(a.measure) ? 'count' : a.measure === 'nights' ? 'nights' : 'INR';
  return { args: a, rows, total: Math.round(total * 10) / 10, unit, truncated };
}

function listRecords(data, raw, me, deps) {
  const kind = raw.kind === 'expenses' ? 'expenses' : 'bookings';
  const a = normArgs({ ...raw, measure: kind === 'expenses' ? 'expenses' : 'revenue' }, data.props.map((p) => p.name));
  const limit = Math.max(1, Math.min(25, Number(raw.limit) || 10));
  if (kind === 'expenses') {
    if (!me.isAdmin && !me.can('metric.expenses')) refuse('The user’s role cannot see expenses.');
    let rows = expenseRows(data, a).map((r) => ({
      date: String(r.txn_date || r.expense_month || '').slice(0, 10), item: r.item || '', property: r.property || '',
      category: r.category || '', type: r.type || '', amount: r0(Number(r.amount || 0)),
    }));
    rows.sort((x, y) => (raw.sort_by === 'date' ? (y.date < x.date ? -1 : 1) : y.amount - x.amount));
    return { kind, rows: rows.slice(0, limit), matched: rows.length };
  }
  if (!me.isAdmin && !me.can('metric.bookings')) refuse('The user’s role cannot see bookings.');
  const money = me.isAdmin || me.can('metric.money');
  const seen = new Set(), rows = [];
  for (const p of bookingPieces(data, a, deps)) {
    if (seen.has(p.x)) continue; seen.add(p.x);
    const r = p.r;
    if (raw.only_pending && !(Number(r.pending_amount) > 0)) continue;
    rows.push({
      booking_id: r.booking_id, booking_date: r.booking_date || '', guest: r.lead_guest || '',
      property: r.property || '', channel: r.channel || '', type: r.booking_type || '',
      checkin: r.checkin_date || '', checkout: r.checkout_date || '', nights: nightsOf(r), guests: Number(r.guests) || 0,
      ...(money ? { net: r0(p.x.share(r.net_earned)), pending: r0(Math.max(0, p.x.share(r.pending_amount))) } : {}),
    });
  }
  const by = raw.sort_by;
  rows.sort((x, y) => by === 'pending' ? (y.pending || 0) - (x.pending || 0)
    : by === 'date' ? (y.booking_date < x.booking_date ? -1 : 1)
    : by === 'nights' ? y.nights - x.nights : (y.net || 0) - (x.net || 0));
  return { kind, rows: rows.slice(0, limit), matched: rows.length };
}

/* ── the model ── */
const FILTERS = {
  from: { type: 'STRING', description: 'Start date YYYY-MM-DD, inclusive. Omit for all time.' },
  to: { type: 'STRING', description: 'End date YYYY-MM-DD, inclusive.' },
  property: { type: 'STRING', description: 'Exact property name, or omit for all properties.' },
  channel: { type: 'STRING', description: 'Booking channel, e.g. Airbnb. Bookings only.' },
  booking_type: { type: 'STRING', enum: ['Stay', 'Resold', 'Pass'] },
  expense_category: { type: 'STRING', description: 'Expense category. Expenses only.' },
  basis: { type: 'STRING', enum: ['booked', 'stay'], description: 'booked = money on the booking date (default); stay = money spread over the nights stayed.' },
};
const TOOLS = [{
  functionDeclarations: [
    {
      name: 'run_query',
      description: 'Compute one aggregate figure from the business data, optionally grouped. Returns {id, rows:[{key,value}], total, unit}. Use the id in charts.',
      parameters: {
        type: 'OBJECT',
        properties: {
          measure: { type: 'STRING', enum: MEASURES },
          group_by: { type: 'STRING', enum: GROUPS },
          sort: { type: 'STRING', enum: ['key', 'value_desc', 'value_asc'] },
          limit: { type: 'INTEGER', description: 'Max rows, 1–60.' },
          ...FILTERS,
        },
        required: ['measure', 'group_by'],
      },
    },
    {
      name: 'list_records',
      description: 'List individual bookings or expenses (max 25) matching the filters — for "which guests…", "biggest expenses…" questions.',
      parameters: {
        type: 'OBJECT',
        properties: {
          kind: { type: 'STRING', enum: ['bookings', 'expenses'] },
          sort_by: { type: 'STRING', enum: ['net', 'pending', 'date', 'nights', 'amount'] },
          only_pending: { type: 'BOOLEAN', description: 'Bookings with money still to collect.' },
          limit: { type: 'INTEGER' },
          ...FILTERS,
        },
        required: ['kind'],
      },
    },
    {
      name: 'submit_report',
      description: 'Finish: deliver the report to the user. Call exactly once, after the queries.',
      parameters: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING', description: 'Short report title, max 8 words.' },
          summary: { type: 'STRING', description: 'The direct answer in 2–4 plain sentences, with the key numbers.' },
          kpis: {
            type: 'ARRAY', description: '2–4 headline numbers, copied exactly from query results.',
            items: { type: 'OBJECT', properties: {
              label: { type: 'STRING' }, value: { type: 'STRING', description: 'Formatted, e.g. ₹1,25,500 or 42 nights' },
              note: { type: 'STRING', description: 'Optional short context, e.g. +12% vs Oct' },
            }, required: ['label', 'value'] },
          },
          charts: {
            type: 'ARRAY', description: '0–3 charts. Each draws a query you ran, by its id.',
            items: { type: 'OBJECT', properties: {
              query_id: { type: 'STRING' }, kind: { type: 'STRING', enum: ['bar', 'line', 'table'] },
              title: { type: 'STRING' },
            }, required: ['query_id', 'kind', 'title'] },
          },
          records: { type: 'STRING', description: 'Optional: id of a list_records result to show as a table.' },
          insights: { type: 'ARRAY', items: { type: 'STRING' }, description: '2–5 trends, comparisons or risks worth acting on.' },
          followups: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Exactly 3 natural next questions this data can answer.' },
        },
        required: ['title', 'summary', 'insights', 'followups'],
      },
    },
  ],
}];

function systemPrompt(data, me, today) {
  const props = data.props.map((p) => `${p.name}${p.location ? ' (' + p.location + ')' : ''}${p.status && p.status !== 'Active' ? ' [' + p.status + ']' : ''}`).join('; ');
  const channels = [...new Set(data.bookings.map((r) => r.channel).filter(Boolean))].join(', ');
  const cats = [...new Set(data.expenses.map((r) => r.category).filter(Boolean))].join(', ');
  const dates = data.bookings.map((r) => r.booking_date).filter(Boolean).sort();
  const hidden = me.isAdmin ? [] : ['metric.money', 'metric.bookings', 'metric.expenses'].filter((r) => !me.can(r));
  return `You are the analyst inside a short-term-rental business's operations app. You answer the owner's or staff's questions about their own business data and produce a short report.

Today is ${today}. Currency is Indian Rupees; write amounts like ₹1,25,500 (Indian grouping).

Business model:
- Properties (units): ${props}.
- A booking has a type: Stay (guest stays in our unit), Resold (we sold a guest to another host's unit, we keep a margin), Pass (we passed a guest to a host who pays us a fee).
- Revenue means net earned (what we keep). Guest paid is the gross. Commission is what platforms or referrers took. Pending is money not yet received.
- Channels seen: ${channels || 'none'}.
- Expense categories seen: ${cats || 'none'}. Expense types: One-time (setup), Recurring (rent, bills), Operating (supplies, cleaning).
- Booking dates in the data run from ${dates[0] || '?'} to ${dates[dates.length - 1] || '?'}.
- basis: "booked" puts a booking's money on its booking date; "stay" spreads it across the nights stayed. Default to booked unless the question is about occupancy, what the flats earned in a period, or stays.
${hidden.length ? `- This user's role cannot see: ${hidden.join(', ')}. If asked, say so politely; never estimate those figures.\n` : ''}
Rules:
- Every number you state must come from a run_query or list_records result in this conversation. Never estimate or invent figures. If the data cannot answer, say what is missing.
- Be economical: call ALL the queries you need together in your first turn (usually 1–4, in parallel), then call submit_report in the next turn. Avoid extra rounds. For trends use group_by month/week; for comparisons group by property/channel/booking_type. Compare against the previous period when it helps.
- Resolve relative dates ("this month", "last quarter", "this year") into from/to dates using today's date.
- Then call submit_report once. Charts must reference query ids you received. Use line for time trends, bar for comparisons, table for lists. Keep text short and specific — a busy operator reads this on a phone.
- Follow-up questions must be specific and answerable from this data.`;
}

/* Busy (429/5xx) is retried with a short backoff. A question whose FIRST
   turn cannot get through moves to the fallback model; once a conversation
   has started it stays on one model, because Gemini's thought signatures are
   only valid on the model that wrote them. */
const FALLBACK_DEFAULT = 'gemini-3.5-flash-lite';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
class Busy extends Error {}

/* Whole question must finish inside the app's 60 s wait. */
const DEADLINE_MS = 50000;

async function geminiOnce(env, model, body, deadline) {
  for (let attempt = 0; ; attempt++) {
    const left = deadline - Date.now();
    if (left < 3000) throw new Error('The AI took too long. Try a simpler question.');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), Math.min(left, 30000));
    let res;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
    } catch (e) {
      throw new Error(e?.name === 'AbortError' ? 'The AI took too long. Try a simpler question.' : 'Could not reach the AI service.');
    } finally { clearTimeout(timer); }
    const j = await res.json().catch(() => ({}));
    if (res.ok) return j;
    const msg = j?.error?.message || ('HTTP ' + res.status);
    const busy = res.status === 429 || res.status >= 500;
    if (res.status === 402) throw new Error('AI credit has run out — top up billing in Google AI Studio.');
    if (busy && attempt < 2 && deadline - Date.now() > 8000) { await wait(800 * (attempt + 1)); continue; }
    if (busy) throw new Busy('AI service is busy right now — try again in a minute.');
    throw new Error('AI service error: ' + msg.slice(0, 200));
  }
}

export async function askAI(env, me, payload, deps) {
  if (!env.GEMINI_API_KEY) throw new Error('AI is not set up yet (missing GEMINI_API_KEY).');
  const question = String(payload.question || '').trim().slice(0, 600);
  if (!question) throw new Error('Type a question first.');
  const t0 = Date.now(), deadline = t0 + DEADLINE_MS;
  const data = await loadData(env, deps);
  const today = deps.todayISO();

  /* Earlier questions in this thread, so "and for last month?" works. Only the
     question and our own summary go back — never earlier tool data. */
  const contents = [];
  for (const h of (Array.isArray(payload.history) ? payload.history : []).slice(-4)) {
    if (!h || !h.q) continue;
    contents.push({ role: 'user', parts: [{ text: String(h.q).slice(0, 600) }] });
    contents.push({ role: 'model', parts: [{ text: String(h.a || '').slice(0, 1200) || '(answered)' }] });
  }
  contents.push({ role: 'user', parts: [{ text: question }] });

  let model = env.GEMINI_MODEL || MODEL_DEFAULT;
  const hist = (Array.isArray(payload.history) ? payload.history : []).slice(-4);
  const key = await cacheKey(model, question, hist, data);
  const hit = await cachedReport(env, key);
  if (hit) {
    const u = await recordUsage(env, { user: me.username, model, question, ok: 1, cached: 1, key });
    return { ok: true, report: { ...hit, cached: true, ms: Date.now() - t0, at: new Date().toISOString() }, usage: slim(u) };
  }
  await checkBudget(env);

  const results = {};   // id -> query or list result
  let qn = 0, report = null;
  const usage = { in: 0, cached: 0, out: 0 };
  try {
  for (let turn = 0; turn < MAX_TURNS && !report; turn++) {
    const last = turn === MAX_TURNS - 1;
    const req = {
      systemInstruction: { parts: [{ text: systemPrompt(data, me, today) }] },
      contents,
      tools: TOOLS,
      toolConfig: { functionCallingConfig: { mode: 'ANY', ...(last ? { allowedFunctionNames: ['submit_report'] } : {}) } },
      generationConfig: { maxOutputTokens: 2048, thinkingConfig: { thinkingLevel: 'low' } },
    };
    let resp;
    try { resp = await geminiOnce(env, model, req, deadline); }
    catch (e) {
      const fb = env.GEMINI_FALLBACK || FALLBACK_DEFAULT;
      if (!(e instanceof Busy) || turn > 0 || model === fb) throw e;
      model = fb;
      resp = await geminiOnce(env, model, req, deadline);
    }
    const um = resp.usageMetadata || {};
    const cachedTok = um.cachedContentTokenCount || 0;
    usage.in += Math.max(0, (um.promptTokenCount || 0) - cachedTok);
    usage.cached += cachedTok;
    usage.out += (um.candidatesTokenCount || 0) + (um.thoughtsTokenCount || 0);
    const cand = resp.candidates?.[0];
    const parts = cand?.content?.parts || [];
    const calls = parts.filter((p) => p.functionCall);
    if (!calls.length) {
      const txt = parts.map((p) => p.text || '').join('').trim();
      if (txt) { report = { title: question.slice(0, 60), summary: txt, insights: [], followups: [] }; break; }
      throw new Error('The AI returned nothing (' + (cand?.finishReason || 'no reason') + '). Try rephrasing.');
    }
    contents.push(cand.content);   // returned as-is: keeps any thought signatures intact
    const replies = [];
    for (const { functionCall: fc } of calls) {
      const args = fc.args || {};
      let out;
      try {
        if (fc.name === 'submit_report') { report = args; out = { ok: true }; }
        else if (fc.name === 'run_query') {
          const id = 'q' + (++qn), r = runQuery(data, args, me, deps);
          results[id] = { type: 'query', ...r };
          /* Compact for the model: [key, value] pairs, no echo of the args. */
          out = { id, unit: r.unit, total: r.total, rows: r.rows.map((x) => [x.key, x.value]), ...(r.truncated ? { truncated: true } : {}) };
        }
        else if (fc.name === 'list_records') { const id = 'r' + (++qn); results[id] = { type: 'records', ...listRecords(data, args, me, deps) }; out = { id, matched: results[id].matched, rows: results[id].rows }; }
        else out = { error: 'Unknown tool ' + fc.name };
      } catch (e) {
        if (!(e instanceof Refuse)) throw e;
        out = { error: e.message };
      }
      replies.push({ functionResponse: { name: fc.name, response: out } });
    }
    if (!report) contents.push({ role: 'user', parts: replies });
  }
  if (!report) throw new Error('The AI could not finish this report. Try a narrower question.');
  } catch (e) {
    /* A failed question can still have used tokens — meter it. */
    if (usage.in || usage.out) await recordUsage(env, { user: me.username, model, question, ok: 0, in: usage.in, cachedTok: usage.cached, out: usage.out, cost: costUsd(model, usage) });
    throw e;
  }

  /* Attach OUR rows to every chart; drop charts pointing at nothing. */
  const charts = (Array.isArray(report.charts) ? report.charts : []).slice(0, 3).map((c) => {
    const q = results[c.query_id];
    if (!q || q.type !== 'query' || !q.rows.length) return null;
    return { kind: ['bar', 'line', 'table'].includes(c.kind) ? c.kind : 'bar', title: String(c.title || ''),
      unit: q.unit, measure: q.args.measure, group: q.args.group_by, rows: q.rows, total: q.total };
  }).filter(Boolean);
  const rec = report.records && results[report.records]?.type === 'records' ? results[report.records] : null;
  const str = (v, n) => String(v || '').slice(0, n);
  const out = {
      question,
      title: str(report.title, 80) || question.slice(0, 60),
      summary: str(report.summary, 1500),
      kpis: (Array.isArray(report.kpis) ? report.kpis : []).slice(0, 4).map((k) => ({ label: str(k.label, 40), value: str(k.value, 30), note: str(k.note, 60) })),
      charts,
      records: rec ? { kind: rec.kind, rows: rec.rows } : null,
      insights: (Array.isArray(report.insights) ? report.insights : []).slice(0, 5).map((s) => str(s, 300)),
      followups: (Array.isArray(report.followups) ? report.followups : []).slice(0, 3).map((s) => str(s, 160)),
      queries: Object.keys(results).length,
      ms: Date.now() - t0,
      model,
      tokens: usage,
      at: new Date().toISOString(),
  };
  const cost = costUsd(model, usage);
  const u = await recordUsage(env, { user: me.username, model, question, ok: 1, in: usage.in, cachedTok: usage.cached, out: usage.out, cost, key, report: out });
  return { ok: true, report: out, usage: slim(u) };
}

/* What the app needs after each question: the meter, not the history. */
const slim = (u) => ({ budget: u.budget, spentInr: u.spentInr, pct: u.pct, questions: u.questions });

/* For tests only. */
export const _internals = { runQuery, listRecords };
