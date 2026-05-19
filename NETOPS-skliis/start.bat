@echo off
chcp 65001 >nul
title NetOps 开发环境启动脚本

echo ========================================
echo      NetOps 网络运维平台 - 启动中...
echo ========================================
echo.

REM ---------- 启动后端 (port 3001) ----------
echo [1/2] 启动后端服务 (http://localhost:3001)...
echo.
start "NetOps-Backend" cmd /c "cd /d %~dp0\server && npm run dev"

REM 等待后端启动
echo 等待后端启动 (5秒)...
ping -n 5 127.0.0.1 >nul

REM ---------- 启动前端 (port 5173) ----------
echo [2/2] 启动前端服务 (http://localhost:5173)...
echo.
start "NetOps-Frontend" cmd /c "cd /d %~dp0\frontend && npm run dev"

echo.
echo ========================================
echo  后端: http://localhost:3001
echo  前端: http://localhost:5173
echo  API:  http://localhost:3001/api
echo  WebSocket: ws://localhost:3001/ws
echo  FastAPI(Python): http://127.0.0.1:3002
echo ========================================
echo  提示: AI 功能需要配置 .env 文件
echo        AI_BASE_URL / AI_API_KEY / AI_MODEL
echo ========================================
echo.
echo 按任意键关闭所有服务...
pause >nul

REM 关闭进程
echo 正在关闭服务...
taskkill /f /fi "WINDOWTITLE eq NetOps-Backend" >nul 2>&1
taskkill /f /fi "WINDOWTITLE eq NetOps-Frontend" >nul 2>&1
taskkill /f /im node.exe >nul 2>&1
echo 服务已关闭。
