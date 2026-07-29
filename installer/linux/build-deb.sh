#!/bin/bash
# Packages the pkg-built Linux binary as a .deb using fpm.
# fpm ships as a Ruby gem: `gem install --no-document fpm` on ubuntu-latest.
#
# Usage: build-deb.sh <version> <path-to-pkg-binary> <output-deb-path>
set -euo pipefail

VERSION="$1"
BINARY="$2"
OUT_DEB="$3"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
STAGE_DIR="$(mktemp -d)"

mkdir -p "$STAGE_DIR/usr/bin"
cp "$BINARY" "$STAGE_DIR/usr/bin/summer-classic"
chmod +x "$STAGE_DIR/usr/bin/summer-classic"

mkdir -p "$STAGE_DIR/usr/share/applications"
cp "$SCRIPT_DIR/summer-classic.desktop" "$STAGE_DIR/usr/share/applications/"

mkdir -p "$STAGE_DIR/usr/share/icons/hicolor/256x256/apps"
cp "$REPO_ROOT/public/shared/logo.png" "$STAGE_DIR/usr/share/icons/hicolor/256x256/apps/summer-classic.png"

mkdir -p "$(dirname "$OUT_DEB")"
fpm -s dir -t deb \
  -n summer-classic \
  -v "$VERSION" \
  --description "Lumber Jill's Summer Classic operator toolkit" \
  --url "https://github.com/thejoshbq/summer-classic" \
  --license "Proprietary" \
  -C "$STAGE_DIR" \
  -p "$OUT_DEB" \
  usr

rm -rf "$STAGE_DIR"
