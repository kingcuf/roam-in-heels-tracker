import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { FormScroll } from '../formkit';
import { C, F } from '../theme';
import { AddSeg, SEG_ENTITY, Ticket, useStore } from '../store';
import { api } from '../api';
import { Btn, CountBadge, Panel, PanelTitle, Segmented, useToast } from '../ui';
import { Field, TxtInput, SelectField } from '../fields';

/* The Team tab.
     Requests  — the signed-in user's own change requests: waiting, sent back
                 (with the manager's comment and a way back into the form), done.
     Approve   — requests routed to this user (or every request, for an Admin).
     Users     — create users with a username, PIN, role and manager.
     Rights    — the role × right matrix.
     Account   — who you are, what you may do, change PIN, sign out.
   Each segment shows only if the role can use it. */

type Seg = 'mine' | 'review' | 'users' | 'rights' | 'me';
const KIND: Record<string, string> = {
  booking: 'Booking', expense: 'Expense', saving: 'Saving', property: 'Property', inventory: 'Inventory item', stock: 'Stock entry',
  payout: 'Payout', review: 'Review', task: 'Action', taskdone: 'Action status',
};
/* Everything the Action tab writes needs the one right, not <kind>.<op>. */
const ACTION_KINDS = ['payout', 'review', 'task', 'taskdone'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function when(iso: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const z = (n: number) => (n < 10 ? '0' : '') + n;
  return z(d.getDate()) + ' ' + MON[d.getMonth()] + ', ' + z(d.getHours()) + ':' + z(d.getMinutes());
}

export default function TeamScreen() {
  const s = useStore();
  const segs: { key: Seg; label: string; dot?: boolean }[] = [
    { key: 'mine', label: 'Requests', dot: (s.tickets?.mine || []).some((t) => t.status === 'open') },
    ...(s.can('tickets.approve') ? [{ key: 'review' as Seg, label: 'Approve',
      dot: (s.tickets?.review || []).some((t) => t.status === 'pending') }] : []),
    ...(s.can('users.manage') ? [{ key: 'users' as Seg, label: 'Users' }, { key: 'rights' as Seg, label: 'Rights' }] : []),
    { key: 'me', label: 'Account' },
  ];
  /* Land on what is waiting for *this* person to decide — but only if anything
     actually is. An approver with nobody reporting to them was being dropped on
     a permanently empty "All caught up" page seconds after sending requests of
     their own, which read as "your requests are gone". Their own list is the
     honest landing. Until the tab is tapped by hand this stays derived, so it
     is right even when tickets arrive after mount. */
  const [seg, setSeg] = useState<Seg | null>(null);
  const auto: Seg = s.can('tickets.approve') && (s.tickets?.review || []).some((t) => t.status === 'pending')
    ? 'review' : 'mine';
  const active = seg && segs.some((x) => x.key === seg) ? seg : auto;
  /* Opened from the Action tab's Approvals tile. */
  useEffect(() => { if (s.approveSig) setSeg('review'); }, [s.approveSig]);
  /* Opened from "View request" on a form, or the Action tab's own-requests tile. */
  useEffect(() => { if (s.mineSig) setSeg('mine'); }, [s.mineSig]);

  return (
    <View style={{ flex: 1 }}>
      <Segmented segments={segs} value={active} onChange={(k) => setSeg(k as Seg)} />
      {active === 'mine' && <Mine />}
      {active === 'review' && <Review />}
      {active === 'users' && <Users />}
      {active === 'rights' && <Rights />}
      {active === 'me' && <Account />}
    </View>
  );
}

/* ───────────────────────── shared ticket card ───────────────────────── */

const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  pending: { label: 'Waiting', bg: C.amberbg, fg: C.amber },
  open: { label: 'Sent back', bg: C.redbg, fg: C.red },
  approved: { label: 'Approved', bg: C.greenbg, fg: C.green },
  cancelled: { label: 'Withdrawn', bg: '#f1f1f1', fg: '#777' },
};

function Chip({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <View style={{ backgroundColor: bg, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 }}>
      <Text style={{ color: fg, fontSize: 11, fontFamily: F.bold }}>{label}</Text>
    </View>
  );
}

function TicketCard({ t, meta, children }: { t: Ticket; meta: string; children?: React.ReactNode }) {
  const stt = STATUS[t.status] || STATUS.pending;
  return (
    <Panel>
      <View style={st.cardTop}>
        <Text style={st.kind}>#{t.id} · {KIND[t.kind] || t.kind} {t.op === 'delete' ? 'delete' : t.op === 'create' ? 'to add' : 'change'}</Text>
        <Chip {...stt} />
      </View>
      <Text style={st.label}>{t.label}</Text>
      <Text style={st.meta}>{meta}</Text>

      {t.op === 'delete' ? (
        <View style={[st.delBox]}><Text style={st.delTxt}>Delete this record permanently</Text></View>
      ) : (
        <View style={st.changes}>
          {t.changes.map((c, i) => (
            <View key={i} style={st.chRow}>
              <Text style={st.chField} numberOfLines={1}>{c.field}</Text>
              <View style={{ flex: 1 }}>
                {/* A new record has nothing to come from — only the values it would be created with. */}
                {t.op !== 'create' && <Text style={st.chFrom} numberOfLines={2}>{c.from || '—'}</Text>}
                <Text style={st.chTo} numberOfLines={3}>{t.op === 'create' ? '' : '→ '}{c.to || '—'}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {t.comment && t.status !== 'pending' ? (
        <View style={[st.commentBox, t.status === 'open' && { backgroundColor: C.redbg, borderColor: '#e6c3bc' }]}>
          <Text style={st.commentBy}>{t.reviewedBy || 'Reviewer'} · {when(t.reviewedAt)}</Text>
          <Text style={st.commentTxt}>“{t.comment}”</Text>
        </View>
      ) : null}
      {children}
    </Panel>
  );
}

function Empty({ title, sub }: { title: string; sub: string }) {
  return (
    <Panel style={{ alignItems: 'center', paddingVertical: 34 }}>
      <Text style={st.emptyT}>{title}</Text>
      <Text style={st.emptyS}>{sub}</Text>
    </Panel>
  );
}

/* ───────────────────────── my requests ───────────────────────── */

function Mine() {
  const s = useStore();
  const toast = useToast();
  const [view, setView] = useState<'live' | 'closed'>('live');
  const all = s.tickets?.mine || [];
  /* Sent back first: they need you. The request you were sent here to see
     (from a form's "View request") jumps above even those — arriving on a list
     where the thing you came for is below the fold is what sent the user
     hunting in the first place. */
  const rank = (t: Ticket) => (t.id === s.focusTicket ? -1 : t.status === 'open' ? 0 : 1);
  const live = all.filter((t) => t.status === 'open' || t.status === 'pending')
    .sort((a, b) => rank(a) - rank(b));
  const closed = all.filter((t) => t.status === 'approved' || t.status === 'cancelled');
  const list = view === 'live' ? live : closed;

  const withdraw = async (t: Ticket) => {
    try {
      const r = await api.withdrawTicket(s.pin, t.id);
      toast(r?.message || 'Withdrawn', true);
      await s.reloadTickets();
    } catch (e: any) { toast(e?.message || 'Could not withdraw', false); }
  };

  /* Back into the form the change came from, with the requested values laid
     over the record as it is now. Submitting again reuses this ticket. */
  const editAgain = async (t: Ticket) => {
    const RIGHT_OP: Record<string, string> = { create: 'add', update: 'update', delete: 'delete' };
    const need = ACTION_KINDS.indexOf(t.kind) >= 0
      ? 'action.manage'
      : (t.kind === 'stock' ? 'inventory' : t.kind) + '.' + RIGHT_OP[t.op];
    if (!s.can(need)) { toast('Your role no longer has the right to do this', false); return; }
    const row = Number(t.target);
    const gone = () => toast('That record no longer exists — withdraw this request', false);

    if (t.op === 'delete') {
      try {
        const fns: Record<string, (pin: string, r: number) => Promise<any>> = {
          deleteBooking: api.deleteBooking, deleteExpense: api.deleteExpense, deleteSaving: api.deleteSaving,
          invDeleteItem: api.invDeleteItem, invDeleteMovement: api.invDeleteMovement, deleteTask: api.deleteTask,
        };
        const r = t.action === 'deleteProperty'
          ? await api.deleteProperty(s.pin, t.target)
          : await fns[t.action](s.pin, row);
        toast(r?.message || 'Sent', true);
        await s.refresh();
      } catch (e: any) { toast(e?.message || 'Could not send', false); }
      return;
    }

    /* The Action-tab requests have no form to reopen — the tap that raised them
       IS the whole request — so resubmitting just makes the same ask again,
       which revises this ticket rather than raising a second one. */
    if (ACTION_KINDS.indexOf(t.kind) >= 0) {
      if (t.action === 'addTask') { toast('Add the action again from the Action tab', false); return; }
      try {
        const r = t.action === 'setPayouts' ? await api.setPayouts(s.pin, [row])
          : t.action === 'setReviewStatus' ? await api.setReviewStatus(s.pin, row, String(t.payload?.status || ''))
          : t.action === 'setTaskDone' ? await api.setTaskDone(s.pin, row, !!t.payload?.done)
          : await api.updateTask(s.pin, row, t.payload);
        toast(r?.message || 'Sent', true);
        await s.refresh();
      } catch (e: any) { toast(e?.message || 'Could not send', false); }
      return;
    }

    const find = (blk: any) => (blk?.rows || []).find((o: any) => o.r === row);
    let seg: AddSeg;
    /* A create has no record to open: the Add form picks the values up instead. */
    if (t.op === 'create') {
      const SEG: Record<string, AddSeg> = { booking: 'book', expense: 'exp', saving: 'sav', property: 'prop', inventory: 'inv', stock: 'inv' };
      seg = SEG[t.kind];
      if (!seg || s.addSegs.indexOf(seg) < 0) return;
      s.setNewDraft({ kind: t.kind, ticket: t.id, payload: t.payload });
      s.setAddSeg(seg);
      s.setTab('add');
      return;
    }
    if (t.action === 'updateBooking') {
      const o = find(s.logs?.bookings); if (!o) return gone();
      s.setEditB({ row, bookingId: String(o.cells[18] || ''), from: 'blog', cells: o.cells, draft: t.payload }); seg = 'book';
    } else if (t.action === 'updateExpense') {
      const o = find(s.logs?.expenses); if (!o) return gone();
      s.setEditE({ row, from: 'elog', cells: o.cells, draft: t.payload }); seg = 'exp';
    } else if (t.action === 'updateSaving') {
      const o = find(s.logs?.savings); if (!o) return gone();
      s.setEditS({ row, from: 'slog', cells: o.cells, draft: t.payload }); seg = 'sav';
    } else if (t.action === 'updateProperty') {
      const p = s.props.find((x) => String(x.id) === t.target); if (!p) return gone();
      s.setEditP({ origId: t.target, from: 'prop', prop: p, draft: t.payload }); seg = 'prop';
    } else if (t.action === 'invUpdateItem' || t.action === 'invUpdateMovement') {
      s.setInvEdit({ kind: t.action === 'invUpdateItem' ? 'item' : 'move', r: row, draft: t.payload }); seg = 'inv';
    } else return;
    if (s.addSegs.indexOf(seg) < 0 || s.addSegs.length === 0 || !SEG_ENTITY[seg]) return;
    s.setAddSeg(seg);
    s.setTab('add');
  };

  return (
    <ScrollView contentContainerStyle={st.body}>
      <View style={st.head}>
        <Text style={st.h2}>My requests</Text>
        <Btn title="↻" kind="mini" onPress={() => s.reloadTickets()} />
      </View>
      <View style={st.chips}>
        {(['live', 'closed'] as const).map((v) => (
          <TouchableOpacity key={v} onPress={() => setView(v)} activeOpacity={0.7}
            style={[st.fchip, view === v && st.fchipOn]}>
            <Text style={[st.fchipTxt, view === v && { color: '#fff' }]}>
              {v === 'live' ? `Open · ${live.length}` : `Closed · ${closed.length}`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {!s.tickets && <Text style={st.muted}>Loading…</Text>}
      {s.tickets && !list.length && (
        view === 'live'
          ? <Empty title="Nothing waiting" sub={s.needsApproval
              ? 'When you add, change or delete a record, the request shows up here until your manager approves it.'
              : 'Your changes apply directly — as an Admin you do not raise requests.'} />
          : <Empty title="No closed requests" sub="Approved and withdrawn requests are kept here." />
      )}
      {list.map((t) => (
        <TicketCard key={t.id} t={t}
          meta={(t.status === 'pending' ? 'Waiting for ' + (t.approver || 'an admin') : 'Raised') +
            ' · ' + when(t.updatedAt) + (t.attempts > 1 ? ' · attempt ' + t.attempts : '')}>
          {t.status === 'open' && (
            <View style={st.actions}>
              <Btn title={t.op === 'delete' ? 'Request delete again' : 'Edit & resubmit'} onPress={() => editAgain(t)} />
              <Btn title="Withdraw" kind="ghost" onPress={() => withdraw(t)} />
            </View>
          )}
          {t.status === 'pending' && (
            <View style={st.actions}>
              {t.op !== 'delete' && <Btn title="Edit request" onPress={() => editAgain(t)} />}
              <Btn title="Withdraw" kind="ghost" onPress={() => withdraw(t)} />
            </View>
          )}
        </TicketCard>
      ))}
    </ScrollView>
  );
}

/* ───────────────────────── approvals ───────────────────────── */

function Review() {
  const s = useStore();
  const toast = useToast();
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const all = s.tickets?.review || [];
  const pending = all.filter((t) => t.status === 'pending');
  const done = all.filter((t) => t.status !== 'pending');

  const approve = async (t: Ticket) => {
    setBusy(t.id);
    try {
      const r = await api.approveTicket(s.pin, t.id, notes[t.id] || '');
      toast(r?.message || 'Approved', true);
      await s.refresh();                         // the data itself just changed
    } catch (e: any) { toast(e?.message || 'Could not approve', false); await s.reloadTickets(); }
    finally { setBusy(null); }
  };
  const sendBack = async (t: Ticket) => {
    const c = (notes[t.id] || '').trim();
    if (!c) { toast('Add a comment so they know what to change', false); return; }
    setBusy(t.id);
    try {
      const r = await api.rejectTicket(s.pin, t.id, c);
      toast(r?.message || 'Sent back', true);
      setNotes((n) => ({ ...n, [t.id]: '' }));
      await s.reloadTickets();
    } catch (e: any) { toast(e?.message || 'Could not send back', false); }
    finally { setBusy(null); }
  };

  return (
    <FormScroll contentContainerStyle={st.body}>
      <View style={st.head}>
        <Text style={st.h2}>Approvals</Text>
        <Btn title="↻" kind="mini" onPress={() => s.reloadTickets()} />
      </View>
      {!s.tickets && <Text style={st.muted}>Loading…</Text>}
      {s.tickets && !pending.length && (
        <Empty title="All caught up" sub="Change and delete requests from your team land here for you to approve or send back." />
      )}
      {pending.map((t) => (
        <TicketCard key={t.id} t={t}
          meta={'From ' + t.requester + ' · ' + when(t.updatedAt) + (t.attempts > 1 ? ' · resubmitted (attempt ' + t.attempts + ')' : '')}>
          {t.attempts > 1 && t.comment ? (
            <Text style={st.prev}>Earlier comment from {t.reviewedBy || 'reviewer'}: “{t.comment}”</Text>
          ) : null}
          {t.gone ? (
            <View style={st.warn}><Text style={st.warnTxt}>This record no longer exists. Send the request back.</Text></View>
          ) : t.stale ? (
            <View style={st.warn}>
              <Text style={st.warnTxt}>
                The record was edited after this request was raised. Approving applies these values over those later edits.
              </Text>
            </View>
          ) : null}
          <TextInput
            value={notes[t.id] || ''} onChangeText={(v) => setNotes((n) => ({ ...n, [t.id]: v }))}
            placeholder="Comment (required to send back)" placeholderTextColor="#C0BFC6"
            style={st.noteInput} multiline
          />
          <View style={st.actions}>
            <Btn title={busy === t.id ? 'Working…' : 'Approve'} onPress={() => approve(t)} disabled={busy !== null || !!t.gone} />
            <Btn title="Send back" kind="danger" onPress={() => sendBack(t)} disabled={busy !== null} />
          </View>
        </TicketCard>
      ))}
      {done.length > 0 && (
        <>
          <Text style={st.group}>REVIEWED BY YOU</Text>
          {done.map((t) => (
            <TicketCard key={'d' + t.id} t={t} meta={'From ' + t.requester + ' · reviewed ' + when(t.reviewedAt)} />
          ))}
        </>
      )}
    </FormScroll>
  );
}

/* ───────────────────────── users ───────────────────────── */

type UserRow = { id: number; username: string; role: string; managerId: number | null; managerName: string; avatarAt?: number; metricOverride?: Record<string, boolean>; active: boolean; createdAt: string; createdBy: string };
type RoleRow = { name: string; rights: string[]; locked: boolean };
type Catalog = { key: string; group: string; label: string }[];
type UsersData = { users: UserRow[]; roles: RoleRow[]; catalog: Catalog };
const ROLES = ['Admin', 'Manager', 'Viewer'];
const ANY_ADMIN = 'Any admin (owner)';
const EMPTY_USER = { id: 0, username: '', pin: '', role: 'Viewer', manager: '', active: 'Active' };

/* Report metric groups a single user can be shown or hidden, on top of the role. */
const METRICS: { key: string; label: string; hint: string }[] = [
  { key: 'metric.money', label: 'Money totals', hint: 'Revenue, expense, net P&L, monthly P&L' },
  { key: 'metric.cash', label: 'Cash & savings', hint: 'Bank balance, pending, invested, payback' },
  { key: 'metric.bookings', label: 'Bookings & channels', hint: 'Counts, channels, types, repeat, recent' },
  { key: 'metric.expenses', label: 'Expense breakdown', hint: 'One-time / recurring / operating' },
];
type MetricChoice = 'role' | 'show' | 'hide';

function Users() {
  const s = useStore();
  const toast = useToast();
  const [data, setData] = useState<UsersData | null>(null);
  const [form, setForm] = useState<typeof EMPTY_USER | null>(null);
  const [metrics, setMetrics] = useState<Record<string, MetricChoice>>({});
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try { setData(await api.users(s.pin)); }
    catch (e: any) { toast(e?.message || 'Could not load users', false); }
  };
  useEffect(() => { load(); }, []);

  /* Only someone who can act on a request may receive them. */
  const canApprove = (role: string) =>
    role === 'Admin' || !!data?.roles.find((r) => r.name === role)?.rights.includes('tickets.approve');
  const managers = (data?.users || []).filter((u) => u.active && u.id !== form?.id && canApprove(u.role));
  const mgrLabel = (u: UserRow) => u.username + ' · ' + u.role;
  const set = (k: keyof typeof EMPTY_USER) => (v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const open = (u?: UserRow) => {
    if (!u) { setForm({ ...EMPTY_USER }); setMetrics({}); return; }
    const mo = u.metricOverride || {};
    setMetrics(Object.fromEntries(METRICS.map((m) => [m.key, m.key in mo ? (mo[m.key] ? 'show' : 'hide') : 'role'])));
    const m = (data?.users || []).find((x) => x.id === u.managerId);
    setForm({
      id: u.id, username: u.username, pin: '', role: u.role,
      manager: u.managerId === 0 ? ANY_ADMIN : m ? mgrLabel(m) : '',
      active: u.active ? 'Active' : 'Inactive',
    });
  };

  const save = async () => {
    if (!form) return;
    const isNew = !form.id;
    if (isNew && !form.username.trim()) { toast('Username is required', false); return; }
    if ((isNew || form.pin) && !/^\d{4,8}$/.test(form.pin)) { toast('PIN must be 4–8 digits', false); return; }
    let managerId: number | null = null;
    if (form.role !== 'Admin') {
      if (!form.manager) { toast('Pick a manager — they approve this user\'s changes', false); return; }
      managerId = form.manager === ANY_ADMIN ? 0 : (managers.find((u) => mgrLabel(u) === form.manager)?.id ?? -1);
      if (managerId === -1) { toast('Pick a manager from the list', false); return; }
    }
    setSaving(true);
    try {
      const r = isNew
        ? await api.addUser(s.pin, { username: form.username.trim(), pin: form.pin, role: form.role, managerId })
        : await api.updateUser(s.pin, form.id, {
            role: form.role, managerId, active: form.active === 'Active', ...(form.pin ? { pin: form.pin } : {}),
            metricOverride: Object.fromEntries(METRICS.map((m) => {
              const c = metrics[m.key] || 'role';
              return [m.key, c === 'role' ? null : c === 'show'];
            })),
          });
      toast(r?.message || 'Saved', true);
      setForm(null);
      await load();
    } catch (e: any) { toast(e?.message || 'Could not save', false); }
    finally { setSaving(false); }
  };

  if (form) {
    const isNew = !form.id;
    return (
      <FormScroll contentContainerStyle={st.body} onSubmit={save}>
        <View style={st.head}>
          <Text style={st.h2}>{isNew ? 'New user' : 'Edit ' + form.username}</Text>
          <Btn title="✕ Cancel" kind="ghost" onPress={() => setForm(null)} />
        </View>
        <Panel>
          {isNew ? (
            <Field label="Username" req hint="3–32 letters, digits, dot, dash or underscore. Used to sign in.">
              <TxtInput value={form.username} onChange={set('username')} placeholder="e.g. caretaker.ravi" keyboardType="default" />
            </Field>
          ) : null}
          <Field label="PIN" req={isNew} hint={isNew ? '4–8 digits. Share it with the user privately.' : 'Leave blank to keep their current PIN.'}>
            <TxtInput value={form.pin} onChange={(v) => set('pin')(v.replace(/\D/g, '').slice(0, 8))} keyboardType="numeric" placeholder={isNew ? '' : '••••'} />
          </Field>
          <Field label="Role" req hint={
            form.role === 'Admin' ? 'Admins change data directly and manage users.' :
            form.role === 'Manager' ? 'Managers approve their team\'s requests; their own changes go to an admin.' :
            'Viewers see what their rights allow; their changes need approval.'}>
            <SelectField title="Role" value={form.role} options={ROLES}
              onChange={(v) => setForm((f) => (f ? { ...f, role: v, manager: v === 'Admin' ? '' : f.manager } : f))} />
          </Field>
          {form.role !== 'Admin' && (
            <Field label="Manager" req hint="Approves this user's changes and deletes.">
              <SelectField title="Manager" value={form.manager} options={[ANY_ADMIN, ...managers.map(mgrLabel)]} onChange={set('manager')} />
            </Field>
          )}
          {!isNew && (
            <Field label="Status" hint="Inactive users cannot sign in. Their request history is kept.">
              <SelectField title="Status" value={form.active} options={['Active', 'Inactive']} onChange={set('active')} />
            </Field>
          )}
          {!isNew && form.role !== 'Admin' && (
            <View style={{ marginTop: 6 }}>
              <Text style={st.secLbl}>Report metrics for {form.username}</Text>
              <Text style={[st.meta, { marginBottom: 6 }]}>“Role” follows the {form.role} rights matrix.</Text>
              {METRICS.map((m) => {
                const roleHas = !!data?.roles.find((r) => r.name === form.role)?.rights.includes(m.key);
                const cur = metrics[m.key] || 'role';
                return (
                  <View key={m.key} style={st.metricRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={st.uName}>{m.label}</Text>
                      <Text style={st.meta}>{m.hint}</Text>
                    </View>
                    <View style={st.tri}>
                      {(['role', 'show', 'hide'] as MetricChoice[]).map((c) => (
                        <TouchableOpacity key={c} onPress={() => setMetrics((x) => ({ ...x, [m.key]: c }))}
                          style={[st.triBtn, cur === c && st.triOn]} activeOpacity={0.7}>
                          <Text style={[st.triTxt, cur === c && st.triTxtOn]}>
                            {c === 'role' ? 'Role (' + (roleHas ? 'shown' : 'hidden') + ')' : c === 'show' ? 'Show' : 'Hide'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
          <View style={st.actions}>
            <Btn title={saving ? 'Saving…' : isNew ? 'Create user' : 'Save'} onPress={save} disabled={saving} />
          </View>
        </Panel>
      </FormScroll>
    );
  }

  return (
    <ScrollView contentContainerStyle={st.body}>
      <View style={st.head}>
        <Text style={st.h2}>Users</Text>
        <Btn title="+ New user" kind="mini" onPress={() => open()} />
      </View>
      <Panel>
        <PanelTitle right={<CountBadge n={data?.users.length || 0} />}>Team — tap to edit</PanelTitle>
        {!data && <Text style={st.muted}>Loading…</Text>}
        {data && !data.users.length && (
          <Text style={st.muted}>No users yet. You are signed in as the owner — create users so each person has their own sign-in.</Text>
        )}
        {(data?.users || []).map((u) => (
          <TouchableOpacity key={u.id} style={[st.uRow, !u.active && { opacity: 0.5 }]} onPress={() => open(u)} activeOpacity={0.7}>
            <Avatar id={u.id} name={u.username} at={u.avatarAt} size={36} />
            <View style={{ flex: 1 }}>
              <Text style={st.uName}>{u.username}</Text>
              <Text style={st.meta}>
                {u.role === 'Admin' ? 'Changes apply directly' : 'Manager: ' + (u.managerName || '—')}
                {u.active ? '' : ' · inactive'}
              </Text>
            </View>
            <Chip label={u.role} bg={u.role === 'Admin' ? C.navy : u.role === 'Manager' ? C.amberbg : C.skybg}
              fg={u.role === 'Admin' ? '#fff' : u.role === 'Manager' ? C.amber : C.sky} />
          </TouchableOpacity>
        ))}
      </Panel>
    </ScrollView>
  );
}

/* ───────────────────────── rights matrix ───────────────────────── */

function Rights() {
  const s = useStore();
  const toast = useToast();
  const [data, setData] = useState<UsersData | null>(null);
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const d: UsersData = await api.users(s.pin);
      setData(d);
      setDraft(Object.fromEntries(d.roles.map((r) => [r.name, r.rights])));
    } catch (e: any) { toast(e?.message || 'Could not load rights', false); }
  };
  useEffect(() => { load(); }, []);

  const groups = useMemo(() => {
    const out: { group: string; items: Catalog }[] = [];
    for (const c of data?.catalog || []) {
      const g = out.find((x) => x.group === c.group);
      if (g) g.items.push(c); else out.push({ group: c.group, items: [c] });
    }
    return out;
  }, [data]);

  const key = (a: string[]) => [...a].sort().join(',');
  const dirty = (data?.roles || []).filter((r) => !r.locked && key(draft[r.name] || []) !== key(r.rights));

  const toggle = (role: string, right: string) => {
    if (role === 'Admin') return;
    setDraft((d) => {
      const cur = d[role] || [];
      return { ...d, [role]: cur.includes(right) ? cur.filter((k) => k !== right) : [...cur, right] };
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      for (const r of dirty) await api.setRoleRights(s.pin, r.name, draft[r.name] || []);
      toast('Rights saved — they apply from each user\'s next refresh', true);
      await load();
      await s.refresh();                         // picks up your own role's rights too
    } catch (e: any) { toast(e?.message || 'Could not save rights', false); }
    finally { setSaving(false); }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[st.body, { paddingBottom: dirty.length ? 110 : 60 }]}>
        <View style={st.head}>
          <Text style={st.h2}>Role rights</Text>
          <Btn title="↻" kind="mini" onPress={load} />
        </View>
        <Text style={[st.muted, { marginBottom: 12 }]}>
          Tick what each role may do. Admin always has every right. Updates and deletes by Managers and Viewers
          are sent for approval; adds apply directly.
        </Text>
        {!data && <Text style={st.muted}>Loading…</Text>}
        {data && (
          <Panel style={{ paddingHorizontal: 10 }}>
            <View style={[st.mRow, st.mHead]}>
              <Text style={[st.mLabel, st.mHeadTxt]}>Right</Text>
              {data.roles.map((r) => (
                <Text key={r.name} style={[st.mCol, st.mHeadTxt]}>{r.name}</Text>
              ))}
            </View>
            {groups.map((g) => (
              <View key={g.group}>
                <Text style={st.mGroup}>{g.group.toUpperCase()}</Text>
                {g.items.map((c) => (
                  <View key={c.key} style={st.mRow}>
                    <Text style={st.mLabel}>{c.label}</Text>
                    {data.roles.map((r) => {
                      const on = (draft[r.name] || []).includes(c.key);
                      return (
                        <View key={r.name} style={st.mCol}>
                          <TouchableOpacity
                            disabled={r.locked} onPress={() => toggle(r.name, c.key)} activeOpacity={0.6}
                            accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled: r.locked }}
                            accessibilityLabel={`${r.name}: ${g.group} ${c.label}`}
                            style={[st.box, on && st.boxOn, r.locked && { opacity: 0.45 }]}
                          >
                            {on ? <Text style={st.tick}>✓</Text> : null}
                          </TouchableOpacity>
                        </View>
                      );
                    })}
                  </View>
                ))}
              </View>
            ))}
          </Panel>
        )}
      </ScrollView>
      {dirty.length > 0 && (
        <View style={st.footer}>
          <Text style={[st.meta, { flex: 1 }]}>Unsaved: {dirty.map((r) => r.name).join(', ')}</Text>
          <Btn title="Discard" kind="ghost" onPress={() => setDraft(Object.fromEntries((data?.roles || []).map((r) => [r.name, r.rights])))} />
          <Btn title={saving ? 'Saving…' : 'Save'} onPress={save} disabled={saving} />
        </View>
      )}
    </View>
  );
}

/* ───────────────────────── account ───────────────────────── */

const ENTITY: Record<string, string> = {
  booking: 'Bookings', expense: 'Expenses', saving: 'Savings', property: 'Properties', inventory: 'Inventory',
  reports: 'Reports', calendar: 'Calendar', action: 'Action', tickets: 'Approvals', users: 'Users',
};
const OP: Record<string, string> = {
  add: 'add', update: 'update', delete: 'delete', view: 'view', manage: 'manage', approve: 'approve requests',
};

/* Profile picture, falling back to the initial. `at` is the upload time — it
   versions the URL so a replaced photo is not served from cache, and 0/absent
   means there is nothing to fetch. */
function Avatar({ id, name, at, size }: { id: number; name: string; at?: number; size: number }) {
  const s = useStore();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [at]);
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (at && !failed) {
    return (
      <Image source={{ uri: api.avatarUrl(s.pin, id, at) }} style={[box, { backgroundColor: C.bone }]}
        onError={() => setFailed(true)} />
    );
  }
  return (
    <View style={[st.avatar, box]}>
      <Text style={[st.avatarTxt, { fontSize: Math.round(size * 0.4) }]}>{(name || '?').slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}

function Account() {
  const s = useStore();
  const toast = useToast();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const me = s.me;

  const byEntity: Record<string, string[]> = {};
  for (const k of ['booking', 'expense', 'saving', 'property', 'inventory', 'reports', 'calendar', 'action', 'tickets', 'users']) {
    const ops = Object.keys(OP).filter((op) => s.can(k + '.' + op)).map((op) => OP[op]);
    if (ops.length) byEntity[ENTITY[k]] = ops;
  }
  const seen = METRICS.filter((m) => s.can(m.key)).map((m) => m.label.toLowerCase());
  if (s.can('reports.view')) byEntity['Report metrics'] = seen.length ? seen : ['none'];

  const [avBusy, setAvBusy] = useState(false);
  const pickAvatar = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { toast('Photo access is needed to pick a picture', false); return; }
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.6,
    });
    if (r.canceled || !r.assets?.length) return;
    const a = r.assets[0];
    setAvBusy(true);
    try {
      const res = await api.uploadAvatar(s.pin, {
        uri: a.uri, name: a.fileName || 'avatar.jpg', mimeType: a.mimeType || 'image/jpeg',
      });
      s.patchMe({ avatarAt: res.avatarAt });
      toast(res.message || 'Profile picture updated', true);
    } catch (e: any) { toast(e?.message || 'Upload failed', false); }
    finally { setAvBusy(false); }
  };
  const removeAvatar = async () => {
    setAvBusy(true);
    try {
      await api.deleteAvatar(s.pin);
      s.patchMe({ avatarAt: 0 });
      toast('Profile picture removed', true);
    } catch (e: any) { toast(e?.message || 'Could not remove', false); }
    finally { setAvBusy(false); }
  };

  const change = async () => {
    if (!/^\d{4,8}$/.test(next)) { toast('New PIN must be 4–8 digits', false); return; }
    if (next !== again) { toast('The new PINs do not match', false); return; }
    setBusy(true);
    try {
      const r = await api.changePin(s.pin, cur, next);
      toast(r?.message || 'PIN changed', true);
      setCur(''); setNext(''); setAgain('');
      await s.doLogin(me?.username || '', next, { keepTab: true });
    } catch (e: any) { toast(e?.message || 'Could not change PIN', false); }
    finally { setBusy(false); }
  };

  return (
    <FormScroll contentContainerStyle={st.body} onSubmit={change}>
      <View style={st.head}><Text style={st.h2}>Account</Text></View>
      <Panel>
        <View style={st.uRow}>
          <TouchableOpacity onPress={pickAvatar} disabled={avBusy} activeOpacity={0.7}>
            <Avatar id={me?.id ?? 0} name={me?.username || '?'} at={me?.avatarAt} size={64} />
            <View style={st.camBadge}>
              {avBusy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={st.camTxt}>✎</Text>}
            </View>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={[st.uName, { fontSize: 17 }]}>{me?.username}</Text>
            <Text style={st.meta}>
              {me?.role}{me?.id === 0 ? ' · built-in owner account' : ''}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 16, marginTop: 8 }}>
          <TouchableOpacity onPress={pickAvatar} disabled={avBusy}>
            <Text style={st.link}>{me?.avatarAt ? 'Change photo' : 'Add profile photo'}</Text>
          </TouchableOpacity>
          {me?.avatarAt ? (
            <TouchableOpacity onPress={removeAvatar} disabled={avBusy}>
              <Text style={[st.link, { color: C.red }]}>Remove</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <Text style={[st.body2, { marginTop: 10 }]}>
          {s.needsApproval
            ? `Your changes and deletes are approved by ${me?.managerName && me.managerName !== 'Any admin' ? me.managerName : 'an admin'} before they apply.`
            : 'Your changes apply directly.'}
        </Text>
      </Panel>

      <Panel>
        <PanelTitle>What you can do</PanelTitle>
        {Object.keys(byEntity).length === 0 && <Text style={st.muted}>No rights assigned yet — ask an admin.</Text>}
        {Object.entries(byEntity).map(([ent, ops]) => (
          <View key={ent} style={st.rightRow}>
            <Text style={st.rightEnt}>{ent}</Text>
            <Text style={st.rightOps}>{ops.join(' · ')}</Text>
          </View>
        ))}
      </Panel>

      {me && me.id !== 0 ? (
        <Panel>
          <PanelTitle>Change PIN</PanelTitle>
          <Field label="Current PIN"><TxtInput value={cur} onChange={(v) => setCur(v.replace(/\D/g, ''))} keyboardType="numeric" /></Field>
          <Field label="New PIN" hint="4–8 digits."><TxtInput value={next} onChange={(v) => setNext(v.replace(/\D/g, '').slice(0, 8))} keyboardType="numeric" /></Field>
          <Field label="New PIN again"><TxtInput value={again} onChange={(v) => setAgain(v.replace(/\D/g, '').slice(0, 8))} keyboardType="numeric" /></Field>
          <View style={st.actions}><Btn title={busy ? 'Saving…' : 'Change PIN'} onPress={change} disabled={busy} /></View>
        </Panel>
      ) : null}

      <View style={{ marginTop: 4 }}>
        <Btn title="Sign out" kind="danger" onPress={s.logout} />
      </View>
    </FormScroll>
  );
}

const st = StyleSheet.create({
  body: { padding: 14, paddingBottom: 60 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 },
  h2: { fontSize: 25, color: C.ink, fontFamily: F.xbold, letterSpacing: -0.6 },
  muted: { color: C.muted, fontSize: 13, fontFamily: F.med, lineHeight: 18 },
  body2: { color: C.bark, fontSize: 13, fontFamily: F.med, lineHeight: 19 },
  chips: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  fchip: { borderWidth: 1, borderColor: C.line, backgroundColor: '#fff', borderRadius: 999, paddingVertical: 7, paddingHorizontal: 14 },
  fchipOn: { backgroundColor: C.navy, borderColor: C.navy },
  fchipTxt: { fontFamily: F.semi, fontSize: 12.5, color: C.bark },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  kind: { fontFamily: F.bold, fontSize: 11, color: C.muted, letterSpacing: 0.5, textTransform: 'uppercase' },
  label: { fontFamily: F.bold, fontSize: 15, color: C.ink, marginTop: 6 },
  meta: { fontFamily: F.med, fontSize: 12, color: C.muted, marginTop: 2 },
  changes: { marginTop: 10, borderTopWidth: 1, borderTopColor: C.hair },
  chRow: { flexDirection: 'row', gap: 10, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: C.hair },
  chField: { width: 104, fontFamily: F.semi, fontSize: 12, color: C.bark },
  chFrom: { fontFamily: F.med, fontSize: 12.5, color: C.muted, textDecorationLine: 'line-through' },
  chTo: { fontFamily: F.bold, fontSize: 13, color: C.ink, marginTop: 1 },
  delBox: { marginTop: 10, backgroundColor: C.redbg, borderRadius: 10, padding: 10 },
  delTxt: { fontFamily: F.bold, fontSize: 13, color: C.red },
  commentBox: { marginTop: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.warm2, borderRadius: 10, padding: 10 },
  commentBy: { fontFamily: F.semi, fontSize: 11, color: C.muted },
  commentTxt: { fontFamily: F.semi, fontSize: 14, color: C.ink, marginTop: 4, lineHeight: 20 },
  prev: { fontFamily: F.med, fontSize: 12, color: C.bark, marginTop: 10, lineHeight: 17 },
  warn: { marginTop: 10, backgroundColor: C.amberbg, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#e9d2a3' },
  warnTxt: { fontFamily: F.semi, fontSize: 12, color: C.amber, lineHeight: 17 },
  noteInput: {
    marginTop: 12, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 10, minHeight: 60,
    fontSize: 14, color: C.ink, backgroundColor: '#fff', textAlignVertical: 'top',
  },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14, flexWrap: 'wrap' },
  group: { fontFamily: F.xbold, fontSize: 11.5, color: C.muted, letterSpacing: 1.1, marginTop: 10, marginBottom: 8 },
  emptyT: { fontFamily: F.xbold, fontSize: 17, color: C.ink },
  emptyS: { fontFamily: F.med, fontSize: 13, color: C.muted, textAlign: 'center', marginTop: 6, lineHeight: 19, maxWidth: 300 },
  uRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.hair },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.bone, alignItems: 'center', justifyContent: 'center' },
  secLbl: { fontFamily: F.xbold, fontSize: 11.5, letterSpacing: 1.1, textTransform: 'uppercase', color: C.blue2, marginTop: 8 },
  metricRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.hair, gap: 8 },
  tri: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  triBtn: { paddingVertical: 6, paddingHorizontal: 11, borderRadius: 999, borderWidth: 1, borderColor: C.line, backgroundColor: '#fff' },
  triOn: { backgroundColor: C.navy, borderColor: C.navy },
  triTxt: { fontFamily: F.semi, fontSize: 12, color: C.bark },
  triTxtOn: { color: '#fff' },
  camBadge: {
    position: 'absolute', right: -2, bottom: -2, width: 24, height: 24, borderRadius: 12,
    backgroundColor: C.navy, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff',
  },
  camTxt: { color: '#fff', fontSize: 12, fontFamily: F.bold },
  link: { fontFamily: F.semi, fontSize: 13.5, color: C.blue2 },
  avatarTxt: { fontFamily: F.xbold, fontSize: 15, color: C.blue2 },
  uName: { fontFamily: F.bold, fontSize: 15, color: C.ink },
  mRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: C.hair },
  mHead: { borderBottomColor: C.line, paddingBottom: 9 },
  mHeadTxt: { fontFamily: F.bold, fontSize: 10.5, color: C.muted, letterSpacing: 0.4, textTransform: 'uppercase' },
  mLabel: { flex: 1, fontFamily: F.semi, fontSize: 13, color: C.ink, paddingRight: 6 },
  mCol: { width: 66, alignItems: 'center', textAlign: 'center' },
  mGroup: { fontFamily: F.xbold, fontSize: 10.5, color: C.blue, letterSpacing: 1.2, marginTop: 14, marginBottom: 2 },
  box: { width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: C.line, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: C.navy, borderColor: C.navy },
  tick: { color: '#fff', fontFamily: F.bold, fontSize: 14, lineHeight: 16 },
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: C.line, paddingHorizontal: 14, paddingVertical: 10,
  },
  rightRow: { flexDirection: 'row', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: C.hair, gap: 10 },
  rightEnt: { width: 96, fontFamily: F.semi, fontSize: 13, color: C.bark },
  rightOps: { flex: 1, fontFamily: F.med, fontSize: 13, color: C.ink },
});
