import { chromium } from 'playwright';
import { config } from 'dotenv';
import { writeFile } from 'fs/promises';
import path from 'path';

config();

const NAVER_ID = process.env.NAVER_ID || process.env.NAVER_SELLER_ID;
const NAVER_PW = process.env.NAVER_PW || process.env.NAVER_SELLER_PW;
const BLOG_ID = process.env.NAVER_BLOG_ID || '2basstune';

async function main() {
  if (!NAVER_ID || !NAVER_PW) {
    throw new Error('Missing NAVER_ID/NAVER_PW');
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto('https://nid.naver.com/nidlogin.login', { waitUntil: 'domcontentloaded' });
    await page.locator('#id').fill(NAVER_ID);
    await page.locator('#pw').fill(NAVER_PW);
    await page.locator('#log\\.login,button[type="submit"],input[type="submit"]').first().click();
    await page.waitForLoadState('domcontentloaded');

    await page.goto(`https://admin.blog.naver.com/PostExportForm.naver?blogId=${BLOG_ID}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(1500);

    const iframeCount = await page.locator('iframe').count();
    const papermainExists = (await page.locator('iframe[name="papermain"]').count()) > 0;
    const frame = page.frame({ name: 'papermain' }) || page.mainFrame();

    const paginateCount = await frame.locator('#paginate, [id*="paginate"]').count().catch(() => 0);
    const pageLinks = await frame
      .locator('#paginate a, [id*="paginate"] a, a[rel="next"], a[rel="prev"], a.next, a.prev')
      .allInnerTexts()
      .catch(() => []);
    const bodySample = await frame.locator('body').innerText().catch(() => '');
    const html = await frame.content();

    const outDir = path.resolve(process.cwd(), 'output');
    await writeFile(path.join(outDir, 'postexport-layout.html'), html, 'utf8');
    await writeFile(
      path.join(outDir, 'postexport-layout-summary.json'),
      JSON.stringify(
        {
          url: page.url(),
          iframeCount,
          papermainExists,
          frameUrl: frame.url(),
          paginateCount,
          pageLinks: pageLinks.map((x) => String(x).trim()).filter(Boolean).slice(0, 120),
          bodySample: String(bodySample).slice(0, 2000),
        },
        null,
        2
      ),
      'utf8'
    );

    console.log('layout_dumped');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

