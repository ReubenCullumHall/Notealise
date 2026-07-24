@echo off
rem ===========================================================================
rem  Notes - run the reference app (the localhost:5173 look) on this PC.
rem  Double-click this file, or run it from a terminal. It starts a local live
rem  server and opens the app in your browser. Close this window to stop it.
rem
rem  Runs through cmd.exe + npm.cmd, so it is NOT affected by the PowerShell
rem  "running scripts is disabled" error, and needs no admin rights.
rem ===========================================================================
setlocal
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;%PATH%"

echo.
echo   Starting Notes at http://localhost:5173/
echo   Your browser will open automatically. Keep this window open while you use it;
echo   close it (or press Ctrl+C) to stop the app.
echo.

call npm.cmd run dev:legacy -- --open

echo.
echo   The server has stopped. You can close this window.
pause
