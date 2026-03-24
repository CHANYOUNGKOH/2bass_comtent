import { chromium } from 'playwright';
import path from 'path';
import { mkdir } from 'fs/promises';

const BLOG_ID = process.env.NAVER_BLOG_ID || '2basstune';
const NAVER_ID = process.env.NAVER_ID || process.env.NAVER_SELLER_ID || '';
const NAVER_PW = process.env.NAVER_PW || process.env.NAVER_SELLER_PW || '';
const ADMIN_LOGIN_URL =
  'https://nid.naver.com/nidlogin.login?mode=form&svctype=64&url=http://admin.blog.naver.com/CloseLoginPopup.naver';

async function main() {
  const userDataDir = path.resolve(process.cwd(), 'output', 'pw-userdata-admin');
  await mkdir(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    slowMo: 80,
    viewport: { width: 1440, height: 900 },
  });

  const page = context.pages()[0] || (await context.newPage());
  await page.goto(ADMIN_LOGIN_URL, { waitUntil: 'domcontentloaded' });
  if ((await page.locator('#id').count().catch(() => 0)) > 0 && NAVER_ID && NAVER_PW) {
    await page.locator('#id').fill(NAVER_ID);
    await page.locator('#pw').fill(NAVER_PW);
    await page.locator('#log\\.login,button[type="submit"],input[type="submit"]').first().click();
    await page.waitForTimeout(1200);
  }

  await page.goto(`https://admin.blog.naver.com/PostExportForm.naver?blogId=${BLOG_ID}`, {
    waitUntil: 'domcontentloaded',
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        userDataDir,
        url: page.url(),
        message: '로그인/인증 완료 후 이 창을 닫지 말고 유지하세요.',
      },
      null,
      2
    )
  );

  await new Promise(() => {});
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
