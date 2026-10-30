/**
 * One-way mirror: D1 (source of truth) -> Google Sheets (read-only view).
 *
 * Runs on the cron trigger in wrangler.toml. Pushes a full snapshot to an Apps
 * Script doPost endpoint (gas/Mirror.gs) which rewrites the tabs in place.
 *
 * Why push a snapshot rather than diff: the dataset is ~450 rows, a full
 * rewrite is one Sheets call per tab, and it is idempotent — a failed run is
 * corrected by the next one with no reconciliation state to get wrong.
 *
 * IMPORTANT — the mirror is one-way. Anything typed into the sheet by hand is
 * overwritten on the next run. The sheet is a window onto the DB now, not an
 * input surface.
 *
 * Column discipline for the IMS workbook: 'Item Master' cols F/H/I/K and
 * 'Stock Log' cols F/J are ARRAYFORMULAs. Those columns are never sent, so the
 * formulas survive — the same rule the old Apps Script had to follow.
 */

const BOOKING_COLS = ['booking_date','property','lead_guest','booking_type','channel','referrer',
  'list_price','discount','guest_paid','net_earned','commission_paid','pending_amount','notes','phone',
  'lead_birth_yr','co_guest','co_guest_birth_yr','guests','booking_id','month','checkin_date',
  'checkout_date','checkin_time','checkout_time','stay_unit','repeat_flag','review_status'];
const EXPENSE_COLS = ['txn_date','expense_month','item','property','category','quantity','amount','type',
  'status','refundable','vendor','notes','init_invest'];
const SAVING_COLS = ['date','amount','scheme','platform','status','returns','notes','created_at'];
const PROPERTY_COLS = ['id','name','location','type','status','onboarded','rent','notes'];

/* NULL -> '' so blank cells stay blank rather than rendering as the string 'null'. */
const blank = (v) => (v === null || v === undefined) ? '' : v;

async function grid(db, table, cols, order = 'id') {
  const { results } = await db.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all();
  return results.map(r => cols.map(c => blank(r[c])));
}

export async function buildSnapshot(db) {
  return {
    // PnL workbook — full-width rewrites, these tabs hold no formulas.
    Bookings:   await grid(db, 'bookings',   BOOKING_COLS),
    Expenses:   await grid(db, 'expenses',   EXPENSE_COLS),
    Savings:    await grid(db, 'savings',    SAVING_COLS),
    Properties: await grid(db, 'properties', PROPERTY_COLS, 'sort, rowid'),

    /* IMS workbook — only the non-formula columns, sent as sparse blocks the
       Apps Script writes into their exact ranges. */
    ItemMasterA_E: await grid(db, 'inv_items', ['item_id','property','category','item','type']),
    ItemMasterG:   await grid(db, 'inv_items', ['required_qty']),
    ItemMasterJ:   await grid(db, 'inv_items', ['reorder_level']),
    ItemMasterL_N: await grid(db, 'inv_items', ['unit_price','vendor','remarks']),
    StockLogA_E:   await grid(db, 'inv_movements', ['date','item_key','movement','qty','unit_cost']),
    StockLogG_I:   await grid(db, 'inv_movements', ['vendor','logged_by','remarks'])
  };
}

export async function runMirror(env) {
  if (!env.MIRROR_URL || !env.MIRROR_SECRET) {
    console.log('mirror: MIRROR_URL / MIRROR_SECRET not set — skipping');
    return { ok: false, skipped: true };
  }
  const snapshot = await buildSnapshot(env.DB);
  const res = await fetch(env.MIRROR_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: env.MIRROR_SECRET, snapshot })
  });
  const text = await res.text();
  let out;
  try { out = JSON.parse(text); } catch { out = { error: text.slice(0, 300) }; }
  if (!out.ok) console.log('mirror failed:', JSON.stringify(out).slice(0, 500));
  else console.log('mirror ok:', JSON.stringify(out.counts));
  return out;
}
