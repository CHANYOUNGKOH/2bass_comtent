import { chromium } from 'playwright';
import { config } from 'dotenv';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

config();

const NAVER_ID = process.env.NAVER_ID || process.env.NAVER_SELLER_ID;
const NAVER_PW = process.env.NAVER_PW || process.env.NAVER_SELLER_PW;

const BATCH_SIZE = Number(process.env.NAVER_BLOG_BATCH_SIZE || 10);
const TITLE_PREFIX = process.env.NAVER_BLOG_TITLE_PREFIX || '투베이스_블로그';
const MAX_ITERATIONS = Number(process.env.NAVER_BLOG_MAX_ITERATIONS || 500);
const RESERVE_MB = Number(process.env.NAVER_BLOG_RESERVE_MB || 50);
const PAGE_SELECTION_LIMIT_MB = Number(process.env.NAVER_BLOG_PAGE_LIMIT_MB || 500);
const PROGRESS_PATH = process.env.NAVER_BLOG_PROGRESS_PATH || 'output/naver-blog-pdf-progress.json';
const START_PAGE = Number(process.env.NAVER_BLOG_START_PAGE || 1);
const DOWNLOAD_DIR = process.env.NAVER_BLOG_DOWNLOAD_DIR || 'output/naver-blog-pdfs';
const MAX_SAVED_LIST_DRAIN = Number(process.env.NAVER_BLOG_MAX_SAVED_LIST_DRAIN || 30);
const BLOG_ID = process.env.NAVER_BLOG_ID || '2basstune';
const CONFIG_POSTEXPORT_URL = `https://admin.blog.naver.com/${BLOG_ID}/config/postexport`;
const USE_PERSISTENT_CONTEXT = String(process.env.NAVER_BLOG_USE_PERSISTENT || 'false').toLowerCase() === 'true';
const PERSISTENT_DIR = process.env.NAVER_BLOG_PERSISTENT_DIR || 'output/pw-userdata-admin';
const ADMIN_LOGIN_URL =
  'https://nid.naver.com/nidlogin.login?mode=form&svctype=64&url=http://admin.blog.naver.com/CloseLoginPopup.naver';

function sanitizeFileName(name) {
  return String(name || 'download.pdf')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

async function resolveUniquePath(baseDir, fileName) {
  const parsed = path.parse(fileName);
  const ext = parsed.ext || '.pdf';
  const base = parsed.name || 'download';
  let attempt = 0;
  while (attempt < 1000) {
    const candidateName = attempt === 0 ? `${base}${ext}` : `${base}-${attempt}${ext}`;
    const candidatePath = path.resolve(baseDir, candidateName);
    try {
      await readFile(candidatePath);
      attempt += 1;
    } catch {
      return candidatePath;
    }
  }
  return path.resolve(baseDir, `${base}-${Date.now()}${ext}`);
}

async function loadProgress() {
  const filePath = path.resolve(process.cwd(), process.env.NAVER_BLOG_PROGRESS_PATH || PROGRESS_PATH);
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function toMB(value, unit) {
  const u = String(unit || '').toUpperCase();
  if (u === 'GB') return value * 1024;
  if (u === 'KB') return value / 1024;
  return value;
}

function parseUsageFromText(text) {
  const regex = /([0-9]+(?:\.[0-9]+)?)\s*(KB|MB|GB)\s*\/\s*([0-9]+(?:\.[0-9]+)?)\s*(KB|MB|GB)/gi;
  const matches = [];
  let m;
  while ((m = regex.exec(text)) !== null) {
    const used = Number(m[1]);
    const usedUnit = m[2];
    const limit = Number(m[3]);
    const limitUnit = m[4];
    matches.push({
      usedMB: toMB(used, usedUnit),
      limitMB: toMB(limit, limitUnit),
      raw: m[0],
    });
  }
  if (matches.length === 0) return null;

  // Prefer storage-like usage meter (usually >= 1GB total).
  const storageMatches = matches.filter((x) => x.limitMB >= 1024);
  if (storageMatches.length > 0) {
    storageMatches.sort((a, b) => b.limitMB - a.limitMB || b.usedMB - a.usedMB);
    return storageMatches[0];
  }

  return null;
}

async function getPaperFrame(page) {
  const iframeSelector = 'iframe[name="papermain"]';
  const iframeCount = await page.locator(iframeSelector).count().catch(() => 0);
  if (iframeCount > 0) {
    await page.waitForSelector(iframeSelector, { timeout: 20000, state: 'attached' });
    const frame = page.frame({ name: 'papermain' });
    if (frame) return frame;
  }

  // New admin layouts can render content directly in the main frame.
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  return page.mainFrame();
}

async function gotoPostExportForm(page) {
  const postExportUrl = CONFIG_POSTEXPORT_URL;
  await page.goto(postExportUrl, { waitUntil: 'domcontentloaded' });

  if (String(page.url()).includes('idSafetyRelease')) {
    throw new Error('id_safety_release_required');
  }
  await page.waitForTimeout(500);

  const html = await page.content().catch(() => '');
  if (/아이디\s*보호조치\s*해제/i.test(html)) {
    throw new Error('id_safety_release_required');
  }
  const loginPopupMatch = String(html).match(/window\.open\("([^"]*nidlogin[^"]*)"/i);
  const needsDirectLogin = /nid\.naver\.com\/nidlogin\.login/i.test(page.url());
  if (!loginPopupMatch && !needsDirectLogin) return;

  const loginUrl = (loginPopupMatch?.[1] || ADMIN_LOGIN_URL).replace(/&amp;/g, '&');
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded' }).catch(async () => {
    await page.goto(ADMIN_LOGIN_URL, { waitUntil: 'domcontentloaded' });
  });
  if ((await page.locator('#id').count().catch(() => 0)) > 0) {
    await page.locator('#id').fill(NAVER_ID);
    await page.locator('#pw').fill(NAVER_PW);
    await page.locator('#log\\.login,button[type="submit"],input[type="submit"]').first().click();
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(1200);
  }

  await page.goto(postExportUrl, { waitUntil: 'domcontentloaded' });
}

async function readUsage(frame) {
  const bodyText = await frame.locator('body').innerText();
  return parseUsageFromText(bodyText);
}

async function readSelectedUsage(frame) {
  const texts = await frame.locator('text=/\\/\\s*500\\s*MB/i').allInnerTexts().catch(() => []);
  const regex = /([0-9]+(?:\.[0-9]+)?)\s*(KB|MB|GB)\s*\/\s*500\s*MB/i;
  const parsed = [];
  for (const t of texts) {
    const m = String(t).match(regex);
    if (!m) continue;
    parsed.push({
      count: -1,
      usedMB: toMB(Number(m[1]), m[2]),
      limitMB: 500,
      raw: m[0],
    });
  }
  if (parsed.length > 0) {
    parsed.sort((a, b) => b.usedMB - a.usedMB);
    return parsed[0];
  }
  return null;
}

function parseMbText(text) {
  const m = String(text || '')
    .replace(/,/g, '')
    .match(/([0-9]+(?:\.[0-9]+)?)\s*(KB|MB|GB)/i);
  if (!m) return 0;
  return toMB(Number(m[1]), m[2]);
}

async function readSelectedUsageByCheckedRows(frame) {
  const checked = frame.locator('tbody input[type="checkbox"]:checked');
  const count = await checked.count().catch(() => 0);
  let usedMB = 0;
  for (let i = 0; i < count; i += 1) {
    const row = checked.nth(i).locator('xpath=ancestor::tr[1]');
    const capText = await row.locator('._capacity,.num._capacity,td:has(._capacity)').first().innerText().catch(() => '');
    usedMB += parseMbText(capText);
  }
  return {
    count,
    usedMB: Number(usedMB.toFixed(3)),
    limitMB: 500,
    raw: `${usedMB.toFixed(3)}MB /500MB`,
  };
}

async function clearAllSelections(frame) {
  const checked = frame.locator('tbody input[type="checkbox"]:checked');
  const count = await checked.count();
  for (let i = 0; i < count; i += 1) {
    await checked.nth(i).uncheck({ force: true }).catch(() => {});
  }
}

async function getCandidateIndices(frame, maxCount) {
  const checkboxes = frame.locator('tbody input[type="checkbox"]:enabled');
  const total = await checkboxes.count();
  const count = Math.min(total, maxCount);
  return Array.from({ length: count }, (_, i) => i);
}

async function selectIndicesByUsageBudget(frame, candidates, budgetMB) {
  const checkboxes = frame.locator('tbody input[type="checkbox"]:enabled');
  const selected = [];
  const oversized = [];

  for (const idx of candidates) {
    const box = checkboxes.nth(idx);
    if ((await box.count()) === 0) continue;
    await box.check({ force: true }).catch(() => {});
    await frame.waitForTimeout(120);

    let selectedUsage = null;
    for (let i = 0; i < 5; i += 1) {
      selectedUsage = await readSelectedUsage(frame);
      if (selectedUsage) break;
      await frame.waitForTimeout(120);
    }
    if (!selectedUsage) {
      // Skip item if selected usage meter is not detected.
      await box.uncheck({ force: true }).catch(() => {});
      continue;
    }

    const limit = Math.min(selectedUsage.limitMB, budgetMB);
    if (selectedUsage.usedMB > limit) {
      await box.uncheck({ force: true }).catch(() => {});
      if (selected.length === 0) oversized.push(idx);
      continue;
    }
    selected.push(idx);
  }

  const usage = await readSelectedUsage(frame);
  return { selected, oversized, totalMB: usage?.usedMB ?? 0 };
}

async function clickAddWithDialogHandling(page, frame) {
  let blocked = false;
  const dialogPromise = page
    .waitForEvent('dialog', { timeout: 1500 })
    .then(async (dialog) => {
      blocked = true;
      console.log(`[dialog] ${dialog.message()}`);
      await dialog.dismiss();
    })
    .catch(() => {});

  await frame
    .locator('#add_button,a#add_button,a._nclk\\(edt_backup\\.add\\).btn10,a:has-text("추가")')
    .first()
    .click();
  await dialogPromise;
  return !blocked;
}

async function goToPage(frame, targetPageNumber) {
  console.log(`[goToPage] target=${targetPageNumber} enter`);
  for (let step = 0; step < 120; step += 1) {
    const result = await frame
      .evaluate((target) => {
        const pg =
          document.querySelector('#paginate') ||
          document.querySelector('[id*="paginate"]');
        if (!pg) return { ok: false, done: false, reason: 'no_paginate' };

        const links = Array.from(pg.querySelectorAll('a'));
        const nums = links
          .map((a) => Number(String(a.textContent || '').trim()))
          .filter((n) => Number.isFinite(n));

        const strong = Number(String(pg.querySelector('strong')?.textContent || '').trim());
        if (Number.isFinite(strong) && strong === target) {
          return { ok: true, done: true, reason: 'already_on_target' };
        }

        const exact = links.find((a) => String(a.textContent || '').trim() === String(target));
        if (exact) {
          exact.click();
          return { ok: true, done: true, reason: 'clicked_target' };
        }

        if (nums.length === 0) return { ok: false, done: false, reason: 'no_numeric_links' };
        const min = Math.min(...nums);
        const max = Math.max(...nums);

        if (target > max) {
          const next =
            links.find((a) => /다음|next/i.test(String(a.textContent || ''))) ||
            pg.querySelector('a.next,[rel="next"]');
          if (next) {
            next.click();
            return { ok: true, done: false, reason: 'clicked_next', min, max };
          }
          return { ok: false, done: false, reason: 'next_not_found', min, max };
        }

        if (target < min) {
          const prev =
            links.find((a) => /이전|prev/i.test(String(a.textContent || ''))) ||
            pg.querySelector('a.pre,[rel="prev"],a.prev');
          if (prev) {
            prev.click();
            return { ok: true, done: false, reason: 'clicked_prev', min, max };
          }
          return { ok: false, done: false, reason: 'prev_not_found', min, max };
        }

        return { ok: false, done: false, reason: 'in_range_not_found', min, max };
      }, targetPageNumber)
      .catch(() => ({ ok: false, done: false, reason: 'evaluate_failed' }));

    if (!result.ok) {
      console.log(`[goToPage] target=${targetPageNumber} step=${step} fail=${result.reason}`);
      return false;
    }
    if (result.done) return true;
    await frame.waitForTimeout(550);
  }

  console.log(`[goToPage] target=${targetPageNumber} exhausted steps`);
  return false;
}

async function ensurePdfMakeTab(frame) {
  const hasPageLinks = await frame.locator('#paginate a').count();
  if (hasPageLinks > 0) return;

  const byRole = frame.getByRole('link', { name: /PDF\s*만들기|PDF/i }).first();
  if ((await byRole.count()) > 0 && (await byRole.isVisible().catch(() => false))) {
    await byRole.click({ force: true }).catch(() => {});
    await frame.waitForTimeout(1000);
    return;
  }
  const pdfTab = frame.locator('a[href*="PostExportForm"],a[href*="postexportform"]').first();
  if ((await pdfTab.count()) > 0 && (await pdfTab.isVisible().catch(() => false))) {
    await pdfTab.click({ force: true }).catch(() => {});
    await frame.waitForTimeout(1000);
  }
}

async function clickMakeWithRetry(page, frame, title) {
  const makeLink = frame
    .locator(
      [
        '#post_save_button',
        'a#post_save_button',
        '.post_btn2 a._nclk\\(edt_backup\\.ok\\).btn6',
        '.post_btn2 a.btn6',
      ].join(',')
    )
    .first();
  let noPostsToSave = false;
  for (let i = 0; i < 3; i += 1) {
    if ((await makeLink.count()) === 0 || !(await makeLink.isVisible().catch(() => false))) {
      // Fallback: exact "만들기" link only (exclude "PDF 만들기")
      const byExactText = frame.getByRole('link', { name: /^만들기$/, exact: true }).first();
      if ((await byExactText.count()) > 0 && (await byExactText.isVisible().catch(() => false))) {
        await byExactText.click({ force: true, timeout: 3000 }).catch(async () => {
          await byExactText.evaluate((el) => el.click()).catch(() => {});
        });
        await frame.waitForTimeout(600);
      }
      await frame.waitForTimeout(800);
      continue;
    }

    const beforePdfCount = await readTotalPdfCount(frame);
    const beforeUsage = await readAddedPostUsage(frame).catch(() => ({ usedMB: 0 }));
    if (String(process.env.DEBUG_MAKE_DUMP || '').toLowerCase() === 'true') {
      const debugDir = path.resolve(process.cwd(), 'output');
      await mkdir(debugDir, { recursive: true }).catch(() => {});
      const stamp = Date.now();
      const html = await frame.content().catch(() => '');
      await writeFile(path.join(debugDir, `make-before-${stamp}.html`), html, 'utf8').catch(() => {});
    }
    console.log(`[make] try=${i + 1} title=${title} beforePdfCount=${beforePdfCount} beforeUsage=${beforeUsage.usedMB}`);
    const dialogPromise = page.waitForEvent('dialog', { timeout: 1800 }).catch(() => null);
    await makeLink.click({ force: true, timeout: 3000 }).catch(async () => {
      await makeLink.evaluate((el) => el.click()).catch(() => {});
    });
    const dialog = await dialogPromise;
    if (dialog) {
      const msg = String(dialog.message() || '');
      console.log(`[make-dialog] ${msg}`);
      if (/저장할\s*글이\s*없습니다|no\s*post/i.test(msg)) {
        noPostsToSave = true;
        await dialog.dismiss().catch(() => {});
        return 'empty';
      }
      // Confirm dialogs should be accepted; dismiss can cancel actual PDF creation.
      await dialog.accept().catch(() => {});
    }

    // Success signal should come from explicit UI feedback after clicking make.
    for (let w = 0; w < 40; w += 1) {
      const hasCreating = (await frame.locator('text=/생성중|creating|processing/i').count().catch(() => 0)) > 0;
      const hasTitle = await frame.getByText(title).first().isVisible().catch(() => false);
      const nowUsage = await readAddedPostUsage(frame).catch(() => ({ usedMB: beforeUsage.usedMB }));
      const usageDroppedToZero = beforeUsage.usedMB > 10 && nowUsage.usedMB < 1;
      const afterPdfCount = await readTotalPdfCount(frame);
      const countIncreased = beforePdfCount >= 0 && afterPdfCount > beforePdfCount;
      if (w === 39) {
        console.log(
          `[make] timeout title=${title} afterPdfCount=${afterPdfCount} nowUsage=${nowUsage.usedMB} hasCreating=${hasCreating} hasTitle=${hasTitle}`
        );
      }
      if (hasCreating) return 'ok';
      // In Naver flow, "make" can clear selected list immediately and move job to saved-list "생성중".
      if (usageDroppedToZero) return 'ok';
      if ((hasCreating || hasTitle) && countIncreased) return 'ok';
      if (countIncreased) return 'ok';
      await frame.waitForTimeout(500);
    }
  }
  return noPostsToSave ? 'empty' : 'fail';
}

async function readAddedPostUsage(frame) {
  const usedText = await frame.locator('#added_post_capacity').first().innerText().catch(() => '');
  const limitText = await frame.locator('#max_pdf_capacity').first().innerText().catch(() => '500MB');
  const usedMB = parseMbText(usedText);
  const limitMB = parseMbText(limitText) || 500;
  return {
    usedMB: Number(usedMB.toFixed(3)),
    limitMB: Number(limitMB.toFixed(3)),
    raw: `${usedMB.toFixed(3)}MB /${limitMB.toFixed(0)}MB`,
  };
}

async function readTotalPdfCount(frame) {
  // 1) JS state variable (most reliable in this admin page)
  const byVar = await frame
    .evaluate(() => {
      const v = Number(window?.nTotalPdfCount || 0);
      return Number.isFinite(v) ? v : -1;
    })
    .catch(() => -1);
  if (byVar >= 0) return byVar;

  // 2) Visible summary text
  const txt = await frame.locator('body').innerText().catch(() => '');
  const m = String(txt).match(/전체\s*PDF\s*파일\s*([0-9]+)\s*개/i);
  if (!m) return -1;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : -1;
}

async function trimAddedPostsToLimit(frame, limitMB = 500) {
  let guard = 0;
  while (guard < 50) {
    guard += 1;
    const usage = await readAddedPostUsage(frame);
    if (usage.usedMB <= limitMB) return usage;

    const selectedRows = frame.locator('#selected_post_list tr');
    const rowCount = await selectedRows.count().catch(() => 0);
    if (rowCount <= 0) return usage;

    const lastRow = selectedRows.nth(rowCount - 1);
    const cb = lastRow.locator('input[type="checkbox"]').first();
    if ((await cb.count()) === 0) return usage;
    await cb.check({ force: true }).catch(() => {});

    const del = frame
      .locator('a.btn_del, ._delete, #del_button, a#del_button, a._nclk\\(edt_backup\\.selectdelete\\), a:has-text("삭제")')
      .first();
    if ((await del.count()) === 0) return usage;
    await del.click({ force: true }).catch(() => {});
    await frame.waitForTimeout(400);
  }
  return readAddedPostUsage(frame);
}

async function createPdfChunk({ profilePage, frame, batch, suffix, indices }) {
  await clearAllSelections(frame);
  const checkboxes = frame.locator('tbody input[type="checkbox"]:enabled');
  let checkedCount = 0;
  for (const idx of indices) {
    const box = checkboxes.nth(idx);
    if ((await box.count()) === 0) continue;
    await box.check({ force: true }).catch(() => {});
    checkedCount += 1;
  }

  if (checkedCount === 0) {
    return { ok: false, reason: 'no_checked', checkedCount: 0, title: '', selectedUsage: null };
  }

  const selectedUsage = await readSelectedUsageByCheckedRows(frame);
  if (!selectedUsage || selectedUsage.usedMB <= 0) {
    return { ok: false, reason: 'selected_usage_zero', checkedCount, title: '', selectedUsage: selectedUsage || null };
  }

  const title = `${TITLE_PREFIX}_${String(batch).padStart(3, '0')}${suffix}`;
  const titleInput = frame
    .locator('input[name*="title" i],input[id*="title" i],input[type="text"]')
    .first();
  await titleInput.click();
  await titleInput.fill(title);

  const addOk = await clickAddWithDialogHandling(profilePage, frame);
  if (!addOk) {
    return { ok: false, reason: 'dialog_blocked_on_add', checkedCount, title, selectedUsage };
  }

  const adjustedUsage = await trimAddedPostsToLimit(frame, PAGE_SELECTION_LIMIT_MB);
  if (!adjustedUsage || adjustedUsage.usedMB <= 0 || adjustedUsage.usedMB > PAGE_SELECTION_LIMIT_MB) {
    return {
      ok: false,
      reason: 'over_500_after_trim',
      checkedCount,
      title,
      selectedUsage: adjustedUsage || selectedUsage,
    };
  }

  const includeComment = frame.locator('#include_comment');
  if ((await includeComment.count()) > 0 && !(await includeComment.isChecked())) {
    await includeComment.check({ force: true });
  }

  // Deleting rows can reset focus/state in some layouts; write title again right before make.
  await titleInput.click().catch(() => {});
  await titleInput.fill(title).catch(() => {});
  await titleInput.press('End').catch(() => {});
  await titleInput.press('Tab').catch(() => {});
  await frame.locator('body').click({ position: { x: 10, y: 10 } }).catch(() => {});
  await frame.waitForTimeout(120);

  const makeStatus = await clickMakeWithRetry(profilePage, frame, title);
  if (makeStatus !== 'ok') {
    return {
      ok: false,
      reason: makeStatus === 'empty' ? 'no_posts_to_save' : 'make_click_failed',
      checkedCount,
      title,
      selectedUsage: adjustedUsage,
    };
  }

  await frame.waitForTimeout(800);
  return { ok: true, reason: '', checkedCount, title, selectedUsage: adjustedUsage };
}

async function saveProgress(state) {
  const filePath = path.resolve(process.cwd(), process.env.NAVER_BLOG_PROGRESS_PATH || PROGRESS_PATH);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function clickAndResolvePage(sourcePage, clickAction) {
  const popupPromise = sourcePage.waitForEvent('popup', { timeout: 5000 }).catch(() => null);
  await clickAction();
  const popupPage = await popupPromise;
  const targetPage = popupPage || sourcePage;
  await targetPage.waitForLoadState('domcontentloaded').catch(() => {});
  return targetPage;
}

async function reopenPdfMakeAtPage(profilePage, pageNumber) {
  await gotoPostExportForm(profilePage);
  let frame = await getPaperFrame(profilePage);
  frame = await getPaperFrame(profilePage);
  await ensurePdfMakeTab(frame);
  const ok = await goToPage(frame, pageNumber);
  if (!ok) throw new Error(`failed to navigate to page ${pageNumber}`);
  return frame;
}

async function openSavedList(profilePage) {
  let frame = await getPaperFrame(profilePage);
  let opened = false;
  const clickWithDialogAccept = async (locator) => {
    const dialogPromise = profilePage.waitForEvent('dialog', { timeout: 1800 }).catch(() => null);
    await locator.click({ force: true }).catch(() => {});
    const dialog = await dialogPromise;
    if (dialog) await dialog.accept().catch(() => {});
  };

  const byRole = frame.getByRole('link', { name: /저장\s*목록|saved|list|저장|목록/i }).first();
  if ((await byRole.count()) > 0 && (await byRole.isVisible().catch(() => false))) {
    await clickWithDialogAccept(byRole);
    opened = true;
  }

  if (!opened) {
    const byHref = frame.locator('a[href*="PostExportList"], a[href*="postexportlist"]').first();
    if ((await byHref.count()) > 0 && (await byHref.isVisible().catch(() => false))) {
      await clickWithDialogAccept(byHref);
      opened = true;
    }
  }

  if (!opened) {
    const fallback = frame.locator('a[href*="PostExportPdfList"],a[href*="postexportpdflist"],a:has-text("저장 목록")').first();
    if ((await fallback.count()) > 0 && (await fallback.isVisible().catch(() => false))) {
      await clickWithDialogAccept(fallback);
      opened = true;
    }
  }

  if (!opened) throw new Error('cannot_open_saved_list');

  await profilePage.waitForTimeout(1100);
  frame = await getPaperFrame(profilePage);
  return frame;
}

async function collectRowActions(row) {
  const nodes = row.locator('a,button,input[type="button"],input[type="submit"],[role="button"]');
  const out = [];
  const count = await nodes.count();
  for (let i = 0; i < count; i += 1) {
    const node = nodes.nth(i);
    const text = (await node.innerText().catch(() => '')).trim();
    const title = (await node.getAttribute('title').catch(() => '')) || '';
    const aria = (await node.getAttribute('aria-label').catch(() => '')) || '';
    const value = (await node.getAttribute('value').catch(() => '')) || '';
    const href = (await node.getAttribute('href').catch(() => '')) || '';
    const onclick = (await node.getAttribute('onclick').catch(() => '')) || '';
    const signature = [text, title, aria, value, href, onclick].join(' ').toLowerCase();
    out.push({ node, signature, text, href, onclick });
  }
  return out;
}

async function clickGlobalDelete(frame, profilePage) {
  const globalActions = frame.locator('a,button,input[type="button"],input[type="submit"],[role="button"]');
  const total = await globalActions.count();
  const signatures = [];
  for (let i = 0; i < total; i += 1) {
    const node = globalActions.nth(i);
    const text = (await node.innerText().catch(() => '')).trim();
    const title = (await node.getAttribute('title').catch(() => '')) || '';
    const aria = (await node.getAttribute('aria-label').catch(() => '')) || '';
    const value = (await node.getAttribute('value').catch(() => '')) || '';
    const href = (await node.getAttribute('href').catch(() => '')) || '';
    const onclick = (await node.getAttribute('onclick').catch(() => '')) || '';
    const signature = [text, title, aria, value, href, onclick].join(' ').toLowerCase();
    signatures.push(signature);
    if (!/(delete|del|remove|erase)/i.test(signature)) continue;
    const dialogPromise = profilePage.waitForEvent('dialog', { timeout: 2500 }).catch(() => null);
    await node.click({ force: true }).catch(() => {});
    const dialog = await dialogPromise;
    if (dialog) await dialog.accept().catch(() => {});
    await profilePage.waitForTimeout(800);
    return true;
  }
  console.log(`[saved-list] global delete candidate not found. action samples=${JSON.stringify(signatures.slice(0, 40))}`);
  return false;
}

async function findRowByDownloadHref(frame, hrefNeedle) {
  const rows = frame.locator('tbody tr');
  const rowCount = await rows.count();
  for (let i = 0; i < rowCount; i += 1) {
    const row = rows.nth(i);
    const link = row.locator(`a[href*="${hrefNeedle}"]`).first();
    if ((await link.count()) > 0) return row;
  }
  return null;
}

function parsePageFromName(name) {
  const m = String(name || '').match(/_(\d{1,4})(?:\D|$)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

async function drainSavedPdfList({ context, profilePage, progress }) {
  const downloadDir = path.resolve(process.cwd(), DOWNLOAD_DIR);
  await mkdir(downloadDir, { recursive: true });

  let downloaded = 0;
  let deleted = 0;

  for (let loop = 0; loop < MAX_SAVED_LIST_DRAIN; loop += 1) {
    console.log(`[saved-list] poll loop=${loop + 1}/${MAX_SAVED_LIST_DRAIN}`);
    let frame = null;
    try {
      frame = await openSavedList(profilePage);
    } catch {
      break;
    }
    await profilePage.waitForTimeout(500);
    const dlCell = frame.getByRole('cell', { name: /다운로드|download/i }).first();
    if ((await dlCell.count()) === 0 || !(await dlCell.isVisible().catch(() => false))) {
      const pending = await frame.locator('text=/생성중|creating|processing/i').count().catch(() => 0);
      const rowCount = await frame.locator('tbody tr').count().catch(() => 0);
      // If row exists or pending text exists, keep waiting for download button to appear.
      if (pending > 0 || rowCount > 0) {
        await profilePage.waitForTimeout(2500);
        continue;
      }
      await profilePage.waitForTimeout(1200);
      continue;
    }

    let savePath = '';
    let downloadedOk = false;

    // Preferred path: real browser download event handles JS links and signed URLs reliably.
    const popupEvt = profilePage.waitForEvent('popup', { timeout: 8000 }).catch(() => null);
    const downloadEvt = profilePage.waitForEvent('download', { timeout: 15000 }).catch(() => null);
    await dlCell.click({ force: true }).catch(() => {});
    const popup = await popupEvt;
    if (popup) await popup.close().catch(() => {});
    const downloadObj = await downloadEvt;
    if (downloadObj) {
      const suggested = sanitizeFileName(downloadObj.suggestedFilename() || '');
      const preferredBase = sanitizeFileName(progress.lastTitle || '').trim();
      const chosen = preferredBase || suggested || `naver-blog-${Date.now()}`;
      savePath = await resolveUniquePath(downloadDir, chosen.endsWith('.pdf') ? chosen : `${chosen}.pdf`);
      await downloadObj.saveAs(savePath).catch(() => {});
      downloadedOk = true;
    }

    if (!downloadedOk) {
      await profilePage.waitForTimeout(1200);
      continue;
    }

    downloaded += 1;
    progress.download = progress.download || {};
    progress.download.dir = downloadDir;
    progress.download.downloadedTotal = Number(progress.download.downloadedTotal || 0) + 1;
    progress.download.lastFile = savePath;
    progress.download.lastDownloadedAt = new Date().toISOString();
    const pageNo = parsePageFromName(path.basename(savePath));
    if (pageNo) progress.download.lastDownloadedPage = pageNo;
    await saveProgress(progress);

    const del = frame.getByRole('cell', { name: /삭제|delete/i }).first();
    const dialogPromise = profilePage.waitForEvent('dialog', { timeout: 2500 }).catch(() => null);
    await del.click({ force: true }).catch(() => {});
    const dialog = await dialogPromise;
    if (dialog) await dialog.accept().catch(() => {});

    deleted += 1;
    progress.download.deletedTotal = Number(progress.download.deletedTotal || 0) + 1;
    await saveProgress(progress);
    await profilePage.waitForTimeout(450);
  }

  return { downloaded, deleted };
}

async function main() {
  if (!NAVER_ID || !NAVER_PW) {
    throw new Error('Set NAVER_ID/NAVER_PW (or NAVER_SELLER_ID/NAVER_SELLER_PW).');
  }

  const launchOptions = {
    headless: String(process.env.HEADLESS || 'false').toLowerCase() === 'true',
    slowMo: Number(process.env.SLOW_MO || 100),
  };
  let browser = null;
  let context = null;
  if (USE_PERSISTENT_CONTEXT) {
    const userDataDir = path.resolve(process.cwd(), PERSISTENT_DIR);
    await mkdir(userDataDir, { recursive: true });
    context = await chromium.launchPersistentContext(userDataDir, launchOptions);
  } else {
    browser = await chromium.launch(launchOptions);
    context = await browser.newContext({ acceptDownloads: true });
  }

  const page = context.pages()[0] || (await context.newPage());

  try {
    console.log('Naver blog export run started');
    await page.goto(ADMIN_LOGIN_URL, { waitUntil: 'domcontentloaded' });
    await page.locator('#id').fill(NAVER_ID);
    await page.locator('#pw').fill(NAVER_PW);
    await page.locator('#log\\.login,button[type="submit"],input[type="submit"]').first().click();
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(1200);
    if (String(page.url()).includes('idSafetyRelease')) {
      throw new Error('id_safety_release_required');
    }

    const profilePage = page;
    await gotoPostExportForm(profilePage);

    let frame = await getPaperFrame(profilePage);
    await ensurePdfMakeTab(frame);

    const loadedProgress = await loadProgress();
    const resumePage = Number(loadedProgress?.nextPage);
    const runStartPage =
      Number.isFinite(resumePage) && resumePage >= START_PAGE && resumePage <= MAX_ITERATIONS
        ? resumePage
        : START_PAGE;

    const progress = {
      updatedAt: new Date().toISOString(),
      status: 'running',
      stopReason: '',
      collectedPage: Math.max(runStartPage - 1, 0),
      nextPage: runStartPage,
      lastBatch: Math.max(runStartPage - 1, 0),
      lastTitle: '',
      selectedCount: 0,
      usage: null,
      reserveMB: RESERVE_MB,
      download: {
        dir: path.resolve(process.cwd(), DOWNLOAD_DIR),
        downloadedTotal: Number(loadedProgress?.download?.downloadedTotal || 0),
        deletedTotal: Number(loadedProgress?.download?.deletedTotal || 0),
        lastFile: loadedProgress?.download?.lastFile || '',
        lastDownloadedAt: loadedProgress?.download?.lastDownloadedAt || '',
        lastDownloadedPage: Number(loadedProgress?.download?.lastDownloadedPage || 0),
      },
    };
    await saveProgress(progress);

    let endedByBreak = false;
    for (let batch = runStartPage; batch <= MAX_ITERATIONS; batch += 1) {
      console.log(`[batch] start page=${batch}`);
      await ensurePdfMakeTab(frame);
      const navigated = await goToPage(frame, batch);
      if (!navigated) {
        console.log(`cannot navigate to target page ${batch}; stop run`);
        progress.updatedAt = new Date().toISOString();
        progress.status = 'stopped';
        progress.stopReason = 'cannot_navigate_to_target_page';
        await saveProgress(progress);
        endedByBreak = true;
        break;
      }

      const candidates = await getCandidateIndices(frame, BATCH_SIZE);
      if (candidates.length === 0) {
        console.log('no selectable posts on current page; stop run');
        progress.updatedAt = new Date().toISOString();
        progress.status = 'stopped';
        progress.stopReason = 'no_selectable_posts';
        await saveProgress(progress);
        endedByBreak = true;
        break;
      }

      let plan10 = [{ suffix: '', indices: candidates }];
      const plan5 = [
        { suffix: '-1', indices: candidates.slice(0, 5) },
        { suffix: '-2', indices: candidates.slice(5, 10) },
      ];
      const plan334 = [
        { suffix: '-1', indices: candidates.slice(0, 3) },
        { suffix: '-2', indices: candidates.slice(3, 6) },
        { suffix: '-3', indices: candidates.slice(6, 10) },
      ];

      // First try: split by real size budget to produce natural chunks like 6+4.
      // If that fails, fallback to 5+5 and then 3+3+4.
      try {
        await clearAllSelections(frame);
        const sized = await selectIndicesByUsageBudget(frame, candidates, PAGE_SELECTION_LIMIT_MB);
        await clearAllSelections(frame);
        const first = Array.isArray(sized?.selected) ? sized.selected : [];
        if (first.length > 0 && first.length < candidates.length) {
          const firstSet = new Set(first);
          const rest = candidates.filter((idx) => !firstSet.has(idx));
          plan10 = [
            { suffix: '-1', indices: first },
            { suffix: '-2', indices: rest },
          ];
          console.log(
            `[${batch}] size-plan selected: ${first.length}+${rest.length} (budget ${PAGE_SELECTION_LIMIT_MB}MB)`
          );
        }
      } catch {
        // ignore and keep default plan
      }

      const plans = [plan10, plan5, plan334];

      let pageDone = false;
      let lastError = '';
      for (let p = 0; p < plans.length; p += 1) {
        const plan = plans[p];
        let okPlan = true;
        let successParts = 0;
        for (const part of plan) {
          if (part.indices.length === 0) continue;
          try {
            frame = await reopenPdfMakeAtPage(profilePage, batch);
          } catch (err) {
            okPlan = false;
            lastError = 'reopen_page_failed';
            break;
          }

          let result = await createPdfChunk({
            profilePage,
            frame,
            batch,
            suffix: part.suffix,
            indices: part.indices,
          });

          if (!result.ok && result.reason === 'dialog_blocked_on_add') {
            const drained = await drainSavedPdfList({ context, profilePage, progress }).catch(() => null);
            if (drained) {
              console.log(`[saved-list] downloaded=${drained.downloaded}, deleted=${drained.deleted}`);
            }
            try {
              frame = await reopenPdfMakeAtPage(profilePage, batch);
              result = await createPdfChunk({
                profilePage,
                frame,
                batch,
                suffix: part.suffix,
                indices: part.indices,
              });
            } catch {
              result = { ok: false, reason: 'retry_after_drain_failed' };
            }
          }

          if (!result.ok) {
            if (result.reason === 'no_posts_to_save') {
              console.log(`[${batch}] no_posts_to_save -> skip page`);
              okPlan = true;
              lastError = 'no_posts_to_save';
              break;
            }
            if (successParts > 0) {
              console.log(
                `[${batch}] partial success (${successParts} parts), last reason=${result.reason}. continue with completed parts`
              );
              okPlan = true;
              lastError = `partial_success_${result.reason}`;
              break;
            }
            if (result.reason === 'dialog_blocked_on_add' && successParts > 0) {
              console.log(
                `[${batch}] dialog_blocked_on_add after partial success (${successParts} parts). mark page partial-complete and continue`
              );
              okPlan = true;
              lastError = 'partial_success_dialog_blocked';
              break;
            }
            okPlan = false;
            lastError = result.reason;
            break;
          }

          successParts += 1;

          if (result.selectedUsage) {
            console.log(
              `[${String(batch)}${part.suffix}] selected usage: ${result.selectedUsage.usedMB.toFixed(1)}MB / ${result.selectedUsage.limitMB}MB`
            );
          }
          const usage = await readUsage(frame);
          console.log(`[${String(batch)}${part.suffix}] created${usage ? ` - storage ${usage.raw}` : ''}`);
          progress.updatedAt = new Date().toISOString();
          progress.status = 'running';
          progress.collectedPage = batch;
          progress.lastBatch = batch;
          progress.lastTitle = result.title;
          progress.selectedCount = result.checkedCount;
          if (usage) {
            progress.usage = {
              raw: usage.raw,
              usedMB: Number(usage.usedMB.toFixed(2)),
              limitMB: Number(usage.limitMB.toFixed(2)),
            };
            if (usage.usedMB >= usage.limitMB - RESERVE_MB) {
              console.log(`remaining storage is within ${RESERVE_MB}MB reserve; stop run`);
              progress.updatedAt = new Date().toISOString();
              progress.status = 'stopped';
              progress.stopReason = 'storage_limit_reached';
              await saveProgress(progress);
              endedByBreak = true;
              okPlan = false;
              lastError = 'storage_limit_reached';
              break;
            }
          } else {
            progress.usage = null;
          }
          await saveProgress(progress);
        }

        if (endedByBreak) break;
        if (okPlan) {
          pageDone = true;
          break;
        }
      }

      if (endedByBreak) break;
      if (!pageDone) {
        console.log(`[${batch}] page create failed: ${lastError}`);
        progress.updatedAt = new Date().toISOString();
        progress.status = 'stopped';
        progress.stopReason = lastError || 'page_create_failed';
        await saveProgress(progress);
        endedByBreak = true;
        break;
      }

      const drainedAfterPage = await drainSavedPdfList({ context, profilePage, progress }).catch(() => null);
      if (drainedAfterPage && (drainedAfterPage.downloaded > 0 || drainedAfterPage.deleted > 0)) {
        console.log(
          `[saved-list][page ${batch}] downloaded=${drainedAfterPage.downloaded}, deleted=${drainedAfterPage.deleted}`
        );
      }

      progress.nextPage = batch + 1;
      progress.updatedAt = new Date().toISOString();
      await saveProgress(progress);
    }

    if (!endedByBreak) {
      progress.updatedAt = new Date().toISOString();
      progress.status = 'stopped';
      progress.stopReason = 'max_iterations_reached';
      await saveProgress(progress);
    }

    console.log('Run finished');
  } finally {
    await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
