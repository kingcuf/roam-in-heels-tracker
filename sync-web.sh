#!/usr/bin/env bash
# Build the Expo web export and stage it into both web deploy targets.
#
#   ./sync-web.sh            build + stage
#   ./sync-web.sh --deploy   build + stage + vercel --prod for both
#
# Why a script: `expo export` REGENERATES index.html every time, so the PWA tags
# that make dashboard.roam-in-heels.com installable (manifest, icons, iOS status
# bar) are wiped on every build. Patching them by hand works exactly once and is
# then silently lost on the next deploy — the kind of regression nobody notices
# until an installed home-screen app stops looking like an app.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT/mobile"

echo "→ building web export"
npx expo export --platform web --clear >/dev/null

# The PWA head tags, injected after <title>. Icons and site.webmanifest live in
# the deploy dirs (they are not part of the Expo export) and are left in place.
read -r -d '' PWA <<'HTML' || true
    <meta name="theme-color" content="#111114" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="apple-mobile-web-app-title" content="Roam in Heels" />
    <link rel="icon" type="image/png" sizes="64x64" href="/favicon.png?v=heels" />
    <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png?v=heels" />
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=heels" />
    <link rel="manifest" href="/site.webmanifest?v=heels" />
HTML

stage() {
  local dest="$1"
  echo "→ staging into ${dest##*/}"
  rm -rf "$dest/_expo" "$dest/assets" "$dest/index.html" "$dest/favicon.ico" "$dest/metadata.json"
  cp -R dist/_expo dist/assets dist/index.html dist/favicon.ico dist/metadata.json "$dest/"

  # Vercel refuses to publish ANY file under a directory called node_modules, and
  # that is exactly where Expo puts the bundled Manrope faces
  # (assets/node_modules/@expo-google-fonts/...). Deployed as-is every font 404s
  # and the app hangs on its loading spinner, because useFonts never resolves.
  # Staging them under assets/nm and letting vercel.json rewrite the requests is
  # the fix; it must happen on every sync, not once.
  if [ -d "$dest/assets/node_modules" ]; then
    mkdir -p "$dest/assets/nm"
    cp -R "$dest/assets/node_modules/." "$dest/assets/nm/"
    rm -rf "$dest/assets/node_modules"
    echo "   fonts staged to assets/nm"
  fi
  # Only where the icons actually exist — spira-app-web has no PWA assets.
  if [ -f "$dest/site.webmanifest" ]; then
    PWA="$PWA" python3 - "$dest/index.html" <<'PY'
import os, sys
p = sys.argv[1]
html = open(p).read()
tag = '<title>Roam in Heels</title>'
if tag in html and 'site.webmanifest' not in html:
    html = html.replace(tag, tag + '\n' + os.environ['PWA'])
    open(p, 'w').write(html)
    print('   injected PWA tags')
PY
  fi
}

stage "$ROOT/spira-app-web"
stage "$ROOT/spira-tracker"

if [ "${1:-}" = "--deploy" ]; then
  for d in spira-app-web spira-tracker; do
    echo "→ deploying $d"
    (cd "$ROOT/$d" && npx vercel --prod --yes >/dev/null 2>&1 && echo "   done")
  done
fi

echo "✓ web export staged$([ "${1:-}" = "--deploy" ] && echo " and deployed")"
