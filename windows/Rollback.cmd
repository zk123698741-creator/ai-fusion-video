@echo off
chcp 65001 >nul
cd /d "%~dp0"
"runtime\node\node.exe" "windows\update.mjs" rollback
pause
