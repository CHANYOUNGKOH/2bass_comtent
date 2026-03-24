import { chromium } from 'playwright';
import { config } from 'dotenv';
import fs from 'fs/promises';
import path from 'path';

config();
const NAVER_ID = process.env.NAVER_ID || process.env.NAVER_SELLER_ID;
const NAVER_PW = process.env.NAVER_PW || process.env.NAVER_SELLER_PW;
const LOCAL_DIR = path.resolve(process.cwd(), 'output/naver-blog-pdfs');
const ADMIN_URL = 'https://admin.blog.naver.com/2basstune/config/postexport';

function safeDecode(v) {
  try { return decodeURIComponent(v); } catch { return v; }
}

async function main() {
  if (!NAVER_ID || !NAVER_PW) throw new Error('missing NAVER credentials');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto('https://www.naver.com/');
    await page.locator('a[href*=\"nidlogin.login\"]').first().click();
    await page.waitForLoadState('domcontentloaded');
    await page.locator('#id').fill(NAVER_ID);
    await page.locator('#pw').fill(NAVER_PW);
    await page.locator('#log\\.login,button[type=\"submit\"],input[type=\"submit\"]').first().click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1200);

    await page.goto(ADMIN_URL, { waitUntil: 'domcontentloaded' });

    let frame = page.frame({ name: 'papermain' });
    if (!frame) throw new Error('papermain not found');

    const pdfTab = frame.locator('a[href*="PostExportForm"],a[href*="postexportform"]').first();
    if ((await pdfTab.count()) > 0) await pdfTab.click({ force: true });

    await page.waitForTimeout(1000);
    frame = page.frame({ name: 'papermain' });
    if (!frame) throw new Error('papermain missing after pdf tab');

    const savedTab = frame.locator('a[href*="PostExportPdfList"],a[href*="postexportpdflist"]').first();
    if ((await savedTab.count()) === 0) throw new Error('saved list tab not found');
    await savedTab.click({ force: true });
    await page.waitForTimeout(1200);

    frame = page.frame({ name: 'papermain' });
    const dls = frame.locator('a[href*="download.blog.naver.com"]');
    const cnt = await dls.count();
    const remoteFiles = [];
    for (let i = 0; i < cnt; i += 1) {
      const href = await dls.nth(i).getAttribute('href');
      if (!href) continue;
      const name = safeDecode((href.split('/').pop() || '').split('?')[0]);
      remoteFiles.push(name);
    }

    const locals = await fs.readdir(LOCAL_DIR).catch(() => []);
    const localSet = new Set(locals);
    const missingLocal = remoteFiles.filter((x) => !localSet.has(x));

    console.log(JSON.stringify({
      savedListCount: cnt,
      localFileCount: locals.length,
      missingLocalCount: missingLocal.length,
      missingLocalSample: missingLocal.slice(0, 20),
      savedListSample: remoteFiles.slice(0, 20)
    }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
