@echo off
chcp 936 >nul
setlocal enabledelayedexpansion
title 一键推送 FileView 到仓库

REM ============================================================
REM  使用方法：把下面的 REPO_URL 改成你的仓库地址，双击运行即可
REM  例：set "REPO_URL=https://github.com/用户名/仓库名.git"
REM ============================================================
set "REPO_URL=https://gitee.com/huyihong/fileview.git"

cd /d "%~dp0"

if "%REPO_URL%"=="" (
    echo [错误] 请先用记事本打开本脚本，填写 REPO_URL 仓库地址。
    pause
    exit /b 1
)

where git >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到 Git，请先安装 https://git-scm.com/downloads
    pause
    exit /b 1
)

if not exist ".git" (
    echo [1/4] 初始化 Git 仓库...
    git init -b main
) else (
    echo [1/4] 已存在 Git 仓库
)

git remote get-url origin >nul 2>&1
if errorlevel 1 (
    git remote add origin "%REPO_URL%"
) else (
    git remote set-url origin "%REPO_URL%"
)

echo [2/4] 暂存全部变更...
git add -A

echo [3/4] 提交...
git diff --cached --quiet
if not errorlevel 1 (
    echo       没有新变更，跳过提交
) else (
    for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm-ss"') do set "TS=%%i"
    git commit -m "update !TS!"
)

echo [4/4] 推送到 origin/main ...
git push -u origin main
if errorlevel 1 (
    echo.
    echo [推送失败] 常见原因：
    echo   1. 远程仓库已有内容如 README：先执行 git pull --rebase origin main 再重跑本脚本
    echo   2. 未登录凭证：GitHub/Gitee 请配置 Personal Access Token 或 SSH 密钥
    echo   3. 仓库地址错误或无推送权限
) else (
    echo.
    echo [完成] 已成功推送到 %REPO_URL%
)

echo.
pause
