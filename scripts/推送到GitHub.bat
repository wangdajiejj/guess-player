@echo off
rem NOTE: this file must stay PURE ASCII, and be saved as GBK.
rem       cmd reads .bat bytes with the active code page; Chinese here
rem       would be mojibake. All Chinese output comes from the node script.
chcp 65001 >nul
cd /d "%~dp0\.."
title guess-player push to github

set NODE=C:\Users\wang\.workbuddy\binaries\node\versions\22.22.2-6\node.exe

echo ============================================================
echo   push guess-player to GitHub
echo ============================================================

"%NODE%" scripts\push-github.js
if errorlevel 1 (echo   [FAIL]) else (echo   [DONE])

pause
