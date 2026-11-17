#!/bin/bash
# Renders every sprite again (export.html via a headless browser) and unpacks it into godot/assets,
# then makes the placeholder sounds. Needs Node, Playwright with Chromium, Python 3 with NumPy.
#   tools/update-godot-assets.sh
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
cd "$ROOT"
npx vite --port 5173 --strictPort > "$TMP/vite.log" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true' EXIT
for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:5173/ && break; sleep 0.5; done
node tools/export-sprites.cjs "$TMP/sprites.zip"
python3 - "$TMP/sprites.zip" "$ROOT/godot/assets/sprites" <<'PY'
import os, shutil, sys, zipfile
src, dst = sys.argv[1], sys.argv[2]
shutil.rmtree(dst, ignore_errors=True)
z = zipfile.ZipFile(src)
for n in z.namelist():
    rel = n.split('/', 1)[1]
    if not rel or rel.endswith('/'):
        continue
    p = os.path.join(dst, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'wb') as f:
        f.write(z.read(n))
print(len(z.namelist()), 'Dateien nach', dst)
PY
python3 tools/sounds.py "$ROOT/godot/assets/sounds"
exit 0
