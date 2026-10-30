/**
 * SPIRA TRACKER — sheet mirror receiver.
 *
 * After the migration to Cloudflare D1, the database is the source of truth and
 * these spreadsheets are a read-only view. The Worker's cron job POSTs a full
 * snapshot here once a day and this rewrites the data tabs in place.
 *
 * ⚠️  ONE-WAY. Anything typed into the mirrored tabs by hand is overwritten on
 *     the next run. Enter data through the app, not the sheet.
 *
 * Deploy as a SEPARATE Apps Script project (or a separate deployment) from the
 * old read/write API:
 *   Deploy ▸ New deployment ▸ Web app ▸ Execute as: Me ▸ Who has access: Anyone
 * then set the /exec URL and the shared secret on the Worker:
 *   npx wrangler secret put MIRROR_URL
 *   npx wrangler secret put MIRROR_SECRET
 *
 * The secret must match on both sides — "Anyone" access means the URL alone is
 * otherwise enough to overwrite your sheets.
 */

const PNL_SPREADSHEET_ID = '1QO8wQqKENFWqmRtc0Lwc1iSHIhMnhwA-6j4k-nS4t2Y';
const IMS_SPREADSHEET_ID = '14JAEgwyN3Zr7DrohWviRC0rHovSJ8BERM-kaSaSozxI';

/* Set this to the same value passed to `wrangler secret put MIRROR_SECRET`.
   Stored in Script Properties rather than inline so the secret is not in code:
   Project Settings ▸ Script Properties ▸ add MIRROR_SECRET. */
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
    const counts = {};
    const pnl = SpreadsheetApp.openById(PNL_SPREADSHEET_ID);
    const ims = SpreadsheetApp.openById(IMS_SPREADSHEET_ID);

    /* PnL tabs hold no formulas — safe to rewrite the full width. */
    /* 14 = Phone, 20 = Month ('May 2026' is read back as a date otherwise). */
    counts.bookings   = writeBlock_(pnl, 'Bookings',   s.Bookings,   1, 26, [14, 20]);
    counts.expenses   = writeBlock_(pnl, 'Expenses',   s.Expenses,   1, 13);
    counts.savings    = writeBlock_(pnl, 'Savings',    s.Savings,    1, 8);
    counts.properties = writeBlock_(pnl, 'Properties', s.Properties, 1, 8);

    /* IMS: write ONLY the editable columns. Item Master F/H/I/K and Stock Log
       F/J are ARRAYFORMULAs living in row 2 — touching them destroys the
       computed columns for every row. */
    clearCols_(ims, 'Item Master', [[1, 5], [7, 1], [10, 1], [12, 3]]);
    /* Item ids like 'DEC-04' are read by Sheets as 4-Dec dates unless the column
       is pinned to plain text first. */
    forceText_(ims, 'Item Master', [1], (s.ItemMasterA_E || []).length);
    writeAt_(ims, 'Item Master', quoteCols_(s.ItemMasterA_E, [0]), 2, 1, 5);
    writeAt_(ims, 'Item Master', s.ItemMasterG,   2, 7, 1);
    writeAt_(ims, 'Item Master', s.ItemMasterJ,   2, 10, 1);
    writeAt_(ims, 'Item Master', s.ItemMasterL_N, 2, 12, 3);
    counts.invItems = (s.ItemMasterA_E || []).length;

    clearCols_(ims, 'Stock Log', [[1, 5], [7, 3]]);
    writeAt_(ims, 'Stock Log', s.StockLogA_E, 2, 1, 5);
    writeAt_(ims, 'Stock Log', s.StockLogG_I, 2, 7, 3);
    counts.invMovements = (s.StockLogA_E || []).length;

    stampMirroredAt_(pnl);
    return json_({ ok: true, counts: counts });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* Rewrites rows 2..n of a tab, clearing any surplus rows left over from a
   previous, longer snapshot. */
function writeBlock_(ss, tabName, rows, startCol, width, textCols) {
  const sh = ss.getSheetByName(tabName);
  if (!sh) throw new Error('Missing tab: ' + tabName);
  rows = rows || [];
  const last = sh.getLastRow();
  if (last >= 2) sh.getRange(2, startCol, last - 1, width).clearContent();
  if (rows.length) {
    ensureRows_(sh, rows.length + 1);
    if (textCols && textCols.length) {
      forceText_(ss, tabName, textCols, rows.length);
      rows = quoteCols_(rows, textCols.map(function (c) { return c - startCol; }));
    }
    sh.getRange(2, startCol, rows.length, width).setValues(rows);
  }
  return rows.length;
}

/* Pins columns to plain text BEFORE the write. Cosmetic on its own — see
   quoteCols_ for the part that actually stops the coercion. */
function forceText_(ss, tabName, cols, nRows) {
  if (!nRows) return;
  const sh = ss.getSheetByName(tabName);
  if (!sh) return;
  ensureRows_(sh, nRows + 1);
  cols.forEach(function (c) { sh.getRange(2, c, nRows, 1).setNumberFormat('@'); });
}

/**
 * Forces the named columns to land as literal text.
 *
 * setValues() parses like a human typing into the cell, and a plain-text number
 * format does NOT switch that off — 'DEC-04' still becomes 4-Dec (serial 46360)
 * and 'May 2026' still becomes 1-May. The leading apostrophe is the only thing
 * Sheets honours unconditionally; it is stripped on read, so getValues() and
 * the old API see the original string back.
 *
 * Columns that need it: item ids ('DEC-04'), booking Month ('May 2026'), and
 * phone (a bare '+91…' would be read as a formula). All three are TEXT in D1.
 *
 * `idxs` are 0-based offsets into each row, not sheet columns.
 */
function quoteCols_(rows, idxs) {
  return (rows || []).map(function (row) {
    const copy = row.slice();
    idxs.forEach(function (i) {
      if (typeof copy[i] === 'string' && copy[i] !== '') copy[i] = "'" + copy[i];
    });
    return copy;
  });
}

function clearCols_(ss, tabName, blocks) {
  const sh = ss.getSheetByName(tabName);
  if (!sh) throw new Error('Missing tab: ' + tabName);
  const last = sh.getLastRow();
  if (last < 2) return;
  blocks.forEach(function (b) { sh.getRange(2, b[0], last - 1, b[1]).clearContent(); });
}

function writeAt_(ss, tabName, rows, startRow, startCol, width) {
  if (!rows || !rows.length) return;
  const sh = ss.getSheetByName(tabName);
  ensureRows_(sh, startRow + rows.length - 1);
  sh.getRange(startRow, startCol, rows.length, width).setValues(rows);
}

function ensureRows_(sh, needed) {
  if (sh.getMaxRows() < needed) sh.insertRowsAfter(sh.getMaxRows(), needed - sh.getMaxRows());
}

/* Leaves a visible marker so nobody mistakes the sheet for a live input surface. */
function stampMirroredAt_(ss) {
  const sh = ss.getSheetByName('README');
  if (!sh) return;
  sh.getRange('A1').setValue(
    'READ-ONLY MIRROR — source of truth is the Cloudflare D1 database. ' +
    'Edits here are overwritten. Last mirrored: ' +
    Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd MMM yyyy, HH:mm') + ' IST');
}

/**
 * One-time bootstrap + health check.
 *
 * Script Properties cannot be set from clasp, so the shared secret is planted
 * once over HTTPS: GET ?init=<secret> writes MIRROR_SECRET **only while it is
 * unset**. Once set, this route refuses forever — it can never overwrite or
 * reveal the live secret, so leaving it deployed is inert. To rotate, clear the
 * property in Project Settings first.
 *
 * A bare GET is a health check: says whether the mirror is configured, nothing
 * more. The sheets are never readable through this route.
 */
function doGet(e) {
  const props = PropertiesService.getScriptProperties();
  const init = (e && e.parameter && e.parameter.init) || '';
  if (!init) return json_({ ok: true, configured: !!props.getProperty('MIRROR_SECRET') });
  if (props.getProperty('MIRROR_SECRET')) {
    return json_({ ok: false, error: 'Already initialised — clear MIRROR_SECRET to rotate' });
  }
  if (init.length < 24) return json_({ ok: false, error: 'Secret too short' });
  props.setProperty('MIRROR_SECRET', init);
  return json_({ ok: true, message: 'MIRROR_SECRET stored' });
}
