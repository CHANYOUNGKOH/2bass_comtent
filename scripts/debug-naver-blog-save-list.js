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

async function main() {
  if (!NAVER_ID || !NAVER_PW) throw new Error('Missing NAVER creds');
  const browser = await chromium.launch({ headless: false, slowMo: 80 });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  try {
    await page.goto('https://www.naver.com/');
    await page.getByRole('link', { name: 'NAVER 濡쒓렇?? }).click();
    await page.getByRole('textbox', { name: '?꾩씠???먮뒗 ?꾪솕踰덊샇' }).fill(NAVER_ID);
    await page.getByRole('textbox', { name: '鍮꾨?踰덊샇' }).fill(NAVER_PW);
    await page.getByRole('button', { name: '濡쒓렇??, exact: true }).click();
    await page.waitForLoadState('domcontentloaded');

    const blogPage = await clickAndResolvePage(page, async () => {
      await page.getByRole('link', { name: '釉붾줈洹?, exact: true }).click();
    });

    const profilePage = await clickAndResolvePage(blogPage, async () => {
      await blogPage.getByRole('link', { name: /?꾨줈?? }).click();
    });

    await profilePage.frameLocator('iframe[name="mainFrame"]').getByRole('link', { name: '愿由?' }).click();
    await profilePage.getByRole('link', { name: /硫붾돱.*愿由?/ }).click();
    await profilePage.getByRole('link', { name: '湲 ???' }).click();

    const frame = profilePage.frame({ name: 'papermain' });
    if (!frame) throw new Error('papermain not found');
    await frame.getByRole('link', { name: 'PDF 留뚮뱾湲?' }).click();
    await frame.waitForTimeout(1200);

    const frame2 = profilePage.frame({ name: 'papermain' });
    if (!frame2) throw new Error('papermain after pdf tab not found');

    await frame2.getByRole('link', { name: '???紐⑸줉' }).click();
    await frame2.waitForTimeout(1800);

    const links = await frame2.locator('a:visible').allInnerTexts();
    const buttons = await frame2.locator('button:visible').allInnerTexts();
    console.log('VISIBLE_LINKS');
    console.log(JSON.stringify(links.slice(0, 300), null, 2));
    console.log('VISIBLE_BUTTONS');
    console.log(JSON.stringify(buttons.slice(0, 100), null, 2));

    const tableText = await frame2.locator('body').innerText();
    console.log('BODY_SAMPLE');
    console.log(tableText.slice(0, 2000));

    await frame2.waitForTimeout(7000);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
