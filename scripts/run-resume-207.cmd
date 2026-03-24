@echo off
cd /d "C:\Users\Chtat GPT\Desktop\Python\260302_Playwright_MCP"
set NAVER_ID=taekuk2bass
set NAVER_PW=c7orange123
powershell -ExecutionPolicy Bypass -File "scripts\run-naver-blog-until-end.ps1" -StartPage 207 -EndPage 9999 -Headless true >> "C:\Users\Chtat GPT\Desktop\Python\260302_Playwright_MCP\output\resume-from-207.log" 2>&1
