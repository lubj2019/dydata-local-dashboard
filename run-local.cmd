@echo off
setlocal
set "ROOT=%~dp0"
set "NODE_HOME=%ROOT%.local-runtime\node-v22.23.1-win-x64"
if not exist "%NODE_HOME%\npm.cmd" (
  echo Local Node.js runtime not found: %NODE_HOME%
  exit /b 1
)
set "PATH=%NODE_HOME%;%PATH%"
call "%NODE_HOME%\npm.cmd" run dev
