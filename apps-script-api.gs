/**
 * SPIRA TRACKER — JSON API (Google Apps Script)
 * Use this version when the UI is hosted elsewhere (e.g. Vercel).
 * It exposes a single doGet endpoint that returns JSON (or JSONP if a
 * ?callback= param is given, which the Vercel frontend uses to avoid CORS).
 *
 * Setup: Extensions ▸ Apps Script ▸ paste this ▸ Deploy ▸ New deployment ▸
 * Web app ▸ Execute as: Me ▸ Who has access: Anyone ▸ Deploy. Copy the /exec URL.
 */

/* ─────────────── CONFIG (edit these) ─────────────── */
const SPREADSHEET_ID = '1QO8wQqKENFWqmRtc0Lwc1iSHIhMnhwA-6j4k-nS4t2Y';
const PIN            = PropertiesService.getScriptProperties().getProperty('PIN');
// Set it once in the Apps Script editor under Project Settings ▸ Script
// Properties. It used to be a literal here, which put the live passcode in
// every copy of this file — including this public repository.
const TZ             = 'Asia/Kolkata';
// Canonical recurring charges to track each month (matched by category/item keyword)
const RECURRING_ITEMS = [
  { name:'Rent',             kw:['rent'] },
  { name:'Police charge',    kw:['police'] },
  { name:'Caretaker',        kw:['caretaker'] },
  { name:'Laundry',          kw:['laundry'] },
  { name:'Wifi',             kw:['wifi','wi-fi','internet'] },
  { name:'Electricity bill', kw:['electric'] },
  { name:'Re-stock',         kw:['restock','re-stock','re stock'] }
];
/* ──────────────────────────────────────────────────── */

/* ─────────────── API router ─────────────── */
function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    const pin = p.pin;
    const payload = p.payload ? JSON.parse(p.payload) : {};
    let out;
    switch (p.action) {
      case 'login':          out = login(pin); break;
      case 'dashboard':      out = getDashboard(pin, p.property, p.from, p.to); break;
      case 'properties':     out = getProperties(pin); break;
      case 'addBooking':     out = addBooking(pin, payload); break;
      case 'addExpense':     out = addExpense(pin, payload); break;
      case 'addProperty':    out = addProperty(pin, payload); break;
      case 'updateProperty': out = updateProperty(pin, payload); break;
      case 'logs':           out = getLogs(pin); break;
      case 'updateBooking':  out = updateBooking(pin, Number(p.row), payload); break;
      case 'updateExpense':  out = updateExpense(pin, Number(p.row), payload); break;
      case 'deleteBooking':  out = deleteBooking(pin, Number(p.row)); break;
      case 'deleteExpense':  out = deleteExpense(pin, Number(p.row)); break;
      case 'addSaving':      out = addSaving(pin, payload); break;
      case 'updateSaving':   out = updateSaving(pin, Number(p.row), payload); break;
      case 'deleteSaving':   out = deleteSaving(pin, Number(p.row)); break;
      case 'setPayouts':     out = setPayouts(pin, payload); break;
      default: throw new Error('Unknown action: ' + p.action);
    }
    return reply_(e, out);
  } catch (err) {
    return reply_(e, { error: String((err && err.message) || err) });
  }
}
function reply_(e, obj) {
  const txt = JSON.stringify(obj);
  const cb = e && e.parameter && e.parameter.callback;
  if (cb) return ContentService.createTextOutput(cb + '(' + txt + ')')
                  .setMimeType(ContentService.MimeType.JAVASCRIPT);
  return ContentService.createTextOutput(txt).setMimeType(ContentService.MimeType.JSON);
}

/* ── helpers ── */
function checkPin_(pin) { if (String(pin) !== String(PIN)) throw new Error('Wrong PIN'); }
function ss_()          { return SpreadsheetApp.openById(SPREADSHEET_ID); }
function num_(v) {
  if (v === '' || v === null || v === undefined) return 0;
  if (typeof v === 'string') v = v.replace(/[^0-9.\-]/g, '');
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}
function login(pin) { checkPin_(pin); return true; }

/* ─────────────── PROPERTIES ─────────────── */
function readProperties_() {
  const rows = ss_().getSheetByName('Properties').getDataRange().getValues().slice(1);
  return rows.filter(r => r[1]).map(r => ({
    id: r[0], name: r[1], location: r[2], type: r[3], status: r[4],
    onboarded: r[5] instanceof Date ? Utilities.formatDate(r[5], TZ, 'yyyy-MM-dd') : (r[5] || ''),
    rent: num_(r[6]), notes: r[7]
  }));
}
function getProperties(pin) { checkPin_(pin); return readProperties_(); }

function addProperty(pin, d) {
  checkPin_(pin);
  if (!d.name) throw new Error('Property name is required');
  const sh = ss_().getSheetByName('Properties');
  let id = (d.id || d.name).toString().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (readProperties_().some(p => String(p.id) === id)) throw new Error('Property ID "' + id + '" already exists');
  const onb = d.onboarded ? new Date(d.onboarded + 'T00:00:00') : '';
  sh.appendRow([ id, d.name, d.location || '', d.type || '', d.status || 'Active', onb,
                 (d.rent === '' || d.rent == null) ? '' : num_(d.rent), d.notes || '' ]);
  return { ok: true, message: 'Property "' + d.name + '" added', properties: readProperties_() };
}

function updateProperty(pin, d) {
  checkPin_(pin);
  if (!d.origId) throw new Error('Missing property reference');
  if (!d.name)   throw new Error('Property name is required');
  const sh = ss_().getSheetByName('Properties');
  const vals = sh.getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][0]) === String(d.origId)) {
      const onb = d.onboarded ? new Date(d.onboarded + 'T00:00:00') : '';
      sh.getRange(i + 1, 1, 1, 8).setValues([[
        d.id || d.origId, d.name, d.location || '', d.type || '', d.status || 'Active',
        onb, (d.rent === '' || d.rent == null) ? '' : num_(d.rent), d.notes || '' ]]);
      return { ok: true, message: 'Property "' + d.name + '" updated', properties: readProperties_() };
    }
  }
  throw new Error('Property not found: ' + d.origId);
}

/* ─────────────── DASHBOARD ─────────────── */
function getDashboard(pin, property, fromISO, toISO) {
  checkPin_(pin);
  const ss = ss_();
  const bRows = ss.getSheetByName('Bookings').getDataRange().getValues().slice(1);
  const eRows = ss.getSheetByName('Expenses').getDataRange().getValues().slice(1);
  const fp = (property && property !== 'All') ? String(property) : null;
  const curKey = Utilities.formatDate(new Date(), TZ, 'yyyy-MM');

  const rFrom = fromISO ? new Date(fromISO + 'T00:00:00') : null;
  const rTo   = toISO   ? new Date(toISO + 'T23:59:59')   : null;
  const hasRange = !!(rFrom || rTo);
  function inR(d){ if (!(d instanceof Date)) return false; if (rFrom && d < rFrom) return false; if (rTo && d > rTo) return false; return true; }
  function expDate_(r){ return (r[0] instanceof Date) ? r[0] : (r[1] instanceof Date ? r[1] : null); }

  const bookings  = bRows.filter(r => r[18] && (!fp || String(r[1]) === fp));  // Booking ID = col S (idx 18)
  const exp       = eRows.filter(r => !fp || String(r[3]) === fp);   // Expenses Property = col D (idx 3)
  const bookingsR = hasRange ? bookings.filter(r => inR(r[0])) : bookings;
  const expR      = hasRange ? exp.filter(r => inR(expDate_(r))) : exp;

  /* range-scoped: top KPIs, breakdown tables, drills */
  let stay = 0, resold = 0, pass = 0;
  const byType = { Stay:{c:0,net:0}, Resold:{c:0,net:0}, Pass:{c:0,net:0} };
  const byChannel = {}, dayMap = {}, revMatrix = {};
  bookingsR.forEach(function(r){
    const type = r[3], ch = r[4] || '(none)', net = num_(r[9]), d = r[0];
    if (byType[type]) { byType[type].c++; byType[type].net += net; }
    if (type === 'Stay') stay += net; else if (type === 'Resold') resold += net; else if (type === 'Pass') pass += net;
    byChannel[ch] = byChannel[ch] || {c:0,net:0}; byChannel[ch].c++; byChannel[ch].net += net;
    if (!revMatrix[ch]) revMatrix[ch] = { Stay:0, Resold:0, Pass:0 };
    if (revMatrix[ch][type] !== undefined) revMatrix[ch][type] += net;
    if (d instanceof Date) {
      const dk = Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
      dayMap[dk] = dayMap[dk] || {c:0,stay:0,comm:0}; dayMap[dk].c++;
      if (type === 'Stay') dayMap[dk].stay += net; else dayMap[dk].comm += net;
    }
  });
  const commission = resold + pass, totalRev = stay + commission;
  const daily = Object.keys(dayMap).sort().map(function(k){ return {
    date: Utilities.formatDate(new Date(k + 'T00:00:00'), TZ, 'dd MMM'),
    bookings: dayMap[k].c, stay: dayMap[k].stay, commission: dayMap[k].comm, total: dayMap[k].stay + dayMap[k].comm }; });
  const recent = bookingsR.slice(-8).reverse().map(function(r){ return {
    id: r[18], date: r[0] instanceof Date ? Utilities.formatDate(r[0], TZ, 'dd MMM') : '',
    guest: r[2], type: r[3], channel: r[4], net: num_(r[9]) }; });

  let oneTime = 0, recurring = 0, operating = 0, deposits = 0;
  const expenseByCategory = {};
  expR.forEach(function(r){
    const amt = num_(r[6]), type = r[7], ref = String(r[9]).toLowerCase(), cat = r[4] || 'Other';  // Category = col E (idx 4)
    if (type === 'One-time') oneTime += amt;
    else if (type === 'Recurring') recurring += amt;
    else if (type === 'Operating') operating += amt;
    if (ref === 'yes') deposits += amt;
    if (type === 'One-time' || type === 'Recurring' || type === 'Operating') expenseByCategory[cat] = (expenseByCategory[cat] || 0) + amt;
  });
  const totalExp = oneTime + recurring + operating;

  /* full / month-scoped (independent of range): current-month row, trend, checklist */
  const monthMap = {}, recurMonthMap = {};
  const monthByType = { Stay:{c:0,net:0}, Resold:{c:0,net:0}, Pass:{c:0,net:0} };
  const monthByChannel = {};
  bookings.forEach(function(r){
    const d = r[0]; if (!(d instanceof Date)) return;
    const mk = Utilities.formatDate(d, TZ, 'yyyy-MM'), type = r[3], ch = r[4] || '(none)', net = num_(r[9]);
    monthMap[mk] = monthMap[mk] || {c:0,stay:0,comm:0}; monthMap[mk].c++;
    if (type === 'Stay') monthMap[mk].stay += net; else monthMap[mk].comm += net;
    if (mk === curKey) {
      if (monthByType[type]) { monthByType[type].c++; monthByType[type].net += net; }
      monthByChannel[ch] = monthByChannel[ch] || {c:0,net:0}; monthByChannel[ch].c++; monthByChannel[ch].net += net;
    }
  });
  let expMonthRecur = 0, expMonthOper = 0; const monthRecur = [];
  exp.forEach(function(r){
    const amt = num_(r[6]), type = r[7], em = r[1];
    if ((type === 'Recurring' || type === 'Operating') && em instanceof Date) {
      const mk = Utilities.formatDate(em, TZ, 'yyyy-MM');
      recurMonthMap[mk] = (recurMonthMap[mk] || 0) + amt;  // Monthly P&L opex = Recurring + Operating
      if (mk === curKey) {
        if (type === 'Recurring') { expMonthRecur += amt; monthRecur.push({ cat: r[4] || 'Other', item: r[2] || '', amt: amt }); }  // checklist stays Recurring-only; Category=E(4), Item=C(2)
        else expMonthOper += amt;
      }
    }
  });
  const expMonthTotal = expMonthRecur + expMonthOper;  // This-Month expense card = Recurring + Operating
  const recurringChecklist = RECURRING_ITEMS.map(function(it){
    var amt = 0, added = false;
    monthRecur.forEach(function(x){
      var hay = (String(x.cat) + ' ' + String(x.item)).toLowerCase();
      if (it.kw.some(function(k){ return hay.indexOf(k) >= 0; })) { added = true; amt += x.amt; }
    });
    return { name: it.name, added: added, amount: amt };
  });
  const cm = monthMap[curKey] || {c:0,stay:0,comm:0};
  const cmRev = cm.stay + cm.comm;
  const _pnlKeys = Object.keys(Object.assign({}, monthMap, recurMonthMap)).sort();
  const monthlyPnl = _pnlKeys.map(function(k){
    const mm = monthMap[k] || {c:0,stay:0,comm:0};
    const rev = mm.stay + mm.comm, rec = recurMonthMap[k] || 0;
    return { month: Utilities.formatDate(new Date(k + '-01T00:00:00'), TZ, 'MMM yyyy'),
             bookings: mm.c, revenue: rev, recurring: rec, netPnl: rev - rec };
  });

  return {
    kpis:    { totalRev, totalExp, netPnL: totalRev - totalExp, bookings: bookingsR.length, deposits },
    revenue: { stay, commission, total: totalRev },
    expenses:{ oneTime, recurring, operating, total: totalExp, deposits },
    byType, byChannel, monthlyPnl, daily, recent,
    recurringChecklist, expenseByCategory, monthByType, monthByChannel, revMatrix,
    kpisMonth: { totalRev: cmRev, totalExp: expMonthTotal, recurExp: expMonthRecur, operExp: expMonthOper, netPnL: cmRev - expMonthTotal, bookings: cm.c },
    currentMonth: Utilities.formatDate(new Date(), TZ, 'MMM yyyy'),
    properties: readProperties_(), filter: fp || 'All',
    generatedAt: Utilities.formatDate(new Date(), TZ, 'dd MMM yyyy, HH:mm')
  };
}

/* ─────────────── WRITE: bookings ─────────────── */
function nextBookingId_(sheet) {
  const ids = sheet.getRange('S2:S').getValues().flat().filter(String);  // Booking ID = col S
  let max = 0;
  ids.forEach(v => { const m = String(v).match(/B(\d+)/); if (m) max = Math.max(max, parseInt(m[1], 10)); });
  return 'B' + String(max + 1).padStart(3, '0');
}
function addBooking(pin, d) {
  checkPin_(pin);
  const sheet = ss_().getSheetByName('Bookings');
  if (!d.property) throw new Error('Property is required');
  if (!d.date)     throw new Error('Booking date is required');
  if (!d.type)     throw new Error('Booking type is required');
  if (d.net === '' || d.net == null) throw new Error('Net Earned is required');
  const date  = new Date(d.date + 'T00:00:00');
  const id    = nextBookingId_(sheet);
  const month = Utilities.formatDate(date, TZ, 'MMM yyyy');
  const guestPaid = (d.guestPaid === '' || d.guestPaid == null) ? '' : num_(d.guestPaid);
  const net   = num_(d.net);
  let comm    = (d.commission === '' || d.commission == null) ? '' : num_(d.commission);
  if (comm === '' && guestPaid !== '') comm = guestPaid - net;
  const ciDate = d.checkinDate  ? new Date(d.checkinDate  + 'T00:00:00') : '';
  const coDate = d.checkoutDate ? new Date(d.checkoutDate + 'T00:00:00') : '';
  const pend   = (d.pending === '' || d.pending == null) ? '' : num_(d.pending);
  // Column order: A-K then L Pending, M Notes … R Guests, S Booking ID, T Month, U-X check-in/out date/time, Y Stay unit, Z Repeat
  sheet.appendRow([
    date, d.property, d.guest || '', d.type, d.channel || '', d.referrer || '',
    (d.listPrice === '' || d.listPrice == null) ? '' : num_(d.listPrice),
    (d.discount  === '' || d.discount  == null) ? '' : num_(d.discount),
    guestPaid, net, comm, pend, d.notes || '', d.phone || '', d.leadBirthYr || '', d.coGuest || '', d.coGuestBirthYr || '',
    (d.guests === '' || d.guests == null) ? '' : num_(d.guests), id, month,
    ciDate, coDate, d.checkinTime || '', d.checkoutTime || '', d.stayUnit || '', (d.repeat ? 1 : '') ]);
  return { ok: true, message: 'Booking ' + id + ' added' };
}

/* ─────────────── WRITE: expenses ─────────────── */
function addExpense(pin, d) {
  checkPin_(pin);
  const sheet = ss_().getSheetByName('Expenses');
  if (!d.property)     throw new Error('Property is required');
  if (!d.amount)       throw new Error('Amount is required');
  if (!d.type)         throw new Error('Expense type is required');
  if (!d.expenseMonth) throw new Error('Expense month is required');
  if (!d.item)         throw new Error('Item / description is required');
  const [yy, mm] = d.expenseMonth.split('-').map(Number);
  const expMonth = new Date(yy, mm - 1, 1);
  const txnDate  = d.date ? new Date(d.date + 'T00:00:00') : '';
  const refundable = d.refundable || (d.type === 'Deposit' ? 'Yes' : 'No');
  sheet.appendRow([
    txnDate, expMonth, d.item, d.property, d.category || '',
    (d.quantity === '' || d.quantity == null) ? '' : num_(d.quantity),
    num_(d.amount), d.type, d.status || 'Bought', refundable, d.vendor || '', d.notes || '',
    (d.initInvest ? 1 : 0) ]);
  return { ok: true, message: 'Expense added' };
}

/* ─────────────── LOGS (full tables for the log views) ─────────────── */
function getLogs(pin) {
  checkPin_(pin);
  const ss = ss_();
  return {
    bookings: logBlock_(ss.getSheetByName('Bookings')),
    expenses: logBlock_(ss.getSheetByName('Expenses')),
    savings:  logBlock_(savingsSheet_())
  };
}
function logBlock_(sh) {
  const vals = sh.getDataRange().getValues();
  const headers = (vals[0] || []).map(function(c){ return (c === null || c === undefined) ? '' : c; });
  const rows = [];
  for (var i = 1; i < vals.length; i++) {
    var cells = vals[i].map(function(c){
      if (c instanceof Date) {
        // Time-only cells (e.g. Check-in/out Time) carry the spreadsheet epoch date
        // 1899-12-30; format those as a clock time, real dates as yyyy-MM-dd.
        return (c.getFullYear() === 1899)
          ? Utilities.formatDate(c, TZ, 'h:mm a')
          : Utilities.formatDate(c, TZ, 'yyyy-MM-dd');
      }
      return (c === null || c === undefined) ? '' : c;
    });
    if (cells.some(function(c){ return String(c) !== ''; })) rows.push({ r: i + 1, cells: cells });
  }
  return { headers: headers, rows: rows };
}

/* ─────────────── EDIT existing rows (from the log views) ─────────────── */
function updateBooking(pin, row, d) {
  checkPin_(pin);
  if (!row || row < 2) throw new Error('Invalid row');
  const sheet = ss_().getSheetByName('Bookings');
  if (!d.date) throw new Error('Booking date is required');
  if (!d.type) throw new Error('Booking type is required');
  if (d.net === '' || d.net == null) throw new Error('Net Earned is required');
  const date = new Date(d.date + 'T00:00:00');
  const month = Utilities.formatDate(date, TZ, 'MMM yyyy');
  const guestPaid = (d.guestPaid === '' || d.guestPaid == null) ? '' : num_(d.guestPaid);
  const net = num_(d.net);
  let comm = (d.commission === '' || d.commission == null) ? '' : num_(d.commission);
  if (comm === '' && guestPaid !== '') comm = guestPaid - net;
  const id = d.bookingId || sheet.getRange(row, 19).getValue();   // Booking ID = col S (19)
  const ciDate = d.checkinDate  ? new Date(d.checkinDate  + 'T00:00:00') : '';
  const coDate = d.checkoutDate ? new Date(d.checkoutDate + 'T00:00:00') : '';
  const pend   = (d.pending === '' || d.pending == null) ? '' : num_(d.pending);
  sheet.getRange(row, 1, 1, 26).setValues([[
    date, d.property || '', d.guest || '', d.type, d.channel || '', d.referrer || '',
    (d.listPrice === '' || d.listPrice == null) ? '' : num_(d.listPrice),
    (d.discount  === '' || d.discount  == null) ? '' : num_(d.discount),
    guestPaid, net, comm, pend, d.notes || '', d.phone || '', d.leadBirthYr || '', d.coGuest || '', d.coGuestBirthYr || '',
    (d.guests === '' || d.guests == null) ? '' : num_(d.guests), id, month,
    ciDate, coDate, d.checkinTime || '', d.checkoutTime || '', d.stayUnit || '', (d.repeat ? 1 : '') ]]);
  return { ok: true, message: 'Booking ' + id + ' updated' };
}
function updateExpense(pin, row, d) {
  checkPin_(pin);
  if (!row || row < 2) throw new Error('Invalid row');
  const sheet = ss_().getSheetByName('Expenses');
  if (!d.amount)       throw new Error('Amount is required');
  if (!d.type)         throw new Error('Expense type is required');
  if (!d.expenseMonth) throw new Error('Expense month is required');
  if (!d.item)         throw new Error('Item / description is required');
  const parts = String(d.expenseMonth).split('-');
  const expMonth = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
  const txnDate = d.date ? new Date(d.date + 'T00:00:00') : '';
  const refundable = d.refundable || (d.type === 'Deposit' ? 'Yes' : 'No');
  sheet.getRange(row, 1, 1, 13).setValues([[
    txnDate, expMonth, d.item, d.property || '', d.category || '',
    (d.quantity === '' || d.quantity == null) ? '' : num_(d.quantity),
    num_(d.amount), d.type, d.status || 'Bought', refundable, d.vendor || '', d.notes || '',
    (d.initInvest ? 1 : 0) ]]);
  return { ok: true, message: 'Expense updated' };
}
function deleteBooking(pin, row) {
  checkPin_(pin);
  if (!row || row < 2) throw new Error('Invalid row');
  ss_().getSheetByName('Bookings').deleteRow(row);
  return { ok: true, message: 'Booking deleted' };
}
/* Settle a payment: clear the Pending amount (Bookings col L = 12) for one or more rows. */
function setPayouts(pin, d) {
  checkPin_(pin);
  var rows = (d && d.rows) || [];
  if (!rows.length) throw new Error('No rows given');
  var sh = ss_().getSheetByName('Bookings');
  var n = 0;
  rows.forEach(function (r) { r = Number(r); if (r >= 2) { sh.getRange(r, 12).clearContent(); n++; } });  // Pending amount = col L (12)
  return { ok: true, message: n + ' payment' + (n === 1 ? '' : 's') + ' marked paid' };
}
function deleteExpense(pin, row) {
  checkPin_(pin);
  if (!row || row < 2) throw new Error('Invalid row');
  ss_().getSheetByName('Expenses').deleteRow(row);
  return { ok: true, message: 'Expense deleted' };
}

/* ─────────────── SAVINGS (global — not per-property) ─────────────── */
const SAVING_SCHEMES   = ['FDs', 'Mutual Funds', 'Stocks', 'Bonds', 'Other'];
const SAVING_PLATFORMS = ['Slice', 'Groww', 'ET Money', 'Grip Invest', 'Others'];
const SAVING_STATUSES  = ['Active', 'Matured', 'Withdrawn'];
const SAVING_HEADERS   = ['Date', 'Amount', 'Scheme', 'Platform', 'Status', 'Returns Received', 'Notes / Ref No', 'Created At'];

/* Auto-creates the Savings sheet (with headers) on first touch — zero manual setup. */
function savingsSheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName('Savings');
  if (!sh) sh = ss.insertSheet('Savings');
  if (!String(sh.getRange(1, 1).getValue())) {
    sh.getRange(1, 1, 1, SAVING_HEADERS.length).setValues([SAVING_HEADERS]);
  }
  return sh;
}
/* Validate + normalize one saving into cols A..G (shared by add + update). */
function savingCells_(d) {
  if (!d.date) throw new Error('Date is required');
  if (d.amount === '' || d.amount == null) throw new Error('Amount is required');
  const amount = num_(d.amount);
  if (!(amount > 0)) throw new Error('Amount must be greater than 0');
  const scheme   = d.scheme   || 'Other';
  const platform = d.platform || 'Others';
  const status   = d.status   || 'Active';
  if (SAVING_SCHEMES.indexOf(scheme) < 0)     throw new Error('Invalid scheme: ' + scheme);
  if (SAVING_PLATFORMS.indexOf(platform) < 0) throw new Error('Invalid platform: ' + platform);
  if (SAVING_STATUSES.indexOf(status) < 0)    throw new Error('Invalid status: ' + status);
  let returns = '';   // Active entries never carry returns
  if (status !== 'Active' && d.returns !== '' && d.returns != null) {
    returns = num_(d.returns);
    if (returns < 0) throw new Error('Returns must be 0 or more');
  }
  return [ new Date(d.date + 'T00:00:00'), amount, scheme, platform, status, returns, d.notes || '' ];
}
function addSaving(pin, d) {
  checkPin_(pin);
  const sheet = savingsSheet_();
  sheet.appendRow(savingCells_(d).concat([new Date()]));
  return { ok: true, message: 'Saving added' };
}
function updateSaving(pin, row, d) {
  checkPin_(pin);
  if (!row || row < 2) throw new Error('Invalid row');
  const sheet = savingsSheet_();
  sheet.getRange(row, 1, 1, 7).setValues([savingCells_(d)]);   // A..G only — never rewrites H (Created At)
  return { ok: true, message: 'Saving updated' };
}
function deleteSaving(pin, row) {
  checkPin_(pin);
  if (!row || row < 2) throw new Error('Invalid row');
  savingsSheet_().deleteRow(row);
  return { ok: true, message: 'Saving deleted' };
}
