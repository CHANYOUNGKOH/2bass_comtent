import { chromium } from 'playwright';
import { config } from 'dotenv';
import path from 'path';
import { mkdir } from 'fs/promises';

config();

const NAVER_ID = process.env.NAVER_ID || process.env.NAVER_SELLER_ID;
const NAVER_PW = process.env.NAVER_PW || process.env.NAVER_SELLER_PW;
const BLOG_ID = process.env.NAVER_BLOG_ID || '2basstune';
const TARGET_PAGE = Number(process.env.DEBUG_TARGET_PAGE || 140);

function nowTag() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function main() {
  const tag = nowTag();
  const outDir = path.resolve(process.cwd(), 'output', `debug-capture-${TARGET_PAGE}-${tag}`);
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: false, slowMo: 120 });
  const context = await browser.newContext({
    recordHar: { path: path.join(outDir, 'network.har'), content: 'embed' },
    recordVideo: { dir: outDir, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });

  const respLogs = [];
  const reqLogs = [];
  page.on('request', (r) => {
    const u = r.url();
    if (/PostExport|postexport|pdf|save|export|nidlogin|admin\.blog/i.test(u)) {
      reqLogs.push(`[REQ] ${r.method()} ${u}`);
    }
  });
  page.on('response', async (r) => {
    const u = r.url();
    if (!/PostExport|postexport|pdf|save|export|nidlogin|admin\.blog/i.test(u)) return;
    const ct = r.headers()['content-type'] || '';
    let body = '';
    if (/json|text|html/i.test(ct)) {
      body = (await r.text().catch(() => '')).slice(0, 220).replace(/\s+/g, ' ');
    }
    respLogs.push(`[RES] ${r.status()} ${u} ${body}`);
  });
  page.on('dialog', async (d) => {
    respLogs.push(`[DIALOG] ${d.message()}`);
    await d.dismiss().catch(() => {});
  });

  try {
    await page.goto('https://www.naver.com/', { waitUntil: 'domcontentloaded' });
    const login = page.getByRole('link', { name: /NAVER 로그인|로그인/i }).first();
    if ((await login.count()) > 0) await login.click({ force: true }).catch(() => {});
    await page.locator('#id').fill(NAVER_ID || '');
    await page.locator('#pw').fill(NAVER_PW || '');
    await page.locator('#log\\.login,button[type="submit"],input[type="submit"]').first().click();
    await page.waitForLoadState('domcontentloaded');

    await page.goto(`https://admin.blog.naver.com/PostExportForm.naver?blogId=${BLOG_ID}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const frame = page.frame({ name: 'papermain' }) || page.mainFrame();
    await page.screenshot({ path: path.join(outDir, '01-loaded.png'), fullPage: true }).catch(() => {});

    // paginate to target
    for (let i = 0; i < 140; i += 1) {
      const link = frame.locator('#paginate a, [id*="paginate"] a').filter({ hasText: new RegExp(`^\\s*${TARGET_PAGE}\\s*$`) }).first();
      if ((await link.count()) > 0) {
        await link.click({ force: true });
        await frame.waitForTimeout(800);
        break;
      }
      const next = frame.locator('#paginate a, [id*="paginate"] a').filter({ hasText: /다음/ }).first();
      if ((await next.count()) === 0) break;
      await next.click({ force: true });
      await frame.waitForTimeout(700);
    }
    await page.screenshot({ path: path.join(outDir, '02-page-selected.png'), fullPage: true }).catch(() => {});

    const cbs = frame.locator('tbody input[type="checkbox"]');
    const n = await cbs.count();
    for (let i = 0; i < Math.min(10, n); i += 1) {
      await cbs.nth(i).check({ force: true }).catch(() => {});
    }
    await frame.locator('#add_button,a#add_button').first().click({ force: true }).catch(() => {});
    await frame.waitForTimeout(1000);

    // trim over 500
    for (let g = 0; g < 20; g += 1) {
      const used = await frame.locator('#added_post_capacity').innerText().catch(() => '0MB');
      const num = Number(String(used).replace(/[^0-9.]/g, '')) || 0;
      if (num <= 500) break;
      const rows = frame.locator('#selected_post_list tr');
      const rc = await rows.count();
      if (rc <= 0) break;
      const last = rows.nth(rc - 1);
      await last.locator('input[type="checkbox"]').first().check({ force: true }).catch(() => {});
      await frame.locator('a.btn_del, ._delete').first().click({ force: true }).catch(() => {});
      await frame.waitForTimeout(500);
    }

    const title = `투베이스_블로그_${TARGET_PAGE}_${tag}`;
    const ti = frame.locator('input[name*="title" i],input[id*="title" i],input[type="text"]').first();
    await ti.fill(title).catch(() => {});
    await ti.press('Tab').catch(() => {});
    await frame.locator('#include_comment').check({ force: true }).catch(() => {});
    await page.screenshot({ path: path.join(outDir, '03-before-make.png'), fullPage: true }).catch(() => {});

    await frame.locator('a._nclk\\(edt_backup\\.ok\\).btn6,a:has-text("만들기")').first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(7000);
    await page.screenshot({ path: path.join(outDir, '04-after-make.png'), fullPage: true }).catch(() => {});

    const body = await frame.locator('body').innerText().catch(() => '');
    reqLogs.push(`[INFO] body-sample=${String(body).slice(0, 1200).replace(/\s+/g, ' ')}`);
  } finally {
    await context.tracing.stop({ path: path.join(outDir, 'trace.zip') }).catch(() => {});
    const fs = await import('fs/promises');
    await fs.writeFile(path.join(outDir, 'requests.log'), `${reqLogs.join('\n')}\n`, 'utf8').catch(() => {});
    await fs.writeFile(path.join(outDir, 'responses.log'), `${respLogs.join('\n')}\n`, 'utf8').catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    console.log(JSON.stringify({ outDir }, null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
