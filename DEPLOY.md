# Spira Tracker — Deploy (one-time, ~3 minutes)

A web app that adds bookings/expenses to your sheet and shows the dashboard,
so you never edit the sheet by hand. Runs under **your** Google account — no
passwords, API keys, or third-party access.

## Steps

1. **Open the script editor**
   - Open the spreadsheet *"Airbnb Portfolio Tracker — Spira (Restructured)"*.
   - Menu: **Extensions ▸ Apps Script**. A new tab opens.

2. **Paste the backend**
   - In the editor you'll see a file `Code.gs` with a default `myFunction`.
   - Select all, delete, and paste the entire contents of **`Code.gs`** from this folder.
   - **Set your PIN:** add a `PIN` script property under Project Settings ▸ Script Properties. Never put it in source.
   - Click the **💾 Save** icon.

3. **Add the web page**
   - Click the **＋** next to "Files" ▸ **HTML**. Name it exactly **`Index`** (no extension).
   - Delete the placeholder content and paste the entire contents of **`Index.html`**.
   - **💾 Save**.

4. **Deploy**
   - Top-right: **Deploy ▸ New deployment**.
   - Click the gear ⚙ next to "Select type" ▸ choose **Web app**.
   - Settings:
     - **Description:** Spira Tracker
     - **Execute as:** *Me (your account)*
     - **Who has access:** *Anyone*  ← needed so you can open it without a Google login; the **PIN** is what protects it.
   - Click **Deploy**.

5. **Authorize** (first time only)
   - Click **Authorize access** ▸ pick your account ▸ "Advanced" ▸ "Go to … (unsafe)" ▸ **Allow**.
   - (This warning is normal — it's *your* script asking to edit *your* sheet.)

6. **Get your URL**
   - Copy the **Web app URL** (ends in `/exec`). That's your website.
   - Open it, enter your PIN, and you're in. **Bookmark it** / add to your phone home screen.

## Using it
- **Dashboard** tab — KPIs, charts, revenue by channel/type, monthly + daily, expenses. Hit **↻ Refresh** anytime.
- **+ Add Booking** — Date, Type (Stay/Resold/Pass) and **Net Earned** are required; Booking ID, Month, and Commission auto-fill. Saving appends a row to the **Bookings** tab.
- **+ Add Expense** — **Expense Month**, **Item**, **Amount**, **Type** required. Saving appends to the **Expenses** tab; Refundable auto-sets to "Yes" for Deposits.

Every save writes straight into the sheet, the sheet's formulas recalc, and the
dashboard updates immediately.

## Updating later
If I change the code, paste the new version and do **Deploy ▸ Manage deployments
▸ ✏️ Edit ▸ Version: New version ▸ Deploy** (keeps the same URL).

## Notes
- Booking columns written: Date·Property·Guest·Type·Channel·Referrer·List·Discount·GuestPaid·Net·Commission·Notes·Phone·CoGuest·Guests·BookingID·Month.
- Expense columns written: TxnDate·ExpenseMonth·Property·Category·Item·Qty·Amount·Type·Status·Refundable·Vendor·Notes.
- To change the PIN later: edit `const PIN` in `Code.gs`, Save, and redeploy a new version.
