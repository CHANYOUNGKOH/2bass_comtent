/**
 * 도매포유 송장 수집 Skill
 *
 * 주문목록에서 주문번호/상품명/택배사/송장번호/상태 수집
 * - 송장번호가 테이블에 바로 표시됨
 * - 주문번호로 직접 검색 가능
 *
 * 사용법:
 *   node skills/invoice/dome4u.collector.js --my-orders
 *   node skills/invoice/dome4u.collector.js --my-orders --pages=3
 *   node skills/invoice/dome4u.collector.js --search=C0000781176
 */

import { chromium } from 'playwright';
import { config } from 'dotenv';
import { existsSync } from 'fs';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

config();

const __dirname = dirname(fileURLToPath(import.meta.url));

class Dome4uCollector {
  constructor(options = {}) {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.headless = options.headless ?? true;
    this.sessionPath = join(__dirname, '../../sessions/dome4u.json');
  }

  async start() {
    this.browser = await chromium.launch({
      headless: this.headless
    });

    const contextOptions = {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      viewport: { width: 1920, height: 1080 }
    };

    if (existsSync(this.sessionPath)) {
      console.log('📂 저장된 세션 로드...');
      const sessionData = JSON.parse(await readFile(this.sessionPath, 'utf8'));
      this.context = await this.browser.newContext({
        storageState: sessionData,
        ...contextOptions
      });
    } else {
      this.context = await this.browser.newContext(contextOptions);
    }

    this.page = await this.context.newPage();

    // dialog 자동 처리
    this.page.on('dialog', async dialog => {
      console.log(`   [Dialog] ${dialog.message()}`);
      await dialog.dismiss();
    });

    return this.page;
  }

  async humanDelay(min = 500, max = 1500) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await this.page.waitForTimeout(delay);
  }

  async stop() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async saveSession() {
    const sessionDir = dirname(this.sessionPath);
    await mkdir(sessionDir, { recursive: true });

    const storage = await this.context.storageState();
    await writeFile(this.sessionPath, JSON.stringify(storage, null, 2));
    console.log('💾 세션 저장 완료');
  }

  /**
   * 로그인
   */
  async login() {
    const page = this.page;
    const id = process.env.DOME4U_BUYER_ID;
    const pw = process.env.DOME4U_BUYER_PW;

    if (!id || !pw) {
      throw new Error('DOME4U_BUYER_ID, DOME4U_BUYER_PW 환경변수 설정 필요');
    }

    console.log('🔐 도매포유 로그인...');
    await page.goto('https://www.dome4u.co.kr/home/member/login.php');
    await page.waitForTimeout(2000);

    await page.getByRole('textbox', { name: '아이디 입력' }).fill(id);
    await this.humanDelay(300, 500);
    await page.getByRole('textbox', { name: '비밀번호 입력' }).fill(pw);
    await this.humanDelay(300, 500);
    await page.getByRole('button', { name: '로그인' }).click();

    await page.waitForTimeout(3000);
    await this.saveSession();
    console.log('✅ 로그인 완료');
    return true;
  }

  /**
   * 주문목록 페이지 이동
   */
  async goToMyOrders(period = '1year') {
    const page = this.page;

    console.log('🌐 도매포유 주문목록...');
    await page.goto('https://www.dome4u.co.kr/home/mypage/order_list.php?odtype=1');
    await page.waitForTimeout(2000);

    // 로그인 확인
    if (page.url().includes('login')) {
      await this.login();
      await page.goto('https://www.dome4u.co.kr/home/mypage/order_list.php?odtype=1');
      await page.waitForTimeout(2000);
    }

    // 기간 설정 (1년 조회)
    if (period === '1year') {
      try {
        const yearLink = page.getByRole('link', { name: '1년' });
        if (await yearLink.isVisible({ timeout: 2000 })) {
          await yearLink.click();
          await page.waitForTimeout(500);
          await page.getByRole('button', { name: '조회' }).click();
          await page.waitForTimeout(2000);
        }
      } catch (e) {
        // 기간 버튼 없으면 무시
      }
    }

    console.log('📋 주문목록 페이지');
    console.log('   URL:', page.url());
  }

  /**
   * 주문번호로 검색
   */
  async searchOrder(orderNumber) {
    const page = this.page;

    console.log(`🔍 주문번호 검색: ${orderNumber}`);

    const searchInput = page.locator('input[name="search_key"]');
    if (await searchInput.isVisible({ timeout: 2000 })) {
      await searchInput.fill(orderNumber);
      await page.getByRole('button', { name: '조회' }).click();
      await page.waitForTimeout(2000);
    }
  }

  /**
   * 주문 수집
   * 테이블: 주문일/주문번호 | 상품명 | 공급가 | 구매수량 | 상품합계 | 배송비 | 추가배송비 | 총금액 | 주문상태 | 비고
   */
  async collectOrders() {
    const page = this.page;
    const results = [];

    console.log('\n📦 주문 수집 중...');

    // 테이블 행 가져오기
    const rows = page.locator('table tbody tr, table tr').filter({ hasNot: page.locator('th') });
    const rowCount = await rows.count();
    console.log(`   테이블 행 수: ${rowCount}`);

    for (let i = 0; i < rowCount; i++) {
      const row = rows.nth(i);
      const rowText = (await row.textContent().catch(() => '')).replace(/\s+/g, ' ').trim();

      // 빈 행 스킵
      if (!rowText || rowText.length < 10) continue;

      const order = {
        orderNumber: null,
        orderDate: null,
        productName: null,
        recipient: null,
        status: null,
        carrier: null,
        trackingNumber: null,
        market: 'dome4u',
        collectedAt: new Date().toISOString()
      };

      // 주문번호 추출 (C + 숫자 10자리)
      const orderMatch = rowText.match(/(C\d{10})/);
      if (orderMatch) {
        order.orderNumber = orderMatch[1];
      } else {
        continue; // 주문번호 없으면 스킵
      }

      // 날짜 추출 (YYYY-MM-DD HH:MM:SS)
      const dateMatch = rowText.match(/(\d{4}-\d{2}-\d{2})/);
      if (dateMatch) {
        order.orderDate = dateMatch[1];
      }

      // 수취인 추출
      const recipientMatch = rowText.match(/수취인명\s*:\s*([^\s/]+)/);
      if (recipientMatch) {
        order.recipient = recipientMatch[1];
      }

      // 상태 추출
      if (rowText.includes('거래완료') || rowText.includes('배송완료')) {
        order.status = 'delivered';
      } else if (rowText.includes('배송중')) {
        order.status = 'shipping';
      } else if (rowText.includes('결제완료') || rowText.includes('입금확인')) {
        order.status = 'paid';
      } else if (rowText.includes('배송준비') || rowText.includes('상품준비')) {
        order.status = 'preparing';
      } else if (rowText.includes('주문취소')) {
        order.status = 'cancelled';
      }

      // 택배사/송장번호 추출 (붙어있는 형식: 한진택배461710777975)
      const carriers = [
        { name: 'CJ대한통운', pattern: /CJ대한통운\s*(\d{10,14})/ },
        { name: '한진택배', pattern: /한진택배\s*(\d{10,14})/ },
        { name: '롯데택배', pattern: /롯데택배\s*(\d{10,14})/ },
        { name: '로젠택배', pattern: /로젠택배\s*(\d{10,14})/ },
        { name: '우체국택배', pattern: /우체국택배\s*(\d{10,14})/ },
        { name: '경동택배', pattern: /경동택배\s*(\d{10,14})/ },
        { name: '대신택배', pattern: /대신택배\s*(\d{10,14})/ }
      ];

      for (const c of carriers) {
        const match = rowText.match(c.pattern);
        if (match) {
          order.carrier = c.name;
          order.trackingNumber = match[1];
          break;
        }
      }

      results.push(order);

      // 로그
      const statusIcon = order.status === 'delivered' ? '✅' :
                         order.status === 'shipping' ? '🚚' :
                         order.status === 'cancelled' ? '❌' :
                         order.carrier ? '📦' : '⏳';
      console.log(`   ${statusIcon} ${order.orderNumber}: ${order.carrier || '-'} ${order.trackingNumber || '-'}`);
    }

    return results;
  }

  /**
   * 여러 페이지 수집
   */
  async collectAllPages(maxPages = 3) {
    const page = this.page;
    const allResults = [];

    for (let p = 1; p <= maxPages; p++) {
      console.log(`\n📄 페이지 ${p}/${maxPages}`);

      const results = await this.collectOrders();
      allResults.push(...results);

      // 다음 페이지로 이동
      if (p < maxPages) {
        const nextLink = page.getByRole('link', { name: String(p + 1), exact: true });
        if (await nextLink.isVisible({ timeout: 2000 }).catch(() => false)) {
          await nextLink.click();
          await page.waitForTimeout(2000);
        } else {
          console.log('   더 이상 페이지 없음');
          break;
        }
      }
    }

    return allResults;
  }
}

// CLI
async function main() {
  const args = process.argv.slice(2);

  const myOrders = args.includes('--my-orders');
  const searchArg = args.find(a => a.startsWith('--search='));
  const searchQuery = searchArg?.split('=')[1];
  const pagesArg = args.find(a => a.startsWith('--pages='));
  const maxPages = pagesArg ? parseInt(pagesArg.split('=')[1]) : 3;

  if (!myOrders && !searchQuery) {
    console.log('도매포유 송장 수집 도구');
    console.log('');
    console.log('세션 저장:');
    console.log('  npx playwright codegen https://www.dome4u.co.kr --save-storage=sessions/dome4u.json');
    console.log('');
    console.log('사용법:');
    console.log('  --my-orders       : 전체 주문 수집');
    console.log('  --pages=N         : N페이지까지 수집 (기본: 3)');
    console.log('  --search=주문번호  : 특정 주문번호 검색');
    console.log('  --visible         : 브라우저 표시');
    return;
  }

  const visible = args.includes('--visible');
  const collector = new Dome4uCollector({ headless: !visible });

  try {
    await collector.start();
    await collector.goToMyOrders();

    let results;

    if (searchQuery) {
      await collector.searchOrder(searchQuery);
      results = await collector.collectOrders();
    } else {
      results = await collector.collectAllPages(maxPages);
    }

    // 중복 제거
    const uniqueResults = [];
    const seen = new Set();
    for (const r of results) {
      if (!seen.has(r.orderNumber)) {
        seen.add(r.orderNumber);
        uniqueResults.push(r);
      }
    }

    // 결과 요약
    console.log('\n' + '='.repeat(50));
    console.log('📊 수집 결과:');
    console.log(`  전체: ${uniqueResults.length}건`);
    console.log(`  배송완료: ${uniqueResults.filter(r => r.status === 'delivered').length}건`);
    console.log(`  배송중: ${uniqueResults.filter(r => r.status === 'shipping').length}건`);
    console.log(`  결제완료: ${uniqueResults.filter(r => r.status === 'paid').length}건`);
    console.log(`  취소: ${uniqueResults.filter(r => r.status === 'cancelled').length}건`);

    const collected = uniqueResults.filter(r => r.carrier && r.trackingNumber);
    console.log(`  송장수집: ${collected.length}건`);

    // 결과 저장
    const outputDir = join(__dirname, '../../output/invoices');
    await mkdir(outputDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outputPath = join(outputDir, `dome4u_results_${timestamp}.json`);
    await writeFile(outputPath, JSON.stringify({
      results: uniqueResults,
      summary: {
        total: uniqueResults.length,
        delivered: uniqueResults.filter(r => r.status === 'delivered').length,
        shipping: uniqueResults.filter(r => r.status === 'shipping').length,
        paid: uniqueResults.filter(r => r.status === 'paid').length,
        cancelled: uniqueResults.filter(r => r.status === 'cancelled').length,
        collected: collected.length
      }
    }, null, 2));
    console.log(`\n💾 저장: ${outputPath}`);

  } finally {
    await collector.stop();
  }
}

main().catch(console.error);

export { Dome4uCollector };
