import { chromium } from 'playwright';

async function clickAndResolvePage(sourcePage, clickAction) {
  const popupPromise = sourcePage.waitForEvent('popup', { timeout: 5000 }).catch(() => null);
  await clickAction();
  const popupPage = await popupPromise;
  return popupPage || sourcePage;
}

async function main() {
  const id = process.env.NAVER_ID || process.env.NAVER_SELLER_ID;
  const pw = process.env.NAVER_PW || process.env.NAVER_SELLER_PW;
  if (!id || !pw) throw new Error('NAVER_ID/NAVER_PW 필요');

  const browser = await chromium.launch({ headless: false, slowMo: 80 });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://www.naver.com/');
  await page.getByRole('link', { name: 'NAVER 로그인' }).click();
  await page.getByRole('textbox', { name: '아이디 또는 전화번호' }).fill(id);
  await page.getByRole('textbox', { name: '비밀번호' }).fill(pw);
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
  if (!frame) throw new Error('papermain 없음');
  await frame.getByRole('link', { name: 'PDF 만들기' }).click();
  await frame.waitForTimeout(800);

  const paginate = frame.locator('#paginate');
  for (let i = 0; i < 3; i += 1) {
    const next = paginate.locator('a,button').filter({ hasText: '다음' }).first();
    await next.click({ force: true });
    await frame.waitForTimeout(600);
  }
  await paginate.locator('a').filter({ hasText: /^\s*17\s*$/ }).first().click({ force: true });
  await frame.waitForTimeout(600);

  const checkboxes = frame.locator('tbody input[type="checkbox"]:enabled');
  for (let i = 0; i < 5; i += 1) {
    await checkboxes.nth(i).check({ force: true });
  }
  await frame.waitForTimeout(1000);

  const bodyText = await frame.locator('body').innerText();
  const pairs = bodyText.match(/([0-9]+(?:\.[0-9]+)?)\s*(KB|MB|GB)\s*\/\s*500\s*MB/gi) || [];
  console.log('500MB pairs:', pairs);

  const selectedTexts = await frame.locator('text=/선택한\\s*글/').allInnerTexts().catch(() => []);
  console.log('selected texts:', selectedTexts.slice(0, 20));

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
