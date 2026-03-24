import { chromium } from 'playwright';
import { config } from 'dotenv';

config();
const id = process.env.NAVER_ID || process.env.NAVER_SELLER_ID;
const pw = process.env.NAVER_PW || process.env.NAVER_SELLER_PW;
const base = 'https://admin.blog.naver.com/2basstune/config/postexport';

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

    await page.goto(base, { waitUntil: 'domcontentloaded' });
    const frame = page.frame({ name: 'papermain' });
    if (!frame) throw new Error('no papermain');
    const tab = frame.locator('a[href*="PostExportForm"],a[href*="postexportform"]').first();
    if ((await tab.count()) > 0) await tab.click({ force: true });
    await page.waitForTimeout(700);

    const f = page.frame({ name: 'papermain' });
    if (!f) throw new Error('no papermain2');

    const paginate = (await f.locator('#paginate').count()) > 0 ? f.locator('#paginate').first() : f.locator('[id*="paginate"]').first();
    for (let i=0;i<120;i++){
      const link = paginate.locator('a').filter({ hasText: /^\s*43\s*$/ }).first();
      if ((await link.count()) > 0){ await link.click({ force:true }); break; }
      const next = paginate.locator('a,button').filter({ hasText: /다음|next/i }).first();
      if ((await next.count())===0) break;
      await next.click({force:true});
      await f.waitForTimeout(500);
    }

    const boxes = f.locator('tbody input[type="checkbox"]:enabled');
    const total = await boxes.count();
    const picked = [];
    for (let i=0;i<Math.min(10,total);i++){
      const row = boxes.nth(i).locator('xpath=ancestor::tr[1]');
      const txt = (await row.innerText().catch(()=>'')).trim().replace(/\s+/g,' ').slice(0,160);
      await boxes.nth(i).check({ force:true }).catch(()=>{});
      picked.push({i, txt});
    }
    await f.waitForTimeout(800);
    const body = await f.locator('body').innerText();
    const matches = [...body.matchAll(/([0-9,]+(?:\.[0-9]+)?\s*(?:KB|MB|GB)\s*\/\s*[0-9,]+(?:\.[0-9]+)?\s*(?:KB|MB|GB))/gi)].map(m=>m[1]);

    console.log(JSON.stringify({totalEnabledCheckbox: total, picked, usageMatches: matches.slice(0,20)}, null, 2));
  } finally {
    await browser.close();
  }
})().catch(e=>{ console.error(e); process.exit(1);});
