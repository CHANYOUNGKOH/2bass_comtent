/**
 * 네이버 로그인 자동화 스크립트
 *
 * 사용법:
 *   node naver_login.js
 *
 * 필요 파일:
 *   - .env (NAVER_ID, NAVER_PW)
 *   - selectors.config.js
 */

import { chromium } from 'playwright';
import { NAVER_SELECTORS } from './selectors.config.js';
import { config } from 'dotenv';

// 환경변수 로드
config();

const { NAVER_ID, NAVER_PW } = process.env;

async function naverLogin() {
  // 브라우저 실행 (headless: false로 브라우저 창 표시)
  const browser = await chromium.launch({
    headless: false,
    slowMo: 100, // 동작을 느리게 하여 확인 용이
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('🚀 네이버 로그인 시작...');

    // 1. 로그인 페이지 이동
    await page.goto(NAVER_SELECTORS.urls.login);
    console.log('📄 로그인 페이지 로드 완료');

    // 2. 아이디 입력
    const idInput = page.getByRole(
      NAVER_SELECTORS.login.idInput.role,
      { name: NAVER_SELECTORS.login.idInput.name }
    );
    await idInput.click();
    await idInput.fill(NAVER_ID);
    console.log('✅ 아이디 입력 완료');

    // 3. 비밀번호 입력
    const pwInput = page.getByRole(
      NAVER_SELECTORS.login.pwInput.role,
      { name: NAVER_SELECTORS.login.pwInput.name }
    );
    await pwInput.click();
    await pwInput.fill(NAVER_PW);
    console.log('✅ 비밀번호 입력 완료');

    // 4. 로그인 상태 유지 체크
    const keepLogin = page.getByRole(
      NAVER_SELECTORS.login.keepLogin.role,
      { name: NAVER_SELECTORS.login.keepLogin.name }
    );
    await keepLogin.click();

    // 5. 로그인 버튼 클릭
    const loginBtn = page.getByRole(
      NAVER_SELECTORS.login.loginButton.role,
      { name: NAVER_SELECTORS.login.loginButton.name, exact: true }
    );
    await loginBtn.click();
    console.log('🔐 로그인 버튼 클릭');

    // 6. 페이지 로드 대기
    await page.waitForLoadState('networkidle');
    console.log('✨ 로그인 완료!');

    // 추가 작업을 여기에...
    // 예: await page.goto('https://mail.naver.com');

    // 테스트용: 5초 대기 후 종료
    await page.waitForTimeout(5000);

  } catch (error) {
    console.error('❌ 에러 발생:', error.message);
  } finally {
    await browser.close();
    console.log('🔚 브라우저 종료');
  }
}

// 실행
naverLogin();
