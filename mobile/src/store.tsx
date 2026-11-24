import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { api, setApiUser } from './api';
import { IdDocMap, IdItem, IdMap, InvData, Logs } from './logic';
import { useToast } from './ui';

// Container model: Action is the default landing tab; Calendar is the
// occupancy view; Add holds the five entry segments, each with its own log
// directly beneath the form; Team holds change requests, users and rights.
// Which of these a user sees depends on their role's rights.
export type Tab = 'action' | 'cal' | 'dash' | 'add' | 'team';
export type AddSeg = 'book' | 'exp' | 'sav' | 'prop' | 'inv' | 'msg' | 'host';
// Retained: identifies which log a pending edit came from, and which log block
// an embedded LogsScreen should render.
export type LogSeg = 'blog' | 'elog' | 'slog' | 'prop';

export type Prop = {
  id: string; name: string; location?: string; type?: string; status?: string;
  onboarded?: string; rent?: number; notes?: string;
};
export type RangeSel = 'all' | '7' | '30' | 'custom';
/* `draft` = the values of this user's live change request (waiting, or sent
   back) on the record. The form prefills from the stored record, then lays the
   draft over it, so a resend revises the request without dropping anything. */
export type EditB = { row: number; bookingId: string; from: LogSeg; cells: any[]; draft?: any } | null;
export type EditE = { row: number; from: LogSeg; cells: any[]; draft?: any } | null;
export type EditS = { row: number; from: LogSeg; cells: any[]; draft?: any } | null;
export type EditP = { origId: string; from: LogSeg; prop: any; draft?: any } | null;
/* The Inventory screen keeps its edit state locally; this is how the Team tab
   asks it to open an item or stock entry with a rejected request's values. */
export type InvEdit = { kind: 'item' | 'move'; r: number; draft?: any } | null;

/* A sent-back request to CREATE a record, being filled in again. There is no
   record to open, so the Add form picks this up and carries the ticket id back
   so the same request is revised rather than a second one raised. */
export type NewDraft = { kind: TicketKind; ticket: number; payload: any } | null;

export type Me = { id: number; username: string; role: string; managerId: number | null; managerName: string; avatarAt?: number };
/* 'stock' = an inventory movement; its rights are inventory.*
   The Action-tab kinds all need action.manage: 'payout' settles a booking's
   pending payment, 'review' sets its review status, 'task' is a to-do and
   'taskdone' is that to-do being ticked off (a separate kind so it can wait
   alongside an edit to the same to-do). */
export type TicketKind = 'booking' | 'expense' | 'saving' | 'property' | 'inventory' | 'stock'
  | 'payout' | 'review' | 'task' | 'taskdone';
export type Ticket = {
  id: number; kind: TicketKind; op: 'create' | 'update' | 'delete'; action: string; target: string; label: string;
  payload: any; before: any; changes: { field: string; from: string; to: string }[];
  status: 'pending' | 'approved' | 'open' | 'cancelled';
  requestedBy: number; requester: string; approverId: number; approver: string;
  comment: string; reviewedBy: string; reviewedAt: string; attempts: number;
  createdAt: string; updatedAt: string; stale?: boolean; gone?: boolean;
};
export type Tickets = { mine: Ticket[]; review: Ticket[] };

const AUTH_KEY = 'spira_auth';   // JSON { user, pin }
const PIN_KEY = 'spira_pin';     // pre-username installs saved only the owner PIN

/* expo-secure-store has no web implementation (its web module is `{}`), so on
   the website every call threw, nothing was saved, and each page refresh
   signed the user out. The browser gets localStorage instead — the same trust
   level as the signed-in tab itself; phones keep the Keychain/Keystore. */
export const authStore = Platform.OS === 'web'
  ? {
      getItemAsync: async (k: string) => { try { return globalThis.localStorage?.getItem(k) ?? null; } catch { return null; } },
      setItemAsync: async (k: string, v: string) => { try { globalThis.localStorage?.setItem(k, v); } catch {} },
      deleteItemAsync: async (k: string) => { try { globalThis.localStorage?.removeItem(k); } catch {} },
    }
  : SecureStore;
/* Last-seen data, kept on this browser so a return visit paints at once and
   refreshes in the background (stale-while-revalidate). Web only: phones keep
   credentials in SecureStore, which is sized for secrets, not datasets.
   Keyed by user and wiped on sign-out, like the saved credentials. */
const SNAP_PREFIX = 'spira_snap_v1:';
type Snap = { at: number; me: any; rights: string[]; needsApproval: boolean; logs: any; vers?: Record<string, string>; inv: any; tickets: any; dash: any; props: any[] };
const snapKey = (user: string) => SNAP_PREFIX + (String(user || '').trim().toLowerCase() || 'owner');
function readSnap(user: string): Snap | null {
  if (Platform.OS !== 'web') return null;
  try { const t = globalThis.localStorage?.getItem(snapKey(user)); return t ? JSON.parse(t) : null; } catch { return null; }
}
function writeSnap(user: string, v: Snap) {
  if (Platform.OS !== 'web') return;
  try { globalThis.localStorage?.setItem(snapKey(user), JSON.stringify(v)); }
  catch { try { globalThis.localStorage?.removeItem(snapKey(user)); } catch {} }   // over quota: drop it rather than keep a stale one
}
function clearSnaps() {
  if (Platform.OS !== 'web') return;
  try {
    const ls = globalThis.localStorage; if (!ls) return;
    const ks: string[] = [];
    for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k && k.startsWith(SNAP_PREFIX)) ks.push(k); }
    ks.forEach((k) => ls.removeItem(k));
  } catch {}
}
/* Blocks every screen needs, fetched on every refresh; LAZY ones join only
   once a screen that shows them has been opened (then they stay in sync). */
const CORE_BLOCKS = ['bookings', 'expenses', 'savings', 'tasks', 'enquiries', 'idStatus', 'idDocs', 'checklist', 'hosts'];
export type LazyBlock = 'messages' | 'photos';
const LOGS_STALE_MS = 15000; // E4: skip reload if logs fetched < 15 s ago
const TICKETS_STALE_MS = 15000; // same window for the Team tab's ticket list

/* Which of the six calls a load needs. loadAll() used to fetch all of them for
   every reason it ran — a sign-in, a save, a Report range change — so touching
   one control re-downloaded the inventory and re-checked who you are. Callers
   now say what actually changed; `refresh()` (the header ↻) still asks for
   everything. */
export type LoadParts = { dash?: boolean; logs?: boolean; inv?: boolean; tickets?: boolean; who?: boolean };
const ALL_PARTS: Required<LoadParts> = { dash: true, logs: true, inv: true, tickets: true, who: true };
/* A write changes records and may raise a request; it cannot change the
   inventory catalogue or this user's rights.
   Every key is stated explicitly, including the false ones: these masks are
   merged OVER an all-true default, so an absent key means "keep fetching it",
   not "skip it". Leaving `inv` and `who` out is why this mask first shipped
   doing nothing at all. */
const WRITE_PARTS: LoadParts = { dash: true, logs: true, tickets: true, inv: false, who: false };
/* The Report's controls feed exactly one call. */
const REPORT_PARTS: LoadParts = { dash: true, logs: false, inv: false, tickets: false, who: false };

/* Tab → the right that shows it. Add and Team are decided by rights().*/
const TAB_RIGHT: Partial<Record<Tab, string>> = { action: 'action.view', cal: 'calendar.view', dash: 'reports.view' };
export const SEG_ENTITY: Record<AddSeg, string> = { book: 'booking', exp: 'expense', sav: 'saving', prop: 'property', inv: 'inventory', msg: 'messages', host: 'booking' };

type StoreT = {
  pin: string;
  loggedIn: boolean;
  booting: boolean;
  doLogin: (user: string, pin: string, opts?: { keepTab?: boolean }) => Promise<void>;
  logout: () => void;
  /* Local update after an Account-screen change, without a full re-login. */
  patchMe: (p: Partial<Me>) => void;
  me: Me | null;
  /* Admins write directly; everyone else's updates and deletes are requests. */
  needsApproval: boolean;
  can: (right: string) => boolean;
  /* Any of add/update/delete on an entity — decides whether its Add segment shows. */
  canAny: (entity: string) => boolean;
  tabs: Tab[];
  addSegs: AddSeg[];
  tickets: Tickets | null;
  reloadTickets: () => Promise<void>;
  maybeReloadTickets: () => void;
  /* This user's live requests — waiting, or sent back to them. */
  myLive: Ticket[];
  /* The request raised by the last submit on this device, so the form that
     raised it can say where it went instead of blanking silently. */
  lastSubmit: number | null;
  setLastSubmit: (id: number | null) => void;
  /* Bumped to ask the Team tab to open its own-requests list. */
  mineSig: number;
  /* Request the Requests list should show first (the one just submitted). */
  focusTicket: number | null;
  openMyRequests: (id?: number) => void;
  /* The signed-in user's live (pending or sent-back) request on one record. */
  ticketFor: (kind: TicketKind, target: string | number) => Ticket | null;
  newDraft: NewDraft;
  setNewDraft: (d: NewDraft) => void;
  tab: Tab;
  setTab: (t: Tab) => void;
  addSeg: AddSeg;
  setAddSeg: (s: AddSeg) => void;
  logSeg: LogSeg;
  setLogSeg: (s: LogSeg) => void;
  retapSig: number;
  /* True while the Action tab shows one of its detail pages (L2). */
  actionDeep: boolean;
  /* Bumped to ask the Team tab to open its Approve list. */
  approveSig: number;
  openApprovals: () => void;
  setActionDeep: (v: boolean) => void;
  retap: () => void;
  props: Prop[];
  dash: any;
  logs: Logs | null;
  /* REPORT-SCOPED. The property and date range belong to the Report tab, which
     is the only screen that offers the controls and the only one whose data is
     fetched with them. They used to be read by every screen, so narrowing the
     Report to one flat silently narrowed the Action queues, the Calendar and the
     default property on new bookings too. Other tabs scope themselves. */
  filter: string;
  setFilter: (f: string) => void;
  rangeSel: RangeSel;
  setRangeSel: (r: RangeSel) => void;
  rFrom: string;
  setRFrom: (s: string) => void;
  rTo: string;
  setRTo: (s: string) => void;
  busy: boolean;
  refresh: (overrides?: { filter?: string; rangeSel?: RangeSel; rFrom?: string; rTo?: string }) => Promise<void>;
  /* After saving a record: logs + dashboard + requests, nothing else. */
  refreshWrite: () => Promise<void>;
  /* The Report's own controls: only the one call that reads them. */
  refreshReport: (overrides?: { filter?: string; rangeSel?: RangeSel; rFrom?: string; rTo?: string }) => Promise<void>;
  reloadLogs: () => Promise<void>;
  /* Ask for a lazily loaded block (messages, photos) — call when a screen that shows it opens. */
  needLogs: (k: LazyBlock) => void;
  maybeReloadLogs: () => void;
  editB: EditB;
  setEditB: (e: EditB) => void;
  editE: EditE;
  setEditE: (e: EditE) => void;
  editS: EditS;
  setEditS: (e: EditS) => void;
  editP: EditP;
  setEditP: (e: EditP) => void;
  invEdit: InvEdit;
  setInvEdit: (e: InvEdit) => void;
  // Which guest-ID slots already have a document, keyed by booking row.
  idMap: IdMap | null;
  /* Attachment ids per booking row, so a card can render the guest's ID
     document without a request of its own. Rides along on getLogs(). */
  idDocs: IdDocMap | null;
  // The booking whose IDs are being uploaded (null = sheet closed).
  idTarget: IdItem | null;
  setIdTarget: (t: IdItem | null) => void;
  /* The full-screen booking page (src/screens/BookingPage). `onBack` lets the
     opener put its own context back — the Report reopens its day list. */
  bookingPage: { row: number; onBack?: () => void } | null;
  openBooking: (row: number, onBack?: () => void) => void;
  closeBooking: () => void;
  /* The full-screen unit photo album (src/screens/UnitGallery); the value is
     the property name, '' = pick a unit first. null = closed. */
  gallery: string | null;
  /* Setup → Hosts: which host profile is open (null = the list, -1 = new host). */
  hostFocus: number | null;
  setHostFocus: (id: number | null) => void;
  /* From anywhere (booking page): jump to a host's profile. */
  openHost: (id: number) => void;
  openGallery: (property: string) => void;
  closeGallery: () => void;
  /* Inventory lives here rather than inside the Inventory screen so the Action
     tab's low-stock section reads the same data the Inventory tab shows. */
  inv: InvData | null;
  reloadInv: () => Promise<void>;
  /* Item key the Inventory screen should open a stock movement for, set when
     "Add stock" is tapped on a low-stock row. Cleared once consumed. */
  invTarget: string | null;
  setInvTarget: (k: string | null) => void;
};

const Ctx = createContext<StoreT>(null as any);
export const useStore = () => useContext(Ctx);

export function rangeDates(sel: RangeSel, rFrom: string, rTo: string) {
  const iso = (d: Date) => {
    const z = (n: number) => (n < 10 ? '0' : '') + n;
    return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
  };
  if (sel === '7') { const f = new Date(); f.setDate(f.getDate() - 6); return { from: iso(f), to: iso(new Date()) }; }
  if (sel === '30') { const f = new Date(); f.setDate(f.getDate() - 29); return { from: iso(f), to: iso(new Date()) }; }
  if (sel === 'custom') return { from: rFrom || '', to: rTo || '' };
  return { from: '', to: '' };
}
export function rangeText(sel: RangeSel, rFrom: string, rTo: string) {
  if (sel === '7') return 'Last 7 days';
  if (sel === '30') return 'Last 30 days';
  if (sel === 'custom') return rFrom || rTo ? 'Custom · ' + (rFrom || '…') + ' → ' + (rTo || '…') : 'Custom range';
  return 'Overall · all time';
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const toast = useToast();
  const [pin, setPin] = useState('');
  const [loggedIn, setLoggedIn] = useState(false);
  const [booting, setBooting] = useState(true);
  const [me, setMe] = useState<Me | null>(null);
  const [rights, setRights] = useState<string[]>([]);
  const [needsApproval, setNeedsApproval] = useState(false);
  const [tickets, setTickets] = useState<Tickets | null>(null);
  const [tab, setTab] = useState<Tab>('action');
  const [addSeg, setAddSeg] = useState<AddSeg>('book');
  const [logSeg, setLogSeg] = useState<LogSeg>('blog');
  const [retapSig, setRetapSig] = useState(0);
  const [actionDeep, setActionDeep] = useState(false);
  const [approveSig, setApproveSig] = useState(0);
  const [mineSig, setMineSig] = useState(0);
  const [focusTicket, setFocusTicket] = useState<number | null>(null);
  const [lastSubmit, setLastSubmit] = useState<number | null>(null);
  const [props, setProps] = useState<Prop[]>([]);
  const [dash, setDash] = useState<any>(null);
  const [logs, setLogs] = useState<Logs | null>(null);
  const [filter, setFilter] = useState('All');
  const [rangeSel, setRangeSel] = useState<RangeSel>('all');
  const [rFrom, setRFrom] = useState('');
  const [rTo, setRTo] = useState('');
  const [busyN, setBusyN] = useState(0);
  const [editB, setEditB] = useState<EditB>(null);
  const [editE, setEditE] = useState<EditE>(null);
  const [editS, setEditS] = useState<EditS>(null);
  const [editP, setEditP] = useState<EditP>(null);
  const [invEdit, setInvEdit] = useState<InvEdit>(null);
  const [newDraft, setNewDraft] = useState<NewDraft>(null);
  const [idMap, setIdMap] = useState<IdMap | null>(null);
  const [idDocs, setIdDocs] = useState<IdDocMap | null>(null);
  const [idTarget, setIdTarget] = useState<IdItem | null>(null);
  const [bookingPage, setBookingPage] = useState<StoreT['bookingPage']>(null);
  const [gallery, setGallery] = useState<string | null>(null);
  const [hostFocus, setHostFocus] = useState<number | null>(null);
  const [inv, setInv] = useState<InvData | null>(null);
  const [invTarget, setInvTarget] = useState<string | null>(null);
  const pinRef = useRef('');
  const rightsRef = useRef<string[]>([]);
  const logsFetchedAt = useRef(0);
  const ticketsFetchedAt = useRef(0);
  /* One in-flight inventory request, shared. loadAll() fetches invData at the
     same instant the Inventory segment mounts and asks for it too; `!s.inv` is
     a value check with no in-flight flag, so both went out. */
  const invInflight = useRef<Promise<InvData | null> | null>(null);
  /* Monotonic token for logs loads. loadAll() and reloadLogs() both end in
     setLogs(), and the busy overlay is pointerEvents="none", so a mutation can
     be fired while an earlier, slower getLogs is still in flight. Without this
     the older response lands last and overwrites the fresh one with a snapshot
     taken before the write — which is why "mark as paid" appeared to do nothing:
     the payout returned to the queue and the cash position reverted. */
  const logsSeq = useRef(0);

  const can = (k: string) => rights.indexOf(k) >= 0;
  const canAny = (entity: string) => ['add', 'update', 'delete'].some((op) => can(entity + '.' + op));
  /* Messages is the message library — written by Admins only (sending
     happens on the booking page, for anyone who can see bookings). */
  /* Hosts: anyone who works bookings can see the ledger; changing it is Admin (server-checked). */
  const addSegs = (['book', 'exp', 'sav', 'prop', 'inv', 'msg', 'host'] as AddSeg[]).filter((sg) =>
    sg === 'msg' ? me?.role === 'Admin' : sg === 'host' ? me?.role === 'Admin' || canAny('booking') : canAny(SEG_ENTITY[sg]));
  const tabs = (['action', 'cal', 'dash', 'add', 'team'] as Tab[]).filter((t) =>
    t === 'add' ? addSegs.length > 0 : t === 'team' ? true : can(TAB_RIGHT[t]!));

  /* An open edit form holds a `cells` snapshot captured when the row was tapped.
     Add-tab pages stay mounted, so that snapshot can outlive a change made
     elsewhere (e.g. marking the same booking paid on the Action tab) and Save
     would then write the stale figures back. Re-point the snapshots at the rows
     that just arrived; drop the edit if the row is gone. */
  const resyncEdits = (l: any) => {
    const find = (blk: any, row: number) =>
      (blk?.rows || []).find((o: any) => o.r === row) || null;
    setEditB((e) => (e ? ((r) => (r ? { ...e, cells: r.cells } : null))(find(l?.bookings, e.row)) : e));
    setEditE((e) => (e ? ((r) => (r ? { ...e, cells: r.cells } : null))(find(l?.expenses, e.row)) : e));
    setEditS((e) => (e ? ((r) => (r ? { ...e, cells: r.cells } : null))(find(l?.savings, e.row)) : e));
  };

  /* Delta sync state: the fingerprint of each block held, the data as last
     applied (for merging a partial reply), and which lazy blocks are on. */
  const logVers = useRef<Record<string, string>>({});
  const logsRef = useRef<any>(null);
  const lazyOn = useRef<Set<string>>(new Set());
  const wantFor = (keys: string[]) => keys.map((k) => k + ':' + (logsRef.current && logsRef.current[k] !== undefined ? logVers.current[k] || '' : '')).join(',');
  const fetchLogsRaw = (p: string, only?: string[]) => api.getLogsDelta(p, wantFor(only || [...CORE_BLOCKS, ...lazyOn.current]));
  /* Fold a delta reply into what is held. Returns the merged Logs. */
  const mergeLogs = (r: any) => {
    const next: any = { ...(logsRef.current || {}) };
    for (const k of Object.keys(r || {})) if (k !== 'v') next[k] = r[k];
    logVers.current = { ...logVers.current, ...(r?.v || {}) };
    logsRef.current = next;
    return next;
  };

  /* Keep the snapshot current, a beat after things settle. */
  const userRef = useRef('');
  useEffect(() => {
    if (!loggedIn || !logs || !me) return;
    const t = setTimeout(() => writeSnap(userRef.current, {
      at: Date.now(), me, rights, needsApproval, logs: { ...logs, idStatus: idMap || (logs as any).idStatus, idDocs: idDocs || (logs as any).idDocs }, vers: logVers.current,
      inv, tickets, dash, props,
    }), 800);
    return () => clearTimeout(t);
  }, [loggedIn, logs, inv, tickets, dash, props, me, rights, needsApproval, idMap, idDocs]);
  const applySnap = (sn: Snap) => {
    rightsRef.current = sn.rights || []; setRights(sn.rights || []);
    setMe(sn.me || null); setNeedsApproval(!!sn.needsApproval);
    if (sn.logs) {
      logsRef.current = sn.logs;
      logVers.current = sn.vers || {};
      setLogs(sn.logs);
      if (sn.logs.idStatus) setIdMap(sn.logs.idStatus);
      if (sn.logs.idDocs) setIdDocs(sn.logs.idDocs);
    }
    if (sn.inv) setInv(sn.inv);
    if (sn.tickets) setTickets(sn.tickets);
    if (sn.dash) setDash(sn.dash);
    if (Array.isArray(sn.props)) setProps(sn.props);
  };

  const applyLogs = (r: any) => {
    const l = mergeLogs(r);
    setLogs(l);
    resyncEdits(l);
    if (l && l.idStatus) setIdMap(l.idStatus);
    if (l && l.idDocs) setIdDocs(l.idDocs);
    logsFetchedAt.current = Date.now();
  };

  const inc = () => setBusyN((n) => n + 1);
  const dec = () => setBusyN((n) => Math.max(0, n - 1));

  /* Inventory, deduplicated: concurrent callers share the one request. */
  const fetchInv = (p: string) => {
    if (invInflight.current) return invInflight.current;
    const pr = api.invData(p).finally(() => { invInflight.current = null; });
    invInflight.current = pr;
    return pr;
  };

  async function loadAll(p: string, f: string, sel: RangeSel, from0: string, to0: string, parts0?: LoadParts) {
    const parts = { ...ALL_PARTS, ...(parts0 || {}) };
    const { from, to } = rangeDates(sel, from0, to0);
    const my = parts.logs ? ++logsSeq.current : logsSeq.current;
    /* The Report is the only surface that needs the dashboard call, and the
       API refuses it without reports.view — properties then come on their own. */
    const report = rightsRef.current.indexOf('reports.view') >= 0;
    inc();
    try {
      const [d, l, iv, pr, tk, who] = await Promise.all([
        parts.dash && report ? api.getDashboard(p, f, from, to) : Promise.resolve(null),
        parts.logs ? fetchLogsRaw(p) : Promise.resolve(null),
        // inventory is non-fatal: a failure here must not blank the dashboard
        parts.inv ? fetchInv(p).catch(() => null) : Promise.resolve(null),
        parts.dash && !report ? api.getProperties(p).catch(() => null) : Promise.resolve(null),
        parts.tickets ? api.tickets(p).catch(() => null) : Promise.resolve(null),   // requests are non-fatal too
        /* Rights are re-read on a full refresh, so an admin's change to a role
           (or to this user's manager) reaches an open app without a sign-out. */
        parts.who ? api.login(p).catch(() => null) : Promise.resolve(null),
      ]);
      if (who?.rights) {
        rightsRef.current = who.rights; setRights(who.rights);
        setMe(who.user || null); setNeedsApproval(!!who.needsApproval);
      }
      if (iv) setInv(iv);
      if (tk) { setTickets(tk); ticketsFetchedAt.current = Date.now(); }
      if (d) setDash(d);
      if (d?.properties) setProps(d.properties);
      else if (Array.isArray(pr)) setProps(pr);
      if (!parts.logs) return;
      // A newer logs load already landed — this response is stale, drop it.
      if (my !== logsSeq.current) return;
      applyLogs(l);
    } catch (e: any) {
      toast(e?.message || 'Failed to load', false);
    } finally {
      dec();
    }
  }

  const load = (o: { filter?: string; rangeSel?: RangeSel; rFrom?: string; rTo?: string } | undefined, parts?: LoadParts) =>
    loadAll(
      pinRef.current,
      o?.filter ?? filter,
      o?.rangeSel ?? rangeSel,
      o?.rFrom ?? rFrom,
      o?.rTo ?? rTo,
      parts
    );

  const refresh: StoreT['refresh'] = async (o) => { await load(o); };
  const refreshWrite: StoreT['refreshWrite'] = async () => { await load(undefined, WRITE_PARTS); };
  const refreshReport: StoreT['refreshReport'] = async (o) => { await load(o, REPORT_PARTS); };

  const reloadInv = async () => {
    try {
      const iv = await fetchInv(pinRef.current);
      if (iv) setInv(iv);
    } catch (e: any) { toast(e?.message || 'Failed to load inventory', false); }
  };

  const reloadTickets = async () => {
    try { setTickets(await api.tickets(pinRef.current)); ticketsFetchedAt.current = Date.now(); }
    catch (e: any) { toast(e?.message || 'Failed to load requests', false); }
  };

  /* Entering Team refetched unconditionally while every other tab used a
     staleness window; this gives it the same one. A write refreshes tickets,
     so a request raised seconds ago is already in hand. */
  const maybeReloadTickets = () => {
    if (Date.now() - ticketsFetchedAt.current > TICKETS_STALE_MS) reloadTickets();
  };

  const ticketFor: StoreT['ticketFor'] = (kind, target) => {
    const t = String(target);
    return (tickets?.mine || []).find((x) =>
      x.kind === kind && x.target === t && (x.status === 'pending' || x.status === 'open')) || null;
  };

  const liveDraft = (kind: TicketKind, target: string | number) => {
    const t = ticketFor(kind, target);
    return t && t.op === 'update' ? t.payload : undefined;
  };

  const reloadLogs = async () => {
    const my = ++logsSeq.current;
    inc();
    try {
      const l = await fetchLogsRaw(pinRef.current);
      if (my !== logsSeq.current) return;   // superseded by a newer load
      applyLogs(l);
    } catch (e: any) { toast(e?.message || 'Failed to load logs', false); }
    finally { dec(); }
  };

  /* Lazy blocks: the first screen that needs messages or photos asks for
     them; from then on they ride along with every refresh (delta-checked). */
  const needLogs = (k: LazyBlock) => {
    if (lazyOn.current.has(k)) return;
    lazyOn.current.add(k);
    fetchLogsRaw(pinRef.current, [k]).then((r) => {
      if (!logsRef.current) return;      // signed out meanwhile
      setLogs(mergeLogs(r));
    }).catch(() => { lazyOn.current.delete(k); });
  };

  // E4: entering the Logs tab refreshes only when stale; manual ↻ uses reloadLogs()
  const maybeReloadLogs = () => {
    if (Date.now() - logsFetchedAt.current > LOGS_STALE_MS) reloadLogs();
  };

  const retap = () => setRetapSig((n) => n + 1);

  const doLogin: StoreT['doLogin'] = async (user, p, opts) => {
    setApiUser(user.trim());
    userRef.current = user.trim();
    let r: any;
    try { r = await api.login(p); }
    catch (e) { setApiUser(''); throw e; }
    const rs: string[] = Array.isArray(r?.rights) ? r.rights : [];
    rightsRef.current = rs;
    setRights(rs);
    setMe(r?.user || null);
    setNeedsApproval(!!r?.needsApproval);
    pinRef.current = p;
    setPin(p);
    /* Land on the first tab this role may see — Action if it can. */
    const first = (['action', 'cal', 'dash'] as Tab[]).find((t) => rs.indexOf(TAB_RIGHT[t]!) >= 0);
    if (!opts?.keepTab) setTab(first || 'team');
    setLoggedIn(true);
    try { await authStore.setItemAsync(AUTH_KEY, JSON.stringify({ user: user.trim(), pin: p })); } catch {}
    /* `who: false` — api.login() has just returned, 30 ms ago, and its rights
       are already applied above. Re-asking on the sign-in path was a duplicate. */
    loadAll(p, 'All', 'all', '', '', { who: false });
  };

  const logout = () => {
    setLoggedIn(false); setPin(''); pinRef.current = '';
    setApiUser(''); setMe(null); setRights([]); rightsRef.current = []; setNeedsApproval(false); setTickets(null);
    setDash(null); setLogs(null); setEditB(null); setEditE(null); setEditS(null); setEditP(null); setInvEdit(null);
    setNewDraft(null); setLastSubmit(null); setFocusTicket(null);
    setIdMap(null); setIdTarget(null); setBookingPage(null); setGallery(null); setInv(null); setInvTarget(null);
    setTab('action'); setAddSeg('book'); setLogSeg('blog');
    authStore.deleteItemAsync(AUTH_KEY).catch(() => {});
    authStore.deleteItemAsync(PIN_KEY).catch(() => {});
    clearSnaps();
    logsRef.current = null; logVers.current = {}; lazyOn.current = new Set();
  };

  /* The Add tab can land on a segment this role cannot use (the default is
     Booking); move it to the first one it can. */
  useEffect(() => {
    if (addSegs.length && addSegs.indexOf(addSeg) < 0) setAddSeg(addSegs[0]);
  }, [rights.join(',')]);

  useEffect(() => {
    (async () => {
      try {
        const saved = await authStore.getItemAsync(AUTH_KEY);
        if (saved) {
          const a = JSON.parse(saved);
          /* Paint the last-seen data straight away, then sign in and refresh
             behind it. A wrong PIN (changed elsewhere) still signs out; no
             network keeps the saved data on screen, said as such. */
          const sn = readSnap(a.user || '');
          if (sn && sn.logs) {
            setApiUser(String(a.user || '').trim()); userRef.current = String(a.user || '').trim();
            pinRef.current = a.pin || ''; setPin(a.pin || '');
            applySnap(sn);
            const rs = sn.rights || [];
            const first = (['action', 'cal', 'dash'] as Tab[]).find((t) => rs.indexOf(TAB_RIGHT[t]!) >= 0);
            setTab(first || 'team');
            setLoggedIn(true);
            setBooting(false);
          }
          try { await doLogin(a.user || '', a.pin || '', sn && sn.logs ? { keepTab: true } : undefined); }
          catch (e: any) {
            if (sn && sn.logs) {
              const msg = String(e?.message || '');
              if (/wrong username or pin/i.test(msg)) logout();
              else {
                const mins = Math.max(1, Math.round((Date.now() - sn.at) / 60000));
                toast('Offline — showing data from ' + (mins < 60 ? mins + ' min' : Math.round(mins / 60) + ' h') + ' ago', false);
              }
            }
          }
        } else {
          const legacy = await authStore.getItemAsync(PIN_KEY);   // owner PIN from before usernames
          if (legacy) { try { await doLogin('', legacy); } catch {} }
        }
      } catch {
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  const store: StoreT = {
    pin, loggedIn, booting, doLogin, logout,
    patchMe: (p: Partial<Me>) => setMe((m) => (m ? { ...m, ...p } : m)),
    me, needsApproval, can, canAny, tabs, addSegs, tickets, reloadTickets, maybeReloadTickets, ticketFor,
    myLive: (tickets?.mine || []).filter((t) => t.status === 'pending' || t.status === 'open'),
    lastSubmit, setLastSubmit,
    newDraft, setNewDraft,
    tab, setTab, addSeg, setAddSeg, logSeg, setLogSeg, retapSig, retap, actionDeep, setActionDeep, approveSig,
    openApprovals: () => { setApproveSig((n) => n + 1); setTab('team'); maybeReloadTickets(); },
    mineSig, focusTicket,
    openMyRequests: (id?: number) => {
      setFocusTicket(id ?? null); setMineSig((n) => n + 1); setTab('team'); maybeReloadTickets();
    },
    props, dash, logs,
    filter, setFilter, rangeSel, setRangeSel, rFrom, setRFrom, rTo, setRTo,
    busy: busyN > 0, refresh, refreshWrite, refreshReport, reloadLogs, maybeReloadLogs, needLogs,
    /* Opening a record from anywhere picks up this user's live update request
       on it, unless the caller already passed one. */
    editB,
    setEditB: (e) => setEditB(e && e.draft === undefined ? { ...e, draft: liveDraft('booking', e.row) } : e),
    editE,
    setEditE: (e) => setEditE(e && e.draft === undefined ? { ...e, draft: liveDraft('expense', e.row) } : e),
    editS,
    setEditS: (e) => setEditS(e && e.draft === undefined ? { ...e, draft: liveDraft('saving', e.row) } : e),
    editP,
    setEditP: (e) => setEditP(e && e.draft === undefined ? { ...e, draft: liveDraft('property', e.origId) } : e),
    invEdit,
    setInvEdit: (e) => setInvEdit(e && e.draft === undefined
      ? { ...e, draft: liveDraft(e.kind === 'item' ? 'inventory' : 'stock', e.r) } : e),
    idMap, idDocs, idTarget, setIdTarget,
    bookingPage,
    openBooking: (row, onBack) => setBookingPage({ row, onBack }),
    closeBooking: () => setBookingPage(null),
    gallery, openGallery: (p) => setGallery(p), closeGallery: () => setGallery(null),
    hostFocus, setHostFocus,
    openHost: (id) => { setBookingPage(null); setGallery(null); setHostFocus(id); setAddSeg('host'); setTab('add'); },
    inv, reloadInv, invTarget, setInvTarget,
  };
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}
