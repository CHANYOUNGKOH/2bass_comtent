@echo off
chcp 65001 >nul
echo ━━━ 투베이스 콘텐츠 시스템 업데이트 ━━━
echo.
git pull origin main
if errorlevel 1 (
    echo.
    echo [오류] 업데이트 실패. 인터넷 연결을 확인하세요.
    pause
    exit /b 1
)
echo.
echo 패키지 의존성 확인 중...
call npm install --omit=dev
echo.
echo 업데이트 완료!
pause
