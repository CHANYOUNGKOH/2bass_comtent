import { chromium } from 'playwright';
import { config } from 'dotenv';

config();

const NAVER_ID = process.env.NAVER_ID || process.env.NAVER_SELLER_ID;
const NAVER_PW = process.env.NAVER_PW || process.env.NAVER_SELLER_PW;
const ADMIN_LOGIN_URL =
  'https://nid.naver.com/nidlogin.login?mode=form&svctype=64&url=http://admin.blog.naver.com/CloseLoginPopup.naver';
const TARGET_URL = 'https://admin.blog.naver.com/PostExportForm.naver?blogId=2basstune';

async function main() {
  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(ADMIN_LOGIN_URL, { waitUntil: 'domcontentloaded' });
    console.log(`[step] login page url=${page.url()}`);

    await page.locator('#id').fill(NAVER_ID || '');
    await page.locator('#pw').fill(NAVER_PW || '');
    await page.locator('#log\\.login,button[type="submit"],input[type="submit"]').first().click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
    console.log(`[step] after login url=${page.url()}`);
    if (page.url().includes('idSafetyRelease')) {
      const buttons = await page.locator('button, a, input[type="submit"]').allInnerTexts().catch(() => []);
      console.log(`[step] safety buttons=${JSON.stringify(buttons.slice(0, 40))}`);
      const body = await page.locator('body').innerText().catch(() => '');
      console.log(`[step] safety body sample=${body.slice(0, 1200).replace(/\s+/g, ' ')}`);
    }

    const cookies1 = await context.cookies();
    console.log(`[step] cookie count=${cookies1.length}`);
    console.log(
      JSON.stringify(
        cookies1
          .filter((c) => /naver\.com/.test(c.domain))
          .map((c) => ({ name: c.name, domain: c.domain, path: c.path }))
          .slice(0, 30),
        null,
        2
      )
    );

    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    console.log(`[step] target url=${page.url()}`);
    const html = await page.content();
    console.log(`[step] html head=${html.slice(0, 300).replace(/\s+/g, ' ')}`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
