@echo off
setlocal
chcp 65001 >nul

set NAVER_ID=taekuk2bass
set NAVER_PW=c7orange123

cd /d "C:\Users\Chtat GPT\Desktop\Python\260302_Playwright_MCP"
powershell -ExecutionPolicy Bypass -File "scripts\run-naver-blog-daily.ps1" -StartPage 43 -MaxIterations 9999 -Headless true -SlowMo 50 >> "output\daily-run.log" 2>&1

endlocal
