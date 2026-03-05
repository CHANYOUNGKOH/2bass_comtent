import { chromium } from 'playwright';

(async () => {
  console.log('브라우저 실행 중...');

  const browser = await chromium.launch({
    headless: false,
    slowMo: 100
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://signin.auction.co.kr/authenticate/');
  console.log('');
  console.log('=== 옥션 로그인 페이지 열림 ===');
  console.log('1. 로그인 진행 (ID: kohaz94)');
  console.log('2. 로그인 완료 후 주문목록 페이지로 이동');
  console.log('3. 브라우저 닫기 (X 버튼)');
  console.log('');
  console.log('세션이 자동 저장됩니다.');

  // 주기적으로 세션 저장 (5초마다)
  const saveInterval = setInterval(async () => {
    try {
      await context.storageState({ path: 'sessions/auction.json' });
    } catch (e) {
      // 무시
    }
  }, 5000);

  // 브라우저가 닫힐 때까지 대기
  await new Promise(resolve => {
    browser.on('disconnected', () => {
      clearInterval(saveInterval);
      resolve();
    });
  });

  console.log('브라우저 종료됨');
  console.log('세션 저장 완료: sessions/auction.json');
})();
