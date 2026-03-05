import { chromium } from 'playwright';
import { readFileSync } from 'fs';

async function test() {
  console.log('📦 지마켓 주문수집 테스트...');

  const sessionData = JSON.parse(readFileSync('sessions/gmarket.json', 'utf8'));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: sessionData,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();

  // 마이페이지
  console.log('🌐 마이페이지 접속...');
  await page.goto('https://my.gmarket.co.kr/ko/pc/main');
  await page.waitForTimeout(3000);

  console.log('URL:', page.url());
  const title = await page.title();
  console.log('제목:', title);

  // 구매내역 링크 클릭
  const orderLink = page.locator('a:has-text("구매내역"), a:has-text("주문/배송"), a[href*="order"]').first();
  if (await orderLink.isVisible({ timeout: 3000 })) {
    console.log('구매내역 링크 클릭...');
    await orderLink.click();
    await page.waitForTimeout(3000);
    console.log('URL:', page.url());
  }

  // 6개월 조회
  const sixMonth = page.locator('a:has-text("6개월"), button:has-text("6개월"), [data-period="6"]').first();
  if (await sixMonth.isVisible({ timeout: 2000 }).catch(() => false)) {
    await sixMonth.click();
    await page.waitForTimeout(2000);
    console.log('6개월 조회');
  }

  // 주문번호 추출
  const bodyText = await page.textContent('body').catch(() => '');
  const allMatches = bodyText.match(/\d{10}/g) || [];
  const orderNumbers = [...new Set(allMatches)].filter(n =>
    n.startsWith('17') || n.startsWith('25') || n.startsWith('16')
  );
  console.log(`\n📦 발견된 주문: ${orderNumbers.length}건`);
  console.log('주문번호:', orderNumbers.slice(0, 10).join(', '));

  // 배송조회 링크
  const trackingBtns = await page.locator('button:has-text("배송조회"), a:has-text("배송조회"), a:has-text("배송추적")').count();
  console.log('배송조회 버튼:', trackingBtns);

  // 첫 주문 배송조회 테스트
  if (trackingBtns > 0) {
    const firstBtn = page.locator('button:has-text("배송조회"), a:has-text("배송조회")').first();

    const popupPromise = page.waitForEvent('popup', { timeout: 5000 }).catch(() => null);
    await firstBtn.click();
    const popup = await popupPromise;

    if (popup) {
      await popup.waitForLoadState('networkidle').catch(() => {});
      await popup.waitForTimeout(2000);
      console.log('\n📋 배송조회 팝업:', popup.url());

      const popupText = await popup.textContent('body').catch(() => '');
      const carriers = ['CJ대한통운', '롯데택배', '한진택배', '우체국택배', '로젠택배'];
      for (const c of carriers) {
        if (popupText.includes(c)) {
          console.log('택배사:', c);
          break;
        }
      }

      const nums = popupText.match(/\b\d{10,14}\b/g) || [];
      const trackingNum = nums.find(n => !orderNumbers.includes(n));
      console.log('송장번호:', trackingNum || '(없음)');

      await popup.close().catch(() => {});
    } else {
      // 팝업 없이 같은 페이지에서 표시
      console.log('팝업 없음 - 인라인 표시 확인');
      await page.waitForTimeout(1000);
      const inlineTracking = await page.locator('[class*="tracking"], [class*="delivery"]').textContent().catch(() => '');
      console.log('인라인:', inlineTracking.substring(0, 100));
    }
  }

  // 문의 링크
  const inquiryLinks = await page.locator('a:has-text("판매자문의"), a:has-text("상품문의"), button:has-text("문의")').count();
  console.log('\n문의 링크:', inquiryLinks);

  await browser.close();
}

test().catch(console.error);
