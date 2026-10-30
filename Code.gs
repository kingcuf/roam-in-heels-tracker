/**
 * SPIRA TRACKER — backend (Google Apps Script) — multi-property
 * Serves the web UI and reads/writes the Properties, Bookings & Expenses tabs.
 * Setup: Extensions ▸ Apps Script ▸ paste this + Index.html ▸ Deploy ▸ Web app.
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

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Spira Tracker')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
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

/* ─────────────── PROPERTIES (master list) ─────────────── */
// Properties cols: A id · B name · C location · D type · E status · F onboarded · G rent · H notes
function readProperties_() {
  const sh = ss_().getSheetByName('Properties');
  const rows = sh.getDataRange().getValues().slice(1);
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

/* ─────────────── READ: dashboard (optional property filter) ─────────────── */
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

  const bookings  = bRows.filter(r => r[17] && (!fp || String(r[1]) === fp));
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
    id: r[17], date: r[0] instanceof Date ? Utilities.formatDate(r[0], TZ, 'dd MMM') : '',
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

/* ─────────────── WRITE: add booking ─────────────── */
function nextBookingId_(sheet) {
  const ids = sheet.getRange('R2:R').getValues().flat().filter(String);
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

  sheet.appendRow([
    date, d.property, d.guest || '', d.type, d.channel || '', d.referrer || '',
    (d.listPrice === '' || d.listPrice == null) ? '' : num_(d.listPrice),
    (d.discount  === '' || d.discount  == null) ? '' : num_(d.discount),
    guestPaid, net, comm, d.notes || '', d.phone || '', d.leadBirthYr || '', d.coGuest || '', d.coGuestBirthYr || '',
    (d.guests === '' || d.guests == null) ? '' : num_(d.guests), id, month
  ]);
  return { ok: true, message: 'Booking ' + id + ' added' };
}

/* ─────────────── WRITE: add expense ─────────────── */
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
    num_(d.amount), d.type, d.status || 'Bought', refundable, d.vendor || '', d.notes || ''
  ]);
  return { ok: true, message: 'Expense added' };
}

/* ─────────────── LOGS (full tables for the log views) ─────────────── */
function getLogs(pin) {
  checkPin_(pin);
  const ss = ss_();
  return {
    bookings: logBlock_(ss.getSheetByName('Bookings')),
    expenses: logBlock_(ss.getSheetByName('Expenses'))
  };
}
function logBlock_(sh) {
  const vals = sh.getDataRange().getValues();
  const headers = (vals[0] || []).map(function(c){ return (c === null || c === undefined) ? '' : c; });
  const rows = [];
  for (var i = 1; i < vals.length; i++) {
    var cells = vals[i].map(function(c){
      if (c instanceof Date) {
        // Time-only cells (Check-in/out Time) carry the epoch date 1899-12-30 → show as clock time.
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
  const id = d.bookingId || sheet.getRange(row, 18).getValue();
  sheet.getRange(row, 1, 1, 19).setValues([[
    date, d.property || '', d.guest || '', d.type, d.channel || '', d.referrer || '',
    (d.listPrice === '' || d.listPrice == null) ? '' : num_(d.listPrice),
    (d.discount  === '' || d.discount  == null) ? '' : num_(d.discount),
    guestPaid, net, comm, d.notes || '', d.phone || '', d.leadBirthYr || '', d.coGuest || '', d.coGuestBirthYr || '',
    (d.guests === '' || d.guests == null) ? '' : num_(d.guests), id, month ]]);
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
  sheet.getRange(row, 1, 1, 12).setValues([[
    txnDate, expMonth, d.item, d.property || '', d.category || '',
    (d.quantity === '' || d.quantity == null) ? '' : num_(d.quantity),
    num_(d.amount), d.type, d.status || 'Bought', refundable, d.vendor || '', d.notes || '' ]]);
  return { ok: true, message: 'Expense updated' };
}
function deleteBooking(pin, row) {
  checkPin_(pin);
  if (!row || row < 2) throw new Error('Invalid row');
  ss_().getSheetByName('Bookings').deleteRow(row);
  return { ok: true, message: 'Booking deleted' };
}
function deleteExpense(pin, row) {
  checkPin_(pin);
  if (!row || row < 2) throw new Error('Invalid row');
  ss_().getSheetByName('Expenses').deleteRow(row);
  return { ok: true, message: 'Expense deleted' };
}
