# Codegen 템플릿 가이드

## 개요

Playwright Codegen을 사용하여 새로운 셀렉터를 추출하는 방법입니다.

## Codegen 실행

```bash
# 기본 실행
npm run codegen

# 특정 URL로 시작
npm run codegen:seller
npm run codegen:naver
```

## 워크플로우

### 1. Codegen 시작

```bash
npx playwright codegen https://sell.smartstore.naver.com
```

### 2. 브라우저에서 작업 시연

- 실제로 수행하고자 하는 작업을 브라우저에서 수행
- Inspector 창에서 생성되는 코드 확인

### 3. 셀렉터 추출

생성된 코드에서 셀렉터를 추출합니다:

```javascript
// Codegen 생성 코드
await page.locator('[data-menu="direct"]').click();
await page.getByRole('button', { name: '처리' }).click();
```

### 4. YAML로 변환

추출한 셀렉터를 YAML 형식으로 변환:

```yaml
# selectors/naver-seller.yaml
selectors:
  order_management:
    direct_delivery:
      tab:
        selector: '[data-menu="direct"]'
        type: "css"
      process_btn:
        selector: 'button:has-text("처리")'
        type: "css"
        # 또는 role 기반
        # role: "button"
        # name: "처리"
```

## 셀렉터 타입

### CSS 셀렉터 (권장)

```yaml
element:
  selector: '.class-name'
  type: "css"
```

### 속성 셀렉터

```yaml
element:
  selector: '[data-test="value"]'
  type: "css"
```

### 텍스트 포함

```yaml
element:
  selector: 'button:has-text("텍스트")'
  type: "css"
```

### Role 기반 (접근성)

```yaml
element:
  role: "button"
  name: "버튼 텍스트"
```

## 폴백 설정

사이트 변경에 대비한 폴백 셀렉터:

```yaml
element:
  selector: '#primary-selector'
  type: "css"
  fallback: '.fallback-selector'
  description: "주요 버튼"
```

## 예시 템플릿

### 로그인 폼

```yaml
login:
  id_input:
    selector: 'input[name="userId"]'
    type: "css"
    fallback: '#userId'
  pw_input:
    selector: 'input[name="password"]'
    type: "css"
  submit_btn:
    selector: 'button[type="submit"]'
    type: "css"
    fallback: '.btn-login'
```

### 테이블 목록

```yaml
order_list:
  table:
    selector: '.order-table tbody tr'
    type: "css"
  checkbox:
    selector: 'input[type="checkbox"]'
    type: "css"
  order_number:
    selector: '.order-no'
    type: "css"
  status:
    selector: '.status-badge'
    type: "css"
```

### 모달/다이얼로그

```yaml
modal:
  overlay:
    selector: '.modal-overlay'
    type: "css"
  content:
    selector: '.modal-content'
    type: "css"
  confirm_btn:
    selector: '.modal-footer .btn-primary'
    type: "css"
  cancel_btn:
    selector: '.modal-footer .btn-secondary'
    type: "css"
```

## 팁

1. **고유한 셀렉터 사용**: ID나 data 속성 우선
2. **텍스트 의존 최소화**: 다국어 대응 고려
3. **구조적 셀렉터 피하기**: `div > div > span` 같은 셀렉터는 취약
4. **폴백 준비**: 주요 셀렉터에는 폴백 설정
5. **주석 추가**: description으로 셀렉터 용도 명시

## 테스트

새 셀렉터 추가 후 테스트:

```bash
npm run test:selectors
```
