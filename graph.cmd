@echo off
rem I-080 — 双击这个文件：起本地小服务并在浏览器里打开想法图。
rem 先切到脚本自己所在的目录：双击时的工作目录不确定，少了这一句相对路径全错。
cd /d "%~dp0"
node ".companion\companion.mjs" serve %*
