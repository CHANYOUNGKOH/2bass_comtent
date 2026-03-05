import { chromium } from 'playwright';
import { config } from 'dotenv';
import { mkdir, writeFile } from 'fs/promises';
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

  // 저장공간은 보통 1GB 이상이므로 우선적으로 선택
  const storageMatches = matches.filter((x) => x.limitMB >= 1024);
  if (storageMatches.length > 0) {
    storageMatches.sort((a, b) => b.limitMB - a.limitMB || b.usedMB - a.usedMB);
    return storageMatches[0];
  }

  return null;
}

async function getPaperFrame(page) {
  await page.waitForSelector('iframe[name="papermain"]', { timeout: 20000 });
  const frame = page.frame({ name: 'papermain' });
  if (!frame) throw new Error('papermain iframe을 찾을 수 없습니다.');
  return frame;
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
      // 합계를 읽지 못하면 안전하게 제외
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

  await frame.getByRole('link', { name: '추가' }).first().click();
  await dialogPromise;
  return !blocked;
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
      await frame.waitForTimeout(900);
      return true;
    }

    const roleLink = frame.getByRole('link', { name: String(targetPageNumber), exact: true }).first();
    if ((await roleLink.count()) > 0 && (await roleLink.isVisible())) {
      await roleLink.click({ force: true });
      await frame.waitForTimeout(900);
      return true;
    }
    return false;
  };

  const isAlreadyOnTarget = async () => {
    const nums = await readVisiblePageNumbers();
    if (nums.length === 0) return false;
    if (nums.includes(targetPageNumber)) return false;
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    return targetPageNumber >= min - 1 && targetPageNumber <= max + 1;
  };

  if (await clickNumeric()) return true;
  if (await isAlreadyOnTarget()) return true;

  for (let step = 0; step < 100; step += 1) {
    const pageNumbers = await readVisiblePageNumbers();
    if (pageNumbers.length === 0) return false;

    let minPage = Number.POSITIVE_INFINITY;
    let maxPage = Number.NEGATIVE_INFINITY;
    for (const n of pageNumbers) {
      minPage = Math.min(minPage, n);
      maxPage = Math.max(maxPage, n);
    }

    let moved = false;
    if (targetPageNumber > maxPage + 1) {
      const next = paginate.locator('a,button').filter({ hasText: '다음' }).first();
      if ((await next.count()) > 0 && (await next.isVisible())) {
        await next.click({ force: true });
        moved = true;
      }
    } else if (targetPageNumber < minPage - 1) {
      const prev = paginate.locator('a,button').filter({ hasText: '이전' }).first();
      if ((await prev.count()) > 0 && (await prev.isVisible())) {
        await prev.click({ force: true });
        moved = true;
      }
    } else {
      if (await clickNumeric()) return true;
      if (await isAlreadyOnTarget()) return true;
      return false;
    }

    if (!moved) return false;
    await frame.waitForTimeout(900);
    if (await clickNumeric()) return true;
    if (await isAlreadyOnTarget()) return true;
  }

  return false;
}

async function ensurePdfMakeTab(frame) {
  const hasPageLinks = await frame.locator('#paginate a').count();
  if (hasPageLinks > 0) return;

  const pdfTab = frame.getByRole('link', { name: 'PDF 만들기' }).first();
  if ((await pdfTab.count()) > 0 && (await pdfTab.isVisible())) {
    await pdfTab.click({ force: true });
    await frame.waitForTimeout(1000);
  }
}

async function clickMakeWithRetry(page, frame, title) {
  const makeLink = frame.getByRole('link', { name: '만들기', exact: true }).first();
  for (let i = 0; i < 3; i += 1) {
    if ((await makeLink.count()) === 0 || !(await makeLink.isVisible().catch(() => false))) {
      await frame.waitForTimeout(800);
      continue;
    }

    const dialogPromise = page.waitForEvent('dialog', { timeout: 1800 }).catch(() => null);
    await makeLink.click({ force: true }).catch(() => {});
    const dialog = await dialogPromise;
    if (dialog) {
      console.log(`[make-dialog] ${dialog.message()}`);
      await dialog.dismiss().catch(() => {});
      continue;
    }

    // 성공 신호: 생성중 표시/제목 노출/선택용량 0으로 리셋
    for (let w = 0; w < 12; w += 1) {
      const hasCreating = (await frame.getByRole('cell', { name: '생성중' }).count().catch(() => 0)) > 0;
      const hasTitle = await frame.getByText(title).first().isVisible().catch(() => false);
      const selectedUsage = await readSelectedUsage(frame).catch(() => null);
      const resetSelected = selectedUsage ? selectedUsage.usedMB === 0 : false;
      if (hasCreating || hasTitle || resetSelected) return true;
      await frame.waitForTimeout(500);
    }
  }
  return false;
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

  const selectedUsage = await readSelectedUsage(frame);
  if (!selectedUsage) {
    return { ok: false, reason: 'selected_usage_not_found', checkedCount, title: '', selectedUsage: null };
  }
  if (selectedUsage.usedMB > PAGE_SELECTION_LIMIT_MB) {
    return { ok: false, reason: 'over_500_before_add', checkedCount, title: '', selectedUsage };
  }

  const title = `${TITLE_PREFIX}_${String(batch).padStart(3, '0')}${suffix}`;
  const titleInput = frame.getByRole('textbox', { name: '파일 제목' });
  await titleInput.click();
  await titleInput.fill(title);

  const addOk = await clickAddWithDialogHandling(profilePage, frame);
  if (!addOk) {
    return { ok: false, reason: 'dialog_blocked_on_add', checkedCount, title, selectedUsage };
  }

  const includeComment = frame.locator('#include_comment');
  if ((await includeComment.count()) > 0 && !(await includeComment.isChecked())) {
    await includeComment.check({ force: true });
  }

  const made = await clickMakeWithRetry(profilePage, frame, title);
  if (!made) {
    return { ok: false, reason: 'make_click_failed', checkedCount, title, selectedUsage };
  }

  await frame.waitForTimeout(800);
  return { ok: true, reason: '', checkedCount, title, selectedUsage };
}

async function saveProgress(state) {
  const filePath = path.resolve(process.cwd(), PROGRESS_PATH);
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
  await profilePage.getByRole('link', { name: '글 저장' }).click().catch(() => {});
  let frame = await getPaperFrame(profilePage);
  await frame.getByRole('link', { name: 'PDF 만들기' }).click();
  frame = await getPaperFrame(profilePage);
  await ensurePdfMakeTab(frame);
  const ok = await goToPage(frame, pageNumber);
  if (!ok) throw new Error(`페이지 ${pageNumber} 재진입 실패`);
  return frame;
}

async function main() {
  if (!NAVER_ID || !NAVER_PW) {
    throw new Error('.env에 NAVER_ID/NAVER_PW 또는 NAVER_SELLER_ID/NAVER_SELLER_PW를 설정하세요.');
  }

  const browser = await chromium.launch({
    headless: String(process.env.HEADLESS || 'false').toLowerCase() === 'true',
    slowMo: Number(process.env.SLOW_MO || 100),
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('네이버 로그인 시작');
    await page.goto('https://www.naver.com/');
    await page.getByRole('link', { name: 'NAVER 로그인' }).click();
    await page.getByRole('textbox', { name: '아이디 또는 전화번호' }).fill(NAVER_ID);
    await page.getByRole('textbox', { name: '비밀번호' }).fill(NAVER_PW);
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await page.waitForLoadState('domcontentloaded');

    const blogPage = await clickAndResolvePage(page, async () => {
      await page.getByRole('link', { name: '블로그', exact: true }).click();
    });

    const profilePage = await clickAndResolvePage(blogPage, async () => {
      await blogPage.getByRole('link', { name: /프로필/ }).click();
    });

    await profilePage.frameLocator('iframe[name="mainFrame"]').getByRole('link', { name: '관리' }).click();
    await profilePage.getByRole('link', { name: /메뉴.*관리/ }).click();
    await profilePage.getByRole('link', { name: '글 저장' }).click();

    let frame = await getPaperFrame(profilePage);
    await frame.getByRole('link', { name: 'PDF 만들기' }).click();
    frame = await getPaperFrame(profilePage);

    const progress = {
      updatedAt: new Date().toISOString(),
      status: 'running',
      stopReason: '',
      collectedPage: Math.max(START_PAGE - 1, 0),
      nextPage: START_PAGE,
      lastBatch: Math.max(START_PAGE - 1, 0),
      lastTitle: '',
      selectedCount: 0,
      usage: null,
      reserveMB: RESERVE_MB,
    };
    await saveProgress(progress);

    let endedByBreak = false;
    for (let batch = START_PAGE; batch <= MAX_ITERATIONS; batch += 1) {
      await ensurePdfMakeTab(frame);
      const navigated = await goToPage(frame, batch);
      if (!navigated) {
        console.log(`목표 페이지 ${batch}로 이동할 수 없어 종료합니다.`);
        progress.updatedAt = new Date().toISOString();
        progress.status = 'stopped';
        progress.stopReason = 'cannot_navigate_to_target_page';
        await saveProgress(progress);
        endedByBreak = true;
        break;
      }

      const candidates = await getCandidateIndices(frame, BATCH_SIZE);
      if (candidates.length === 0) {
        console.log('선택 가능한 글이 없습니다. 종료합니다.');
        progress.updatedAt = new Date().toISOString();
        progress.status = 'stopped';
        progress.stopReason = 'no_selectable_posts';
        await saveProgress(progress);
        endedByBreak = true;
        break;
      }

      const plan10 = [{ suffix: '', indices: candidates }];
      const plan5 = [
        { suffix: '-1', indices: candidates.slice(0, 5) },
        { suffix: '-2', indices: candidates.slice(5, 10) },
      ];
      const plan334 = [
        { suffix: '-1', indices: candidates.slice(0, 3) },
        { suffix: '-2', indices: candidates.slice(3, 6) },
        { suffix: '-3', indices: candidates.slice(6, 10) },
      ];
      const plans = [plan10, plan5, plan334];

      let pageDone = false;
      let lastError = '';
      for (let p = 0; p < plans.length; p += 1) {
        const plan = plans[p];
        let okPlan = true;
        for (const part of plan) {
          if (part.indices.length === 0) continue;
          try {
            frame = await reopenPdfMakeAtPage(profilePage, batch);
          } catch (err) {
            okPlan = false;
            lastError = 'reopen_page_failed';
            break;
          }

          const result = await createPdfChunk({
            profilePage,
            frame,
            batch,
            suffix: part.suffix,
            indices: part.indices,
          });
          if (!result.ok) {
            okPlan = false;
            lastError = result.reason;
            break;
          }

          if (result.selectedUsage) {
            console.log(
              `[${String(batch)}${part.suffix}] 선택합계: ${result.selectedUsage.usedMB.toFixed(1)}MB / ${result.selectedUsage.limitMB}MB`
            );
          }
          const usage = await readUsage(frame);
          console.log(`[${String(batch)}${part.suffix}] 생성 완료${usage ? ` - 사용량: ${usage.raw}` : ''}`);
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
              console.log(`용량 여유 ${RESERVE_MB}MB 이하로 내려가 종료합니다.`);
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
        console.log(`[${batch}] 페이지 생성 실패: ${lastError}`);
        progress.updatedAt = new Date().toISOString();
        progress.status = 'stopped';
        progress.stopReason = lastError || 'page_create_failed';
        await saveProgress(progress);
        endedByBreak = true;
        break;
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

    console.log('작업 종료');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
