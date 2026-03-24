@echo off
cd /d "%~dp0"
chcp 65001 >nul 2>&1
title 투베이스 블로그 생성

:: 포터블 Node.js 우선 → 시스템 → 에러
if exist "node\node.exe" (
    set "PATH=%~dp0node;%PATH%"
    goto :node_ready
)
where node >nul 2>&1
if not errorlevel 1 goto :node_ready
echo [오류] Node.js가 설치되지 않았습니다.
echo   https://nodejs.org/ 에서 설치하세요.
pause
exit /b 1
:node_ready

echo ━━━ 투베이스 블로그 콘텐츠 생성 ━━━
echo.

:: ── 키워드 캐시 상태 표시 ──
node --input-type=module -e "import{readFileSync}from'fs';try{const c=JSON.parse(readFileSync('data/work/keyword-volume-cache.json'));const d=Math.floor((Date.now()-new Date(c.meta.updatedAt))/864e5);const w=d>30?' !! 30일 초과 - 갱신 필요':'';console.log('[키워드 캐시] '+c.meta.updatedAt.slice(0,10)+' ('+d+'일 전, '+Object.keys(c.keywords).length+'개 키워드)'+w)}catch{console.log('[키워드 캐시] 없음 - 하드코딩 fallback 사용 중')}" 2>nul
echo.

:: ── 인증 방식 선택 ──
echo [1] Claude Code 구독 사용 (월정액, claude 로그인 필요)
echo [2] Anthropic API 키 사용 (종량제)
echo.
set /p AUTH_MODE="선택 (1 또는 2): "

if "%AUTH_MODE%"=="2" goto :api_auth
goto :cli_auth

:cli_auth
echo.
echo Claude Code 로그인 상태 확인 중...
claude --version >nul 2>&1
if errorlevel 1 (
    echo [오류] Claude Code가 설치되지 않았습니다.
    echo   npm install -g @anthropic-ai/claude-code
    pause
    exit /b 1
)

:: 로그인 체크 (간단한 테스트 호출)
echo 인증 테스트 중...
claude --model haiku --print "reply OK" 2>nul | findstr /i "OK" >nul
if errorlevel 1 (
    echo.
    echo Claude Code 로그인이 필요합니다.
    echo 브라우저가 열리면 로그인해주세요.
    claude auth login
    if errorlevel 1 (
        echo [오류] 로그인 실패
        pause
        exit /b 1
    )
)
echo [OK] Claude Code 인증 완료
set "ANTHROPIC_API_KEY="
goto :select_task

:api_auth
echo.
set /p API_KEY="Anthropic API Key (sk-ant-...): "
if "%API_KEY%"=="" (
    echo [오류] API 키를 입력해주세요.
    pause
    exit /b 1
)
set "ANTHROPIC_API_KEY=%API_KEY%"
echo [OK] API 키 설정 완료
goto :select_task

:select_task
echo.
echo ━━━ 작업 선택 ━━━
echo [1] 이미지 추출 (전체 미추출분)
echo [2] Blog1 미생성분 생성
echo [3] Blog2 미생성분 생성
echo [4] Blog1 + Blog2 순차 생성
echo [5] 전체 파이프라인 (이미지추출 → B1 → B2)
echo [6] 특정 포스트 생성 (postId 지정)
echo [7] 우선순위 기반 생성 (검색량 높은 순)
echo [8] 우선순위 리포트 (미발행 상위 20)
echo [9] 키워드 검색량 갱신 (네이버 API)
echo.
set /p TASK="선택: "

if "%TASK%"=="1" goto :extract_img
if "%TASK%"=="2" goto :gen_b1
if "%TASK%"=="3" goto :gen_b2
if "%TASK%"=="4" goto :gen_both
if "%TASK%"=="5" goto :full_pipeline
if "%TASK%"=="6" goto :gen_single
if "%TASK%"=="7" goto :gen_priority
if "%TASK%"=="8" goto :priority_report
if "%TASK%"=="9" goto :refresh_kv
echo 잘못된 선택
pause
exit /b 1

:extract_img
echo.
echo 이미지 추출 시작 (미추출분)...
set IMG_LIMIT=9999
node scripts/content-extract-images.js
echo.
echo 이미지 추출 완료.
goto :done

:gen_b1
echo.
echo Blog1 생성 시작 (미생성분)...
node scripts/content-generate-naver-blog.js
echo.
echo Blog1 생성 완료. HTML 재생성 중...
node scripts/naver-blog-publish-html.js
goto :done

:gen_b2
echo.
echo Blog2 생성 시작 (미생성분)...
node scripts/content-generate-naver-blog.js --blog2
echo.
echo Blog2 생성 완료. HTML 재생성 중...
node scripts/naver-blog-publish-html.js
goto :done

:gen_both
echo.
echo Blog1 생성 시작...
node scripts/content-generate-naver-blog.js
echo.
echo Blog2 생성 시작...
node scripts/content-generate-naver-blog.js --blog2
echo.
echo HTML 재생성 중...
node scripts/naver-blog-publish-html.js
goto :done

:full_pipeline
echo.
echo ━━━ 전체 파이프라인 시작 ━━━
echo.
echo [1/3] 이미지 추출 (미추출분)...
set IMG_LIMIT=9999
node scripts/content-extract-images.js
echo.
echo [2/3] Blog1 생성 (미생성분)...
node scripts/content-generate-naver-blog.js
echo.
echo [3/3] Blog2 생성 (미생성분)...
node scripts/content-generate-naver-blog.js --blog2
echo.
echo HTML 재생성 중...
node scripts/naver-blog-publish-html.js
goto :done

:gen_single
echo.
set /p POST_ID="postId 입력: "
if "%POST_ID%"=="" (
    echo [오류] postId를 입력해주세요.
    pause
    exit /b 1
)
echo %POST_ID% 이미지 추출 중...
node scripts/content-extract-images.js --postId %POST_ID%
echo %POST_ID% Blog1 생성 중...
node scripts/content-generate-naver-blog.js %POST_ID%
echo %POST_ID% Blog2 생성 중...
node scripts/content-generate-naver-blog.js %POST_ID% --blog2
echo HTML 재생성 중...
node scripts/naver-blog-publish-html.js %POST_ID%
goto :done

:gen_priority
echo.
echo 검색량 우선순위 기반 생성 (Blog1 + Blog2)...
node scripts/content-generate-naver-blog.js --prioritize
echo.
node scripts/content-generate-naver-blog.js --blog2 --prioritize
echo.
echo HTML 재생성 중...
node scripts/naver-blog-publish-html.js
goto :done

:priority_report
echo.
echo 발행 우선순위 리포트 (미발행 상위 20건)...
node scripts/content-prioritize-publish.js --top 20 --unpublished
goto :done

:refresh_kv
echo.
echo 키워드 검색량 갱신 중 (네이버 검색광고 API)...
echo.
echo 환경변수 필요: NAVER_AD_CUSTOMER_ID, NAVER_AD_API_KEY, NAVER_AD_SECRET_KEY
echo.
node scripts/naver-keyword-volume.js --scan
if errorlevel 1 (
    echo.
    echo [오류] API 키가 설정되지 않았거나 API 호출 실패
    echo   환경변수를 확인해주세요.
)
goto :done

:done
echo.
echo ━━━ 완료 ━━━
pause
