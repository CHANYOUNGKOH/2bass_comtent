import { chromium } from 'playwright';
import { config } from 'dotenv';

config();

const NAVER_ID = process.env.NAVER_ID || process.env.NAVER_SELLER_ID;
const NAVER_PW = process.env.NAVER_PW || process.env.NAVER_SELLER_PW;
const BLOG_ID = process.env.NAVER_BLOG_ID || '2basstune';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto('https://nid.naver.com/nidlogin.login', { waitUntil: 'domcontentloaded' });
    await page.locator('#id').fill(NAVER_ID || '');
    await page.locator('#pw').fill(NAVER_PW || '');
    await page.locator('#log\\.login,button[type="submit"],input[type="submit"]').first().click();
    await page.waitForLoadState('domcontentloaded');

    await page.goto(`https://admin.blog.naver.com/PostExportForm.naver?blogId=${BLOG_ID}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(1200);
    const frame = page.frame({ name: 'papermain' }) || page.mainFrame();

    const bodyText = await frame.locator('body').innerText().catch(() => '');
    const has139 = bodyText.includes('139');
    const allCbs = await frame.locator('input[type="checkbox"]').count();
    const enabledCbs = await frame.locator('input[type="checkbox"]:enabled').count();
    const tbodyCbs = await frame.locator('tbody input[type="checkbox"]').count();
    const rowCbs = await frame.locator('tr input[type="checkbox"]').count();
    const usageTexts = await frame.locator('text=/\\/\\s*500\\s*MB/i').allInnerTexts().catch(() => []);
    const links = await frame.locator('#paginate a, [id*="paginate"] a').allInnerTexts().catch(() => []);

    console.log(
      JSON.stringify(
        {
          url: page.url(),
          frameUrl: frame.url(),
          has139,
          allCbs,
          enabledCbs,
          tbodyCbs,
          rowCbs,
          usageTexts: usageTexts.slice(0, 10),
          paginateLinks: links.slice(0, 30),
        },
        null,
        2
      )
    );
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

