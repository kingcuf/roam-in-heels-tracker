/**
 * ROAM IN HEELS — sheet mirror receiver.
 *
 * The Cloudflare D1 database is the source of truth; this spreadsheet is a
 * read-only copy. The Worker's nightly cron job (and the `mirrorNow` action)
 * POSTs a full snapshot here and this rewrites the data tabs.
 *
 * ⚠️  ONE-WAY. Anything typed into the mirrored tabs is overwritten on the next
 *     run. Enter data through the app, not the sheet.
 *
 * SETUP (once):
 *   1. Create a Google Sheet. Extensions ▸ Apps Script. Replace Code.gs with
 *      this file. Save.
 *   2. Deploy ▸ New deployment ▸ ⚙ Web app ▸ Execute as: Me ▸ Who has access:
 *      Anyone ▸ Deploy (authorise when asked). Copy the /exec URL.
 *   3. Plant the shared secret once: open  <exec URL>?init=<MIRROR_SECRET>
 *      (only works while no secret is set — see doGet), then on the Worker:
 *        npx wrangler secret put MIRROR_URL      # the /exec URL
 *        npx wrangler secret put MIRROR_SECRET   # the same secret
 *
 * The script is BOUND to the sheet it was created from and writes only there —
 * no spreadsheet ids in code. Tabs are created on first run. Every block is
 * sized from the data, so a column added to the database cannot make the
 * write fail on a width mismatch (the previous mirror hard-coded 26 booking
 * columns and broke when a 27th was added).
 */

/* Column headers for each tab, in the order the Worker sends them
   (worker/src/mirror.js). A header list shorter than the data is padded with
   the column number, so new columns still land, just unnamed. */
const HEADERS = {
  'Bookings': ['Booking Date', 'Property', 'Lead Guest', 'Type', 'Channel', 'Referrer',
    'List Price', 'Discount', 'Guest Paid', 'Net Earned', 'Commission Paid', 'Pending Amount',
    'Notes', 'Phone', 'Lead Birth Yr', 'Co-guest', 'Co-guest Birth Yr', 'Guests', 'Booking ID',
    'Month', 'Check-in Date', 'Check-out Date', 'Check-in Time', 'Check-out Time', 'Stay Unit',
    'Repeat', 'Review Status'],
  'Expenses': ['Txn Date', 'Expense Month', 'Item', 'Property', 'Category', 'Qty', 'Amount', 'Type',
    'Status', 'Refundable', 'Vendor', 'Notes', 'Initial Investment'],
  'Savings': ['Date', 'Amount', 'Scheme', 'Platform', 'Status', 'Returns Received', 'Notes / Ref No',
    'Created At'],
  'Properties': ['ID', 'Name', 'Location', 'Type', 'Status', 'Onboarded', 'Rent', 'Notes'],
  'Inventory Items': ['Item ID', 'Property', 'Category', 'Item', 'Type', 'Required Qty',
    'Reorder Level', 'Unit Price', 'Vendor', 'Remarks'],
  'Stock Log': ['Date', 'Item Key', 'Movement', 'Qty', 'Unit Cost', 'Vendor', 'Logged By', 'Remarks'],
};

/* Header names whose values must stay literal text: a booking Month like
   'May 2026' is otherwise read as 1-May, an item id 'DEC-04' as 4-Dec, and a
   phone '+91…' as a formula. */
const TEXT_COLS = ['Phone', 'Month', 'Booking ID', 'Item ID', 'Item Key', 'Stay Unit'];

function sheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function mirrorSecret_() {
  return PropertiesService.getScriptProperties().getProperty('MIRROR_SECRET');
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const expected = mirrorSecret_();
    if (!expected) throw new Error('MIRROR_SECRET not configured in Script Properties');
    if (String(body.secret) !== String(expected)) throw new Error('Unauthorized');

    const s = body.snapshot || {};
    const ss = sheet_();
    const counts = {};
    counts.bookings   = writeTab_(ss, 'Bookings',   s.Bookings);
    counts.expenses   = writeTab_(ss, 'Expenses',   s.Expenses);
    counts.savings    = writeTab_(ss, 'Savings',    s.Savings);
    counts.properties = writeTab_(ss, 'Properties', s.Properties);
    /* Inventory arrives as column slices shaped for the old workbook, whose
       formula columns had to be skipped. This sheet has no formulas, so the
       slices are joined back into whole rows. */
    counts.invItems     = writeTab_(ss, 'Inventory Items',
      zip_(s.ItemMasterA_E, s.ItemMasterG, s.ItemMasterJ, s.ItemMasterL_N));
    counts.invMovements = writeTab_(ss, 'Stock Log', zip_(s.StockLogA_E, s.StockLogG_I));
    stampReadme_(ss, counts);
    return json_({ ok: true, counts: counts });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

/* Row-wise concatenation of equally long column slices. */
function zip_() {
  const parts = Array.prototype.slice.call(arguments).map(function (p) { return p || []; });
  const n = parts.reduce(function (m, p) { return Math.max(m, p.length); }, 0);
  const out = [];
  for (let i = 0; i < n; i++) {
    let row = [];
    parts.forEach(function (p) { row = row.concat(p[i] || []); });
    out.push(row);
  }
  return out;
}

/* Rewrites a whole tab: header row, then the data, with any surplus rows or
   columns from a previous, larger snapshot cleared. */
function writeTab_(ss, name, rows) {
  rows = rows || [];
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  const base = HEADERS[name] || [];
  const width = Math.max(base.length, rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0), 1);
  const header = [];
  for (let c = 0; c < width; c++) header.push(base[c] || 'Col ' + (c + 1));
  const data = rows.map(function (r) {
    const row = r.slice();
    while (row.length < width) row.push('');
    header.forEach(function (h, c) {
      if (TEXT_COLS.indexOf(h) >= 0 && typeof row[c] === 'string' && row[c] !== '') row[c] = "'" + row[c];
    });
    return row;
  });

  sh.clearContents();
  if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
  if (sh.getMaxRows() < data.length + 1) sh.insertRowsAfter(sh.getMaxRows(), data.length + 1 - sh.getMaxRows());
  sh.getRange(1, 1, 1, width).setValues([header]).setFontWeight('bold');
  sh.setFrozenRows(1);
  if (data.length) sh.getRange(2, 1, data.length, width).setValues(data);
  return data.length;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* A visible marker so nobody mistakes the sheet for an input surface. */
function stampReadme_(ss, counts) {
  let sh = ss.getSheetByName('README');
  if (!sh) { sh = ss.insertSheet('README', 0); }
  sh.getRange('A1').setValue('READ-ONLY MIRROR of the Roam in Heels database. Edits here are overwritten on the next run.');
  sh.getRange('A2').setValue('Last mirrored: ' +
    Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd MMM yyyy, HH:mm') + ' IST');
  sh.getRange('A3').setValue('Rows: ' + JSON.stringify(counts));
}

/**
 * One-time bootstrap + health check.
 *
 * GET ?init=<secret> stores MIRROR_SECRET **only while it is unset**. Once set
 * this route refuses forever — it can never overwrite or reveal the live
 * secret. To rotate, clear the property in Project Settings first.
 *
 * A bare GET is a health check: whether the mirror is configured and which
 * sheet it writes to (by name). The sheet's data is never readable here.
 */
function doGet(e) {
  const props = PropertiesService.getScriptProperties();
  const init = (e && e.parameter && e.parameter.init) || '';
  if (!init) {
    const ss = sheet_();
    return json_({ ok: true, mirror: true, configured: !!props.getProperty('MIRROR_SECRET'),
                   sheet: ss ? ss.getName() : null });
  }
  if (props.getProperty('MIRROR_SECRET')) {
    return json_({ ok: false, error: 'Already initialised — clear MIRROR_SECRET to rotate' });
  }
  if (init.length < 24) return json_({ ok: false, error: 'Secret too short' });
  props.setProperty('MIRROR_SECRET', init);
  return json_({ ok: true, message: 'MIRROR_SECRET stored' });
}
