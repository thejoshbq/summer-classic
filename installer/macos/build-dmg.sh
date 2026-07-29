#!/bin/bash
# Wraps the pkg-built macOS binary in a minimal .app bundle and packages it
# as a .dmg. Run on macos-latest in CI (needs hdiutil, macOS-only).
#
# Usage: build-dmg.sh <version> <path-to-pkg-binary> <output-dmg-path>
set -euo pipefail

VERSION="$1"
BINARY="$2"
OUT_DMG="$3"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAGE_DIR="$(mktemp -d)"
APP_DIR="$STAGE_DIR/Summer Classic.app"

mkdir -p "$APP_DIR/Contents/MacOS"
cp "$BINARY" "$APP_DIR/Contents/MacOS/SummerClassic"
chmod +x "$APP_DIR/Contents/MacOS/SummerClassic"

mkdir -p "$APP_DIR/Contents/Resources"
cp "$SCRIPT_DIR/../icons/summer-classic.icns" "$APP_DIR/Contents/Resources/AppIcon.icns"

sed "s/__VERSION__/$VERSION/g" "$SCRIPT_DIR/Info.plist.template" > "$APP_DIR/Contents/Info.plist"

mkdir -p "$(dirname "$OUT_DMG")"
rm -f "$OUT_DMG"
hdiutil create -volname "Summer Classic" -srcfolder "$STAGE_DIR" -ov -format UDZO "$OUT_DMG"

rm -rf "$STAGE_DIR"
