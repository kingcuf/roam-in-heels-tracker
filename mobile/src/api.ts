import { Platform } from 'react-native';
// Same backend as the website — a Cloudflare Worker + D1 since 12-Aug-2026,
// replacing the Apps Script deployment. The web build uses JSONP to dodge CORS;
// native fetch has no CORS, so we hit the endpoint directly and get JSON.
// To roll back, set the API URL in Settings to the old deployment:
// https://script.google.com/macros/s/<YOUR_DEPLOYMENT_ID>/exec
export const DEFAULT_API_URL =
  process.env.EXPO_PUBLIC_API_URL || 'https://spira-api.deependra1997yadav.workers.dev/';

let API_URL = DEFAULT_API_URL;
export function setApiUrl(u: string) { if (u) API_URL = u; }
export function getApiUrl() { return API_URL; }

/* The signed-in username rides on every request next to the PIN. Held here
   rather than threaded through every call so the dozens of existing
   `api.x(s.pin, …)` call sites keep their shape. Blank = the owner account. */
let API_USER = '';
export function setApiUser(u: string) { API_USER = u || ''; }
const userQs = () => (API_USER ? '&user=' + encodeURIComponent(API_USER) : '');

type Args = {
  pin: string;
  property?: string;
  from?: string;
  to?: string;
  row?: number;
  payload?: any;
  status?: string;
  id?: number;
  done?: boolean;
  comment?: string;
  /* Which request a resubmitted new record revises (0 = none). */
  ticket?: number;
};

async function call(action: string, a: Args): Promise<any> {
  let u =
    API_URL +
    '?action=' + encodeURIComponent(action) +
    '&pin=' + encodeURIComponent(a.pin || '') + userQs();
  if (a.comment !== undefined) u += '&comment=' + encodeURIComponent(a.comment);
  if (a.property !== undefined) u += '&property=' + encodeURIComponent(a.property);
  if (a.from) u += '&from=' + encodeURIComponent(a.from);
  if (a.to) u += '&to=' + encodeURIComponent(a.to);
  if (a.row !== undefined) u += '&row=' + encodeURIComponent(String(a.row));
  if (a.payload !== undefined) u += '&payload=' + encodeURIComponent(JSON.stringify(a.payload));
  if (a.status !== undefined) u += '&status=' + encodeURIComponent(a.status);
  if (a.id !== undefined) u += '&id=' + encodeURIComponent(String(a.id));
  if (a.done !== undefined) u += '&done=' + (a.done ? '1' : '0');
  /* Six call sites have always passed `ticket`, and it was never put on the
     query string — so the worker read `Number(p.ticket) || 0` = 0, found no
     request to revise, and raised a second one every time. Resubmitting a
     new-record request silently duplicated it (same guest, two amounts). */
  if (a.ticket) u += '&ticket=' + encodeURIComponent(String(a.ticket));

  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 25000);
  try {
    const res = await fetch(u, { signal: ctl.signal });
    const txt = await res.text();
    let r: any;
    try { r = JSON.parse(txt); }
    catch { throw new Error('Unexpected response from the API.'); }
    if (r && r.error) throw new Error(r.error);
    return r;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('Timed out reaching the API.');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

/* Multipart upload. On phones this goes through XMLHttpRequest: the SDK's
   WinterCG fetch rejects React Native's {uri, name, type} file parts with
   "Unsupported FormDataPart implementation", while RN's XHR streams them from
   disk. The browser build uses fetch with a real Blob. */
function postForm(url: string, fd: FormData, timeoutMs: number): Promise<any> {
  const parse = (txt: string) => {
    let r: any;
    try { r = JSON.parse(txt); } catch { throw new Error('Unexpected response from the API.'); }
    if (r && r.error) throw new Error(r.error);
    return r;
  };
  if (Platform.OS === 'web') {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    return fetch(url, { method: 'POST', body: fd, signal: ctl.signal })
      .then((res) => res.text()).then(parse)
      .catch((e) => { throw e?.name === 'AbortError' ? new Error('Upload timed out.') : e; })
      .finally(() => clearTimeout(t));
  }
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', url);
    x.timeout = timeoutMs;
    x.onload = () => { try { resolve(parse(x.responseText)); } catch (e) { reject(e); } };
    x.onerror = () => reject(new Error('Upload failed — check your connection.'));
    x.ontimeout = () => reject(new Error('Upload timed out.'));
    x.send(fd as any);
  });
}

export const api = {
  login: (pin: string) => call('login', { pin }),
  getDashboard: (pin: string, property: string, from: string, to: string) =>
    call('dashboard', { pin, property, from, to }),
  getProperties: (pin: string) => call('properties', { pin }),
  /* Booking checklists. Steps and ticks ride along on getLogs() as logs.checklist. */
  addChecklistItem: (pin: string, d: { scope: 'property' | 'booking'; property?: string; row?: number; preset?: string; label?: string; stage?: string }) =>
    call('addChecklistItem', { pin, payload: d }),
  removeChecklistItem: (pin: string, id: number) => call('removeChecklistItem', { pin, payload: { id } }),
  tickChecklist: (pin: string, row: number, item: number, done: boolean) =>
    call('tickChecklist', { pin, row, payload: { item, done } }),
  /* Message library (Admin) and sends (anyone who can see the booking). */
  saveTemplate: (pin: string, d: { id?: number; title: string; body: string; stage: string; audience: string; properties: string[]; preset: string }) =>
    call('saveTemplate', { pin, payload: d }) as Promise<{ ok: boolean; message: string; id: number }>,
  removeTemplate: (pin: string, id: number) => call('removeTemplate', { pin, payload: { id } }),
  setPropertyFacts: (pin: string, property: string, facts: { key: string; label: string; value: string }[]) =>
    call('setPropertyFacts', { pin, payload: { property, facts } }),
  logMessageSend: (pin: string, row: number, template: number, recipient: 'guest' | 'host' | 'manager' | 'other') =>
    call('logMessageSend', { pin, row, payload: { template, recipient } }) as Promise<{ ok: boolean; message: string; ticked: boolean }>,
  /* Daily revenue targets, keyed by Report scope ('All' or a property name).
     daily = null removes the target for that scope. Admin only to set. */
  getTargets: (pin: string) =>
    call('targets', { pin }) as Promise<{ targets: Record<string, { daily: number; updatedAt: string; updatedBy: string }> }>,
  setTarget: (pin: string, scope: string, daily: number | null) =>
    call('setTarget', { pin, payload: { scope, daily } }),
  /* `ticket` is only sent when resubmitting a new-record request that was sent
     back: a record that does not exist yet cannot be found by row id. */
  addBooking: (pin: string, d: any, ticket = 0) => call('addBooking', { pin, payload: d, ticket }),
  addExpense: (pin: string, d: any, ticket = 0) => call('addExpense', { pin, payload: d, ticket }),
  addProperty: (pin: string, d: any, ticket = 0) => call('addProperty', { pin, payload: d, ticket }),
  updateProperty: (pin: string, d: any) => call('updateProperty', { pin, payload: d }),
  getLogs: (pin: string) => call('logs', { pin }),
  updateBooking: (pin: string, row: number, d: any) => call('updateBooking', { pin, row, payload: d }),
  updateExpense: (pin: string, row: number, d: any) => call('updateExpense', { pin, row, payload: d }),
  deleteBooking: (pin: string, row: number) => call('deleteBooking', { pin, row }),
  deleteExpense: (pin: string, row: number) => call('deleteExpense', { pin, row }),
  addSaving: (pin: string, d: any, ticket = 0) => call('addSaving', { pin, payload: d, ticket }),
  updateSaving: (pin: string, row: number, d: any) => call('updateSaving', { pin, row, payload: d }),
  deleteSaving: (pin: string, row: number) => call('deleteSaving', { pin, row }),
  setPayouts: (pin: string, rows: number[]) => call('setPayouts', { pin, payload: { rows } }),
  invData: (pin: string) => call('invData', { pin }),
  invAddItem: (pin: string, d: any, ticket = 0) => call('invAddItem', { pin, payload: d, ticket }),
  invUpdateItem: (pin: string, row: number, d: any) => call('invUpdateItem', { pin, row, payload: d }),
  invDeleteItem: (pin: string, row: number) => call('invDeleteItem', { pin, row }),
  invAddMovement: (pin: string, d: any, ticket = 0) => call('invAddMovement', { pin, payload: d, ticket }),
  invUpdateMovement: (pin: string, row: number, d: any) => call('invUpdateMovement', { pin, row, payload: d }),
  invDeleteMovement: (pin: string, row: number) => call('invDeleteMovement', { pin, row }),

  /* Actions — the to-do list on the Action tab. The list itself rides along on
     getLogs() as logs.tasks, so there is no getTasks here. */
  addTask: (pin: string, d: any) => call('addTask', { pin, payload: d }),
  updateTask: (pin: string, row: number, d: any) => call('updateTask', { pin, row, payload: d }),
  setTaskDone: (pin: string, row: number, done: boolean) => call('setTaskDone', { pin, row, done }),
  deleteTask: (pin: string, row: number) => call('deleteTask', { pin, row }),
  setEnquiryStatus: (pin: string, row: number, status: string) =>
    call('setEnquiryStatus', { pin, row, payload: { status } }),

  deleteProperty: (pin: string, id: string) => call('deleteProperty', { pin, payload: { id } }),

  /* Approval tickets. Non-Admin updates and deletes come back from the normal
     update and delete calls as { pendingApproval: true, ticket, message }. */
  tickets: (pin: string) => call('tickets', { pin }),
  approveTicket: (pin: string, row: number, comment: string) => call('approveTicket', { pin, row, comment }),
  rejectTicket: (pin: string, row: number, comment: string) => call('rejectTicket', { pin, row, comment }),
  withdrawTicket: (pin: string, row: number) => call('withdrawTicket', { pin, row }),

  /* Users, roles and rights (users.manage) */
  users: (pin: string) => call('users', { pin }),
  addUser: (pin: string, d: any) => call('addUser', { pin, payload: d }),
  updateUser: (pin: string, row: number, d: any) => call('updateUser', { pin, row, payload: d }),
  setRoleRights: (pin: string, role: string, rights: string[]) => call('setRoleRights', { pin, payload: { role, rights } }),
  avatarUrl: (pin: string, id: number, v: number) =>
    API_URL + '?action=getAvatar&pin=' + encodeURIComponent(pin) + userQs() +
    '&id=' + encodeURIComponent(String(id)) + '&v=' + v,
  deleteAvatar: (pin: string) => call('deleteAvatar', { pin }),
  uploadAvatar: async (pin: string, file: { uri: string; name: string; mimeType: string }) => {
    const fd = new FormData();
    if (Platform.OS === 'web') {
      /* The browser FormData needs a real Blob; the {uri,name,type} shape is
         React Native only and would be sent as the string "[object Object]". */
      fd.append('file', await squareJpeg(file.uri), 'avatar.jpg');
    } else {
      fd.append('file', { uri: file.uri, name: file.name, type: file.mimeType } as any);
    }
    const u = API_URL + '?action=uploadAvatar&pin=' + encodeURIComponent(pin) + userQs();
    return (await postForm(u, fd, 60000)) as { ok: boolean; message: string; avatarAt: number };
  },

  changePin: (pin: string, current: string, next: string) => call('changePin', { pin, payload: { current, pin: next } }),

  /* Review follow-ups (tracked state) */
  setReviewStatus: (pin: string, row: number, status: string) =>
    call('setReviewStatus', { pin, row, status }),

  /* Guest ID documents. Which slots are already uploaded also rides along on
     getLogs(), so this is only needed for a targeted refresh. */
  idStatus: (pin: string) => call('idStatus', { pin }),
  listAttachments: (pin: string, row: number) => call('listAttachments', { pin, row }),
  deleteAttachment: (pin: string, id: number) => call('deleteAttachment', { pin, id }),

  /* Streamed back through the Worker behind the PIN check — never a public
     bucket URL. Returned as a URL so <Image>/Linking can consume it directly. */
  attachmentUrl: (pin: string, id: number) =>
    API_URL + '?action=getAttachment&pin=' + encodeURIComponent(pin) + userQs() + '&id=' + encodeURIComponent(String(id)),

  /* Uploads are multipart POSTs — they cannot use the shared GET helper. */
  uploadAttachment: async (
    pin: string, row: number, slot: string,
    file: { uri: string; name: string; mimeType: string }
  ) => {
    const fd = new FormData();
    fd.append('row', String(row));
    fd.append('slot', slot);
    if (Platform.OS === 'web') {
      // Browsers need a real Blob; the {uri,name,type} object below is RN-only.
      fd.append('file', await (await fetch(file.uri)).blob(), file.name);
    } else {
      // RN's FormData takes this shape for file parts; the cast keeps TS happy.
      fd.append('file', { uri: file.uri, name: file.name, type: file.mimeType } as any);
    }
    const u = API_URL + '?action=uploadAttachment&pin=' + encodeURIComponent(pin) + userQs();
    return postForm(u, fd, 60000);   // uploads need longer than reads
  },
  /* Photos on a library message (Admin). Streamed back through attachmentUrl. */
  uploadMessageImage: async (pin: string, id: number, file: { uri: string; name: string; mimeType: string }) => {
    const fd = new FormData();
    fd.append('id', String(id));
    if (Platform.OS === 'web') fd.append('file', await (await fetch(file.uri)).blob(), file.name);
    else fd.append('file', { uri: file.uri, name: file.name, type: file.mimeType } as any);
    const u = API_URL + '?action=uploadMessageImage&pin=' + encodeURIComponent(pin) + userQs();
    return postForm(u, fd, 60000);
  },
  deleteMessageImage: (pin: string, id: number) => call('deleteMessageImage', { pin, id }),
  /* Unit photo albums (Admin to change). Web photos are scaled to 1600 px JPEG
     first: a phone camera original is 4–8 MB and the guest only needs a view. */
  uploadPropertyPhoto: async (pin: string, property: string, file: { uri: string; name: string; mimeType: string }) => {
    const fd = new FormData();
    fd.append('property', property);
    if (Platform.OS === 'web') fd.append('file', await fitJpeg(file.uri, 1600), (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg');
    else fd.append('file', { uri: file.uri, name: file.name, type: file.mimeType } as any);
    const u = API_URL + '?action=uploadPropertyPhoto&pin=' + encodeURIComponent(pin) + userQs();
    return postForm(u, fd, 90000);
  },
  deletePropertyPhoto: (pin: string, id: number) => call('deletePropertyPhoto', { pin, id }),
  /* Hosts & ledger (Admin). Deals ride on addBooking/updateBooking as payload.hostDeal. */
  saveHost: (pin: string, d: { id?: number; name: string; phone: string; notes: string }) =>
    call('saveHost', { pin, payload: d }) as Promise<{ ok: boolean; message: string; id: number }>,
  removeHost: (pin: string, id: number) => call('removeHost', { pin, payload: { id } }),
  saveHostUnit: (pin: string, d: any) => call('saveHostUnit', { pin, payload: d }) as Promise<{ ok: boolean; message: string; id: number }>,
  removeHostUnit: (pin: string, id: number) => call('removeHostUnit', { pin, payload: { id } }),
  addHostPayment: (pin: string, d: { hostId: number; amount: number; direction: 'paid' | 'received'; date: string; mode: string; note: string }) =>
    call('addHostPayment', { pin, payload: d }),
  removeHostPayment: (pin: string, id: number) => call('removeHostPayment', { pin, payload: { id } }),
};

async function fitJpeg(uri: string, max: number): Promise<Blob> {
  const img = new (globalThis as any).Image();
  img.src = uri;
  await img.decode();
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = (globalThis as any).document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return await new Promise<Blob>((ok, no) =>
    c.toBlob((b: Blob | null) => (b ? ok(b) : no(new Error('Could not read that image.'))), 'image/jpeg', 0.85));
}

/* Web only: centre-crop to a 512px square JPEG. The native picker crops and
   compresses for us; a desktop browser hands over the original, which can be
   far larger than a profile picture needs. */
async function squareJpeg(uri: string): Promise<Blob> {
  const img = new (globalThis as any).Image();
  img.src = uri;
  await img.decode();
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const out = 512;
  const c = (globalThis as any).document.createElement('canvas');
  c.width = out; c.height = out;
  c.getContext('2d').drawImage(
    img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, out, out);
  return await new Promise<Blob>((ok, no) =>
    c.toBlob((b: Blob | null) => (b ? ok(b) : no(new Error('Could not read that image.'))), 'image/jpeg', 0.85));
}
