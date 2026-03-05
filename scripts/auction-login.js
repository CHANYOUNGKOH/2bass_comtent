import { chromium } from 'playwright';
import * as readline from 'readline';

(async () => {
  console.log('브라우저 실행 중...');

  const browser = await chromium.launch({
    headless: false
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://signin.auction.co.kr/Authenticate/MobileLogin.aspx?url=https%3A%2F%2Fwww.auction.co.kr%2F');

  console.log('');
  console.log('===========================================');
  console.log('옥션 로그인 페이지가 열렸습니다.');
  console.log('');
  console.log('ID: kohaz94');
  console.log('PW: qlcsk1201!@A');
  console.log('');
  console.log('로그인 완료 후 여기에 "done" 입력하고 Enter:');
  console.log('===========================================');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  await new Promise(resolve => {
    rl.question('', (answer) => {
      rl.close();
      resolve();
    });
  });

  // 현재 URL 확인
  console.log('현재 URL:', page.url());

  // 세션 저장
  await context.storageState({ path: 'sessions/auction.json' });
  console.log('');
  console.log('세션 저장 완료: sessions/auction.json');

  await browser.close();
  process.exit(0);
})();
