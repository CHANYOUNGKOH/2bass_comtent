# Naver Blog PDF/통계 자동화 스킬 문서

## 목적
- 네이버 블로그 글 저장(PDF)과 통계 파일(xlsx) 수집을 중단 없이 반복 실행한다.
- 중단 시 빠르게 원인 확인 후 재시작한다.

## 핵심 경로
- 진행 상태: `output/naver-blog-pdf-progress.json`
- PDF 저장 폴더: `output/naver-blog-pdfs`
- PDF 루프 로그: `output/daily-run-loop.log`
- PDF 실행 로그: `output/daily-run.log`
- 통계 폴더: `output/naver-blog-analytics`
- 통계 전체 진행: `output/naver-blog-analytics-download-all-types-progress.json`

## PDF 수집 표준 실행
1. 환경변수 설정
```powershell
$env:NAVER_ID='...'
$env:NAVER_PW='...'
```
2. 루프 실행(43~206, 필요 시 EndPage 변경)
```powershell
powershell -ExecutionPolicy Bypass -File "scripts/run-naver-blog-until-end.ps1" -StartPage 43 -EndPage 206
```
3. 백그라운드 실행
```powershell
Start-Process -WindowStyle Hidden powershell -ArgumentList '-ExecutionPolicy Bypass -File "scripts/run-naver-blog-until-end.ps1" -StartPage 43 -EndPage 206'
```

## 장애 대응 체크리스트
1. `nextPage` 정체 확인
- `output/naver-blog-pdf-progress.json`에서 `nextPage`가 10분 이상 동일하면 장애.

2. 저장목록 잔여물 정리
```powershell
$env:NAVER_ID='...'; $env:NAVER_PW='...'; node "scripts/check-saved-count.js"
$env:NAVER_ID='...'; $env:NAVER_PW='...'; node "scripts/drain-saved-list-only.js"
```

3. 중복 루프 프로세스 정리
```powershell
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'run-naver-blog-until-end\.ps1' -or $_.CommandLine -match 'naver-blog-pdf-batch\.js' } | Select-Object ProcessId,Name,CommandLine
```
중복이면 PID 기준 종료 후 루프 1개만 재시작.

4. 관리자 로그인 리다이렉트 점검
- `output/postexport-layout.html`에 `window.open("...nidlogin...")`가 보이면 관리자 로그인 세션 미유지 상태.
- 최신 코드(`scripts/naver-blog-pdf-batch.js`)는 자동 재로그인 후 재진입 처리됨.

## 통계 수집 표준 실행
```powershell
$env:NAVER_ID='...'
$env:NAVER_PW='...'
$env:NAVER_BLOG_ID='2basstune'
$env:HEADLESS='true'
$env:NAVER_BLOG_ANALYTICS_PERIODS='day,week,month'
npm run blog:analytics:download:all-types
```

## 통계 완료 판정
- `output/naver-blog-analytics-download-all-types-progress.json` 에서 `status: completed`
- `runs`의 각 항목 `exitCode: 0`
- `output/naver-blog-analytics`에 일간/주간/월간 xlsx 누적 존재

## 운영 원칙
- 원본 SSOT 폴더(`output/naver-blog-pdfs`)는 수정하지 않는다.
- 중복 정리는 백업 후 별도 폴더에서 수행한다.
- 로그는 UTF-8 기준으로 확인한다.

