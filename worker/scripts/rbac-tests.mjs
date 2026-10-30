/**
 * Users / rights / approval-ticket tests against the LOCAL worker + local D1.
 *
 *   npx wrangler d1 execute spira --local --file=migrations/0005_users_rights_tickets.sql
 *   npx wrangler dev --port 8799 --local
 *   node scripts/rbac-tests.mjs
 *
 * Creates uniquely-suffixed users each run and deletes the records it creates.
 */
const API = process.env.NEW_API || 'http://127.0.0.1:8799/';
const OWNER_PIN = process.env.PIN;

if (!/127\.0\.0\.1|localhost/.test(API)) {
  console.error('Refusing to run against a non-local API:', API);
  process.exit(2);
}

const sfx = Date.now().toString(36).slice(-5);
const OWNER = { user: '', pin: OWNER_PIN };

async function call(who, action, params = {}) {
  const u = new URL(API);
  u.searchParams.set('action', action);
  u.searchParams.set('pin', who.pin);
  if (who.user) u.searchParams.set('user', who.user);
  for (const [k, v] of Object.entries(params)) {
    u.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  return (await fetch(u)).json();
}

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + JSON.stringify(detail) : ''}`); }
}
const bookingRow = async (r) => (await call(OWNER, 'logs')).bookings.rows.find((x) => x.r === r);
const myTicket = async (who, id) => (await call(who, 'tickets')).mine.find((t) => t.id === id);
const reviewTicket = async (who, id) => (await call(who, 'tickets')).review.find((t) => t.id === id);

/* ── sign-in ── */
console.log('sign-in');
let r = await call(OWNER, 'login');
check('owner (blank user + secret PIN) is Admin', r.user && r.user.role === 'Admin' && r.needsApproval === false, r);
r = await call({ user: 'owner', pin: OWNER_PIN }, 'login');
check('"owner" username works too', r.user && r.user.username === 'owner', r);
r = await call({ user: '', pin: 'nope' }, 'login');
check('wrong PIN rejected', r.error === 'Wrong username or PIN', r);

/* ── user creation ── */
console.log('users');
const MGR = { user: 'mgr_' + sfx, pin: process.env.MANAGER_PIN };
const MGR2 = { user: 'mgr2_' + sfx, pin: '1112' };
const VIEW = { user: 'view_' + sfx, pin: process.env.STAFF_PIN };
const ADM = { user: 'adm_' + sfx, pin: '3333' };

check('Viewer without a manager is rejected',
  /Manager is required/.test((await call(OWNER, 'addUser', { payload: { username: VIEW.user, pin: VIEW.pin, role: 'Viewer' } })).error || ''));
check('short PIN rejected',
  /PIN must be 4–8 digits/.test((await call(OWNER, 'addUser', { payload: { username: VIEW.user, pin: '12', role: 'Admin' } })).error || ''));
check('"owner" username is reserved',
  /reserved/.test((await call(OWNER, 'addUser', { payload: { username: 'owner', pin: '1234', role: 'Admin' } })).error || ''));

r = await call(OWNER, 'addUser', { payload: { username: MGR.user, pin: MGR.pin, role: 'Manager', managerId: 0 } });
check('create Manager reporting to any admin', r.ok, r);
r = await call(OWNER, 'addUser', { payload: { username: MGR2.user, pin: MGR2.pin, role: 'Manager', managerId: 0 } });
check('create second Manager', r.ok, r);
r = await call(OWNER, 'addUser', { payload: { username: ADM.user, pin: ADM.pin, role: 'Admin' } });
check('create Admin (no manager needed)', r.ok, r);
check('duplicate username rejected (case-insensitive)',
  /already taken/.test((await call(OWNER, 'addUser', { payload: { username: MGR.user.toUpperCase(), pin: '1234', role: 'Admin' } })).error || ''));

let list = await call(OWNER, 'users');
const mgr = list.users.find((u) => u.username === MGR.user);
const mgr2 = list.users.find((u) => u.username === MGR2.user);
const adm = list.users.find((u) => u.username === ADM.user);
r = await call(OWNER, 'addUser', { payload: { username: VIEW.user, pin: VIEW.pin, role: 'Viewer', managerId: mgr.id } });
check('create Viewer reporting to the Manager', r.ok, r);
list = await call(OWNER, 'users');
const view = list.users.find((u) => u.username === VIEW.user);
check('user list shows manager name', view && view.managerName === MGR.user, view);
check('Admin role is locked with every right', list.roles.find((x) => x.name === 'Admin').locked &&
  list.roles.find((x) => x.name === 'Admin').rights.length === list.catalog.length);

r = await call(OWNER, 'addUser', { payload: { username: 'v2_' + sfx, pin: '1234', role: 'Viewer', managerId: view.id } });
check("a Viewer can't be picked as manager (role can't approve)", /cannot approve/.test(r.error || ''), r);

r = await call(VIEW, 'login');
check('Viewer signs in, needsApproval', r.user && r.user.role === 'Viewer' && r.needsApproval === true, r);
check('Viewer wrong PIN rejected', (await call({ user: VIEW.user, pin: '9999' }, 'login')).error === 'Wrong username or PIN');

/* ── rights ── */
console.log('rights');
const VIEWER_DEFAULT = list.roles.find((x) => x.name === 'Viewer').rights;
check('Viewer cannot add a booking by default',
  /does not have the right: Bookings · Add/.test((await call(VIEW, 'addBooking', { payload: { property: 'Spira 3028', date: '2026-09-01', type: 'Stay', net: 1000 } })).error || ''));
check('Viewer cannot list users', /Users/.test((await call(VIEW, 'users')).error || ''));
check('Viewer can read logs', !!(await call(VIEW, 'logs')).bookings);
check('Viewer can read the report (reports.view)', !!(await call(VIEW, 'dashboard')).kpis);
check('Manager cannot edit role rights', /does not have the right/.test((await call(MGR, 'setRoleRights', { payload: { role: 'Viewer', rights: [] } })).error || ''));
check('Admin rights cannot be edited', /every right/.test((await call(OWNER, 'setRoleRights', { payload: { role: 'Admin', rights: [] } })).error || ''));

r = await call(OWNER, 'setRoleRights', { payload: { role: 'Viewer', rights: [...VIEWER_DEFAULT, 'booking.add', 'booking.update', 'booking.delete', 'bogus.right'] } });
check('grant Viewer booking rights (unknown keys dropped)', r.ok && r.message.includes(`(${VIEWER_DEFAULT.length + 3})`), r);
check('removing reports.view takes effect immediately', true);

/* ── direct add, ticketed update ── */
console.log('approval flow');
const NEW_B = { property: 'Spira 3028', date: '2026-09-01', type: 'Stay', net: 1000, guest: 'RBAC Test' };
const bookingByGuest = async (g) => (await call(OWNER, 'logs')).bookings.rows.filter((x) => x.cells[2] === g).at(-1);

let rt;

/* ── adds need approval too ── */
r = await call(VIEW, 'addBooking', { payload: { ...NEW_B, guest: 'RBAC Invalid', type: 'Nope' } });
check('invalid add is refused at request time', /Booking type must be/.test(r.error || ''), r);
r = await call(VIEW, 'addBooking', { payload: NEW_B });
check('Viewer add becomes a ticket', r.ok && r.pendingApproval && r.ticket > 0, r);
const tc = r.ticket;
check('…and nothing is created yet', !(await bookingByGuest('RBAC Test')));
let ct = await myTicket(VIEW, tc);
check('…listed as a create with its values', ct.op === 'create' && ct.changes.some((c) => c.field === 'Net earned' && c.to === '1000'), ct);
r = await call(VIEW, 'addBooking', { payload: { ...NEW_B, guest: 'RBAC Test 2' } });
check('a second add is its own request, not a clash', r.ok && r.pendingApproval && r.ticket !== tc, r);
check('…requester withdraws the spare', (await call(VIEW, 'withdrawTicket', { row: r.ticket })).ok);
r = await call(VIEW, 'addBooking', { payload: { ...NEW_B, net: 1234 }, ticket: tc });
check('resubmitting with a ticket id revises that request', r.ok && r.ticket === tc, r);
ct = await myTicket(VIEW, tc);
check('…with the new values', ct.changes.some((c) => c.field === 'Net earned' && c.to === '1234'), ct.changes);
rt = await reviewTicket(MGR, tc);
check('manager sees the create, not flagged as missing', rt && rt.op === 'create' && !rt.gone && !rt.stale, rt);
r = await call(MGR, 'approveTicket', { row: tc });
check('manager approves the add', r.ok && /added/.test(r.message), r);
check('…and the booking now exists', !!(await bookingByGuest('RBAC Test')), r);
r = await call(VIEW, 'addBooking', { payload: NEW_B, ticket: tc });
check('an approved create cannot be revised', !r.ok || r.ticket !== tc, r);
check('…and that stray request is withdrawn', !r.ok || (await call(VIEW, 'withdrawTicket', { row: r.ticket })).ok);

/* ── ticketed update on the record the approved add created ── */
const row = (await bookingByGuest('RBAC Test')).r;
await call(OWNER, 'updateBooking', { row, payload: { net: 1000 } });

r = await call(VIEW, 'updateBooking', { row, payload: { property: 'Spira 3028', date: '2026-09-01', type: 'Stay', net: 1500, guest: 'RBAC Test' } });
check('Viewer update becomes a ticket', r.ok && r.pendingApproval && r.ticket > 0, r);
check('…routed to the manager by name', r.message.includes(MGR.user), r.message);
const t1 = r.ticket;
check('…and the data is NOT changed yet', (await bookingRow(row)).cells[9] === 1000);

r = await call(VIEW, 'updateBooking', { row, payload: { notes: 'second thought' } });
check('a second change while pending revises the same request', r.ok && r.ticket === t1 && /updated/.test(r.message), r);
let rv = await myTicket(VIEW, t1);
check('…keeping the earlier change and adding the new one', rv.status === 'pending' && rv.attempts === 2 &&
  rv.changes.length === 2 && rv.payload.net === 1500 && rv.payload.notes === 'second thought', rv);
r = await call(VIEW, 'updateBooking', { row, payload: { notes: '' } });
check('…and can take a change back out again', r.ok && r.ticket === t1, r);
rv = await myTicket(VIEW, t1);
check('…leaving only the net change', rv.changes.length === 1 && rv.changes[0].field === 'Net earned', rv.changes);
check('reverting everything is refused with a withdraw hint',
  /withdraw request/.test((await call(VIEW, 'updateBooking', { row, payload: { net: 1000 } })).error || ''));
check('invalid revision is refused at request time, not approval time',
  /Booking type must be/.test((await call(VIEW, 'updateBooking', { row, payload: { type: 'Nope' } })).error || ''));
check('…and leaves the pending request as it was', (await myTicket(VIEW, t1)).payload.net === 1500);
check('data still unchanged while pending', (await bookingRow(row)).cells[9] === 1000);

rt = await reviewTicket(MGR, t1);
check('manager sees it in review', rt && rt.status === 'pending', rt);
check('…with the field diff', rt && rt.changes.length === 1 && rt.changes[0].field === 'Net earned' &&
  rt.changes[0].from === '1000' && rt.changes[0].to === '1500', rt && rt.changes);
check('other manager does not see it', !(await reviewTicket(MGR2, t1)));
check('other manager cannot approve it', /different manager/.test((await call(MGR2, 'approveTicket', { row: t1 })).error || ''));
check('requester cannot approve (no right)', /does not have the right/.test((await call(VIEW, 'approveTicket', { row: t1 })).error || ''));

check('reject needs a comment', /Add a comment/.test((await call(MGR, 'rejectTicket', { row: t1, comment: '  ' })).error || ''));
r = await call(MGR, 'rejectTicket', { row: t1, comment: 'Net should be 1400 after the discount' });
check('manager rejects with comment', r.ok, r);
let mt = await myTicket(VIEW, t1);
check('requester sees status open + comment', mt.status === 'open' && mt.comment === 'Net should be 1400 after the discount' && mt.reviewedBy === MGR.user, mt);
check('data still unchanged after reject', (await bookingRow(row)).cells[9] === 1000);
check('cannot approve a ticket that is open', /already open/.test((await call(MGR, 'approveTicket', { row: t1 })).error || ''));

r = await call(VIEW, 'updateBooking', { row, payload: { property: 'Spira 3028', date: '2026-09-01', type: 'Stay', net: 1400, guest: 'RBAC Test' } });
check('raising it again reuses the same ticket', r.ok && r.ticket === t1, r);
mt = await myTicket(VIEW, t1);
check('…back to pending, attempt 4, new diff', mt.status === 'pending' && mt.attempts === 4 && mt.changes[0].to === '1400', mt);

r = await call(MGR, 'approveTicket', { row: t1 });
check('manager approves', r.ok && /approved/.test(r.message), r);
check('data updated only after approval', (await bookingRow(row)).cells[9] === 1400);
mt = await myTicket(VIEW, t1);
check('ticket is approved', mt.status === 'approved', mt);
check('double approve refused', /already approved/.test((await call(MGR, 'approveTicket', { row: t1 })).error || ''));

/* ── stale detection ── */
console.log('stale + delete + withdraw');
r = await call(VIEW, 'updateBooking', { row, payload: { notes: 'viewer note' } });
const t2 = r.ticket;
await call(OWNER, 'updateBooking', { row, payload: { guest: 'RBAC Test' , phone: '099' } });
rt = await reviewTicket(MGR, t2);
check('ticket flagged stale after someone else edits the record', rt && rt.stale === true, rt);
r = await call(VIEW, 'withdrawTicket', { row: t2 });
check('requester withdraws', r.ok, r);
check('withdrawn ticket leaves review queue', !(await reviewTicket(MGR, t2)) || (await reviewTicket(MGR, t2)).status !== 'pending');
check('other user cannot withdraw someone else\'s ticket', /not found/.test((await call(MGR, 'withdrawTicket', { row: t1 })).error || ''));

r = await call(VIEW, 'deleteBooking', { row });
check('Viewer delete becomes a ticket', r.ok && r.pendingApproval, r);
const t3 = r.ticket;
check('row still exists before approval', !!(await bookingRow(row)));

/* Manager's own change goes to any Admin, not to themselves. */
await call(OWNER, 'setRoleRights', { payload: { role: 'Viewer', rights: VIEWER_DEFAULT } });
r = await call(VIEW, 'approveTicket', { row: t3 });
check('rights revoked mid-flight: requester still cannot approve', !!r.error);

r = await call(MGR, 'approveTicket', { row: t3 });
check('manager approves delete', r.ok, r);
check('row gone after approval', !(await bookingRow(row)));

/* ── manager's own changes ── */
console.log('manager + admin');
r = await call(MGR, 'addExpense', { payload: { property: 'Spira 3028', expenseMonth: '2026-09', item: 'RBAC test expense', amount: 500, type: 'Operating' } });
check('Manager add becomes a ticket for any admin', r.ok && r.pendingApproval && /an admin/.test(r.message), r);
check('Admin approves the expense add', (await call(ADM, 'approveTicket', { row: r.ticket })).ok);
const eRow = (await call(OWNER, 'logs')).expenses.rows.filter((x) => x.cells[2] === 'RBAC test expense').at(-1).r;
r = await call(MGR, 'updateExpense', { row: eRow, payload: { amount: 650 } });
check('Manager update becomes a ticket for any admin', r.ok && r.pendingApproval && /an admin/.test(r.message), r);
const t4 = r.ticket;
check("manager can't approve their own request", /does not appear|own request|different manager/.test((await call(MGR, 'approveTicket', { row: t4 })).error || ''));
rt = await reviewTicket(ADM, t4);
check('DB Admin user sees it in review', rt && rt.status === 'pending', rt);
r = await call(ADM, 'approveTicket', { row: t4, comment: 'ok' });
check('Admin approves', r.ok, r);
check('expense amount updated', (await call(OWNER, 'logs')).expenses.rows.find((x) => x.r === eRow).cells[6] === 650);
r = await call(ADM, 'updateExpense', { row: eRow, payload: { amount: 700 } });
check('Admin update applies directly', r.ok && !r.pendingApproval, r);
check('Admin add applies directly',
  ((a) => a.ok && !a.pendingApproval)(await call(ADM, 'addSaving', { payload: { date: '2026-09-01', amount: 100 } })));
r = await call(ADM, 'deleteExpense', { row: eRow });
check('Admin delete applies directly', r.ok && !r.pendingApproval, r);

/* ── Action tab: payouts, review follow-ups, to-dos ──
   Everything a Manager can do from the Action tab changes business data, so it
   goes through the same ticket mechanism. MGR reports to "any admin", so ADM
   and OWNER are both valid approvers. */
console.log('action tab — payouts');
const PAY_B = { property: 'Spira 3028', date: '2026-09-02', type: 'Stay', net: 5000 };
const mkBooking = async (guest, pending) => {
  await call(OWNER, 'addBooking', { payload: { ...PAY_B, guest, pending } });
  return (await bookingByGuest(guest)).r;
};
const cellOf = async (r, i) => (await bookingRow(r)).cells[i];
const PENDING = 11, REVIEW = 26;

const p1 = await mkBooking('RBAC Pay 1 ' + sfx, 1500);
const p2 = await mkBooking('RBAC Pay 2 ' + sfx, 2500);
const p3 = await mkBooking('RBAC Pay 3 ' + sfx, 3500);

r = await call(MGR, 'setPayouts', { payload: { rows: [p1, p2] } });
check('Manager bulk payout becomes tickets, not a write', r.ok && r.pendingApproval && (r.tickets || []).length === 2, r);
check('…message names every request', /requests #\d+, #\d+/.test(r.message || '') && /2 payments/.test(r.message || ''), r.message);
const [pt1, pt2] = r.tickets;
check('…and neither booking is settled yet', (await cellOf(p1, PENDING)) === 1500 && (await cellOf(p2, PENDING)) === 2500);

let pv = await myTicket(MGR, pt1);
check('payout request is its own kind, keyed to one booking',
  pv.kind === 'payout' && pv.op === 'update' && Number(pv.target) === p1, pv);
/* Grouped: an approval label is read by a person, so it carries separators
   like the KPIs do — ₹1,500, not ₹1500 (round-4 UX finding F7). */
check('…label shows the booking and the amount', /·\s*₹1,500 pending$/.test(pv.label) && /RBAC Pay 1/.test(pv.label), pv.label);
check('…change row shows the money being cleared',
  pv.changes.length === 1 && pv.changes[0].field === 'Pending payout' && pv.changes[0].from === '₹1,500' && pv.changes[0].to === 'Paid (₹0)', pv.changes);

check('a batch naming a booking that does not exist is refused whole',
  /Booking #999999 not found/.test((await call(MGR, 'setPayouts', { payload: { rows: [p1, p2, 999999] } })).error || ''));
check('…and nothing extra was queued: the batch is checked before anything is raised',
  (await call(MGR, 'tickets')).mine.filter((t) => t.kind === 'payout' && t.status === 'pending').length === 2);

r = await call(ADM, 'approveTicket', { row: pt1 });
check('approving one payout settles that booking', r.ok && /1 payment marked paid/.test(r.message), r);
check('…and does NOT touch the other booking in the batch', (await cellOf(p1, PENDING)) === '' && (await cellOf(p2, PENDING)) === 2500);
check('a booking with nothing left pending cannot be sent again',
  /Booking #\d+ has no pending payment/.test((await call(MGR, 'setPayouts', { payload: { rows: [p1] } })).error || ''));

check('rejecting a payout needs a comment', /Add a comment/.test((await call(ADM, 'rejectTicket', { row: pt2 })).error || ''));
r = await call(ADM, 'rejectTicket', { row: pt2, comment: 'Bank has not credited this yet' });
check('the other payout can be sent back', r.ok, r);
check('…leaving that booking pending', (await cellOf(p2, PENDING)) === 2500);
check('…withdrawal works', (await call(MGR, 'withdrawTicket', { row: pt2 })).ok);

r = await call(MGR, 'setPayouts', { payload: { rows: [p3] } });
check('a single payout keeps the one-request message shape',
  r.ok && /sent to an admin for approval \(request #\d+\)/.test(r.message || ''), r.message);
const pt3 = r.ticket;
r = await call(MGR, 'setPayouts', { payload: { rows: [p3] } });
check('…asking again revises the same request', r.ok && r.ticket === pt3 && /request #\d+ updated/.test(r.message), r);

await call(OWNER, 'updateBooking', { row: p3, payload: { notes: 'unrelated edit' } });
rt = await reviewTicket(ADM, pt3);
check('an unrelated edit to the booking does not flag the payout stale', rt && rt.stale === false, rt);
await call(OWNER, 'setPayouts', { payload: { rows: [p3] } });
rt = await reviewTicket(ADM, pt3);
check('…but settling it elsewhere does', rt && rt.stale === true, rt);
check('withdraw the stale payout request', (await call(MGR, 'withdrawTicket', { row: pt3 })).ok);
check('Admin payout applies directly', ((a) => a.ok && !a.pendingApproval)(await call(ADM, 'setPayouts', { payload: { rows: [p2] } })));
check('…immediately', (await cellOf(p2, PENDING)) === '');

/* ── review follow-ups ── */
console.log('action tab — reviews');
check('an invalid review status is refused at request time',
  /Invalid review status/.test((await call(MGR, 'setReviewStatus', { row: p1, status: 'maybe' })).error || ''));
r = await call(MGR, 'setReviewStatus', { row: p1, status: 'requested' });
check('Manager review change becomes a ticket', r.ok && r.pendingApproval && r.ticket > 0, r);
const rvt = r.ticket;
check('…and the booking is unchanged', (await cellOf(p1, REVIEW)) === '');
pv = await myTicket(MGR, rvt);
check('…as its own kind with a readable diff', pv.kind === 'review' &&
  pv.changes.length === 1 && pv.changes[0].field === 'Review status' &&
  pv.changes[0].from === 'Pending' && pv.changes[0].to === 'Requested', pv);

r = await call(MGR, 'updateBooking', { row: p1, payload: { notes: 'chase for review' } });
check('a booking edit on the same booking is a separate request, not a clash',
  r.ok && r.ticket !== rvt && r.pendingApproval, r);
const bEdit = r.ticket;
check('…both are waiting at once',
  !!(await reviewTicket(ADM, rvt)) && !!(await reviewTicket(ADM, bEdit)));
check('…and the review request is not flagged stale by the pending edit', (await reviewTicket(ADM, rvt)).stale === false);
check('withdraw the booking edit', (await call(MGR, 'withdrawTicket', { row: bEdit })).ok);

r = await call(ADM, 'approveTicket', { row: rvt });
check('approving applies the review status', r.ok && /Review marked requested/.test(r.message), r);
check('…on the booking', (await cellOf(p1, REVIEW)) === 'requested');
check('setting the same status again is refused as no change',
  /Nothing changed|withdraw request/.test((await call(MGR, 'setReviewStatus', { row: p1, status: 'requested' })).error || ''));
r = await call(ADM, 'setReviewStatus', { row: p1, status: 'received' });
check('Admin review change applies directly', r.ok && !r.pendingApproval && (await cellOf(p1, REVIEW)) === 'received', r);

/* ── to-dos ── */
console.log('action tab — to-dos');
const taskRow = async (n) => (await call(OWNER, 'logs')).tasks.rows.filter((x) => x.cells[0] === n).at(-1);
const TASK_N = 'RBAC fix geyser ' + sfx;
check('an action with no end date is refused at request time',
  /End date is required/.test((await call(MGR, 'addTask', { payload: { name: TASK_N } })).error || ''));
r = await call(MGR, 'addTask', { payload: { name: TASK_N, endDate: '2026-10-01', description: 'Flat 2212' } });
check('Manager add-action becomes a ticket', r.ok && r.pendingApproval, r);
const kt = r.ticket;
check('…and nothing is created yet', !(await taskRow(TASK_N)));
pv = await myTicket(MGR, kt);
check('…labelled as a new action, with its values', pv.kind === 'task' && pv.op === 'create' &&
  pv.label === 'New action · ' + TASK_N && pv.changes.some((c) => c.field === 'Action' && c.to === TASK_N), pv);
r = await call(ADM, 'approveTicket', { row: kt });
check('approving creates the action', r.ok && !!(await taskRow(TASK_N)), r);
const kRow = (await taskRow(TASK_N)).r;

r = await call(MGR, 'updateTask', { row: kRow, payload: { name: TASK_N, endDate: '2026-10-05', description: 'Flat 2212' } });
check('Manager edit-action becomes a ticket', r.ok && r.pendingApproval, r);
const ktu = r.ticket;
check('…data unchanged', (await taskRow(TASK_N)).cells[1] === '2026-10-01');
pv = await myTicket(MGR, ktu);
check('…with a readable diff', pv.changes.some((c) => c.field === 'End date' && c.to === '2026-10-05'), pv.changes);

r = await call(MGR, 'setTaskDone', { row: kRow, done: true });
check('marking done is its own request, not merged into the pending edit',
  r.ok && r.pendingApproval && r.ticket !== ktu, r);
const ktd = r.ticket;
check('…action still not done', (await taskRow(TASK_N)).cells[3] === 0 || (await taskRow(TASK_N)).cells[3] === '');
pv = await myTicket(MGR, ktd);
check('…labelled "Mark done" with the action name', pv.kind === 'taskdone' &&
  pv.label === 'Action #' + kRow + ' · Mark done · ' + TASK_N, pv.label);
check('…and a Done diff', pv.changes.length === 1 && pv.changes[0].field === 'Done' &&
  pv.changes[0].from === 'No' && pv.changes[0].to === 'Yes', pv.changes);
check('asking for a state the action is already in is refused as no change',
  /Nothing changed|withdraw request/.test((await call(MGR, 'setTaskDone', { row: kRow, done: false })).error || ''));

r = await call(ADM, 'approveTicket', { row: ktd });
check('approving marks it done', r.ok && /Marked done/.test(r.message), r);
check('…in the data', (await taskRow(TASK_N)).cells[3] === 1);
check('…and the wording edit is still waiting, untouched',
  (await myTicket(MGR, ktu)).status === 'pending' && (await taskRow(TASK_N)).cells[1] === '2026-10-01');
r = await call(ADM, 'approveTicket', { row: ktu });
check('approving the edit applies it', r.ok && (await taskRow(TASK_N)).cells[1] === '2026-10-05', r);
check('…without resetting done', (await taskRow(TASK_N)).cells[3] === 1);

r = await call(MGR, 'deleteTask', { row: kRow });
check('Manager delete-action becomes a ticket', r.ok && r.pendingApproval, r);
const ktdel = r.ticket;
check('…row still there', !!(await taskRow(TASK_N)));
check('…and it can be withdrawn', (await call(MGR, 'withdrawTicket', { row: ktdel })).ok);
r = await call(MGR, 'deleteTask', { row: kRow });
check('…and raised again', r.ok && r.pendingApproval, r);
r = await call(ADM, 'approveTicket', { row: r.ticket });
check('approving deletes the action', r.ok && !(await taskRow(TASK_N)), r);

const ADM_TASK = 'RBAC admin action ' + sfx;
r = await call(ADM, 'addTask', { payload: { name: ADM_TASK, endDate: '2026-10-02' } });
check('Admin add-action applies directly', r.ok && !r.pendingApproval && !!(await taskRow(ADM_TASK)), r);
const aRow = (await taskRow(ADM_TASK)).r;
r = await call(ADM, 'setTaskDone', { row: aRow, done: true });
check('Admin mark-done applies directly', r.ok && !r.pendingApproval && (await taskRow(ADM_TASK)).cells[3] === 1, r);
r = await call(ADM, 'deleteTask', { row: aRow });
check('Admin delete-action applies directly', r.ok && !r.pendingApproval && !(await taskRow(ADM_TASK)), r);

/* A Viewer has no action.manage right at all: the gate is still rights first. */
check('a role without action.manage cannot even request',
  /does not have the right: Action/.test((await call(VIEW, 'setPayouts', { payload: { rows: [p3] } })).error || ''));

/* Tidy up the bookings this section created. */
for (const b of [p1, p2, p3]) await call(OWNER, 'deleteBooking', { row: b });

/* ── property delete guard ── */
const props = await call(OWNER, 'properties');
const used = props[0];
check('deleting a property in use is refused',
  /set it Inactive instead/.test((await call(OWNER, 'deleteProperty', { payload: { id: used.id } })).error || ''));

/* ── report metric rights ── */
console.log('report metrics');
r = await call(OWNER, 'updateUser', { row: view.id, payload: { metricOverride: { 'metric.money': false, 'metric.cash': false } } });
check('set per-user metric override', r.ok, r);
let dash = await call(VIEW, 'dashboard');
check('hidden money totals are stripped server-side', dash.kpis && dash.kpis.totalRev === null && dash.kpisMonth.netPnL === null && dash.monthlyPnl.length === 0, dash.kpis);
check('bookings still visible', typeof dash.kpis.bookings === 'number', dash.kpis);
check('login reports the effective rights', !(await call(VIEW, 'login')).rights.includes('metric.cash'));
check('Admin dashboard is never redacted', typeof (await call(OWNER, 'dashboard')).kpis.totalRev === 'number');
r = await call(OWNER, 'updateUser', { row: view.id, payload: { metricOverride: { 'users.manage': true } } });
check('override cannot grant non-metric rights', r.ok && !(await call(VIEW, 'login')).rights.includes('users.manage'));
r = await call(OWNER, 'updateUser', { row: view.id, payload: { metricOverride: { 'metric.money': null, 'metric.cash': null } } });
check('clearing override restores role default', (await call(VIEW, 'login')).rights.includes('metric.cash'));

/* ── account admin ── */
console.log('account');
check("admin can't deactivate themselves",
  /can't change your own role/.test((await call(ADM, 'updateUser', { row: adm.id, payload: { active: false } })).error || ''));
r = await call(OWNER, 'updateUser', { row: view.id, payload: { managerId: mgr2.id } });
check('reassign manager', r.ok, r);
r = await call(VIEW, 'changePin', { payload: { current: '0000', pin: '4444' } });
check('changePin checks the current PIN', /Current PIN is wrong/.test(r.error || ''), r);
r = await call(VIEW, 'changePin', { payload: { current: VIEW.pin, pin: '4444' } });
check('changePin works', r.ok, r);
check('new PIN signs in', !!(await call({ user: VIEW.user, pin: '4444' }, 'login')).user);
r = await call(OWNER, 'updateUser', { row: view.id, payload: { active: false } });
check('deactivate user', r.ok, r);
check('deactivated user cannot sign in', (await call({ user: VIEW.user, pin: '4444' }, 'login')).error === 'Wrong username or PIN');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
