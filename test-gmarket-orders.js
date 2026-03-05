import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'fs';

async function test() {
  console.log('📦 지마켓 주문목록 구조 분석...');

  const sessionData = JSON.parse(readFileSync('sessions/gmarket.json', 'utf8'));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: sessionData,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();

  // 구매내역 페이지 접근
  console.log('🌐 구매내역 페이지...');
  await page.goto('https://www.gmarket.co.kr/myg/order/order');
  await page.waitForTimeout(5000);

  console.log('URL:', page.url());

  // 6개월 버튼 있으면 클릭
  const sixMonth = page.getByRole('link', { name: '6개월' });
  if (await sixMonth.isVisible({ timeout: 2000 }).catch(() => false)) {
    await sixMonth.click();
    await page.waitForTimeout(2000);
    console.log('6개월 조회 클릭');
  }

  // 페이지 구조 분석
  const bodyText = await page.textContent('body').catch(() => '');

  // 주문번호 추출
  const allMatches = bodyText.match(/\d{10}/g) || [];
  const orderNumbers = [...new Set(allMatches)].filter(n =>
    n.startsWith('17') || n.startsWith('25') || n.startsWith('16')
  );
  console.log(`\n📦 발견된 주문: ${orderNumbers.length}건`);
  console.log('주문번호:', orderNumbers.slice(0, 10).join(', '));

  // 배송조회 링크 확인
  const trackingLinks = await page.locator('a:has-text("배송조회"), a:has-text("배송추적")').count();
  console.log('배송조회 링크:', trackingLinks);

  // 첫 번째 주문의 배송조회 테스트
  if (trackingLinks > 0) {
    const firstTracking = page.locator('a:has-text("배송조회"), a:has-text("배송추적")').first();

    // 팝업 대기
    const popupPromise = page.waitForEvent('popup', { timeout: 5000 }).catch(() => null);
    await firstTracking.click();
    const popup = await popupPromise;

    if (popup) {
      await popup.waitForLoadState('networkidle').catch(() => {});
      await popup.waitForTimeout(2000);

      console.log('\n📋 배송조회 팝업:');
      console.log('URL:', popup.url());

      const popupText = await popup.textContent('body').catch(() => '');

      // 택배사 찾기
      const carriers = ['CJ대한통운', '롯데택배', '한진택배', '우체국택배', '로젠택배'];
      for (const c of carriers) {
        if (popupText.includes(c)) {
          console.log('택배사:', c);
          break;
        }
      }

      // 송장번호 (10-14자리)
      const trackingNums = popupText.match(/\b\d{10,14}\b/g) || [];
      console.log('송장번호 후보:', trackingNums.slice(0, 3).join(', '));

      await popup.close().catch(() => {});
    } else {
      console.log('팝업 없음 - 페이지 내 표시 방식?');
    }
  }

  // 상품문의 링크 확인
  const inquiryLinks = await page.locator('a:has-text("판매자문의"), a:has-text("상품문의")').count();
  console.log('\n문의 링크:', inquiryLinks);

  await browser.close();
}

test().catch(console.error);
