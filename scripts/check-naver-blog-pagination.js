import { chromium } from 'playwright';
import { config } from 'dotenv';

config();

const NAVER_ID = process.env.NAVER_ID || process.env.NAVER_SELLER_ID;
const NAVER_PW = process.env.NAVER_PW || process.env.NAVER_SELLER_PW;

async function clickAndResolvePage(sourcePage, clickAction) {
  const popupPromise = sourcePage.waitForEvent('popup', { timeout: 5000 }).catch(() => null);
  await clickAction();
  const popupPage = await popupPromise;
  const targetPage = popupPage || sourcePage;
  await targetPage.waitForLoadState('domcontentloaded').catch(() => {});
  return targetPage;
}

async function ensurePdfMakeTab(frame) {
  const hasPageLinks = await frame.locator('#paginate a').count();
  if (hasPageLinks > 0) return;
  const tab = frame.getByRole('link', { name: 'PDF 만들기' }).first();
  if ((await tab.count()) > 0 && (await tab.isVisible())) {
    await tab.click({ force: true });
    await frame.waitForTimeout(800);
  }
}

async function goToPage(frame, targetPageNumber) {
  const paginate = (await frame.locator('#paginate').count()) > 0
    ? frame.locator('#paginate').first()
    : frame.locator('[id*="paginate"]').first();
  if ((await paginate.count()) === 0) return false;

  const readVisiblePageNumbers = async () => {
    const pageTexts = await paginate.locator('a').allInnerTexts();
    return pageTexts
      .map((t) => Number(String(t).trim()))
      .filter((n) => Number.isFinite(n));
  };

  const clickNumeric = async () => {
    const link = paginate
      .locator('a')
      .filter({ hasText: new RegExp(`^\\s*${targetPageNumber}\\s*$`) })
      .first();
    if ((await link.count()) > 0 && (await link.isVisible())) {
      await link.click({ force: true });
      await frame.waitForTimeout(600);
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

  for (let step = 0; step < 250; step += 1) {
    const nums = await readVisiblePageNumbers();
    if (nums.length === 0) return false;
    const min = Math.min(...nums);
    const max = Math.max(...nums);

    let moved = false;
    if (targetPageNumber > max + 1) {
      const next = paginate.locator('a,button').filter({ hasText: '다음' }).first();
      if ((await next.count()) > 0 && (await next.isVisible())) {
        await next.click({ force: true });
        moved = true;
      }
    } else if (targetPageNumber < min - 1) {
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
    await frame.waitForTimeout(600);
    if (await clickNumeric()) return true;
    if (await isAlreadyOnTarget()) return true;
  }

  return false;
}

async function getPaginateSnapshot(frame) {
  const paginate = frame.locator('#paginate');
  const links = await paginate.locator('a').allInnerTexts().catch(() => []);
  return links.map((v) => String(v).trim()).filter(Boolean);
}

async function main() {
  if (!NAVER_ID || !NAVER_PW) {
    throw new Error('NAVER_ID/NAVER_PW 설정 필요');
  }

  const browser = await chromium.launch({ headless: false, slowMo: 50 });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
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

    const frame = profilePage.frame({ name: 'papermain' });
    if (!frame) throw new Error('papermain 프레임 없음');
    await ensurePdfMakeTab(frame);

    const targets = [100, 200, 300];
    for (const target of targets) {
      const ok = await goToPage(frame, target);
      const snap = await getPaginateSnapshot(frame);
      console.log(`[check] target=${target} ok=${ok} links=${JSON.stringify(snap)}`);
      if (!ok) {
        throw new Error(`페이지 ${target} 이동 실패`);
      }

      const nextOk = await goToPage(frame, target + 1);
      console.log(`[check] target=${target + 1} ok=${nextOk}`);
      if (!nextOk) {
        throw new Error(`페이지 ${target + 1} 이동 실패`);
      }
    }

    console.log('[check] pagination test passed: 100/200/300(+1)');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
