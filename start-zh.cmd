@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
where npm >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js，然后重新运行此脚本。
  pause
  exit /b 1
)
if not exist "node_modules\.bin\vite.cmd" (
  echo 首次运行：正在安装项目依赖，需要连接网络……
  call npm ci --no-audit --no-fund
  if errorlevel 1 (
    echo 依赖安装失败，请检查网络与 Node.js 版本。
    pause
    exit /b 1
  )
)
echo 正在启动中文版。保持此窗口开启；退出时按 Ctrl+C。
call npm run dev -- --host 127.0.0.1 --open "/?lang=zh-CN"
if errorlevel 1 pause
