@echo off
chcp 65001 >nul
echo ━━━ 투베이스 콘텐츠 시스템 초기 설정 ━━━
echo.
echo [1/3] 패키지 설치 중...
call npm install --omit=dev
echo.
echo [2/3] 환경 설정 파일 생성...
if not exist env.config (
    copy env.config.example env.config
    echo    env.config 생성됨 - 메모장으로 열어 API 키를 입력하세요
) else (
    echo    env.config 이미 존재 - 스킵
)
echo.
echo [3/3] 데이터 폴더 생성...
if not exist data\ssot\objects mkdir data\ssot\objects
if not exist data\ssot-posts mkdir data\ssot-posts
if not exist data\publish\naver-v2-html mkdir data\publish\naver-v2-html
if not exist data\publish\naver-v2 mkdir data\publish\naver-v2
if not exist data\content mkdir data\content
if not exist data\work\inbox mkdir data\work\inbox
if not exist data\work\queue mkdir data\work\queue
if not exist output\images mkdir output\images
echo.
echo 초기 설정 완료!
echo.
echo 다음 단계:
echo   1. env.config 에 API 키 입력
echo   2. 전달받은 data.zip 압축 해제 → data\ 폴더에 덮어쓰기
echo   3. 전달받은 output.zip 압축 해제 → output\ 폴더에 덮어쓰기
echo   4. start-dashboard.bat 으로 대시보드 시작
echo.
pause
