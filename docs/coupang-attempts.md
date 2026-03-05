# 쿠팡 자동화 시도 기록

## 결론
**Playwright로 자동화 불가** - 수동 처리 필요

---

## 시도한 방법들

### 1. 기본 codegen
```bash
npx playwright codegen https://www.coupang.com --save-storage=sessions/coupang.json
```
**결과:** Google reCAPTCHA 후 Access Denied

### 2. 실제 Chrome 채널 사용
```bash
npx playwright codegen https://www.coupang.com --save-storage=sessions/coupang.json --channel=chrome
```
**결과:** 페이지는 열리나 동작 시 감지됨

### 3. Firefox 시도
```bash
npx playwright codegen https://www.coupang.com --save-storage=sessions/coupang.json --browser=firefox
```
**결과:** 미시도 (Chrome 채널 실패 후 스킵)

### 4. playwright-extra + stealth 플러그인
```bash
npm install playwright-extra puppeteer-extra-plugin-stealth
node scripts/coupang-browser.js --save-session
```
**결과:** 로그인 페이지까지 접근 가능, 로그인 후 Access Denied

### 5. Persistent Context (Chrome 프로필)
```bash
npx playwright codegen --browser-data-dir="..."
```
**결과:** codegen에서 해당 옵션 미지원

---

## 차단 원인 분석
- **Akamai CDN** 사용 (에러 Reference #18.xxx)
- 서버단 봇 탐지 (로그인 시점에 차단)
- `navigator.webdriver` 외 추가 핑거프린팅

---

## 미시도 방법 (향후 시도 가능)

### A. undetected-playwright
```bash
npm install undetected-playwright
```
Python의 undetected-chromedriver 포팅 버전

### B. Selenium + undetected-chromedriver
```python
# Python
from undetected_chromedriver import Chrome
driver = Chrome()
```
사용자가 이전에 Selenium으로 성공했다고 함

### C. Puppeteer + puppeteer-extra-plugin-stealth
```bash
npm install puppeteer puppeteer-extra puppeteer-extra-plugin-stealth
```
Playwright 대신 Puppeteer 사용

### D. 브라우저 확장 프로그램 방식
- 실제 Chrome에서 확장 프로그램으로 동작
- Manifest V3 기반

### E. 쿠팡 API (쿠팡윙)
- 판매자 전용 API
- 구매자용 API는 없음

---

## 현재 상태
- `.env`에 `COUPANG_BUYER_ID`, `COUPANG_BUYER_PW` 비워둠
- 쿠팡 송장 수집은 **수동 처리**
- `scripts/coupang-browser.js` 파일 존재 (stealth 시도용)

---

## 업데이트 기록
- 2026-03-03: 최초 시도, Playwright 차단 확인
