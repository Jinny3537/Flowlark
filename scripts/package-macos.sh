#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 2 ]]; then echo "用法：scripts/package-macos.sh <node-binary> <output-dir>" >&2; exit 2; fi
NODE_BINARY="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
NODE_PREFIX="$(cd "$(dirname "$NODE_BINARY")/.." && pwd)"
OUTPUT_DIR="$(mkdir -p "$2" && cd "$2" && pwd)"
APP="$OUTPUT_DIR/Flowlark.app"
if [[ -e "$APP" ]]; then echo "输出已存在：$APP" >&2; exit 1; fi
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/runtime" "$APP/Contents/Resources/app"
cp packaging/macos/Info.plist "$APP/Contents/Info.plist"
cp packaging/macos/flowlark-launcher "$APP/Contents/MacOS/flowlark-launcher"
cp "$NODE_BINARY" "$APP/Contents/Resources/runtime/node"
if [[ -d "$NODE_PREFIX/lib" ]]; then
  mkdir -p "$APP/Contents/Resources/lib"
  find "$NODE_PREFIX/lib" -maxdepth 1 -type f -name 'libnode*.dylib' -exec cp {} "$APP/Contents/Resources/lib/" \;
fi
if [[ -d "$NODE_PREFIX/Cellar" ]]; then
  mkdir -p "$APP/Contents/Resources/lib"
  find "$NODE_PREFIX/Cellar" -type f -path '*/lib/libnode*.dylib' -exec cp {} "$APP/Contents/Resources/lib/" \;
fi
cp -R bin src scripts web package.json README.md CHANGELOG.md LICENSE docs "$APP/Contents/Resources/app/"
chmod +x "$APP/Contents/MacOS/flowlark-launcher" "$APP/Contents/Resources/runtime/node"
echo "$APP"
