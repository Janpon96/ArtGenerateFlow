@echo off
echo Building extension...
pnpm --filter @frs/extension build
echo Build complete. Output: apps\extension\dist
pause