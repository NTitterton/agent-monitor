#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
APP_DIR="$ROOT_DIR/dist/Agent Monitor.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"

mkdir -p "$MACOS_DIR"
cp "$ROOT_DIR/desktop/macos/Info.plist" "$CONTENTS_DIR/Info.plist"

swiftc \
  "$ROOT_DIR/desktop/macos/AgentMonitor.swift" \
  -o "$MACOS_DIR/AgentMonitor" \
  -framework Cocoa \
  -framework WebKit

printf 'APPL????' > "$CONTENTS_DIR/PkgInfo"
echo "Built $APP_DIR"
