@echo off
chcp 65001 >nul
setlocal
set "ROOT=%~dp0"
set "BRIDGE_DIR=E:\Antigravity Project\Tools New\FlowAutoTool"

where python >nul 2>nul || (echo [LOI] Khong tim thay python trong PATH. & pause & exit /b 1)
where node >nul 2>nul || (echo [LOI] Khong tim thay node trong PATH. & pause & exit /b 1)
where ffmpeg >nul 2>nul || (
    echo [THONG BAO] Chua thay ffmpeg trong PATH. He thong se tu tim ffmpeg tai duong dan WinGet cho tinh nang Animation Video.
)

echo [1/3] Build Workbench...
pushd "%ROOT%"
call pnpm build:extension
if errorlevel 1 (echo [LOI] Build that bai. & popd & pause & exit /b 1)

echo [2/3] Khoi dong Python Bridge Server (cua so rieng, giu nguyen khi loi)...
start "Flow Bridge Server" /D "%BRIDGE_DIR%" cmd /k python bridge_server.py

echo [3/3] Khoi dong Workbench tai http://127.0.0.1:5173/workbench.html
start "Workbench Server" /D "%ROOT%" cmd /k node scripts\serve.mjs
timeout /t 2 >nul
start "" "http://127.0.0.1:5173/workbench.html"
popd
echo.
echo Da khoi dong xong Flow Reference Studio!
echo Hay chac chan FlowKit extension da nap trong Chrome va tab flow.google.com da dang nhap.
pause
