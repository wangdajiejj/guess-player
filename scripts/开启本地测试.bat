@echo off
chcp 65001 >nul
rem ===================================================================
rem  KEEP THIS FILE PURE ASCII.
rem  cmd reads .bat bytes under the active code page, so Chinese text
rem  in here turns into mojibake after `chcp 65001`. All Chinese
rem  messages come from scripts\toggle-mock.js (Node, UTF-8) instead.
rem ===================================================================
cd /d "%~dp0\.."
title guess-player - ENABLE local test mode

set NODE=C:\Users\wang\.workbuddy\binaries\node\versions\22.22.2-6\node.exe
if not exist "%NODE%" set NODE=node

echo ============================================================
echo   STEP 1/2   switch to LOCAL TEST MODE
echo              (no cloud, no AppID, no ICP filing needed)
echo ============================================================
echo.

"%NODE%" scripts\toggle-mock.js on
if errorlevel 1 goto fail

echo.
echo ============================================================
echo   STEP 2/2   mock regression (play a whole game in node)
echo ============================================================
echo.

"%NODE%" scripts\test-mock.js
if errorlevel 1 goto fail

echo.
echo ============================================================
echo   DONE.  Local test mode is ON.
echo.
echo   Next: open WeChat DevTools and click "compile" (^<Ctrl+B^>).
echo   It should show a toast "local test mode" and you can play.
echo.
echo   The Chinese note above tells you which .bat to double-click
echo   BEFORE you submit the mini program for review.
echo ============================================================
pause
exit /b 0

:fail
echo.
echo   *** FAILED - read the messages above ***
pause
exit /b 1
