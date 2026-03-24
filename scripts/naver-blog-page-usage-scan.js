import { chromium } from 'playwright';
import { config } from 'dotenv';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

config();

const NAVER_ID = process.env.NAVER_ID || process.env.NAVER_SELLER_ID;
const NAVER_PW = process.env.NAVER_PW || process.env.NAVER_SELLER_PW;

const START_PAGE = Number(process.env.NAVER_BLOG_SCAN_START_PAGE || 43);
const END_PAGE = Number(process.env.NAVER_BLOG_SCAN_END_PAGE || 206);
const CHECK_COUNT = Number(process.env.NAVER_BLOG_SCAN_CHECK_COUNT || 10);
const PROGRESS_PATH = process.env.NAVER_BLOG_SCAN_PROGRESS_PATH || 'output/naver-blog-page-usage-progress.json';
const SLOW_MO = Number(process.env.SLOW_MO || 50);
const HEADLESS = String(process.env.HEADLESS || 'true').toLowerCase() === 'true';
const BLOG_ID = process.env.NAVER_BLOG_ID || '2basstune';
const ADMIN_BASE_URL = `https://admin.blog.naver.com/${BLOG_ID}/config/postexport`;

function toMB(value, unit) {
  const u = String(unit || '').toUpperCase();
  if (u === 'GB') return value * 1024;
  if (u === 'KB') return value / 1024;
  return value;
}

function parseUsageFromText(text) {
  const regex = /([0-9,]+(?:\.[0-9]+)?)\s*(KB|MB|GB)\s*\/\s*([0-9,]+(?:\.[0-9]+)?)\s*(KB|MB|GB)/gi;
  const matches = [];
  let m;
  while ((m = regex.exec(String(text || ''))) !== null) {
    matches.push({
      usedMB: toMB(Number(String(m[1]).replace(/,/g, '')), m[2]),
      limitMB: toMB(Number(String(m[3]).replace(/,/g, '')), m[4]),
      raw: m[0],
    });
  }
  if (matches.length === 0) return null;
  const storage = matches.filter((x) => x.limitMB >= 1024);
  if (storage.length > 0) {
    storage.sort((a, b) => b.limitMB - a.limitMB || b.usedMB - a.usedMB);
    return storage[0];
  }
  return null;
}

async function readUsage(frame) {
  const bodyText = await frame.locator('body').innerText().catch(() => '');
  return parseUsageFromText(bodyText);
}

async function readUsageAny(page, frame) {
  const inFrame = await readUsage(frame).catch(() => null);
  if (inFrame) return inFrame;
  const pageText = await page.locator('body').innerText().catch(() => '');
  return parseUsageFromText(pageText);
}

async function saveJson(filePath, data) {
  const full = path.resolve(process.cwd(), filePath);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function loadJson(filePath) {
  try {
    const full = path.resolve(process.cwd(), filePath);
    const raw = await readFile(full, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function getPaperFrame(page) {
  await page.waitForSelector('iframe[name="papermain"]', { timeout: 20000 });
  const frame = page.frame({ name: 'papermain' });
  if (!frame) throw new Error('papermain frame not found');
  return frame;
}

async function ensurePdfMakeTab(frame) {
  const hasPageLinks = await frame.locator('#paginate a').count();
  if (hasPageLinks > 0) return;

  const tabByHref = frame.locator('a[href*="PostExportForm"],a[href*="postexportform"]').first();
  if ((await tabByHref.count()) > 0 && (await tabByHref.isVisible().catch(() => false))) {
    await tabByHref.click({ force: true });
    await frame.waitForTimeout(1000);
    return;
  }

  const pdfTab = frame.getByRole('link', { name: 'PDF 留뚮뱾湲?' }).first();
  if ((await pdfTab.count()) > 0 && (await pdfTab.isVisible())) {
    await pdfTab.click({ force: true });
    await frame.waitForTimeout(1000);
  }
}

async function goToPage(frame, targetPageNumber) {
  const paginate = (await frame.locator('#paginate').count()) > 0
    ? frame.locator('#paginate').first()
    : frame.locator('[id*="paginate"]').first();

  const readVisiblePageNumbers = async () => {
    const pageTexts = await paginate.locator('a').allInnerTexts();
    return pageTexts
      .map((t) => Number(String(t).trim()))
      .filter((n) => Number.isFinite(n));
  };

  const clickNumeric = async () => {
    const numericLink = paginate
      .locator('a')
      .filter({ hasText: new RegExp(`^\\s*${targetPageNumber}\\s*$`) })
      .first();
    if ((await numericLink.count()) > 0 && (await numericLink.isVisible())) {
      await numericLink.click({ force: true });
      await frame.waitForTimeout(700);
      return true;
    }
    return false;
  };

  if (await clickNumeric()) return true;

  for (let step = 0; step < 150; step += 1) {
    const pageNumbers = await readVisiblePageNumbers();
    if (pageNumbers.length === 0) return false;

    const minPage = Math.min(...pageNumbers);
    const maxPage = Math.max(...pageNumbers);

    if (targetPageNumber >= minPage && targetPageNumber <= maxPage) {
      return clickNumeric();
    }

    let moved = false;
    if (targetPageNumber > maxPage) {
      const next = paginate.locator('a,button').filter({ hasText: /다음|next/i }).first();
      if ((await next.count()) > 0 && (await next.isVisible().catch(() => false))) {
        await next.click({ force: true });
        moved = true;
      }
    } else {
      const prev = paginate.locator('a,button').filter({ hasText: /이전|prev/i }).first();
      if ((await prev.count()) > 0 && (await prev.isVisible().catch(() => false))) {
        await prev.click({ force: true });
        moved = true;
      }
    }

    if (!moved) return false;
    await frame.waitForTimeout(700);
  }

  return false;
}

async function clearAllSelections(frame) {
  const checked = frame.locator('tbody input[type="checkbox"]:checked');
  const count = await checked.count();
  for (let i = 0; i < count; i += 1) {
    await checked.nth(i).uncheck({ force: true }).catch(() => {});
  }
}

async function readSelectedUsage(frame) {
  const texts = await frame.locator('text=/\\/\\s*500\\s*MB/i').allInnerTexts().catch(() => []);
  const regex = /([0-9]+(?:\.[0-9]+)?)\s*(KB|MB|GB)\s*\/\s*500\s*MB/i;
  const parsed = [];
  for (const t of texts) {
    const m = String(t).match(regex);
    if (!m) continue;
    parsed.push({
      usedMB: toMB(Number(m[1]), m[2]),
      limitMB: 500,
      raw: m[0],
    });
  }
  if (parsed.length === 0) return null;
  parsed.sort((a, b) => b.usedMB - a.usedMB);
  return parsed[0];
}

async function selectFirstN(frame, n) {
  await clearAllSelections(frame);
  const boxes = frame.locator('tbody input[type="checkbox"]:enabled');
  const total = await boxes.count();
  const take = Math.min(total, n);
  for (let i = 0; i < take; i += 1) {
    await boxes.nth(i).check({ force: true }).catch(() => {});
  }
  await frame.waitForTimeout(350);
  return take;
}

async function clickAddWithDialog(page, frame) {
  let dialogMessage = '';
  let clicked = false;
  const dialogPromise = page.waitForEvent('dialog', { timeout: 1800 }).then(async (d) => {
    dialogMessage = d.message();
    await d.dismiss().catch(() => {});
  }).catch(() => {});

  let addLink = frame.locator('a:has-text("추가")').first();
  if ((await addLink.count()) === 0) {
    addLink = frame.getByRole('link', { name: '異붽?' }).first();
  }
  if ((await addLink.count()) > 0) {
    await addLink.click({ force: true }).then(() => { clicked = true; }).catch(() => {});
  }
  await dialogPromise;
  return { ok: clicked && !dialogMessage, dialogMessage, clicked };
}

async function openSavedList(page) {
  await page.goto(ADMIN_BASE_URL, { waitUntil: 'domcontentloaded' });
  let frame = await getPaperFrame(page);
  const tab = frame.locator('a[href*="PostExportPdfList"],a[href*="postexportpdflist"]').first();
  if ((await tab.count()) > 0) {
    await tab.click({ force: true });
    await page.waitForTimeout(700);
    frame = await getPaperFrame(page);
  }
  return frame;
}

async function measureAndDeleteRowByTitle(page, context, title) {
  const frame = await openSavedList(page);
  let row = frame.locator('tbody tr', { hasText: title }).first();
  if ((await row.count()) === 0) {
    row = frame.locator('tbody tr').first();
  }
  if ((await row.count()) === 0) return { deleted: false, fileMB: null, downloadUrl: '', rowText: '' };

  const rowText = (await row.innerText().catch(() => '')).trim();
  let fileMB = null;
  const sizeMatches = [...rowText.matchAll(/([0-9,]+(?:\.[0-9]+)?)\s*(KB|MB|GB)/gi)];
  if (sizeMatches.length > 0) {
    const candidates = sizeMatches.map((m) => toMB(Number(String(m[1]).replace(/,/g, '')), m[2]));
    candidates.sort((a, b) => b - a);
    fileMB = Number(candidates[0].toFixed(2));
  }

  const dl = row.locator('a[href*="download.blog.naver.com"]').first();
  const downloadUrl = (await dl.getAttribute('href').catch(() => '')) || '';
  if (downloadUrl && !fileMB) {
    const headRes = await context.request.fetch(downloadUrl, { method: 'HEAD', failOnStatusCode: false }).catch(() => null);
    const len = headRes?.headers()?.['content-length'] || headRes?.headers()?.['Content-Length'];
    if (len && Number.isFinite(Number(len))) {
      fileMB = Number((Number(len) / (1024 * 1024)).toFixed(2));
    } else {
      const getRes = await context.request.get(downloadUrl, { failOnStatusCode: false }).catch(() => null);
      if (getRes && getRes.ok()) {
        const body = await getRes.body();
        fileMB = Number((body.length / (1024 * 1024)).toFixed(2));
      }
    }
  }

  let del = row.locator('a[href="#"],a[onclick*="del"],a[onclick*="remove"],a[onclick*="delete"]').first();
  if ((await del.count()) === 0) {
    del = row.locator('a').nth(1);
  }

  const dialogPromise = page.waitForEvent('dialog', { timeout: 2000 }).catch(() => null);
  await del.click({ force: true }).catch(() => {});
  const dlg = await dialogPromise;
  if (dlg) await dlg.accept().catch(() => {});
  await page.waitForTimeout(700);
  return { deleted: true, fileMB, downloadUrl, rowText };
}

async function reopenPdfMakeAtPage(page, pageNo) {
  await page.goto(ADMIN_BASE_URL, { waitUntil: 'domcontentloaded' });
  let frame = await getPaperFrame(page);
  const tab = frame.locator('a[href*="PostExportForm"],a[href*="postexportform"]').first();
  if ((await tab.count()) > 0) {
    await tab.click({ force: true });
    await page.waitForTimeout(700);
    frame = await getPaperFrame(page);
  }
  await ensurePdfMakeTab(frame);
  const ok = await goToPage(frame, pageNo);
  if (!ok) throw new Error(`cannot navigate page ${pageNo}`);
  return frame;
}

async function main() {
  if (!NAVER_ID || !NAVER_PW) throw new Error('missing NAVER_ID/NAVER_PW');

  const loaded = await loadJson(PROGRESS_PATH);
  const resumePage = Number(loaded?.nextPage);
  const runStart = Number.isFinite(resumePage) && resumePage >= START_PAGE && resumePage <= END_PAGE
    ? resumePage
    : START_PAGE;

  const progress = loaded && loaded.range?.startPage === START_PAGE && loaded.range?.endPage === END_PAGE
    ? loaded
    : {
      updatedAt: new Date().toISOString(),
      status: 'running',
      range: { startPage: START_PAGE, endPage: END_PAGE, checkCount: CHECK_COUNT },
      nextPage: runStart,
      completedUntil: runStart - 1,
      rows: [],
    };

  const browser = await chromium.launch({ headless: HEADLESS, slowMo: SLOW_MO });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto('https://nid.naver.com/nidlogin.login', { waitUntil: 'domcontentloaded' });
    await page.locator('#id').fill(NAVER_ID);
    await page.locator('#pw').fill(NAVER_PW);
    await page.keyboard.press('Enter');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1200);

    for (let p = runStart; p <= END_PAGE; p += 1) {
      let frame = await reopenPdfMakeAtPage(page, p);

      const checkedCount = await selectFirstN(frame, CHECK_COUNT);
      const selectedUsage = await readSelectedUsage(frame);

      const title = `usage_scan_${String(p).padStart(3, '0')}_${Date.now()}`;
      const titleInput = frame.getByRole('textbox', { name: '?뚯씪 ?쒕ぉ' });
      await titleInput.click().catch(() => {});
      await titleInput.fill(title).catch(() => {});

      const addResult = await clickAddWithDialog(page, frame);
      let measuredFileMB = null;
      let measuredDownloadUrl = '';
      let measuredRowText = '';
      let deleted = false;
      if (addResult.ok) {
        const measured = await measureAndDeleteRowByTitle(page, context, title).catch(() => null);
        if (measured) {
          measuredFileMB = measured.fileMB;
          measuredDownloadUrl = measured.downloadUrl;
          measuredRowText = measured.rowText || '';
          deleted = measured.deleted;
        }
      }

      const row = {
        page: p,
        checkedCount,
        selectedUsageMB: selectedUsage ? Number(selectedUsage.usedMB.toFixed(2)) : null,
        selectedUsageRaw: selectedUsage?.raw || '',
        measuredFileMB,
        measuredDownloadUrl,
        measuredRowText,
        deletedAfterMeasure: deleted,
        addOk: addResult.ok,
        addDialog: addResult.dialogMessage,
        scannedAt: new Date().toISOString(),
      };

      const idx = progress.rows.findIndex((x) => x.page === p);
      if (idx >= 0) progress.rows[idx] = row;
      else progress.rows.push(row);

      progress.updatedAt = new Date().toISOString();
      progress.nextPage = p + 1;
      progress.completedUntil = p;
      progress.status = p >= END_PAGE ? 'done' : 'running';
      await saveJson(PROGRESS_PATH, progress);

      console.log(`[scan] page=${p} checked=${checkedCount} measured=${row.measuredFileMB ?? 'N/A'}MB addOk=${row.addOk}`);
    }

    const valid = progress.rows.filter((x) => Number.isFinite(x.measuredFileMB) && x.measuredFileMB > 0);
    const avg = valid.length > 0
      ? valid.reduce((a, b) => a + b.measuredFileMB, 0) / valid.length
      : 0;
    const remainPages = Math.max(END_PAGE - progress.completedUntil, 0);

    progress.summary = {
      scannedPages: progress.rows.length,
      avgMeasuredFileMB: Number(avg.toFixed(2)),
      remainPages,
      estimatedDaysAt3GB: avg > 0 ? Number((remainPages / (3072 / avg)).toFixed(2)) : null,
    };
    progress.updatedAt = new Date().toISOString();
    progress.status = 'done';
    await saveJson(PROGRESS_PATH, progress);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
