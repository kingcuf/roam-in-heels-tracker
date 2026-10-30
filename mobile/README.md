# Spira PnL — iOS & Android app

Native mobile app (Expo / React Native, single codebase for both platforms) that replicates
every feature of https://dashboard.roam-in-heels.com/:

- PIN login (persisted securely — auto-unlocks on next launch)
- Dashboard: overall / current-month / cash-position KPI cards, all with tap-to-drill bottom sheets
  (revenue matrix, expense buckets & categories, recurring checklist, bank-balance monthly cash table)
- Pending Payments panel with multi-select "mark as paid"
- Check-ins Today / Upcoming
- Daily Earnings (stacked bar) and Cumulative Bank Balance (line) charts
- Revenue by Channel, Income by Booking Type, Expenses, Monthly P&L (every cell drills down,
  including the Total row), Repeat Customers by Month, Recent Bookings
- Property filter + range filter (all / 7 / 30 / custom dates)
- Add / edit / delete Bookings (all 24 fields, auto-commission = Guest Paid − Net, Pass→channel sync)
- Add / edit / delete Expenses (Deposit→Refundable sync, initial-investment flag)
- Booking & Expense Logs: global search, per-column filters, 50-row pagination, tap a row to edit
- Properties: list, add, edit

It talks to the same Google Apps Script JSON API as the website (`src/api.ts`) — no backend changes.
The web app uses JSONP for CORS; the app uses plain `fetch` (no CORS on native).

## Run it on your phone (no build needed)

```bash
cd ~/spira-tracker-app/mobile
npx expo start
```

- **Android**: install "Expo Go" from the Play Store, scan the QR code from the terminal.
- **iPhone**: install "Expo Go" from the App Store, scan the QR with the Camera app.

Phone and Mac must be on the same Wi-Fi (or run `npx expo start --tunnel`).

## Build installable binaries (EAS)

```bash
npm i -g eas-cli
eas login                       # free Expo account
eas build:configure
eas build -p android --profile preview   # → .apk you can sideload / share
eas build -p android                     # → .aab for Play Store
eas build -p ios                         # → needs an Apple Developer account ($99/yr)
```

## Code map

- `App.tsx` — shell: header, bottom tabs, auth gate
- `src/api.ts` — Apps Script API client (all 13 actions)
- `src/store.tsx` — session/PIN, data loading, edit-mode state
- `src/logic.ts` — client-side analytics ported 1:1 from the website
  (cash position, check-ins, pending payouts, repeat customers, month drills)
- `src/screens/` — Login, Dashboard, BookingForm, ExpenseForm, LogsScreen, Properties
- `src/charts.tsx` — SVG charts; `src/ui.tsx` + `src/fields.tsx` — shared components
- `src/theme.ts` — the website's "Teal & Ink" palette
