@echo off
chcp 65001 >nul
rem ===================================================================
rem  KEEP THIS FILE PURE ASCII.  See the note in the other .bat.
rem  Double-click this one BEFORE submitting the mini program.
rem ===================================================================
cd /d "%~dp0\.."
title guess-player - switch back to PRODUCTION (do this before review)

set NODE=C:\Users\wang\.workbuddy\binaries\node\versions\22.22.2-6\node.exe
if not exist "%NODE%" set NODE=node

echo ============================================================
echo   Switch back to PRODUCTION / cloud mode
echo     - strips every MOCK-BEGIN ... MOCK-END block
echo     - deletes miniprogram/utils/mock-*.js
echo ============================================================
echo.

"%NODE%" scripts\toggle-mock.js off
if errorlevel 1 goto fail

echo.
echo ============================================================
echo   Static check (must be all green)
echo ============================================================
echo.

"%NODE%" scripts\check-mp.js
if errorlevel 1 goto fail

echo.
echo ============================================================
echo   DONE.  The package is clean and safe to upload.
echo.
echo   Two things left before uploading:
echo     1) miniprogram\app.js - set ENV_ID to your own cloud env id
echo     2) make sure cloud collections + data are imported
echo ============================================================
pause
exit /b 0

:fail
echo.
echo   *** FAILED - read the messages above ***
pause
exit /b 1
