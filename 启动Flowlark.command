#!/usr/bin/env bash
# macOS 上双击这个文件即可启动（.command 后缀会用「终端」打开）。
# 首次双击若提示「无法打开，因为它来自身份不明的开发者」，
# 右键 → 打开，或执行：xattr -d com.apple.quarantine "启动Flowlark.command"
cd "$(dirname "${BASH_SOURCE[0]}")"
exec ./start.sh "$@"
