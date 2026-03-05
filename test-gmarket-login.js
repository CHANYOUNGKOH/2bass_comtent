import { chromium } from 'playwright';
import { config } from 'dotenv';
import { writeFileSync } from 'fs';

config();

async function test() {
  console.log('🔐 지마켓 로그인 테스트...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();

  await page.goto('https://www.gmarket.co.kr/');
  await page.waitForTimeout(2000);

  // 로그인 클릭
  const loginBtn = page.locator('a:has-text("로그인")').first();
  if (await loginBtn.isVisible({ timeout: 3000 })) {
    await loginBtn.click();
    await page.waitForTimeout(2000);
  }

  console.log('로그인 페이지:', page.url());

  // ID/PW 입력
  const idInput = page.getByRole('textbox', { name: '아이디를 입력해주세요' });
  const pwInput = page.getByRole('textbox', { name: '비밀번호를 입력해주세요' });

  if (await idInput.isVisible({ timeout: 3000 })) {
    await idInput.fill(process.env.GMARKET_BUYER_ID);
    await page.waitForTimeout(500);
    await pwInput.fill(process.env.GMARKET_BUYER_PW);
    await page.waitForTimeout(500);

    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForTimeout(5000);

    console.log('로그인 후 URL:', page.url());

    // Cloudflare 확인
    const hasCF = await page.locator('iframe[src*="challenges.cloudflare.com"]').isVisible().catch(() => false);
    console.log('Cloudflare:', hasCF ? '감지됨' : '없음');

    // 로그인 성공 확인
    const hasMyMenu = await page.locator('text=My G').first().isVisible().catch(() => false)
      || await page.locator('text=마이지마켓').first().isVisible().catch(() => false)
      || await page.locator('a[href*="myg"]').first().isVisible().catch(() => false);
    console.log('My G 메뉴:', hasMyMenu ? '있음 (로그인 성공)' : '없음');

    // 로그인 성공 시 세션 저장
    const url = page.url();
    if (!url.includes('signin') && !url.includes('login')) {
      const storage = await context.storageState();
      writeFileSync('sessions/gmarket.json', JSON.stringify(storage, null, 2));
      console.log('💾 세션 저장 완료');
    } else {
      console.log('⚠️ 로그인 실패 - URL에 login 포함');
    }
  } else {
    console.log('⚠️ 로그인 폼 없음');
  }

  await browser.close();
}

test().catch(console.error);
