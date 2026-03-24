import { chromium } from 'playwright';
import { config } from 'dotenv';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

config();

const NAVER_ID = process.env.NAVER_ID || process.env.NAVER_SELLER_ID;
const NAVER_PW = process.env.NAVER_PW || process.env.NAVER_SELLER_PW;
const BLOG_ID = process.env.NAVER_BLOG_ID || '2basstune';

const START_PAGE = Number(process.env.NAVER_BLOG_USAGE_START_PAGE || 43);
const END_PAGE = Number(process.env.NAVER_BLOG_USAGE_END_PAGE || 206);
const PAGE_LIST = String(process.env.NAVER_BLOG_USAGE_PAGE_LIST || '')
  .split(',')
  .map((x) => Number(String(x).trim()))
  .filter((n) => Number.isFinite(n) && n > 0);
const PER_PAGE_COUNT = Number(process.env.NAVER_BLOG_USAGE_PER_PAGE_COUNT || 10);
const OUT_PATH = process.env.NAVER_BLOG_USAGE_OUT || `output/naver-blog-page-usage-${START_PAGE}-${END_PAGE}.json`;
const DAILY_LIMIT_MB = Number(process.env.NAVER_BLOG_DAILY_LIMIT_MB || 3072);

const BASE_URL = `https://admin.blog.naver.com/${BLOG_ID}/config/postexport`;

function toMB(value, unit) {
  const u = String(unit || '').toUpperCase();
  if (u === 'GB') return value * 1024;
  if (u === 'KB') return value / 1024;
  return value;
}

function parseRowSizeMB(rowText) {
  const matches = [...String(rowText || '').matchAll(/([0-9,]+(?:\.[0-9]+)?)\s*(KB|MB|GB)/gi)];
  if (matches.length === 0) return null;
  const vals = matches.map((m) => toMB(Number(String(m[1]).replace(/,/g, '')), m[2]));
  vals.sort((a, b) => b - a);
  return Number(vals[0].toFixed(6));
}

async function getPaperFrame(page) {
  for (let i = 0; i < 3; i += 1) {
    await page.waitForSelector('iframe[name="papermain"]', { timeout: 12000 }).catch(() => {});
    const frame = page.frame({ name: 'papermain' });
    if (frame) return frame;
    await page.waitForTimeout(700);
  }
  throw new Error(`papermain frame not found: ${page.url()}`);
}

async function gotoPdfTab(page) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  let frame = await getPaperFrame(page);
  const tab = frame.locator('a[href*="PostExportForm"],a[href*="postexportform"]').first();
  if ((await tab.count()) > 0) {
    await tab.click({ force: true });
    await page.waitForTimeout(800);
    frame = await getPaperFrame(page);
  }
  return frame;
}

async function login(page) {
  await page.goto('https://nid.naver.com/nidlogin.login', { waitUntil: 'domcontentloaded' });
  await page.locator('#id').fill(NAVER_ID);
  await page.locator('#pw').fill(NAVER_PW);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1300);
}

async function goToPage(frame, targetPageNumber) {
  const paginate = (await frame.locator('#paginate').count()) > 0
    ? frame.locator('#paginate').first()
    : frame.locator('[id*="paginate"]').first();

  const hasCurrentMarker = async () => {
    const marker = paginate
      .locator('*')
      .filter({ hasText: new RegExp(`^\\s*${targetPageNumber}\\s*$`) })
      .first();
    if ((await marker.count()) > 0) return true;
    const txt = (await paginate.innerText().catch(() => '')).replace(/\s+/g, ' ');
    return new RegExp(`(^|\\D)${targetPageNumber}(\\D|$)`).test(txt);
  };

  const clickNumeric = async () => {
    const currentMarker = paginate.locator('strong,span,b,em').filter({ hasText: new RegExp(`^\\s*${targetPageNumber}\\s*$`) }).first();
    if ((await currentMarker.count()) > 0) return true;

    const numericLink = paginate
      .locator('a')
      .filter({ hasText: new RegExp(`^\\s*${targetPageNumber}\\s*$`) })
      .first();
    if ((await numericLink.count()) > 0 && (await numericLink.isVisible().catch(() => false))) {
      await numericLink.click({ force: true });
      await frame.waitForTimeout(500);
      return true;
    }
    return false;
  };

  if (await clickNumeric()) return true;
  if (await hasCurrentMarker()) return true;

  for (let step = 0; step < 200; step += 1) {
    if (await hasCurrentMarker()) return true;

    const nums = (await paginate.locator('a').allInnerTexts())
      .map((x) => Number(String(x).trim()))
      .filter((n) => Number.isFinite(n));
    const strongNow = Number((await paginate.locator('strong').first().innerText().catch(() => '')).trim());
    if (Number.isFinite(strongNow)) nums.push(strongNow);
    if (nums.length === 0) return false;
    const min = Math.min(...nums);
    const max = Math.max(...nums);

    if (targetPageNumber >= min && targetPageNumber <= max) {
      const clicked = await clickNumeric();
      if (clicked) return true;
      if (await hasCurrentMarker()) return true;
      return false;
    }

    let moved = false;
    if (targetPageNumber > max) {
      const next = paginate.locator('a,button').filter({ hasText: /다음|next/i }).first();
      if ((await next.count()) > 0) {
        await next.click({ force: true });
        moved = true;
      }
    } else {
      const prev = paginate.locator('a,button').filter({ hasText: /이전|prev/i }).first();
      if ((await prev.count()) > 0) {
        await prev.click({ force: true });
        moved = true;
      }
    }

    if (!moved) return false;
    await frame.waitForTimeout(500);
  }

  return false;
}

async function main() {
  if (!NAVER_ID || !NAVER_PW) throw new Error('missing NAVER creds');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await login(page);

    const rows = [];
    const outFile = path.resolve(process.cwd(), OUT_PATH);
    const saveSnapshot = async () => {
      const okRows = rows.filter((r) => r.ok);
      const totalMB = Number(okRows.reduce((a, b) => a + b.pageTotalMB, 0).toFixed(3));
      const avgPerPageMB = okRows.length > 0 ? Number((totalMB / okRows.length).toFixed(3)) : 0;
      const estDays = Number((totalMB / DAILY_LIMIT_MB).toFixed(3));
      const estDaysCeil = Math.ceil(totalMB / DAILY_LIMIT_MB);
      const out = {
        generatedAt: new Date().toISOString(),
        range: { startPage: START_PAGE, endPage: END_PAGE, perPageCount: PER_PAGE_COUNT },
        assumptions: { dailyLimitMB: DAILY_LIMIT_MB },
        summary: {
          scannedPages: okRows.length,
          failedPages: rows.length - okRows.length,
          totalMB,
          avgPerPageMB,
          estimatedDaysExact: estDays,
          estimatedDaysCeil: estDaysCeil,
        },
        rows,
      };
      await mkdir(path.dirname(outFile), { recursive: true });
      await writeFile(outFile, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
      return out;
    };

    const targets = PAGE_LIST.length > 0
      ? PAGE_LIST
      : Array.from({ length: END_PAGE - START_PAGE + 1 }, (_, i) => START_PAGE + i);

    for (const p of targets) {
      let done = false;
      for (let retry = 0; retry < 2 && !done; retry += 1) {
        try {
          const frame = await gotoPdfTab(page);
          const ok = await goToPage(frame, p);
          if (!ok) {
            rows.push({ page: p, ok: false, reason: 'navigate_failed', postCount: 0, pageTotalMB: 0, postMB: [] });
          } else {
            const trs = frame.locator('tbody tr');
            const trCount = await trs.count();
            const take = Math.min(PER_PAGE_COUNT, trCount);
            const postMB = [];
            for (let i = 0; i < take; i += 1) {
              const txt = (await trs.nth(i).innerText().catch(() => '')).trim();
              const mb = parseRowSizeMB(txt);
              if (Number.isFinite(mb)) postMB.push(mb);
            }
            const pageTotal = Number(postMB.reduce((a, b) => a + b, 0).toFixed(3));
            rows.push({ page: p, ok: true, postCount: postMB.length, pageTotalMB: pageTotal, postMB });
            console.log(`[usage] page=${p} posts=${postMB.length} totalMB=${pageTotal}`);
          }
          await saveSnapshot();
          done = true;
        } catch (err) {
          if (retry === 0) {
            await login(page).catch(() => {});
          } else {
            rows.push({
              page: p,
              ok: false,
              reason: `error:${String(err?.message || err)}`.slice(0, 200),
              postCount: 0,
              pageTotalMB: 0,
              postMB: [],
            });
            await saveSnapshot();
            done = true;
          }
        }
      }
    }

    const out = await saveSnapshot();
    console.log(JSON.stringify({ outFile, ...out.summary }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
