/**
 * Hosts & the host ledger.
 *
 * Container model: a HOST holds UNITS; a DEAL ties one booking to a host (and,
 * when our guest stayed in their flat, to one of their units); PAYMENTS are the
 * money that actually moved. Balances are never stored — the app derives them
 * from deals (booking money) and payments, so editing a booking's amounts
 * moves the ledger with it.
 *
 * The money rule per deal, using the booking's own figures:
 *   collected by host → the host owes us our net (net_earned)
 *   collected by us   → we owe the host their share (commission_paid)
 * Settled deals (pre-ledger history) count for nothing.
 */

class HostError extends Error {}
const fail = (m) => { throw new HostError(m); };
export { HostError };

const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const now = () => new Date().toISOString();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UNIT_FIELDS = ['unit', 'building', 'address', 'map_link', 'wifi_name', 'wifi_password',
  'checkin_time', 'checkout_time', 'caretaker_name', 'caretaker_phone', 'notes'];

export async function hostsData(env) {
  const [h, u, d, p] = await env.DB.batch([
    env.DB.prepare(`SELECT id, name, phone, notes, updated_at FROM hosts WHERE removed_at = '' ORDER BY name COLLATE NOCASE`),
    env.DB.prepare(`SELECT * FROM host_units WHERE removed_at = '' ORDER BY host_id, unit`),
    env.DB.prepare(`SELECT booking_row, host_id, unit_id, collected_by, settled, updated_by, updated_at FROM host_deals`),
    env.DB.prepare(`SELECT id, host_id, txn_date, amount, direction, mode, note, created_by, created_at FROM host_payments WHERE removed_at = '' ORDER BY txn_date, id`),
  ]);
  return { hosts: h.results || [], units: u.results || [], deals: d.results || [], payments: p.results || [] };
}

function requireAdmin(me) { if (!me.isAdmin) fail('Only an Admin can change hosts and their ledger'); }

export async function saveHost(env, me, d) {
  requireAdmin(me);
  const name = clip(d.name, 80);
  if (!name) fail('Give the host a name');
  const phone = clip(d.phone, 30), notes = clip(d.notes, 1000);
  const clash = await env.DB.prepare(`SELECT id FROM hosts WHERE name = ? COLLATE NOCASE AND removed_at = '' AND id <> ?`)
    .bind(name, Number(d.id) || 0).first();
  if (clash) fail(`A host called "${name}" already exists`);
  if (d.id) {
    const r = await env.DB.prepare(`UPDATE hosts SET name = ?, phone = ?, notes = ?, updated_at = ?, updated_by = ? WHERE id = ? AND removed_at = ''`)
      .bind(name, phone, notes, now(), me.username, Number(d.id)).run();
    if (!r.meta.changes) fail('Host not found');
    return { ok: true, message: 'Host saved', id: Number(d.id) };
  }
  const r = await env.DB.prepare(`INSERT INTO hosts (name, phone, notes, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(name, phone, notes, now(), me.username, now(), me.username).run();
  return { ok: true, message: 'Host added', id: r.meta.last_row_id };
}

export async function removeHost(env, me, d) {
  requireAdmin(me);
  const id = Number(d.id);
  const open = await env.DB.prepare(`SELECT COUNT(*) n FROM host_deals WHERE host_id = ? AND settled = 0`).bind(id).first();
  const pays = await env.DB.prepare(`SELECT COUNT(*) n FROM host_payments WHERE host_id = ? AND removed_at = ''`).bind(id).first();
  if ((open && open.n) || (pays && pays.n)) fail('This host has bookings or payments on the ledger — keep them, or remove those first');
  const r = await env.DB.prepare(`UPDATE hosts SET removed_at = ? WHERE id = ? AND removed_at = ''`).bind(now(), id).run();
  if (!r.meta.changes) fail('Host not found');
  await env.DB.prepare(`DELETE FROM host_deals WHERE host_id = ?`).bind(id).run();   // settled history only, by the check above
  return { ok: true, message: 'Host removed' };
}

export async function saveHostUnit(env, me, d) {
  requireAdmin(me);
  const hostId = Number(d.hostId);
  const host = await env.DB.prepare(`SELECT id FROM hosts WHERE id = ? AND removed_at = ''`).bind(hostId).first();
  if (!host) fail('Host not found');
  const v = {};
  for (const k of UNIT_FIELDS) v[k] = clip(d[k], k === 'address' || k === 'notes' ? 500 : 200);
  if (!v.unit) fail('Give the unit a number or name');
  if (d.id) {
    const r = await env.DB.prepare(`UPDATE host_units SET ${UNIT_FIELDS.map((k) => k + ' = ?').join(', ')} WHERE id = ? AND host_id = ? AND removed_at = ''`)
      .bind(...UNIT_FIELDS.map((k) => v[k]), Number(d.id), hostId).run();
    if (!r.meta.changes) fail('Unit not found');
    return { ok: true, message: 'Unit saved', id: Number(d.id) };
  }
  const r = await env.DB.prepare(`INSERT INTO host_units (host_id, ${UNIT_FIELDS.join(', ')}) VALUES (?, ${UNIT_FIELDS.map(() => '?').join(', ')})`)
    .bind(hostId, ...UNIT_FIELDS.map((k) => v[k])).run();
  return { ok: true, message: 'Unit added', id: r.meta.last_row_id };
}

export async function removeHostUnit(env, me, d) {
  requireAdmin(me);
  const r = await env.DB.prepare(`UPDATE host_units SET removed_at = ? WHERE id = ? AND removed_at = ''`).bind(now(), Number(d.id)).run();
  if (!r.meta.changes) fail('Unit not found');
  return { ok: true, message: 'Unit removed — past bookings keep showing it' };
}

/* Validated before a booking is written, so a bad deal cannot half-save it. */
export async function checkHostDeal(env, deal) {
  if (deal === undefined) return undefined;
  if (deal === null || !deal.hostId) return null;
  const hostId = Number(deal.hostId);
  const host = await env.DB.prepare(`SELECT id FROM hosts WHERE id = ? AND removed_at = ''`).bind(hostId).first();
  if (!host) fail('That host no longer exists');
  const unitId = Number(deal.unitId) || 0;
  if (unitId) {
    const u = await env.DB.prepare(`SELECT id FROM host_units WHERE id = ? AND host_id = ?`).bind(unitId, hostId).first();
    if (!u) fail('That unit does not belong to the host');
  }
  const collected = deal.collectedBy === 'us' ? 'us' : 'host';
  return { hostId, unitId, collected };
}

/* deal: undefined = leave as is · null = remove · object = set. */
export async function writeHostDeal(env, me, row, deal) {
  if (deal === undefined) return;
  if (deal === null) { await env.DB.prepare(`DELETE FROM host_deals WHERE booking_row = ?`).bind(row).run(); return; }
  await env.DB.prepare(
    `INSERT INTO host_deals (booking_row, host_id, unit_id, collected_by, settled, updated_at, updated_by)
     VALUES (?, ?, ?, ?, 0, ?, ?)
     ON CONFLICT(booking_row) DO UPDATE SET host_id = excluded.host_id, unit_id = excluded.unit_id,
       collected_by = excluded.collected_by, settled = 0, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  ).bind(row, deal.hostId, deal.unitId, deal.collected, now(), (me && me.username) || '').run();
}

export async function deleteHostDeal(env, row) {
  await env.DB.prepare(`DELETE FROM host_deals WHERE booking_row = ?`).bind(row).run();
}

export async function addHostPayment(env, me, d) {
  requireAdmin(me);
  const hostId = Number(d.hostId);
  const host = await env.DB.prepare(`SELECT id FROM hosts WHERE id = ? AND removed_at = ''`).bind(hostId).first();
  if (!host) fail('Host not found');
  const amount = Number(d.amount);
  if (!Number.isFinite(amount) || amount <= 0) fail('Enter an amount above ₹0');
  if (amount > 10000000) fail('That amount looks wrong');
  const direction = d.direction === 'received' ? 'received' : d.direction === 'paid' ? 'paid' : '';
  if (!direction) fail('Say whether you paid the host or received from them');
  const date = clip(d.date, 10);
  if (!DATE_RE.test(date)) fail('Pick the payment date');
  const r = await env.DB.prepare(
    `INSERT INTO host_payments (host_id, txn_date, amount, direction, mode, note, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(hostId, date, Math.round(amount * 100) / 100, direction, clip(d.mode, 30), clip(d.note, 300), now(), me.username).run();
  return { ok: true, message: direction === 'paid' ? 'Payment to host recorded' : 'Payment from host recorded', id: r.meta.last_row_id };
}

export async function removeHostPayment(env, me, d) {
  requireAdmin(me);
  const r = await env.DB.prepare(`UPDATE host_payments SET removed_at = ? WHERE id = ? AND removed_at = ''`).bind(now(), Number(d.id)).run();
  if (!r.meta.changes) fail('Payment not found');
  return { ok: true, message: 'Payment removed' };
}

/* From the booking form ("Channel: From host → + New host"): anyone who can
   write bookings may create a host with one unit. Reuses an existing host of
   the same name (and unit) instead of duplicating. Editing stays Admin. */
export async function quickAddHost(env, me, d) {
  if (!(me.isAdmin || me.can('booking.add') || me.can('booking.update'))) fail('Your role cannot add hosts');
  const name = clip(d.name, 80);
  if (!name) fail('Enter the host’s name');
  const phone = clip(d.phone, 30);
  const unit = clip(d.unit, 40);
  let host = await env.DB.prepare(`SELECT id, phone FROM hosts WHERE name = ? COLLATE NOCASE AND removed_at = ''`).bind(name).first();
  let hostId;
  if (host) {
    hostId = host.id;
    if (phone && !host.phone) await env.DB.prepare(`UPDATE hosts SET phone = ?, updated_at = ?, updated_by = ? WHERE id = ?`).bind(phone, now(), me.username, hostId).run();
  } else {
    const r = await env.DB.prepare(`INSERT INTO hosts (name, phone, notes, created_at, created_by, updated_at, updated_by) VALUES (?, ?, '', ?, ?, ?, ?)`)
      .bind(name, phone, now(), me.username, now(), me.username).run();
    hostId = r.meta.last_row_id;
  }
  let unitId = 0;
  if (unit) {
    const u = await env.DB.prepare(`SELECT id FROM host_units WHERE host_id = ? AND unit = ? COLLATE NOCASE AND removed_at = ''`).bind(hostId, unit).first();
    if (u) unitId = u.id;
    else unitId = (await env.DB.prepare(`INSERT INTO host_units (host_id, unit) VALUES (?, ?)`).bind(hostId, unit).run()).meta.last_row_id;
  }
  return { ok: true, message: host ? name + ' was already a host — linked' : 'Host ' + name + ' added', hostId, unitId };
}
