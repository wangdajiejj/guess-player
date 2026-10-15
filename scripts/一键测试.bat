@echo off
rem NOTE: this file must stay PURE ASCII, and be saved as GBK.
rem       cmd reads .bat bytes with the active code page; Chinese here
rem       would be mojibake. Chinese output comes from the node scripts.
rem
rem WARNING: never echo a bare ">>>" here. In cmd ">" is a redirect, so
rem       "echo ^^^>>> OK" silently creates a file named OK in the repo root
rem       instead of printing the marker (that is where the stray OK / FAILED
rem       files came from). Use [ OK ] / [FAIL] -- no shell metacharacters.
chcp 65001 >nul
cd /d "%~dp0\.."
title guess-player test

set NODE=C:\Users\wang\.workbuddy\binaries\node\versions\22.22.2-6\node.exe
set PY=C:\Users\wang\.workbuddy\binaries\python\envs\default\Scripts\python.exe
set FAILED=0

echo ============================================================
echo   [1/9] compare unit test
echo ============================================================
"%NODE%" scripts\test-compare.js
if errorlevel 1 (echo   [FAIL] & set FAILED=1) else (echo   [ OK ])

echo.
echo ============================================================
echo   [2/9] cloud function end-to-end test
echo ============================================================
"%NODE%" scripts\test-flow.js
if errorlevel 1 (echo   [FAIL] & set FAILED=1) else (echo   [ OK ])

echo.
echo ============================================================
echo   [3/9] search hit test
echo ============================================================
"%NODE%" scripts\test-search.js
if errorlevel 1 (echo   [FAIL] & set FAILED=1) else (echo   [ OK ])

echo.
echo ============================================================
echo   [4/9] clue filter test (tap a chip to narrow candidates)
echo ============================================================
"%NODE%" scripts\test-candidates.js
if errorlevel 1 (echo   [FAIL] & set FAILED=1) else (echo   [ OK ])

echo.
echo ============================================================
echo   [5/9] sound effect test
echo ============================================================
"%NODE%" scripts\test-sfx.js
if errorlevel 1 (echo   [FAIL] & set FAILED=1) else (echo   [ OK ])

echo.
echo ============================================================
echo   [6/9] leaderboard scoring test
echo ============================================================
"%NODE%" scripts\test-rank.js
if errorlevel 1 (echo   [FAIL] & set FAILED=1) else (echo   [ OK ])

echo.
echo ============================================================
echo   [7/9] miniprogram static check
echo ============================================================
"%NODE%" scripts\check-mp.js
if errorlevel 1 (echo   [FAIL] & set FAILED=1) else (echo   [ OK ])

echo.
echo ============================================================
echo   [8/9] playability simulation
echo ============================================================
"%NODE%" scripts\simulate.js
if errorlevel 1 (echo   [FAIL] & set FAILED=1) else (echo   [ OK ])

echo.
echo ============================================================
echo   [9/9] players data validation
echo ============================================================
"%PY%" database\validate.py database\players.full.jsonl 2026-10-11 --fix
if errorlevel 1 (echo   [FAIL] & set FAILED=1) else (echo   [ OK ])

echo.
echo ============================================================
if "%FAILED%"=="1" (echo   RESULT: SOME TESTS FAILED) else (echo   RESULT: ALL PASSED)
echo ============================================================
pause
