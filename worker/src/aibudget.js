/* ─────────────── AI CREDIT METER ───────────────
   Google does not let the app read the prepaid balance, so we keep our own
   meter: every question's tokens × the model's list price, summed since the
   budget was last set. At 70 % an alert is raised (in the app for Admins, and
   by email when RESEND_API_KEY + AI_ALERT_EMAIL are set); at 100 % questions
   stop until an Admin records a top-up. Our figure is an estimate — Google's
   bill is the truth — so the stop includes a small safety margin. */

const USD_INR = 88;            // override with the AI_USD_INR var
const DEFAULT_BUDGET_INR = 500;
const SAFETY = 1.1;            // count 10 % more than our estimate

/* USD per 1M tokens: [input, cached input, output incl. thinking].
   Gemini 3.8 Flash is on an introductory price until 31-Dec-2026. */
function priceOf(model, iso) {
  const m = String(model || '');
  if (m === 'gemini-3.8-flash') return iso < '2027-01-01' ? [0.75, 0.075, 3.75] : [1.5, 0.15, 7.5];
  if (m === 'gemini-3.1-flash-lite') return [0.25, 0.025, 1.5];
  if (m === 'gemini-3.5-flash-lite') return [0.3, 0.03, 2.5];
  return [1.5, 0.15, 7.5];     // unknown model: assume the dearest Flash
}
export function costUsd(model, u, iso = new Date().toISOString()) {
  const [pi, pc, po] = priceOf(model, iso);
  return (u.in * pi + u.cached * pc + u.out * po) / 1e6;
}

async function getSettings(env) {
  const { results } = await env.DB.prepare('SELECT k, v FROM ai_settings').all();
  const s = Object.fromEntries(results.map((r) => [r.k, r.v]));
  return {
    budget: Number(s.budget_inr) || DEFAULT_BUDGET_INR,
    since: s.since || '2000-01-01T00:00:00Z',
    alerted70: s.alerted70 === '1', alerted100: s.alerted100 === '1',
  };
}
const setKV = (env, k, v) => env.DB.prepare('INSERT INTO ai_settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind(k, String(v)).run();

export async function usageSummary(env) {
  const s = await getSettings(env);
  const rate = Number(env.AI_USD_INR) || USD_INR;
  const [tot, recent] = await Promise.all([
    env.DB.prepare(`SELECT COALESCE(SUM(cost_usd),0) usd, COUNT(*) n, COALESCE(SUM(cached),0) hits,
                           COALESCE(SUM(in_tokens),0) tin, COALESCE(SUM(cached_tokens),0) tc, COALESCE(SUM(out_tokens),0) tout
                      FROM ai_usage WHERE at >= ?`).bind(s.since).first(),
    env.DB.prepare('SELECT at, user, model, cost_usd, cached, ok, question FROM ai_usage ORDER BY id DESC LIMIT 8').all(),
  ]);
  const spent = tot.usd * rate * SAFETY;
  return {
    budget: s.budget, since: s.since, spentInr: Math.round(spent * 100) / 100,
    pct: Math.round((spent / s.budget) * 1000) / 10,
    questions: tot.n, cacheHits: tot.hits,
    avgInr: tot.n - tot.hits > 0 ? Math.round((spent / (tot.n - tot.hits)) * 100) / 100 : 0,
    tokens: { in: tot.tin, cached: tot.tc, out: tot.tout },
    emailOn: !!(env.RESEND_API_KEY && env.AI_ALERT_EMAIL),
    recent: recent.results.map((r) => ({ at: r.at, user: r.user, model: r.model, inr: Math.round(r.cost_usd * rate * SAFETY * 100) / 100, cached: !!r.cached, ok: !!r.ok, q: String(r.question || '').slice(0, 80) })),
    settings: s,
  };
}

/* Called before a question. Throws when the budget is spent. */
export async function checkBudget(env) {
  const u = await usageSummary(env);
  if (u.pct >= 100) throw new Error(`AI credit budget used up (₹${Math.round(u.spentInr)} of ₹${u.budget}). An Admin can record a top-up in AI Analyst → Usage.`);
  return u;
}

export async function recordUsage(env, row) {
  await env.DB.prepare(`INSERT INTO ai_usage (at, user, model, in_tokens, cached_tokens, out_tokens, cost_usd, question, ok, cached, cache_key, report)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(new Date().toISOString(), row.user || '', row.model || '', row.in || 0, row.cachedTok || 0, row.out || 0,
      row.cost || 0, String(row.question || '').slice(0, 600), row.ok ? 1 : 0, row.cached ? 1 : 0, row.key || null,
      row.report ? JSON.stringify(row.report) : null).run();
  return afterSpend(env);
}

/* Raise each alert once per budget. */
async function afterSpend(env) {
  const u = await usageSummary(env);
  const s = u.settings;
  if (u.pct >= 70 && !s.alerted70) { await setKV(env, 'alerted70', 1); await sendAlert(env, u, 70); }
  if (u.pct >= 100 && !s.alerted100) { await setKV(env, 'alerted100', 1); await sendAlert(env, u, 100); }
  return u;
}

async function sendAlert(env, u, level) {
  if (!env.RESEND_API_KEY || !env.AI_ALERT_EMAIL) return false;
  const subject = level >= 100 ? 'AI Analyst stopped — credit budget used up' : `AI Analyst has used ${Math.round(u.pct)}% of its credit`;
  const html = `<p>${subject}.</p>
<p><b>₹${u.spentInr.toFixed(2)}</b> of ₹${u.budget} used since ${u.since.slice(0, 10)} · ${u.questions} questions (${u.cacheHits} answered from cache) · about ₹${u.avgInr.toFixed(2)} per question.</p>
<p>${level >= 100 ? 'Questions are paused.' : 'Questions keep working until 100%.'} Top up in Google AI Studio, then tap <i>Record a top-up</i> in AI Analyst → Usage.</p>
<p style="color:#888">This is the app's own estimate from token counts; Google's billing page is exact.</p>`;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.AI_ALERT_FROM || 'AI Analyst <onboarding@resend.dev>', to: [env.AI_ALERT_EMAIL], subject, html }),
    });
    return r.ok;
  } catch { return false; }
}

/* Admin: "I added ₹X" — starts a fresh budget from now. */
export async function setBudget(env, me, d) {
  if (!me.isAdmin) throw new Error('Only an Admin can change the AI budget');
  const b = Number(d.budget);
  if (!(b >= 50 && b <= 100000)) throw new Error('Budget must be between ₹50 and ₹1,00,000');
  await setKV(env, 'budget_inr', b);
  await setKV(env, 'since', new Date().toISOString());
  await setKV(env, 'alerted70', 0);
  await setKV(env, 'alerted100', 0);
  return { ok: true, message: `AI budget set to ₹${b}`, usage: await usageSummary(env) };
}

/* Admin: send a test email so the setup can be checked. */
export async function testAlert(env, me) {
  if (!me.isAdmin) throw new Error('Only an Admin can send a test alert');
  if (!env.RESEND_API_KEY || !env.AI_ALERT_EMAIL) throw new Error('Email alerts are not set up (RESEND_API_KEY and AI_ALERT_EMAIL).');
  const ok = await sendAlert(env, await usageSummary(env), 70);
  if (!ok) throw new Error('Resend did not accept the email — check the key and address.');
  return { ok: true, message: 'Test alert sent to ' + env.AI_ALERT_EMAIL };
}

/* 24-hour answer cache: same model, question, thread and data → the stored
   report, at no cost. The data fingerprint changes whenever a booking or
   expense is added, edited or deleted. */
export async function cacheKey(model, question, history, data) {
  let sum = 0;
  for (const r of data.bookings) sum += Number(r.net_earned || 0) + Number(r.pending_amount || 0) * 7 + Number(r.id || 0) * 13;
  for (const r of data.expenses) sum += Number(r.amount || 0) * 3 + Number(r.id || 0) * 17;
  const fp = `${data.bookings.length}|${data.expenses.length}|${Math.round(sum)}`;
  const raw = [model, question.toLowerCase().replace(/\s+/g, ' ').replace(/[?.!]+$/, '').trim(), JSON.stringify(history || []), fp].join('§');
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(raw));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function cachedReport(env, key) {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const r = await env.DB.prepare('SELECT report FROM ai_usage WHERE cache_key = ? AND ok = 1 AND report IS NOT NULL AND at >= ? ORDER BY id DESC LIMIT 1')
    .bind(key, since).first();
  if (!r) return null;
  try { return JSON.parse(r.report); } catch { return null; }
}
