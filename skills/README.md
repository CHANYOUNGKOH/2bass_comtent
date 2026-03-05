# Playwright Automation Skills

## 디렉토리 구조

```
skills/
├── auth/                    # 인증 관련
│   ├── naver.login.js
│   ├── google.login.js
│   └── coupang.login.js
│
├── scraping/                # 데이터 수집
│   ├── price.monitor.js
│   ├── review.collector.js
│   └── product.info.js
│
├── automation/              # 반복 작업
│   ├── form.filler.js
│   ├── bulk.uploader.js
│   └── order.processor.js
│
├── reporting/               # 보고서/캡처
│   ├── screenshot.js
│   ├── pdf.generator.js
│   └── video.recorder.js
│
└── utils/                   # 공통 유틸리티
    ├── browser.manager.js
    ├── session.storage.js
    └── error.handler.js
```

## Skill 작성 규칙

1. 각 Skill은 독립 실행 가능
2. 셀렉터는 `selectors.config.js`에서 관리
3. 인증정보는 `.env`에서 로드
4. 에러 발생시 스크린샷 자동 저장

## 서브에이전트 연동 (향후)

각 Skill을 MCP 서버로 노출하여 Claude가 직접 호출 가능
