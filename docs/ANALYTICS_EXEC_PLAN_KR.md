# 통계/콘텐츠 연계 실행 계획 (순차 + 병렬)

## 목표
- 통계 파일과 콘텐츠 SSOT를 연결해, 글별 성과/개선 포인트를 안정적으로 산출한다.
- URL 매칭이 안 되는 경우도 정규화/유사도 매칭으로 보완한다.

## 순차 단계 (반드시 순서대로)
1. `통계 정규화`
- 명령: `npm run blog:analytics:normalize`
- 출력: `data/content/analysis/naver-analytics-normalized.json`

2. `통계-콘텐츠 매칭`
- 명령: `npm run blog:analytics:match`
- 매칭순서: URL 정확매칭 -> URL 정규화매칭 -> 제목 유사매칭
- 출력:
  - `output/naver-blog-analytics-match.json`
  - `output/naver-blog-analytics-match.xlsx`

3. `전환 패턴 분석`
- 명령: `npm run content:analyze`
- 출력:
  - `data/content/analysis/conversion-patterns.json`
  - `docs/content-conversion-analysis.md`

## 병렬 단계 (순차 2단계 완료 후 동시에 가능)
1. `분류/리포트 엑셀 생성`
- 명령: `npm run content:xlsx`
- 출력: `output/content-classification-report.xlsx`

2. `미매칭 URL 검수`
- 입력: `output/naver-blog-analytics-match.xlsx`의 `미매칭` 시트
- 작업: URL 규칙 보강, 제목 매칭 임계값 조정

3. `상위 성과글 리라이트 후보 선정`
- 입력: 매칭결과 + 전환패턴 분석
- 작업: 상위 성과 글 템플릿화(제목/도입/CTA 구조)

## 1회 실행 명령
```powershell
powershell -ExecutionPolicy Bypass -File "scripts/run-analytics-pipeline.ps1"
```

## 운영 체크 포인트
- 매칭률(`matchRate`)이 낮으면: URL 정규화 규칙 우선 보강
- 미매칭이 특정 기간에 집중되면: 해당 기간 통계 원본(xlsx) 포맷 차이 점검
- 최종 의사결정은 `매칭결과(엑셀)` + `전환분석(JSON/MD)`을 함께 본다

