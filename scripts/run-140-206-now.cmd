@echo off
cd /d "C:\Users\Chtat GPT\Desktop\Python\260302_Playwright_MCP"
set NAVER_ID=taekuk2bass
set NAVER_PW=c7orange123
set NAVER_BLOG_TITLE_PREFIX=????_???
set NAVER_BLOG_START_PAGE=140
set NAVER_BLOG_MAX_ITERATIONS=206
set NAVER_BLOG_PROGRESS_PATH=output/naver-blog-pdf-progress.json
set NAVER_BLOG_DOWNLOAD_DIR=output/naver-blog-pdfs
set NAVER_BLOG_USE_PERSISTENT=false
set HEADLESS=false
set SLOW_MO=80
node scripts/naver-blog-pdf-batch.js >> output\resume-140-206.log 2>&1
