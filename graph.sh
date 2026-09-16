#!/usr/bin/env sh
# I-080 — 非 Windows 的同名入口：起本地小服务并在浏览器里打开想法图。
# 先切到脚本自己所在的目录，理由同 graph.cmd。
cd "$(dirname "$0")" || exit 1
exec node .companion/companion.mjs serve "$@"
