/**
 * Change-approval tickets.
 *
 * A non-Admin add, update or delete on bookings, expenses, savings, properties,
 * inventory or the Action tab (payouts, review follow-ups, to-dos) is not
 * applied. It is validated exactly as the real write would be, stored as a
 * ticket, and routed to the requester's manager (or any Admin).
 *
 *   pending ──approve──▶ approved   (the stored action is replayed through the
 *      │                             same handler an Admin's edit would use)
 *      └────reject────▶ open        (comment required; the requester edits the
 *                                    record again, which reuses this ticket and
 *                                    puts it back to pending)
 *   pending | open ──withdraw──▶ cancelled
 *
 * The table-specific parts — which table, how payload keys map to columns, how
 * to validate — live in TICKET_SPECS in index.js next to the handlers they
 * mirror, and are passed in here.
 */

import { AuthError } from './auth.js';

const deny = (msg) => { throw new AuthError(msg); };
const nowISO = () => new Date().toISOString();
const KIND_LABEL = { booking: 'Booking', expense: 'Expense', saving: 'Saving', property: 'Property', inventory: 'Inventory item', stock: 'Stock entry',
  /* Action-tab writes. Each is its own kind rather than a variant of the record
     it sits on, because a ticket is identified by kind + target + requester: a
     payout request and an edit request on the same booking have to be able to
     wait side by side, and marking an action done must not be merged into a
     pending edit of that action's wording. */
  payout: 'Payout', review: 'Review', task: 'Action', taskdone: 'Action status' };

export function ticketTarget(spec, row, d) {
  const t = spec.keyCol === 'id' && spec.table === 'properties'
    ? String((d && (d.origId || d.id)) || '')
    : (Number.isFinite(row) && row >= 1 ? String(row) : '');
  if (!t) deny('Invalid row');
  return t;
}

export async function readTarget(env, spec, target) {
  const col = spec.keyCol || 'id';
  return env.DB.prepare(`SELECT * FROM ${spec.table} WHERE ${col} = ?`).bind(target).first();
}

/* Display-only diff between the stored record and what was asked for. Only keys
   the caller sent are compared, matching how the update handlers merge. */
function show(v, bool) {
  if (bool) return (v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'yes') ? 'Yes' : 'No';
  return v === null || v === undefined ? '' : String(v).trim();
}
/* Guests 3+ are a JSON list; compare and show them as "Name (1998), Name". */
function guestList(v) {
  let a = v;
  if (typeof a === 'string') { try { a = a ? JSON.parse(a) : []; } catch { a = []; } }
  if (!Array.isArray(a)) return '';
  return a.filter((g) => g && (g.name || g.birthYr))
    .map((g) => String(g.name || '').trim() + (g.birthYr ? ` (${g.birthYr})` : '')).join(', ');
}
export function diffChanges(spec, row, d) {
  const out = [];
  for (const [key, col] of Object.entries(spec.map || {})) {
    if (!(key in d) || d[key] === undefined) continue;
    if (key === 'id' && d[key] === '') continue;             // blank id = keep the existing one
    const bool = (spec.bools || []).includes(key);
    let from = col === 'extra_guests' ? guestList(row[col]) : show(row[col], bool);
    let to = col === 'extra_guests' ? guestList(d[key]) : show(d[key], bool);
    if (col === 'expense_month') { from = from.slice(0, 7); to = to.slice(0, 7); }
    const bothNum = from !== '' && to !== '' && isFinite(Number(from)) && isFinite(Number(to));
    if (bothNum ? Number(from) === Number(to) : from === to) continue;
    out.push({ field: (spec.labels && spec.labels[key]) || key, from, to });
  }
  return out;
}

export async function approverName(env, id) {
  if (!id) return 'an admin';
  const u = await env.DB.prepare('SELECT username FROM users WHERE id = ?').bind(id).first();
  return u ? u.username : 'an admin';
}

export async function raiseTicket(env, me, action, row, d, spec, ticketId = 0) {
  const create = spec.op === 'create';
  /* A create has no record yet, so it cannot be keyed by one: several may be
     waiting at once, and a resubmission says which request it is revising. */
  const target = create ? 'new' : ticketTarget(spec, row, d);
  const existing = create ? null : await readTarget(env, spec, target);
  if (!create && !existing) deny(`${KIND_LABEL[spec.kind]} not found`);

  /* One live request per record per person, so a manager never approves two
     contradictory edits. Sending again — after a rejection, or while it is
     still waiting — revises that same request. Only a request an approver is
     applying right now can't be touched. */
  const live = create
    ? (ticketId
        ? await env.DB.prepare(
            `SELECT id, status, op, payload FROM tickets WHERE id = ? AND kind = ? AND op = 'create'
                AND requested_by = ? AND status IN ('pending', 'applying', 'open')`
          ).bind(ticketId, spec.kind, me.id).first()
        : null)
    : await env.DB.prepare(
        `SELECT id, status, op, payload FROM tickets WHERE kind = ? AND target = ? AND requested_by = ?
            AND status IN ('pending', 'applying', 'open') ORDER BY id DESC LIMIT 1`
      ).bind(spec.kind, target, me.id).first();
  if (live && live.status === 'applying') {
    deny(`Request #${live.id} for this record is being approved right now — try again in a moment`);
  }
  /* A revised update keeps whatever the earlier one asked for unless it is
     changed again, so a partial resend never silently drops a requested change.
     A create is always sent whole by the form, so it is replaced outright. */
  if (live && live.op === 'update' && spec.op === 'update') {
    let prev = {};
    try { prev = JSON.parse(live.payload || '{}') || {}; } catch {}
    d = { ...prev, ...d };
  }

  if (spec.validate) await spec.validate(env, existing, d);  // same rules as the real write
  /* Store the figure, not the string it was typed as: what the approver reads
     in the diff must be what approving will write. */
  if (spec.normalize) d = spec.normalize(d);
  /* Most specs describe the change by diffing the payload against the record
     through `map`. A few — a payout being settled, a review status, an action
     ticked off — do not send the column they change as a form field, so they
     build their own row instead. Either way an empty list still means "nothing
     changed" and is refused below. */
  let changes = spec.op === 'delete' ? []
    : spec.changes ? await spec.changes(existing || {}, d)
    : diffChanges(spec, existing || {}, d);
  if (spec.op === 'update' && !changes.length) {
    deny(live ? `Nothing changed from the saved record — withdraw request #${live.id} from Team ▸ Requests to cancel it`
              : 'Nothing changed — there is nothing to send for approval');
  }
  /* A consequence of the change that no form field carries — the cross-unit
     split being the one case — appended AFTER the "nothing changed" test, so a
     derived row can never make an empty edit look like a real one. */
  if (spec.op !== 'delete' && spec.append) {
    changes = changes.concat(await spec.append(env, existing || {}, d) || []);
  }

  const approver = me.managerId === null || me.managerId === undefined ? 0 : me.managerId;
  /* The payload reaches the label too, so a request whose meaning lives in what
     was asked for rather than in the record ("Mark done") can say so. */
  const label = create ? spec.newLabel(d) : spec.label(existing, d);
  const now = nowISO();

  let id;
  if (live) {
    id = live.id;
    /* Guarded on the status just read: if an approver claimed it in between,
       nothing is overwritten and the requester is told. */
    const upd = await env.DB.prepare(
      `UPDATE tickets SET op = ?, action = ?, label = ?, payload = ?, before = ?, changes = ?, status = 'pending',
              approver_id = ?, attempts = attempts + 1, updated_at = ?
        WHERE id = ? AND status = ?`
    ).bind(spec.op, action, label, JSON.stringify(d), JSON.stringify(existing || {}), JSON.stringify(changes),
           approver, now, id, live.status).run();
    if (!upd.meta.changes) deny(`Request #${id} was just reviewed — refresh and try again`);
  } else {
    const res = await env.DB.prepare(
      `INSERT INTO tickets (kind, op, action, target, label, payload, before, changes, status,
                            requested_by, requester_name, approver_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`
    ).bind(spec.kind, spec.op, action, target, label, JSON.stringify(d), JSON.stringify(existing || {}),
           JSON.stringify(changes), me.id, me.username, approver, now, now).run();
    id = res.meta.last_row_id;
  }
  const who = await approverName(env, approver);
  /* The confirmation has to name the thing that was asked for. It used to read
     "Request #133 updated — still waiting for an admin" whenever a live request
     already existed for the record — so asking to DELETE a booking that already
     had an edit request outstanding was acknowledged with a sentence about the
     edit. The only way to find out what had actually been asked for was Team ▸
     My requests, two screens away. Op and record now appear in every case. */
  const kind = (KIND_LABEL[spec.kind] || 'record').toLowerCase();
  const what = { create: `New ${kind}`, delete: `Delete ${kind}`, update: `Change to ${kind}` }[spec.op];
  /* Just the leading segment of the label — "B178", "Expense #91" — so the
     toast names the record without carrying the guest and property with it. */
  const ref = String(label || '').split(' · ')[0].trim();
  const subject = spec.op === 'create' ? what : `${what}${ref ? ' ' + ref : ''}`;
  /* Asking to delete a record that already had a change waiting REPLACES that
     change — one live request per record per person is the rule that stops an
     approver holding two contradictory edits. The receipt said only "#70
     updated", so the only way to find out the edit was gone was to notice the
     typed values back at their old ones. Say it. */
  const replaced = live && live.op !== spec.op
    ? ` — this replaces your ${{ create: 'request', update: 'change request', delete: 'delete request' }[live.op] || 'request'}`
    : '';
  return {
    ok: true, pendingApproval: true, ticket: id,
    message: live && live.status === 'pending'
      ? `${subject} — request #${id} updated, still waiting for ${who}${replaced}`
      : `${subject} sent to ${who} for approval (request #${id})`,
  };
}

function shape(t, extra = {}) {
  const parse = (s, dflt) => { try { return JSON.parse(s); } catch { return dflt; } };
  return {
    id: t.id, kind: t.kind, op: t.op, action: t.action, target: t.target, label: t.label,
    payload: parse(t.payload, {}), before: parse(t.before, {}), changes: parse(t.changes, []),
    status: t.status === 'applying' ? 'pending' : t.status,
    requestedBy: t.requested_by, requester: t.requester_name,
    approverId: t.approver_id, approver: t.approver_name || (t.approver_id ? '' : 'Any admin'),
    comment: t.comment, reviewedBy: t.reviewed_by, reviewedAt: t.reviewed_at,
    attempts: t.attempts, createdAt: t.created_at, updatedAt: t.updated_at,
    ...extra,
  };
}

const SELECT_T = `SELECT t.*, a.username AS approver_name FROM tickets t LEFT JOIN users a ON a.id = t.approver_id`;

export async function listTickets(env, me, specs) {
  const mine = (await env.DB.prepare(`${SELECT_T} WHERE t.requested_by = ? ORDER BY t.id DESC LIMIT 200`)
    .bind(me.id).all()).results.map((t) => shape(t));

  let review = [];
  if (me.isAdmin || me.can('tickets.approve')) {
    const pending = (me.isAdmin
      ? await env.DB.prepare(`${SELECT_T} WHERE t.status IN ('pending','applying') AND t.requested_by != ? ORDER BY t.id`).bind(me.id).all()
      : await env.DB.prepare(`${SELECT_T} WHERE t.status IN ('pending','applying') AND t.approver_id = ? ORDER BY t.id`).bind(me.id).all()
    ).results;
    /* Flag a request whose record was edited by someone else after it was
       raised: approving it would overwrite that edit with the older view. */
    for (const t of pending) {
      const spec = specs[t.action];
      let stale = false, gone = false;
      if (spec && t.op !== 'create') {
        const cur = await readTarget(env, spec, t.target);
        gone = !cur;
        /* A request that touches one column of a shared record — a payout on a
           booking, an action ticked off — only conflicts with an edit to that
           column. Comparing the whole row would flag it stale because someone
           corrected the guest's phone number. */
        if (cur && spec.watch) {
          let before = {};
          try { before = JSON.parse(t.before || '{}') || {}; } catch {}
          stale = spec.watch.some((c) => String(cur[c] ?? '') !== String(before[c] ?? ''));
        } else {
          stale = !!cur && JSON.stringify(cur) !== t.before;
        }
      }
      review.push(shape(t, { stale, gone }));
    }
    const done = (await env.DB.prepare(
      `${SELECT_T} WHERE t.reviewed_by = ? AND t.status IN ('approved','open') ORDER BY t.reviewed_at DESC LIMIT 50`
    ).bind(me.username).all()).results;
    review = review.concat(done.map((t) => shape(t)));
  }
  return { mine, review };
}

async function loadForReview(env, me, id) {
  const t = await env.DB.prepare('SELECT * FROM tickets WHERE id = ?').bind(id).first();
  if (!t) deny('Request not found');
  if (t.status !== 'pending') deny(`Request #${id} is already ${t.status === 'applying' ? 'being approved' : t.status}`);
  if (t.requested_by === me.id) deny("You can't review your own request");
  if (!me.isAdmin && t.approver_id !== me.id) deny(`Request #${id} is assigned to a different manager`);
  return t;
}

/* `apply(action, target, payload)` runs the real handler. The ticket is claimed
   first (pending -> applying) so two approvers tapping at once cannot apply the
   same change twice; a failed apply puts it back to pending with the error. */
export async function approveTicket(env, me, id, comment, apply) {
  const t = await loadForReview(env, me, id);
  const claim = await env.DB.prepare(`UPDATE tickets SET status = 'applying', updated_at = ? WHERE id = ? AND status = 'pending'`)
    .bind(nowISO(), id).run();
  if (!claim.meta.changes) deny(`Request #${id} was just reviewed by someone else`);
  /* Re-read after claiming: the requester may have revised it since loadForReview. */
  const cur = await env.DB.prepare('SELECT action, target, payload FROM tickets WHERE id = ?').bind(id).first();
  let res;
  try {
    res = await apply(cur.action, cur.target, JSON.parse(cur.payload || '{}'));
  } catch (e) {
    await env.DB.prepare(`UPDATE tickets SET status = 'pending', updated_at = ? WHERE id = ?`).bind(nowISO(), id).run();
    /* Nothing here can be repaired by the approver: the request carries the
       values, and the only person who can correct them is the one who raised
       it. Without the second sentence an admin was left pressing Approve on a
       request that would never take, with no hint that Reject was the only way
       out. (It happens to requests raised before a validation rule existed.) */
    deny(`Could not apply request #${id}: ${(e && e.message) || e} — it cannot be fixed here; send it back with a comment so the requester can correct and resend it`);
  }
  const now = nowISO();
  await env.DB.prepare(
    `UPDATE tickets SET status = 'approved', comment = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?`
  ).bind(String(comment || ''), me.username, now, now, id).run();
  return { ok: true, message: `Request #${id} approved — ${(res && res.message) || 'applied'}` };
}

export async function rejectTicket(env, me, id, comment) {
  const text = String(comment || '').trim();
  if (!text) deny('Add a comment so the requester knows what to change');
  await loadForReview(env, me, id);
  const now = nowISO();
  await env.DB.prepare(
    `UPDATE tickets SET status = 'open', comment = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
      WHERE id = ? AND status = 'pending'`
  ).bind(text, me.username, now, now, id).run();
  return { ok: true, message: `Request #${id} sent back to the requester` };
}

export async function withdrawTicket(env, me, id) {
  const t = await env.DB.prepare('SELECT requested_by, status FROM tickets WHERE id = ?').bind(id).first();
  if (!t || t.requested_by !== me.id) deny('Request not found');
  if (t.status !== 'pending' && t.status !== 'open') deny(`Request #${id} is already ${t.status}`);
  await env.DB.prepare(`UPDATE tickets SET status = 'cancelled', updated_at = ? WHERE id = ? AND status IN ('pending','open')`)
    .bind(nowISO(), id).run();
  return { ok: true, message: `Request #${id} withdrawn` };
}
