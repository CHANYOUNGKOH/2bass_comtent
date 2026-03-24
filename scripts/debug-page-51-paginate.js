import { chromium } from 'playwright';
import { config } from 'dotenv';

config();
const id = process.env.NAVER_ID || process.env.NAVER_SELLER_ID;
const pw = process.env.NAVER_PW || process.env.NAVER_SELLER_PW;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto('https://nid.naver.com/nidlogin.login', { waitUntil: 'domcontentloaded' });
    await page.locator('#id').fill(id || '');
    await page.locator('#pw').fill(pw || '');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1200);

    await page.goto('https://admin.blog.naver.com/2basstune/config/postexport', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('iframe[name="papermain"]', { timeout: 20000 });
    let f = page.frame({ name: 'papermain' });
    if (!f) throw new Error('papermain not found after base');
    const tab = f.locator('a[href*="PostExportForm"],a[href*="postexportform"]').first();
    if ((await tab.count()) > 0) await tab.click({ force: true });
    await page.waitForTimeout(700);
    await page.waitForSelector('iframe[name="papermain"]', { timeout: 20000 });
    f = page.frame({ name: 'papermain' });
    if (!f) throw new Error('papermain not found after pdf tab');

    const paginate = (await f.locator('#paginate').count()) > 0 ? f.locator('#paginate').first() : f.locator('[id*="paginate"]').first();
    for (let i=0;i<80;i++){
      const nums = (await paginate.locator('a').allInnerTexts()).map(t=>t.trim()).filter(Boolean);
      if (nums.includes('51')) { await paginate.locator('a').filter({hasText:/^\s*51\s*$/}).first().click({force:true}); break; }
      const next = paginate.locator('a,button').filter({hasText:/다음|next/i}).first();
      if ((await next.count())===0) break;
      await next.click({force:true});
      await f.waitForTimeout(400);
    }

    await f.waitForTimeout(500);
    const html = await paginate.innerHTML();
    const txt = await paginate.innerText();
    console.log('FRAME_URL=' + f.url());
    console.log('PAGINATE_TEXT=' + txt.replace(/\s+/g,' '));
    console.log('PAGINATE_HTML=' + html.slice(0,1200));
  } finally {
    await browser.close();
  }
})().catch(e=>{ console.error(e); process.exit(1);});
