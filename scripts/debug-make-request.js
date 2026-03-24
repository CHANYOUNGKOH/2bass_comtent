import { chromium } from 'playwright';
import { config } from 'dotenv';

config();

const NAVER_ID = process.env.NAVER_ID || process.env.NAVER_SELLER_ID;
const NAVER_PW = process.env.NAVER_PW || process.env.NAVER_SELLER_PW;
const BLOG_ID = process.env.NAVER_BLOG_ID || '2basstune';
const TARGET_PAGE = Number(process.env.DEBUG_TARGET_PAGE || 140);
const TITLE = process.env.DEBUG_TITLE || `투베이스_블로그_${String(TARGET_PAGE)}`;

function parseMb(text) {
  const m = String(text || '').replace(/,/g, '').match(/([0-9]+(?:\.[0-9]+)?)\s*(KB|MB|GB)/i);
  if (!m) return 0;
  const n = Number(m[1]);
  const u = m[2].toUpperCase();
  if (u === 'GB') return n * 1024;
  if (u === 'KB') return n / 1024;
  return n;
}

async function gotoPage(frame, n) {
  for (let i = 0; i < 120; i += 1) {
    const link = frame.locator('#paginate a, [id*="paginate"] a').filter({ hasText: new RegExp(`^\\s*${n}\\s*$`) }).first();
    if ((await link.count()) > 0) {
      await link.click({ force: true });
      await frame.waitForTimeout(700);
      return true;
    }
    const next = frame.locator('#paginate a, [id*="paginate"] a').filter({ hasText: /다음/ }).first();
    if ((await next.count()) === 0) return false;
    await next.click({ force: true });
    await frame.waitForTimeout(700);
  }
  return false;
}

async function main() {
  const browser = await chromium.launch({ headless: false, slowMo: 80 });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('response', async (res) => {
    const url = res.url();
    if (!/PostExport|postexport|Export|pdf|save|make/i.test(url)) return;
    const status = res.status();
    const ct = res.headers()['content-type'] || '';
    let body = '';
    try {
      if (/json|text|html/i.test(ct)) {
        body = (await res.text()).slice(0, 300);
      }
    } catch {}
    console.log(`[resp] ${status} ${url} ${body}`.slice(0, 700));
  });

  page.on('dialog', async (d) => {
    console.log(`[dialog] ${d.message()}`);
    await d.dismiss().catch(() => {});
  });

  try {
    await page.goto('https://nid.naver.com/nidlogin.login', { waitUntil: 'domcontentloaded' });
    await page.locator('#id').fill(NAVER_ID || '');
    await page.locator('#pw').fill(NAVER_PW || '');
    await page.locator('#log\\.login,button[type=\"submit\"],input[type=\"submit\"]').first().click();
    await page.waitForLoadState('domcontentloaded');

    const targetUrl = `https://admin.blog.naver.com/PostExportForm.naver?blogId=${BLOG_ID}`;
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    const html = await page.content().catch(() => '');
    const popup = String(html).match(/window\.open\("([^"]*nidlogin[^"]*)"/i);
    if (popup) {
      const loginUrl = popup[1].replace(/&amp;/g, '&');
      await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
      if ((await page.locator('#id').count().catch(() => 0)) > 0) {
        await page.locator('#id').fill(NAVER_ID || '');
        await page.locator('#pw').fill(NAVER_PW || '');
        await page.locator('#log\\.login,button[type=\"submit\"],input[type=\"submit\"]').first().click();
        await page.waitForLoadState('domcontentloaded');
      }
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    }
    await page.waitForTimeout(1500);
    const frame = page.frame({ name: 'papermain' }) || page.mainFrame();

    const moved = await gotoPage(frame, TARGET_PAGE);
    if (!moved) throw new Error(`cannot move to page ${TARGET_PAGE}`);

    const checkboxes = frame.locator('tbody input[type="checkbox"]');
    const total = await checkboxes.count();
    for (let i = 0; i < Math.min(10, total); i += 1) {
      await checkboxes.nth(i).check({ force: true }).catch(() => {});
    }
    await frame.waitForTimeout(400);
    await frame.locator('#add_button,a#add_button').first().click({ force: true });
    await frame.waitForTimeout(800);

    const rows = frame.locator('#selected_post_list tr');
    for (let g = 0; g < 20; g += 1) {
      const used = parseMb(await frame.locator('#added_post_capacity').innerText().catch(() => '0MB'));
      if (used <= 500) break;
      const rc = await rows.count();
      if (rc <= 0) break;
      const last = rows.nth(rc - 1);
      await last.locator('input[type="checkbox"]').first().check({ force: true }).catch(() => {});
      await frame.locator('a.btn_del, ._delete').first().click({ force: true }).catch(() => {});
      await frame.waitForTimeout(400);
    }

    await frame.locator('#include_comment').check({ force: true }).catch(() => {});
    await frame.locator('input[name*=\"title\" i],input[id*=\"title\" i],input[type=\"text\"]').first().fill(TITLE);

    const beforeCount = await page.evaluate(() => Number(window.nTotalPdfCount || 0)).catch(() => -1);
    const beforeAdded = await frame.locator('#added_post_capacity').innerText().catch(() => '');
    console.log(`[before] nTotalPdfCount=${beforeCount} added=${beforeAdded}`);

    await frame.locator('a._nclk\\(edt_backup\\.ok\\).btn6,a:has-text(\"만들기\")').first().click({ force: true });
    await page.waitForTimeout(5000);

    const afterCount = await page.evaluate(() => Number(window.nTotalPdfCount || 0)).catch(() => -1);
    const afterAdded = await frame.locator('#added_post_capacity').innerText().catch(() => '');
    const bodySample = (await frame.locator('body').innerText().catch(() => '')).slice(0, 800);
    console.log(`[after] nTotalPdfCount=${afterCount} added=${afterAdded}`);
    console.log(`[body] ${bodySample}`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
