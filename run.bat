@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Flow Reference Studio

rem Tham so tuy chon: --no-build, --no-open
rem Bien moi truong tuy chon: FRS_BRIDGE_DIR = thu muc FlowAutoTool, FRS_PYTHON = duong dan python, FRS_PORT = cong Workbench

where node >nul 2>nul
if errorlevel 1 goto no_node

if exist "node_modules\esbuild" goto launch
echo [CAI DAT] Chua co node_modules, dang cai dat thu vien...
where pnpm >nul 2>nul
if errorlevel 1 goto install_corepack
call pnpm install
goto check_install
:install_corepack
call corepack pnpm install
:check_install
rem pnpm co the tra ve ma loi do ERR_PNPM_IGNORED_BUILDS du da cai xong, nen chi kiem tra thu muc.
if not exist "node_modules\esbuild" goto install_failed

:launch
node scripts\start.mjs %*
set "CODE=%errorlevel%"
if not "%CODE%"=="0" (
    echo.
    echo Launcher dung voi ma loi %CODE%. Xem thong bao phia tren.
    pause
)
exit /b %CODE%

:no_node
echo [LOI] Khong tim thay Node.js trong PATH. Cai Node.js 22 tro len: https://nodejs.org
pause
exit /b 1

:install_failed
echo [LOI] Cai dat thu vien that bai. Hay cai pnpm ^(npm install -g pnpm^) roi chay "pnpm install" trong thu muc nay.
pause
exit /b 1
