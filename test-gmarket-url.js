import { chromium } from 'playwright';
import { readFileSync } from 'fs';

async function test() {
  console.log('🔍 지마켓 마이페이지 URL 탐색...');

  const sessionData = JSON.parse(readFileSync('sessions/gmarket.json', 'utf8'));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: sessionData,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();

  // 메인 페이지에서 시작
  await page.goto('https://www.gmarket.co.kr/');
  await page.waitForTimeout(3000);

  // My G 관련 링크 찾기
  const mygLinks = await page.locator('a[href*="myg"], a[href*="My"], a:has-text("My G"), a:has-text("마이")').all();
  console.log('\nMy G 관련 링크:');
  for (const link of mygLinks.slice(0, 10)) {
    const href = await link.getAttribute('href').catch(() => '');
    const text = await link.textContent().catch(() => '');
    if (href) console.log(`  ${text?.trim()?.substring(0, 20) || '(빈텍스트)'}: ${href}`);
  }

  // 직접 여러 URL 시도
  const testUrls = [
    'https://www.gmarket.co.kr/myg/',
    'https://myg.gmarket.co.kr/',
    'https://www.gmarket.co.kr/mypage/',
    'https://mygmarket.gmarket.co.kr/',
    'https://www.gmarket.co.kr/n/myg',
    'https://escrow.gmarket.co.kr/myg/'
  ];

  for (const url of testUrls) {
    await page.goto(url);
    await page.waitForTimeout(2000);
    const finalUrl = page.url();
    const title = await page.title();
    const has404 = await page.locator('text=404, text=error, text=에러').first().isVisible({ timeout: 500 }).catch(() => false);
    console.log(`\n${url}`);
    console.log(`  → ${finalUrl}`);
    console.log(`  제목: ${title}`);
    console.log(`  404: ${has404}`);

    // 주문 관련 링크 있는지
    if (!has404 && !finalUrl.includes('login')) {
      const orderLinks = await page.locator('a[href*="order"], a:has-text("주문"), a:has-text("구매")').count();
      console.log(`  주문링크: ${orderLinks}`);
    }
  }

  await browser.close();
}

test().catch(console.error);
