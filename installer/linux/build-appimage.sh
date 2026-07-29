#!/bin/bash
# Packages the pkg-built Linux binary as a distro-agnostic AppImage.
# Requires `appimagetool` on PATH (CI downloads it as a separate step).
#
# Usage: build-appimage.sh <path-to-pkg-binary> <output-appimage-path>
set -euo pipefail

BINARY="$1"
OUT_APPIMAGE="$2"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
APPDIR="$(mktemp -d)/SummerClassic.AppDir"

mkdir -p "$APPDIR/usr/bin"
cp "$BINARY" "$APPDIR/usr/bin/summer-classic"
chmod +x "$APPDIR/usr/bin/summer-classic"

cp "$SCRIPT_DIR/summer-classic.desktop" "$APPDIR/summer-classic.desktop"
cp "$REPO_ROOT/public/shared/logo.png" "$APPDIR/summer-classic.png"

cat > "$APPDIR/AppRun" <<'EOF'
#!/bin/sh
HERE="$(dirname "$(readlink -f "${0}")")"
exec "$HERE/usr/bin/summer-classic" "$@"
EOF
chmod +x "$APPDIR/AppRun"

mkdir -p "$(dirname "$OUT_APPIMAGE")"
appimagetool "$APPDIR" "$OUT_APPIMAGE"

rm -rf "$(dirname "$APPDIR")"
