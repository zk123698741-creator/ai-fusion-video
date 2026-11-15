@echo off
chcp 65001 >nul
cd /d "%~dp0"
if /I "%~1"=="--no-browser" goto service
set ELECTRON_RUN_AS_NODE=
start "" "%~dp0FusionVideo.exe"
exit /b %errorlevel%
:service
"runtime\node\node.exe" "windows\control.mjs" start --no-browser
if errorlevel 1 exit /b 1
exit /b 0
