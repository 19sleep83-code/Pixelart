#!/bin/bash
# Exports the Godot game for Windows and wraps it in an installer (NSIS):
#   tools/build-windows-setup.sh [version] [godot-binary]
# Needs Godot 4.7 with the Windows export templates installed, and makensis (NSIS 3).
# Result: build/Pixelfront-Setup-<version>.exe
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-1.0.0}"
GODOT="${2:-${GODOT:-godot}}"
mkdir -p "$ROOT/build/windows"
cd "$ROOT/godot"
"$GODOT" --headless --path . --import > /dev/null 2>&1 || true
"$GODOT" --headless --path . --export-release "Windows Desktop" "$ROOT/build/windows/Pixelfront.exe"
cd "$ROOT/tools/installer"
makensis -V2 -DVERSION="$VERSION" pixelfront.nsi
ls -la "$ROOT/build/Pixelfront-Setup-$VERSION.exe"
