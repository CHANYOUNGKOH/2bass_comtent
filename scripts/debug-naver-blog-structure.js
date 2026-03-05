import { chromium } from 'playwright';
import { config } from 'dotenv';

config();

const NAVER_ID = process.env.NAVER_ID || process.env.NAVER_SELLER_ID;
const NAVER_PW = process.env.NAVER_PW || process.env.NAVER_SELLER_PW;

function printFrameTree(frame, depth = 0) {
  const indent = '  '.repeat(depth);
  console.log(`${indent}- name="${frame.name()}" url="${frame.url()}"`);
  for (const child of frame.childFrames()) {
    printFrameTree(child, depth + 1);
  }
}

async function clickAndResolvePage(sourcePage, clickAction) {
  const popupPromise = sourcePage.waitForEvent('popup', { timeout: 5000 }).catch(() => null);
  await clickAction();
  const popupPage = await popupPromise;
  const targetPage = popupPage || sourcePage;
  await targetPage.waitForLoadState('domcontentloaded').catch(() => {});
  return targetPage;
}

async function main() {
  if (!NAVER_ID || !NAVER_PW) {
    throw new Error('NAVER_ID/NAVER_PW 환경변수를 설정하세요.');
  }

  const browser = await chromium.launch({ headless: false, slowMo: 100 });
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

    console.log('\n[Page frame tree]');
    printFrameTree(profilePage.mainFrame());

    let paper = profilePage.frame({ name: 'papermain' });
    if (!paper) throw new Error('papermain 프레임을 찾지 못했습니다.');
    await paper.getByRole('link', { name: 'PDF 만들기' }).click();
    await paper.waitForTimeout(1200);

    paper = profilePage.frame({ name: 'papermain' });
    if (!paper) throw new Error('PDF 만들기 이후 papermain 프레임을 찾지 못했습니다.');

    console.log('\n[papermain child frames]');
    for (const child of paper.childFrames()) {
      console.log(`- name="${child.name()}" url="${child.url()}"`);
    }

    const paginateCount = await paper.locator('#paginate').count();
    const paginateLikeCount = await paper.locator('[id*="paginate"]').count();
    console.log(`\n#paginate count: ${paginateCount}`);
    console.log(`[id*="paginate"] count: ${paginateLikeCount}`);

    const visibleLinks = await paper.locator('a:visible').allInnerTexts();
    console.log('\n[papermain visible links sample]');
    console.log(visibleLinks.slice(0, 120));

    const paginateTexts = await paper.locator('#paginate a, [id*="paginate"] a').allInnerTexts();
    console.log('\n[paginate links]');
    console.log(paginateTexts);

    console.log('\n[done] 브라우저를 10초 유지합니다.');
    await paper.waitForTimeout(10000);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
