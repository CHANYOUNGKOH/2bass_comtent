import { chromium } from 'playwright';
import { config } from 'dotenv';

config();
const id = process.env.NAVER_ID || process.env.NAVER_SELLER_ID;
const pw = process.env.NAVER_PW || process.env.NAVER_SELLER_PW;

async function countLinksIn(frameOrPage) {
  const loc = frameOrPage.locator('a[href*="download.blog.naver.com"]');
  const n = await loc.count();
  const sample = [];
  for (let i = 0; i < Math.min(n, 10); i += 1) {
    const href = await loc.nth(i).getAttribute('href');
    sample.push(href || '');
  }
  return { n, sample };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto('https://nid.naver.com/nidlogin.login', { waitUntil: 'domcontentloaded' });
    await page.locator('#id').fill(id || '');
    await page.locator('#pw').fill(pw || '');
    await page.keyboard.press('Enter');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    await page.goto('https://admin.blog.naver.com/PostExportPdfList.naver?blogId=2basstune', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    let result = await countLinksIn(page);
    const frame = page.frame({ name: 'papermain' });
    if (frame) {
      const fr = await countLinksIn(frame);
      if (fr.n >= result.n) result = fr;
    }

    console.log(JSON.stringify({ savedListCount: result.n, sample: result.sample }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
