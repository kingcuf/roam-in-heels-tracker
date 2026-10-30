# Roam in Heels — PnL tracker

The books for a small set of short-stay homes: bookings, expenses, savings,
inventory and guest ID documents, with a daily P&L and the queues that say what
needs doing today. One codebase runs the web dashboard
(`dashboard.roam-in-heels.com`) and the iOS/Android app.

The public website that guests see is a separate repository:
[roam-in-heels](https://github.com/kingcuf/roam-in-heels).

## Layout

| Path | What |
|---|---|
| `mobile/` | the app — Expo (SDK 58) + React Native, built for iOS, Android and web |
| `worker/` | the API — a Cloudflare Worker on D1 (SQLite) and R2, with its migrations |
| `spira-tracker/`, `spira-app-web/` | the two Vercel deploy targets; `./sync-web.sh` stages the web export into them |
| `gas/`, `gas-mirror/`, `*.gs` | the Google Apps Script the Worker replaced, plus the one-way Sheets mirror it still feeds |
| `scripts/ux-loop/` | the UX measurement scripts — scripted browser runs used to compare a screen before and after a change |
| `vercel/`, `spira-tracker-legacy/` | the static dashboard that predates the Expo build |

## Running it

```bash
cd mobile && npm install --legacy-peer-deps && npx expo start   # app
cd worker && npm install && npx wrangler dev                    # API
```

The Worker needs `PIN`, `ENQUIRY_KEY`, `MIRROR_URL` and `MIRROR_SECRET` as
secrets (`npx wrangler secret put …`), a D1 database bound as `DB` and an R2
bucket bound as `FILES`. Locally they go in `worker/.dev.vars`, which is not
published.

## What is not in here

No credentials and no production data. The sign-in PIN, the database dumps
under `backups/`, the generated seed migration and the live API snapshots are
all deliberately untracked — see `.gitignore`. Scripts that need to sign in
read `PIN` from the environment.

Guest ID documents live in a private R2 bucket, are streamed only through the
Worker behind the PIN check, and are deleted six months after check-out.
