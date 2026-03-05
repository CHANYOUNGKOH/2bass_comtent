import { chromium } from 'playwright';

(async () => {
  console.log('브라우저 + Inspector 실행 중...');

  const browser = await chromium.launch({
    headless: false
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://signin.auction.co.kr/Authenticate/MobileLogin.aspx?url=https%3A%2F%2Fwww.auction.co.kr%2F');

  console.log('');
  console.log('=== Inspector가 열립니다 ===');
  console.log('1. Inspector에서 Resume 버튼으로 진행');
  console.log('2. 브라우저에서 로그인');
  console.log('3. 로그인 후 Inspector에서 Resume 다시 클릭');
  console.log('');

  // Inspector 열기
  await page.pause();

  // 세션 저장
  await context.storageState({ path: 'sessions/auction.json' });
  console.log('세션 저장 완료: sessions/auction.json');

  await browser.close();
})();
