import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'fs';

async function test() {
  console.log('📂 세션으로 My G 접근 테스트...');

  if (!existsSync('sessions/gmarket.json')) {
    console.log('❌ 세션 파일 없음');
    return;
  }

  const sessionData = JSON.parse(readFileSync('sessions/gmarket.json', 'utf8'));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: sessionData,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();

  // My G 직접 접근
  console.log('🌐 My G 페이지 접속...');
  await page.goto('https://www.gmarket.co.kr/myg/');
  await page.waitForTimeout(3000);

  console.log('URL:', page.url());

  // 로그인 필요 페이지로 리다이렉트되었는지 확인
  const url = page.url();
  if (url.includes('login') || url.includes('signin')) {
    console.log('⚠️ 로그인 필요 - 세션 만료됨');
  } else {
    console.log('✅ My G 접근 성공!');

    // 주문내역 확인
    const orderText = await page.textContent('body').catch(() => '');
    const hasOrders = orderText.includes('주문') || orderText.includes('배송');
    console.log('주문/배송 텍스트:', hasOrders ? '발견' : '없음');

    // iframe 확인
    const iframes = await page.locator('iframe').count();
    console.log('iframe 수:', iframes);

    // 주문번호 패턴 확인
    const matches = orderText.match(/\d{10}/g) || [];
    const orderNumbers = [...new Set(matches)].filter(n => n.startsWith('17') || n.startsWith('25') || n.startsWith('16'));
    console.log('주문번호:', orderNumbers.length > 0 ? orderNumbers.slice(0, 5).join(', ') : '없음');
  }

  await browser.close();
}

test().catch(console.error);
