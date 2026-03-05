import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'fs';

async function test() {
  console.log('📋 지마켓 주문 HTML 구조 분석...');

  const sessionData = JSON.parse(readFileSync('sessions/gmarket.json', 'utf8'));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: sessionData,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();

  await page.goto('https://www.gmarket.co.kr/myg/order/order');
  await page.waitForTimeout(5000);

  // 6개월 조회
  const sixMonth = page.locator('a:has-text("6개월"), button:has-text("6개월")').first();
  if (await sixMonth.isVisible({ timeout: 2000 }).catch(() => false)) {
    await sixMonth.click();
    await page.waitForTimeout(3000);
  }

  // 모든 링크 텍스트 확인
  const allLinks = await page.locator('a').all();
  const linkTexts = [];
  for (const link of allLinks) {
    const text = await link.textContent().catch(() => '');
    const href = await link.getAttribute('href').catch(() => '');
    if (text && text.trim()) {
      linkTexts.push({ text: text.trim().substring(0, 30), href: href?.substring(0, 50) || '' });
    }
  }

  console.log('\n🔗 페이지 내 링크들:');
  const uniqueTexts = [...new Set(linkTexts.map(l => l.text))];
  console.log(uniqueTexts.slice(0, 30).join(' | '));

  // 배송 관련 텍스트 포함 요소
  const deliveryElements = await page.locator('*:has-text("배송"), *:has-text("택배"), *:has-text("송장")').all();
  console.log('\n배송 관련 요소 수:', deliveryElements.length);

  // 버튼들 확인
  const buttons = await page.locator('button, a.btn, [role="button"]').all();
  const btnTexts = [];
  for (const btn of buttons) {
    const text = await btn.textContent().catch(() => '');
    if (text && text.trim()) btnTexts.push(text.trim().substring(0, 20));
  }
  console.log('\n버튼들:', [...new Set(btnTexts)].slice(0, 15).join(' | '));

  // 주문 행 구조 확인 (테이블 또는 리스트)
  const tables = await page.locator('table').count();
  const orderLists = await page.locator('[class*="order"], [class*="list"]').count();
  console.log('\nTable 수:', tables);
  console.log('주문/리스트 요소:', orderLists);

  // 주문 상세 페이지 링크 확인
  const detailLinks = await page.locator('a[href*="orderdetail"], a[href*="detail"]').count();
  console.log('상세 링크:', detailLinks);

  // 페이지 일부 HTML 저장 (분석용)
  const orderSection = await page.locator('main, .content, #content, [class*="order"]').first();
  if (await orderSection.isVisible({ timeout: 1000 }).catch(() => false)) {
    const html = await orderSection.innerHTML().catch(() => '');
    writeFileSync('output/gmarket_structure.html', html.substring(0, 10000));
    console.log('\n📄 HTML 구조 저장: output/gmarket_structure.html');
  }

  await browser.close();
}

test().catch(console.error);
