@echo off
rem Double-click to open the editor on this project's dev server.
rem Close the editor window and the server shuts itself down.
title Retouch
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on PATH. Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)
node "%~dp0bin\retouch.mjs" %*
if errorlevel 1 pause
