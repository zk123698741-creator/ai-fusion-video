@echo off
chcp 65001 >nul
cd /d "%~dp0"
"runtime\node\node.exe" "windows\control.mjs" stop
if errorlevel 1 pause
