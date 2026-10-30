# Spira Tracker API — Cloudflare Workers + D1

Replaces the Google Apps Script web app (`gas/Code.js`) with a Worker backed by
D1 (serverless SQLite). The Google Sheets become a **read-only mirror**.

The wire contract is unchanged, so `spira-tracker/index.html` and the Expo app
in `mobile/` need nothing but a new API URL.

## Why this shape

- **D1 over Postgres** — D1 speaks HTTP, so there is no connection pool to size
  or exhaust from a serverless runtime, and no cold TCP handshake per request.
- **`row` is now a primary key**, not a spreadsheet row number. Clients
  round-trip it opaquely, so nothing changed for them — but deleting a row no
  longer shifts every id below it, which was the sheet's sharpest edge.
- **Computed columns are SQL, not ARRAYFORMULAs.** `In Stock`, `Pending`,
  `Low Stock`, `Item Key`, `Total Cost` and `Signed Qty` used to be formulas
  pinned to row 2 of the IMS workbook, which forced the old script to skip
  columns F/H/I/K on write and to *clear* rather than delete row 2. That whole
  constraint is gone.
- **The PIN is a secret**, not a literal in source as it was before.

## Layout

| Path | What |
|---|---|
| `src/index.js` | the API — all 23 actions, JSON + JSONP |
| `src/mirror.js` | cron job: pushes a D1 snapshot to the Sheets |
| `migrations/0001_init.sql` | schema |
| `migrations/0002_seed.sql` | generated import of the live sheet data |
| `scripts/build-seed.mjs` | regenerates the seed from the JSON snapshots |
| `scripts/parity-check.mjs` | deep-diffs every read endpoint vs the old API |
| `scripts/write-tests.mjs` | 55 assertions over every mutating action |
| `src/auth.js` | users, roles, rights catalog, per-action rights map |
| `src/tickets.js` | change-approval tickets (raise / approve / send back / withdraw) |
| `migrations/0005_users_rights_tickets.sql` | `roles`, `users`, `tickets` tables |
| `scripts/rbac-tests.mjs` | 72 assertions over sign-in, rights and the approval flow |

## Users, rights and approvals

- Every request carries `user` + `pin`. A **blank user (or `owner`) with the
  `PIN` secret is the built-in owner** — role Admin, not stored — so older
  clients and a lost-admin situation still have a way in.
- Roles are fixed (**Admin, Manager, Viewer**); what each may do is the
  `roles.rights` JSON array, edited on the app's Team ▸ Rights screen. Admin
  always holds every right. The router checks `ACTION_RIGHTS` before any
  handler runs and refuses actions it does not know (fails closed).
- **Adds apply directly** (with the add right). **Updates and deletes by
  anyone but an Admin become tickets** routed to the user's manager (or any
  Admin). They are validated at request time, applied on approval through the
  same handler an Admin edit uses, and a send-back needs a comment; the
  requester's next edit of that record reuses the ticket (status back to
  `pending`). Tickets flag `stale` if the record changed after they were raised.
| `../gas/Mirror.gs` | Apps Script receiver for the mirror |

## Local development

```bash
npm install
echo 'PIN=2468' > .dev.vars            # local-only, gitignored

npx wrangler d1 execute spira --local --file=migrations/0001_init.sql
npx wrangler d1 execute spira --local --file=migrations/0002_seed.sql

npx wrangler dev --port 8799 --local
```

Then, in a second shell:

```bash
node scripts/parity-check.mjs   # vs the live Apps Script — expects "All endpoints match."
node scripts/write-tests.mjs    # local only; refuses to run against a remote API
node scripts/rbac-tests.mjs     # local only; needs migrations/0005 applied locally
```

`parity-check` compares against the still-running Apps Script, so it only works
while the old deployment is alive. Run it before decommissioning that.

## Deploying

Steps 1 and 2 need a browser and are yours to run.

```bash
# 1. authenticate (opens a browser; use your PERSONAL Cloudflare account —
#    this is personal data, and later, guest ID documents)
npx wrangler login

# 2. create the database, then paste the printed database_id into wrangler.toml
npx wrangler d1 create spira

# 3. schema + data into the real database
npx wrangler d1 execute spira --remote --file=migrations/0001_init.sql
npx wrangler d1 execute spira --remote --file=migrations/0002_seed.sql

# 4. secrets
npx wrangler secret put PIN            # the passcode (was hardcoded as 2468)

# 5. ship
npx wrangler deploy
```

`wrangler deploy` prints the URL — `https://spira-api.<subdomain>.workers.dev`.

Verify against production before cutting the clients over:

```bash
curl "https://spira-api.<subdomain>.workers.dev/?action=login&pin=<PIN>"
NEW_API="https://spira-api.<subdomain>.workers.dev/" PIN=<PIN> node scripts/parity-check.mjs
```

## Cutting the clients over

Both clients hold the URL in one place, and both also expose it as a setting, so
you can switch a single device first and roll back by pasting the old URL.

- `spira-tracker/index.html` → `var API_URL = '…'` (~line 535)
- `mobile/src/api.ts` → `DEFAULT_API_URL` (~line 3)

## The sheet mirror

The DB is the source of truth. A cron trigger (06:00 IST daily, set in
`wrangler.toml`) pushes a full snapshot into the spreadsheets.

**One-way.** Anything typed into a mirrored tab by hand is overwritten on the
next run — the sheet is a window now, not an input surface. The receiver stamps
that warning into cell A1 of the README tab on every run.

Setup:

1. Add `gas/Mirror.gs` to an Apps Script project bound to neither workbook (it
   opens both by id). Deploy it as a web app, *Execute as: Me*, *Who has access:
   Anyone*.
2. In that project: **Project Settings ▸ Script Properties ▸** add
   `MIRROR_SECRET` with a long random value.
3. Point the Worker at it:
   ```bash
   npx wrangler secret put MIRROR_URL      # the /exec URL from step 1
   npx wrangler secret put MIRROR_SECRET   # same value as step 2
   ```
4. Force a run without waiting for cron:
   ```bash
   curl "https://spira-api.<subdomain>.workers.dev/?action=mirrorNow&pin=<PIN>"
   ```

"Who has access: Anyone" means the URL alone would otherwise let anybody
overwrite your sheets — hence the shared secret. Treat `MIRROR_URL` as
sensitive too.

Only the non-formula columns of the IMS workbook are written (`Item Master`
A–E/G/J/L–N, `Stock Log` A–E/G–I), so its ARRAYFORMULAs survive each run.

## Attachments (R2) — designed, not yet wired

The `attachments` table exists so the schema is stable, but no upload route is
built yet. The intended shape:

- Files go to the private R2 bucket bound as `FILES`; only the object key is
  stored in D1.
- Downloads are proxied through the Worker behind the same PIN check — the
  bucket is never public, so an ID document is never on a guessable URL.
- For Aadhaar specifically, prefer storing a **masked** copy (last 4 digits)
  unless the full document is genuinely required; full Aadhaar numbers carry
  real handling obligations under the Aadhaar Act.

## Rolling back

The old Apps Script deployment is untouched and still points at the sheets.
Until the mirror's first run overwrites them, the sheets are exactly as they
were, so reverting is just pasting the old `/exec` URL back into the two
clients. Keep the old deployment alive until you're satisfied.
