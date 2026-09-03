#!/bin/sh
# 在浏览器里打开这个项目的想法图。改完点提交，改动直接写回 ideas/ 里的图。
#
# 和 graph.cmd 一样，先切到脚本自己所在的目录：从别处调用时工作目录是不确定的，
# 少了这一句下面的相对路径就全错。
cd "$(dirname "$0")" || exit 1
exec npx tsx claude-companion/ideas.ts serve "$@"
