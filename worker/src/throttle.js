/**
 * Failed-PIN throttling.
 *
 * The API is a public endpoint guarded by a short numeric PIN. Without a limit,
 * the whole keyspace is exhaustible in minutes. That was tolerable while the
 * data was the owner's own financial figures; it is not once guest identity
 * documents sit behind the same PIN, because the people exposed by a compromise
 * are third parties who never accepted the risk.
 *
 * Deliberately fail-open: if the throttle table is unreachable, requests are
 * allowed rather than locking the owner out of their own dashboard. The tradeoff
 * is explicit — availability of a personal tool over defence against an attacker
 * who can also take D1 down.
 */

const MAX_FAILS   = 10;
const WINDOW_MS   = 15 * 60 * 1000;   // failures counted within a rolling window
const BLOCK_MS    = 15 * 60 * 1000;   // lockout once the limit is hit

export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') ||
         request.headers.get('X-Forwarded-For') ||
         'unknown';
}

/* `blocked` is null when allowed, or a human-readable reason; `seen` says
   this IP has a failure on record (so a good sign-in should clear it). */
export async function throttleCheck(env, ip) {
  try {
    const row = await env.DB.prepare(
      'SELECT fails, window_start, blocked_until FROM auth_throttle WHERE ip = ?'
    ).bind(ip).first();
    if (!row) return { blocked: null, seen: false };
    const now = Date.now();
    if (row.blocked_until > now) {
      const mins = Math.ceil((row.blocked_until - now) / 60000);
      return { blocked: `Too many wrong PIN attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`, seen: true };
    }
    return { blocked: null, seen: true };
  } catch {
    return { blocked: null, seen: true };   // fail open — see header note
  }
}

export async function recordFail(env, ip) {
  try {
    const now = Date.now();
    const row = await env.DB.prepare(
      'SELECT fails, window_start FROM auth_throttle WHERE ip = ?'
    ).bind(ip).first();

    // A stale window resets the count, so occasional typos never accumulate
    // into a lockout days later.
    const fresh = row && (now - row.window_start) < WINDOW_MS;
    const fails = fresh ? row.fails + 1 : 1;
    const start = fresh ? row.window_start : now;
    const blocked = fails >= MAX_FAILS ? now + BLOCK_MS : 0;

    await env.DB.prepare(
      `INSERT INTO auth_throttle (ip, fails, window_start, blocked_until)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(ip) DO UPDATE SET fails=?, window_start=?, blocked_until=?`
    ).bind(ip, fails, start, blocked, fails, start, blocked).run();
  } catch {}
}

export async function clearFails(env, ip) {
  try {
    await env.DB.prepare('DELETE FROM auth_throttle WHERE ip = ?').bind(ip).run();
  } catch {}
}
