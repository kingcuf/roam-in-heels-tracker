# Legacy dashboard (retired 19-Aug-2026)

The hand-written single-file PWA that served dashboard.roam-in-heels.com until the
site was switched to the same Expo web build the phone app runs (`../spira-app-web`,
built from `../mobile`).

Kept only as a reference for anything the new frontend has not carried across.
It is NOT deployed — leaving it inside the deploy directory would have published it
alongside the new site, because every file in that folder is served.

Its backend was already the D1 Worker, so nothing about the data changed with the
switch. To roll back, redeploy this file from the Vercel dashboard's deployment
history rather than copying it back over the export.
