@echo off
setlocal
set "ROOT=%~dp0"
set "NODE_HOME=%ROOT%.local-runtime\node-v22.23.1-win-x64"
if exist "%NODE_HOME%\npm.cmd" (
  set "PATH=%NODE_HOME%;%PATH%"
) else (
  where npm >nul 2>nul
  if errorlevel 1 (
    echo Node.js was not found. Install the Node.js 22 LTS version, then run this file again.
    exit /b 1
  )
)
call npm run dev
