/**
 * 네이버 로그인 Skill
 *
 * 사용법:
 *   node skills/auth/naver.login.js
 *   node skills/auth/naver.login.js --save-session
 */

import { BaseSkill } from '../utils/base.skill.js';
import { NAVER_SELECTORS } from '../../selectors.config.js';

const { NAVER_ID, NAVER_PW } = process.env;

class NaverLoginSkill extends BaseSkill {
  constructor() {
    super({ name: 'naver-login' });
    this.selectors = NAVER_SELECTORS;
  }

  async login() {
    const page = this.page;

    // 1. 로그인 페이지 이동
    await page.goto(this.selectors.urls.login);
    console.log('📄 로그인 페이지 로드');

    // 2. 아이디 입력
    const idInput = page.getByRole(
      this.selectors.login.idInput.role,
      { name: this.selectors.login.idInput.name }
    );
    await idInput.fill(NAVER_ID);

    // 3. 비밀번호 입력
    const pwInput = page.getByRole(
      this.selectors.login.pwInput.role,
      { name: this.selectors.login.pwInput.name }
    );
    await pwInput.fill(NAVER_PW);

    // 4. 로그인 버튼 클릭
    const loginBtn = page.getByRole(
      this.selectors.login.loginButton.role,
      { name: this.selectors.login.loginButton.name, exact: true }
    );
    await loginBtn.click();

    // 5. 로그인 완료 대기
    await page.waitForLoadState('networkidle');

    // 로그인 성공 여부 확인
    const currentUrl = page.url();
    if (currentUrl.includes('nid.naver.com')) {
      throw new Error('로그인 실패 - 2단계 인증 또는 캡차 필요');
    }

    console.log('✅ 로그인 성공');
    return true;
  }
}

// CLI 실행
const skill = new NaverLoginSkill();
const saveSession = process.argv.includes('--save-session');

skill.run(async (page) => {
  await skill.login();

  if (saveSession) {
    await skill.saveSession('naver');
    console.log('💾 세션 저장 완료 - 다음부터 로그인 없이 사용 가능');
  }

  // 로그인 후 추가 작업이 필요하면 여기서 수행
  await page.waitForTimeout(3000);

  return { loggedIn: true };
});
