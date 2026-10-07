@echo off
chcp 936 >nul
setlocal enabledelayedexpansion
title 一键推送 FileView 到仓库

REM ============================================================
REM  使用方法：修改下面的仓库地址，双击运行即可（两个都会推送）
REM  不想推某个仓库就把对应地址清空
REM ============================================================
set "REPO_URL=https://gitee.com/huyihong/fileview.git"
set "REPO_URL2=https://github.com/OnlyHiu/FileView.git"
REM ============================================================

cd /d "%~dp0"

if "%REPO_URL%%REPO_URL2%"=="" (
    echo [错误] 请先用记事本打开本脚本，填写至少一个仓库地址。
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

if not "%REPO_URL%"=="" (
    git remote get-url origin >nul 2>&1
    if errorlevel 1 (
        git remote add origin "%REPO_URL%"
    ) else (
        git remote set-url origin "%REPO_URL%"
    )
)
if not "%REPO_URL2%"=="" (
    git remote get-url github >nul 2>&1
    if errorlevel 1 (
        git remote add github "%REPO_URL2%"
    ) else (
        git remote set-url github "%REPO_URL2%"
    )
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

echo [4/4] 推送...
set "FAILED="
if not "%REPO_URL%"=="" (
    call :push_one origin
    if errorlevel 1 set "FAILED=1"
)
if not "%REPO_URL2%"=="" (
    call :push_one github
    if errorlevel 1 set "FAILED=1"
)

echo.
if defined FAILED (
    echo [结束] 部分仓库推送失败，详见上方提示。
) else (
    echo [完成] 全部仓库推送成功。
)
pause
exit /b 0

REM ---------- 子过程：推送单个远程（被拒时自动同步后重试） ----------
:push_one
set "RMT=%~1"
echo       推送到 %RMT% ...
git push -u %RMT% main
if not errorlevel 1 exit /b 0
echo       %RMT% 被拒，自动同步远程后重试...
git pull --rebase %RMT% main
if errorlevel 1 (
    git rebase --abort >nul 2>&1
    echo       [推送失败] %RMT%：自动同步失败。若本地与远程冲突请手动 git pull --rebase；
    echo       或检查登录凭证（Token / SSH 密钥）与网络。
    exit /b 1
)
git push -u %RMT% main
if errorlevel 1 (
    echo       [推送失败] %RMT%：同步后仍无法推送，请检查凭证 / 网络。
    exit /b 1
)
exit /b 0
