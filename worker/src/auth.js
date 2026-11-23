/**
 * Users, roles and rights.
 *
 * Every request carries `user` + `pin`. A blank user (or "owner") with the PIN
 * from the Worker secret is the built-in owner account — role Admin, never
 * stored — so clients that predate usernames keep working and there is always
 * one account that cannot be locked out from inside the app.
 *
 * Rights are checked centrally in the router (ACTION_RIGHTS) rather than inside
 * each handler, so adding an action without deciding who may call it fails
 * closed: an action missing from this map is readable by any signed-in user
 * only if it is listed in OPEN_ACTIONS, and rejected otherwise.
 */

export class AuthError extends Error {}
const deny = (msg) => { throw new AuthError(msg); };

/* The rights catalog. `group` + `label` are what the Rights screen renders. */
export const RIGHTS = [
  { key: 'booking.add',      group: 'Bookings',   label: 'Add' },
  { key: 'booking.update',   group: 'Bookings',   label: 'Update' },
  { key: 'booking.delete',   group: 'Bookings',   label: 'Delete' },
  { key: 'expense.add',      group: 'Expenses',   label: 'Add' },
  { key: 'expense.update',   group: 'Expenses',   label: 'Update' },
  { key: 'expense.delete',   group: 'Expenses',   label: 'Delete' },
  { key: 'saving.add',       group: 'Savings',    label: 'Add' },
  { key: 'saving.update',    group: 'Savings',    label: 'Update' },
  { key: 'saving.delete',    group: 'Savings',    label: 'Delete' },
  { key: 'property.add',     group: 'Properties', label: 'Add' },
  { key: 'property.update',  group: 'Properties', label: 'Update' },
  { key: 'property.delete',  group: 'Properties', label: 'Delete' },
  { key: 'inventory.add',    group: 'Inventory',  label: 'Add' },
  { key: 'inventory.update', group: 'Inventory',  label: 'Update' },
  { key: 'inventory.delete', group: 'Inventory',  label: 'Delete' },
  { key: 'reports.view',     group: 'Reports',    label: 'View' },
  { key: 'metric.money',     group: 'Report metrics', label: 'Money totals — revenue, expense, net P&L, monthly P&L' },
  { key: 'metric.cash',      group: 'Report metrics', label: 'Cash & savings — bank balance, pending, invested, payback' },
  { key: 'metric.bookings',  group: 'Report metrics', label: 'Bookings & channels — counts, channels, types, repeat, recent' },
  { key: 'metric.expenses',  group: 'Report metrics', label: 'Expense breakdown' },
  { key: 'calendar.view',    group: 'Calendar',   label: 'View' },
  { key: 'action.view',      group: 'Action',     label: 'View' },
  { key: 'action.manage',    group: 'Action',     label: 'Manage (tasks, payouts, reviews)' },
  { key: 'tickets.approve',  group: 'Approvals',  label: 'Approve / reject change requests' },
  { key: 'users.manage',     group: 'Users',      label: 'Create users & edit role rights' },
];
const RIGHT_KEYS = new Set(RIGHTS.map((r) => r.key));
export const ROLES = ['Admin', 'Manager', 'Viewer'];
/* Rights a single user may have overridden on top of their role. */
export const METRIC_KEYS = ['metric.money', 'metric.cash', 'metric.bookings', 'metric.expenses'];

function parseOverride(raw) {
  let o = {};
  try { o = JSON.parse(raw || '{}') || {}; } catch {}
  const out = {};
  for (const k of METRIC_KEYS) if (typeof o[k] === 'boolean') out[k] = o[k];
  return out;
}

/* Which right each mutating or restricted action needs. Update/delete actions
   that go through approval are listed too: the requester must hold the right
   to even ask. */
export const ACTION_RIGHTS = {
  dashboard: 'reports.view',
  /* Reading needs the Report; setting is further limited to Admins in setTarget(). */
  targets: 'reports.view', setTarget: 'reports.view',
  addBooking: 'booking.add', updateBooking: 'booking.update', deleteBooking: 'booking.delete',
  addExpense: 'expense.add', updateExpense: 'expense.update', deleteExpense: 'expense.delete',
  addSaving: 'saving.add', updateSaving: 'saving.update', deleteSaving: 'saving.delete',
  addProperty: 'property.add', updateProperty: 'property.update', deleteProperty: 'property.delete',
  invAddItem: 'inventory.add', invAddMovement: 'inventory.add',
  invUpdateItem: 'inventory.update', invUpdateMovement: 'inventory.update',
  invDeleteItem: 'inventory.delete', invDeleteMovement: 'inventory.delete',
  setPayouts: 'action.manage', setReviewStatus: 'action.manage',
  addTask: 'action.manage', updateTask: 'action.manage', setTaskDone: 'action.manage', deleteTask: 'action.manage',
  setEnquiryStatus: 'action.manage',
  /* A guest's ID document is part of the booking record. */
  uploadAttachment: 'booking.update', deleteAttachment: 'booking.update',
  approveTicket: 'tickets.approve', rejectTicket: 'tickets.approve',
  users: 'users.manage', addUser: 'users.manage', updateUser: 'users.manage', setRoleRights: 'users.manage',
  mirrorNow: 'users.manage', sweepIds: 'users.manage',
};
/* Read-only or self-service actions any signed-in user may call. The Action and
   Calendar tabs are derived entirely from `logs`, so it cannot be narrowed to a
   single right without blanking one of them. */
export const OPEN_ACTIONS = new Set([
  'login', 'properties', 'logs', 'invData', 'idStatus', 'idDocs', 'listAttachments', 'getAttachment',
  'tickets', 'withdrawTicket', 'changePin', 'uploadAvatar', 'deleteAvatar', 'getAvatar',
]);

export const rightLabel = (key) => {
  const r = RIGHTS.find((x) => x.key === key);
  return r ? `${r.group} · ${r.label}` : key;
};

/* ─────────────── hashing ───────────────
   A single salted SHA-256. A 4–8 digit PIN has at most 10^8 values, so a slow
   KDF would not stop an offline guess and would cost CPU on every request; the
   real protection is the per-IP throttle in the router. */
async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function newSalt() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function sameString(a, b) {                       // length-independent timing
  a = String(a); b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
const hashPin = (salt, pin) => sha256Hex(`${salt}:${pin}`);

async function readRights(env, role) {
  if (role === 'Admin') return new Set(RIGHT_KEYS);   // Admin always holds every right
  const r = await env.DB.prepare('SELECT rights FROM roles WHERE name = ?').bind(role).first();
  let list = [];
  try { list = JSON.parse((r && r.rights) || '[]'); } catch {}
  return new Set(list.filter((k) => RIGHT_KEYS.has(k)));
}

function principal(u, rights) {
  return {
    id: u.id, username: u.username, role: u.role,
    managerId: u.manager_id === undefined ? null : u.manager_id,
    rights, isAdmin: u.role === 'Admin',
    can: (k) => rights.has(k),
  };
}

/* Returns the principal, or null for bad credentials (the router counts the
   failure towards the throttle). */
export async function authenticate(env, username, pin) {
  const name = String(username || '').trim();
  if (!name || name.toLowerCase() === 'owner') {
    if (!env.PIN || !sameString(pin, env.PIN)) return null;
    return principal({ id: 0, username: 'owner', role: 'Admin', manager_id: null }, await readRights(env, 'Admin'));
  }
  const u = await env.DB.prepare(
    'SELECT id, username, pin_salt, pin_hash, role, manager_id, rights_override FROM users WHERE username = ? AND active = 1'
  ).bind(name).first();
  if (!u) return null;
  if (!sameString(await hashPin(u.pin_salt, String(pin || '')), u.pin_hash)) return null;
  const rights = await readRights(env, u.role);
  /* Admins always see everything; for everyone else a per-user override wins. */
  if (u.role !== 'Admin') {
    for (const [k, on] of Object.entries(parseOverride(u.rights_override))) {
      if (on) rights.add(k); else rights.delete(k);
    }
  }
  return principal(u, rights);
}

export async function whoAmI(env, me) {
  let managerName = '';
  if (me.managerId === 0) managerName = 'Any admin';
  else if (me.managerId) {
    const m = await env.DB.prepare('SELECT username FROM users WHERE id = ?').bind(me.managerId).first();
    managerName = m ? m.username : '';
  }
  return {
    ok: true,
    user: { id: me.id, username: me.username, role: me.role, managerId: me.managerId, managerName },
    rights: [...me.rights],
    /* Admins apply changes directly; everyone else raises a ticket. */
    needsApproval: !me.isAdmin,
  };
}

/* ─────────────── user management ─────────────── */
const nowISO = () => new Date().toISOString();
const USERNAME_RE = /^[a-z0-9._-]{3,32}$/i;
const PIN_RE = /^\d{4,8}$/;

/* A manager must be someone who can actually act on the tickets routed to
   them: an active Admin, or an active user whose role holds tickets.approve.
   0 means "the owner / any Admin". */
async function checkManager(env, managerId, selfId) {
  if (managerId === 0) return;
  if (!Number.isInteger(managerId) || managerId < 1) deny('Pick a manager');
  if (managerId === selfId) deny('A user cannot be their own manager');
  const m = await env.DB.prepare('SELECT id, role, active FROM users WHERE id = ?').bind(managerId).first();
  if (!m || !m.active) deny('Manager not found or inactive');
  if (m.role !== 'Admin' && !(await readRights(env, m.role)).has('tickets.approve')) {
    deny(`That manager's role (${m.role}) cannot approve requests`);
  }
}

function parseManager(role, v) {
  if (role === 'Admin') return null;                  // Admin changes apply directly
  if (v === '' || v === null || v === undefined) deny('Manager is required for Manager and Viewer users');
  return Number(v);
}

export async function listUsers(env) {
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.username, u.role, u.manager_id, u.active, u.created_at, u.created_by, u.rights_override, m.username AS manager_name
       FROM users u LEFT JOIN users m ON m.id = u.manager_id
      ORDER BY u.active DESC, u.username COLLATE NOCASE`
  ).all();
  const roles = (await env.DB.prepare('SELECT name, rights FROM roles ORDER BY sort').all()).results.map((r) => ({
    name: r.name,
    rights: r.name === 'Admin' ? [...RIGHT_KEYS] : JSON.parse(r.rights || '[]').filter((k) => RIGHT_KEYS.has(k)),
    locked: r.name === 'Admin',
  }));
  return {
    users: results.map((u) => ({
      id: u.id, username: u.username, role: u.role, managerId: u.manager_id,
      managerName: u.manager_id === 0 ? 'Any admin' : (u.manager_name || ''),
      active: !!u.active, createdAt: u.created_at, createdBy: u.created_by,
      metricOverride: parseOverride(u.rights_override),
    })),
    roles, catalog: RIGHTS,
  };
}

export async function addUser(env, me, d) {
  const username = String(d.username || '').trim();
  if (!USERNAME_RE.test(username)) deny('Username must be 3–32 letters, digits, dot, dash or underscore');
  if (username.toLowerCase() === 'owner') deny('"owner" is reserved for the built-in account');
  const pin = String(d.pin || '');
  if (!PIN_RE.test(pin)) deny('PIN must be 4–8 digits');
  const role = String(d.role || '');
  if (!ROLES.includes(role)) deny('Role must be Admin, Manager or Viewer');
  const managerId = parseManager(role, d.managerId);
  if (managerId !== null) await checkManager(env, managerId, null);
  const dupe = await env.DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(username).first();
  if (dupe) deny(`Username "${username}" is already taken`);
  const salt = newSalt();
  await env.DB.prepare(
    `INSERT INTO users (username, pin_salt, pin_hash, role, manager_id, active, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
  ).bind(username, salt, await hashPin(salt, pin), role, managerId, nowISO(), me.username).run();
  return { ok: true, message: `User "${username}" created as ${role}` };
}

export async function updateUser(env, me, row, d) {
  const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(row).first();
  if (!u) deny('User not found');
  const role = d.role === undefined ? u.role : String(d.role);
  if (!ROLES.includes(role)) deny('Role must be Admin, Manager or Viewer');
  const active = d.active === undefined ? !!u.active : !!(d.active === true || d.active === 1 || d.active === '1');
  /* Stops an admin demoting or deactivating the account they are signed in
     with, which would lock them out of this screen mid-edit. */
  if (me.id === u.id && (role !== u.role || !active)) deny("You can't change your own role or deactivate yourself");
  const managerId = d.managerId === undefined && role !== 'Admin' && u.manager_id !== null
    ? u.manager_id
    : parseManager(role, d.managerId);
  if (managerId !== null && managerId !== u.manager_id) await checkManager(env, managerId, u.id);

  let pinSql = '', pinBind = [];
  if (d.pin !== undefined && d.pin !== '') {
    if (!PIN_RE.test(String(d.pin))) deny('PIN must be 4–8 digits');
    const salt = newSalt();
    pinSql = ', pin_salt = ?, pin_hash = ?';
    pinBind = [salt, await hashPin(salt, String(d.pin))];
  }
  /* metricOverride: { key: true|false|null }, null clearing back to the role. */
  let override = parseOverride(u.rights_override);
  if (d.metricOverride && typeof d.metricOverride === 'object') {
    for (const k of METRIC_KEYS) {
      if (!(k in d.metricOverride)) continue;
      const v = d.metricOverride[k];
      if (v === null) delete override[k]; else override[k] = !!v;
    }
  }
  await env.DB.prepare(`UPDATE users SET role = ?, manager_id = ?, active = ?, rights_override = ?${pinSql} WHERE id = ?`)
    .bind(role, managerId, active ? 1 : 0, JSON.stringify(override), ...pinBind, row).run();

  /* Requests already waiting follow the user to their new manager, otherwise
     they would sit with someone who no longer sees them. */
  if (managerId !== u.manager_id) {
    await env.DB.prepare(`UPDATE tickets SET approver_id = ? WHERE requested_by = ? AND status = 'pending'`)
      .bind(managerId === null ? 0 : managerId, row).run();
  }
  return { ok: true, message: `User "${u.username}" updated` };
}

export async function changePin(env, me, d) {
  if (me.id === 0) deny('The owner PIN is a Worker secret — change it with `wrangler secret put PIN`');
  const u = await env.DB.prepare('SELECT pin_salt, pin_hash FROM users WHERE id = ?').bind(me.id).first();
  if (!u || !sameString(await hashPin(u.pin_salt, String(d.current || '')), u.pin_hash)) deny('Current PIN is wrong');
  if (!PIN_RE.test(String(d.pin || ''))) deny('New PIN must be 4–8 digits');
  const salt = newSalt();
  await env.DB.prepare('UPDATE users SET pin_salt = ?, pin_hash = ? WHERE id = ?')
    .bind(salt, await hashPin(salt, String(d.pin)), me.id).run();
  return { ok: true, message: 'PIN changed' };
}

export async function setRoleRights(env, d) {
  const role = String(d.role || '');
  if (!ROLES.includes(role)) deny('Unknown role');
  if (role === 'Admin') deny('Admin always has every right');
  const rights = [...new Set((Array.isArray(d.rights) ? d.rights : []).filter((k) => RIGHT_KEYS.has(k)))];
  await env.DB.prepare('UPDATE roles SET rights = ? WHERE name = ?').bind(JSON.stringify(rights), role).run();
  return { ok: true, message: `${role} rights saved (${rights.length})` };
}
