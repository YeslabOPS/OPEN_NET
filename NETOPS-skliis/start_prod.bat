@echo off
chcp 65001 >nul
title NetOps 生产环境启动脚本

echo ========================================
echo    NetOps 网络运维平台 - 生产模式启动
echo ========================================
echo.

REM ---------- 构建前端 ----------
echo [1/3] 构建前端项目...
echo.
cd /d %~dp0\frontend
call npm run build
if %errorlevel% neq 0 (
    echo 前端构建失败！请检查错误信息。
    pause
    exit /b 1
)
echo 前端构建完成。

REM ---------- 安装后端依赖（如需） ----------
echo.
echo [2/3] 构建后端项目...
echo.
cd /d %~dp0\server
call npm run build
if %errorlevel% neq 0 (
    echo 后端构建失败！
    pause
    exit /b 1
)
echo 后端构建完成。

REM ---------- 启动后端服务 ----------
echo.
echo [3/3] 启动生产服务 (http://localhost:3001)...
echo.
start "NetOps-Prod" cmd /c "cd /d %~dp0\server && node dist/index.js"

echo.
echo ========================================
echo  生产环境服务启动成功！
echo  访问地址: http://localhost:3001
echo ========================================
echo.
echo 按任意键关闭服务...
pause >nul

taskkill /f /fi "WINDOWTITLE eq NetOps-Prod" >nul 2>&1
echo 服务已关闭。
