import { chromium } from 'playwright';
import { config } from 'dotenv';
import { access, mkdir, writeFile } from 'fs/promises';
import path from 'path';

config();
const id = process.env.NAVER_ID || process.env.NAVER_SELLER_ID;
const pw = process.env.NAVER_PW || process.env.NAVER_SELLER_PW;
const OUT_DIR = path.resolve(process.cwd(), 'output/naver-blog-pdfs');
const URL = 'https://admin.blog.naver.com/PostExportPdfList.naver?blogId=2basstune';

function decodeName(url) {
  const last = (url.split('/').pop() || '').split('?')[0];
  try { return decodeURIComponent(last); } catch { return last; }
}

function safeName(name) {
  return String(name || 'download.pdf').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const downloaded = [];
  let deleted = 0;

  try {
    await mkdir(OUT_DIR, { recursive: true });
    await page.goto('https://nid.naver.com/nidlogin.login', { waitUntil: 'domcontentloaded' });
    await page.locator('#id').fill(id || '');
    await page.locator('#pw').fill(pw || '');
    await page.keyboard.press('Enter');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    for (let loop = 0; loop < 50; loop += 1) {
      await page.goto(URL, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(800);

      const frame = page.frame({ name: 'papermain' });
      const scope = frame || page;
      const dl = scope.locator('a[href*="download.blog.naver.com"]').first();
      if ((await dl.count()) === 0) break;
      const href = await dl.getAttribute('href');
      if (!href) break;

      const rawName = safeName(decodeName(href));
      let savePath = path.resolve(OUT_DIR, rawName);
      let idx = 1;
      while (await exists(savePath)) {
        const p = path.parse(rawName);
        savePath = path.resolve(OUT_DIR, `${p.name}-${idx}${p.ext || '.pdf'}`);
        idx += 1;
      }

      const resp = await context.request.get(href, { failOnStatusCode: true });
      const body = await resp.body();
      await writeFile(savePath, body);
      downloaded.push(path.basename(savePath));

      const row = dl.locator('xpath=ancestor::tr[1]');
      let del = row.locator('a[href="#"],a[onclick*="del"],a[onclick*="remove"],a[onclick*="delete"]').first();
      if ((await del.count()) === 0) {
        del = scope.locator('a[href="#"]').first();
      }
      const dialogPromise = page.waitForEvent('dialog', { timeout: 2000 }).catch(() => null);
      await del.click({ force: true }).catch(() => {});
      const dialog = await dialogPromise;
      if (dialog) await dialog.accept().catch(() => {});
      deleted += 1;
      await page.waitForTimeout(500);
    }

    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    const frame = page.frame({ name: 'papermain' });
    const scope = frame || page;
    const remain = await scope.locator('a[href*="download.blog.naver.com"]').count();

    console.log(JSON.stringify({ downloadedCount: downloaded.length, deletedCount: deleted, remainSavedListCount: remain, downloadedSample: downloaded.slice(0, 20) }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
