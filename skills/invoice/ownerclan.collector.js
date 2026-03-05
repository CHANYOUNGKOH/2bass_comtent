/**
 * 오너클랜 송장 수집 Skill
 *
 * 주문목록에서 주문코드/수령인/택배사/송장번호/상태 수집
 * - 합배송: 여러 상품이 같은 송장 공유 가능
 * - 페이지네이션 지원
 * - 검색 기능 (주문번호, 수령인)
 *
 * 사용법:
 *   node skills/invoice/ownerclan.collector.js --my-orders
 *   node skills/invoice/ownerclan.collector.js --search=주문번호
 */

import { chromium } from 'playwright';
import { config } from 'dotenv';
import { existsSync } from 'fs';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

config();

const __dirname = dirname(fileURLToPath(import.meta.url));

class OwnerclanCollector {
  constructor(options = {}) {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.headless = options.headless ?? true;
    this.sessionPath = join(__dirname, '../../sessions/ownerclan.json');
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
    const id = process.env.OWNERCLAN_BUYER_ID;
    const pw = process.env.OWNERCLAN_BUYER_PW;

    if (!id || !pw) {
      throw new Error('OWNERCLAN_BUYER_ID, OWNERCLAN_BUYER_PW 환경변수 설정 필요');
    }

    console.log('🔐 오너클랜 로그인...');
    await page.goto('https://ownerclan.com/');
    await page.waitForTimeout(2000);

    // 이미 로그인 상태 확인
    const loginLink = page.getByRole('link', { name: '로그인', exact: true });
    if (!await loginLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('✅ 이미 로그인 상태');
      return true;
    }

    await loginLink.click();
    await page.waitForTimeout(1500);

    await page.getByRole('textbox', { name: '아이디' }).fill(id);
    await this.humanDelay(300, 500);
    await page.getByRole('textbox', { name: '비밀번호' }).fill(pw);
    await this.humanDelay(300, 500);
    await page.getByRole('button', { name: 'Submit' }).click();

    await page.waitForTimeout(3000);
    await this.saveSession();
    console.log('✅ 로그인 완료');
    return true;
  }

  /**
   * 주문목록 페이지 이동
   */
  async goToMyOrders() {
    const page = this.page;

    console.log('🌐 오너클랜 주문목록...');

    // 주문목록 직접 이동
    await page.goto('https://ownerclan.com/V2/service/orderList.php');
    await page.waitForTimeout(3000);

    // 로그인 필요 시
    if (page.url().includes('login') || page.url().includes('member')) {
      await this.login();
      await page.goto('https://ownerclan.com/V2/service/orderList.php');
      await page.waitForTimeout(3000);
    }

    console.log('📋 주문목록 페이지');
    console.log('   URL:', page.url());
  }

  /**
   * 검색으로 주문 조회
   */
  async searchOrder(keyword) {
    const page = this.page;

    console.log(`🔍 검색: ${keyword}`);

    const searchInput = page.locator('input[name="searchKeyword"]');
    await searchInput.fill(keyword);
    await this.humanDelay(300, 500);

    await page.getByRole('link', { name: '조회하기' }).click();
    await page.waitForTimeout(2000);
  }

  /**
   * 현재 페이지 주문 수집
   * 테이블 구조: 주문코드 | 주문일자 | 이미지 | 주문상품명 | 배송상태 | 배송추적 | 받는사람 | 총결제금액 | 알림메모
   */
  async collectOrdersFromPage() {
    const page = this.page;
    const results = [];

    // 테이블 행 가져오기
    const rows = page.locator('table tbody tr, table tr').filter({ hasNot: page.locator('th') });
    const rowCount = await rows.count();

    for (let i = 0; i < rowCount; i++) {
      const row = rows.nth(i);
      const rowText = (await row.textContent().catch(() => '')).replace(/\s+/g, ' ').trim();

      // 빈 행 또는 헤더 스킵
      if (!rowText || rowText.length < 20) continue;
      if (rowText.includes('주문코드') && rowText.includes('주문일자')) continue;

      const order = {
        orderNumber: null,
        productName: null,
        status: null,
        recipient: null,
        sender: null,
        carrier: null,
        trackingNumber: null,
        market: 'ownerclan',
        collectedAt: new Date().toISOString()
      };

      // 주문코드 추출 (20자리+ 영숫자, A로 끝남)
      const orderMatch = rowText.match(/(\d{19,}[A-Z])/);
      if (orderMatch) {
        order.orderNumber = orderMatch[1];
      } else {
        continue;
      }

      // 상태 추출
      if (rowText.includes('배송완료')) {
        order.status = 'delivered';
      } else if (rowText.includes('배송중')) {
        order.status = 'shipping';
      } else if (rowText.includes('배송대기') || rowText.includes('결제완료')) {
        order.status = 'paid';
      } else if (rowText.includes('취소')) {
        order.status = 'cancelled';
      }

      // 택배사/송장번호 추출
      const carriers = [
        { name: 'CJ대한통운', pattern: /CJ대한통운\s*(\d{10,14})/ },
        { name: '한진택배', pattern: /한진택배\s*(\d{10,14})/ },
        { name: '롯데택배', pattern: /롯데택배\s*(\d{10,14})/ },
        { name: '로젠택배', pattern: /로젠택배\s*(\d{10,14})/ },
        { name: '우체국택배', pattern: /우체국택배\s*(\d{10,14})/ },
        { name: '경동택배', pattern: /경동택배\s*(\d{10,14})/ }
      ];

      for (const c of carriers) {
        const match = rowText.match(c.pattern);
        if (match) {
          order.carrier = c.name;
          order.trackingNumber = match[1];
          break;
        }
      }

      // 수령인 추출 (이름 (보내는사람) 형태)
      // 상태 키워드 제외: 결제완료, 배송대기, 배송중, 배송완료
      const statusKeywords = ['결제완료', '배송대기', '배송중', '배송완료', '취소', '환불'];
      const recipientMatches = rowText.matchAll(/([가-힣]{2,10})\s*\(([가-힣]+몰?)\)/g);
      for (const match of recipientMatches) {
        if (!statusKeywords.includes(match[1]) && !statusKeywords.includes(match[2])) {
          order.recipient = match[1];
          order.sender = match[2];
          break;
        }
      }

      results.push(order);
    }

    return results;
  }

  /**
   * 전체 주문 수집 (페이지네이션 포함)
   */
  async collectOrders(maxPages = 3) {
    const page = this.page;
    const allResults = [];

    console.log('\n📦 주문 수집 중...');

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      console.log(`   페이지 ${pageNum} 수집 중...`);

      const pageResults = await this.collectOrdersFromPage();
      allResults.push(...pageResults);

      console.log(`   - ${pageResults.length}건 수집`);

      // 다음 페이지로 이동
      if (pageNum < maxPages) {
        const nextPageLink = page.getByRole('link', { name: String(pageNum + 1), exact: true });
        if (await nextPageLink.isVisible({ timeout: 2000 }).catch(() => false)) {
          await nextPageLink.click();
          await page.waitForTimeout(2000);
        } else {
          console.log(`   - 마지막 페이지`);
          break;
        }
      }
    }

    // 결과 출력
    for (const order of allResults) {
      const statusIcon = order.status === 'delivered' ? '✅' :
                         order.status === 'shipping' ? '🚚' : '⏳';
      console.log(`   ${statusIcon} ${order.orderNumber}: ${order.carrier || '-'} ${order.trackingNumber || '-'} (${order.recipient || '-'})`);
    }

    return allResults;
  }

  /**
   * 주문 상세 팝업에서 문의하기
   */
  async sendInquiry(orderNumber, title, content) {
    const page = this.page;

    console.log(`\n💬 문의 작성: ${orderNumber}`);

    try {
      // 주문목록에서 주문번호 클릭 → 상세 팝업
      const orderLink = page.getByRole('link', { name: orderNumber });
      if (!await orderLink.isVisible({ timeout: 3000 })) {
        // 검색으로 찾기
        await this.searchOrder(orderNumber);
      }

      const detailPopupPromise = page.waitForEvent('popup');
      await page.getByRole('link', { name: orderNumber }).click();
      const detailPopup = await detailPopupPromise;

      await detailPopup.waitForLoadState('domcontentloaded');
      await detailPopup.waitForTimeout(1500);

      // 문의 버튼 클릭 → 문의 폼 팝업
      const inquiryBtn = detailPopup.getByRole('button', { name: /문의/i });
      if (!await inquiryBtn.isVisible({ timeout: 3000 })) {
        console.log('  ⚠️ 문의 버튼 없음');
        await detailPopup.close().catch(() => {});
        return { success: false, reason: 'no_inquiry_button' };
      }

      // dialog 처리
      detailPopup.once('dialog', dialog => {
        dialog.accept().catch(() => {});
      });

      const inquiryPopupPromise = detailPopup.waitForEvent('popup');
      await inquiryBtn.click();
      const inquiryPopup = await inquiryPopupPromise;

      await inquiryPopup.waitForLoadState('domcontentloaded');
      await inquiryPopup.waitForTimeout(1500);

      // 문의 유형 선택 (01: 배송)
      await inquiryPopup.locator('#qnatype').selectOption('01');
      await inquiryPopup.waitForTimeout(300);

      // 세부 유형 선택 (14: 배송문의)
      await inquiryPopup.locator('#qnatype2').selectOption('14');
      await inquiryPopup.waitForTimeout(300);

      // 제목 입력
      await inquiryPopup.locator('#up_subject').fill(title);
      await this.humanDelay(300, 500);

      // 내용 입력
      const contentTextarea = inquiryPopup.getByRole('textbox').filter({ hasText: '' }).first();
      await contentTextarea.fill(content);
      await this.humanDelay(300, 500);

      // SMS 알림 체크
      const smsCheck = inquiryPopup.locator('#smsck');
      if (await smsCheck.isVisible({ timeout: 1000 }).catch(() => false)) {
        await smsCheck.check();
      }

      // dialog 처리
      inquiryPopup.once('dialog', dialog => {
        dialog.accept().catch(() => {});
      });

      // 문의하기 버튼 클릭
      await inquiryPopup.getByText('문의하기', { exact: true }).click();
      await inquiryPopup.waitForTimeout(2000);

      console.log('  ✅ 문의 등록 완료');

      // 팝업 닫기
      await inquiryPopup.close().catch(() => {});
      await detailPopup.close().catch(() => {});

      return { success: true, orderNumber };

    } catch (error) {
      console.error(`  ❌ 문의 실패: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * 문의 답변 확인 (문의 목록 페이지)
   * URL: https://ownerclan.com/V2/service/qnaList.php
   * 테이블: no. | 글제목 | 답변여부 | 파일 | 작성일 | 답변일
   */
  async checkInquiryReplies() {
    const page = this.page;

    console.log('\n📬 문의 답변 확인...');

    // 문의 목록 페이지 직접 이동
    await page.goto('https://ownerclan.com/V2/service/qnaList.php');
    await page.waitForTimeout(2000);

    // 로그인 필요 시
    if (page.url().includes('login')) {
      await this.login();
      await page.goto('https://ownerclan.com/V2/service/qnaList.php');
      await page.waitForTimeout(2000);
    }

    // 1개월 조회
    const monthLink = page.getByRole('link', { name: '1개월' });
    if (await monthLink.isVisible({ timeout: 2000 })) {
      await monthLink.click();
      await page.waitForTimeout(500);
    }

    const searchLink = page.getByRole('link', { name: '조회하기' });
    if (await searchLink.isVisible({ timeout: 2000 })) {
      await searchLink.click();
      await page.waitForTimeout(2000);
    }

    console.log('   URL:', page.url());

    const inquiries = [];

    try {
      // 테이블 행 파싱
      const rows = page.locator('table tbody tr, table tr').filter({ hasNot: page.locator('th') });
      const rowCount = await rows.count();
      console.log(`   테이블 행 ${rowCount}개`);

      for (let i = 0; i < rowCount; i++) {
        const row = rows.nth(i);
        const cells = row.locator('td');
        const cellCount = await cells.count();

        if (cellCount < 4) continue;

        const inquiry = {
          no: null,
          title: null,
          orderNumber: null,
          status: 'unknown',
          createdAt: null,
          answeredAt: null
        };

        // no. (첫번째 셀)
        inquiry.no = (await cells.nth(0).textContent().catch(() => '')).trim();

        // 글제목 (두번째 셀)
        inquiry.title = (await cells.nth(1).textContent().catch(() => '')).replace(/\s+/g, ' ').trim();

        // 답변여부 (세번째 셀)
        const statusText = (await cells.nth(2).textContent().catch(() => '')).trim();
        if (statusText.includes('답변 완료') || statusText.includes('답변완료')) {
          inquiry.status = 'answered';
        } else if (statusText.includes('신규') || statusText.includes('대기')) {
          inquiry.status = 'waiting';
        }

        // 작성일 (다섯번째 셀)
        inquiry.createdAt = (await cells.nth(4).textContent().catch(() => '')).trim();

        // 답변일 (여섯번째 셀)
        inquiry.answeredAt = (await cells.nth(5).textContent().catch(() => '')).trim();

        // 빈 행 스킵
        if (!inquiry.no || !inquiry.title || inquiry.title.length < 3) continue;

        // 제목에서 주문번호 추출 시도
        const titleOrderMatch = inquiry.title.match(/(\d{19,}[A-Z])/);
        if (titleOrderMatch) {
          inquiry.orderNumber = titleOrderMatch[1];
        }

        inquiries.push(inquiry);

        const statusIcon = inquiry.status === 'answered' ? '✅' : '⏳';
        console.log(`   ${statusIcon} ${inquiry.no}: ${inquiry.title.substring(0, 30)} (${inquiry.status})`);
      }

    } catch (error) {
      console.error(`   ❌ 확인 실패: ${error.message}`);
    }

    console.log(`\n  총 ${inquiries.length}건 문의`);
    console.log(`  답변완료: ${inquiries.filter(i => i.status === 'answered').length}건`);
    console.log(`  대기중: ${inquiries.filter(i => i.status === 'waiting').length}건`);

    return inquiries;
  }

  /**
   * 문의 내용 템플릿
   */
  getInquiryTitle(orderNumber) {
    return `[${orderNumber}] 배송 일정 문의`;
  }

  getInquiryContent(orderNumber) {
    return `[주문번호:${orderNumber}] 배송 일정 문의드립니다.

1. 출고예정일:
2. 재고부족시 재입고일정:
3. 품절시 빠른환불 위해 판매자 직접취소 부탁드립니다.

※ 유선안내 필요시 010-5950-2949 문자부탁 (전화통화 어려움)`;
  }
}

// CLI
async function main() {
  const args = process.argv.slice(2);

  const myOrders = args.includes('--my-orders');
  const inquiryMode = args.includes('--inquiry');
  const checkReplies = args.includes('--check-replies');
  const searchKeyword = args.find(a => a.startsWith('--search='))?.split('=')[1];
  const maxPages = parseInt(args.find(a => a.startsWith('--pages='))?.split('=')[1] || '3');

  if (!myOrders && !searchKeyword && !checkReplies) {
    console.log('오너클랜 송장 수집 도구');
    console.log('');
    console.log('세션 저장:');
    console.log('  npx playwright codegen https://ownerclan.com --save-storage=sessions/ownerclan.json');
    console.log('');
    console.log('사용법:');
    console.log('  --my-orders         : 전체 주문 수집');
    console.log('  --inquiry           : 미발송 건 문의하기');
    console.log('  --check-replies     : 문의 답변 확인');
    console.log('  --search=키워드     : 주문번호/수령인 검색');
    console.log('  --pages=N           : 최대 페이지 수 (기본 3)');
    console.log('  --visible           : 브라우저 표시');
    return;
  }

  const visible = args.includes('--visible');
  const collector = new OwnerclanCollector({ headless: !visible });

  try {
    await collector.start();
    await collector.goToMyOrders();

    // 답변 확인 모드
    if (checkReplies) {
      const replies = await collector.checkInquiryReplies();

      // 결과 저장
      const outputDir = join(__dirname, '../../output/invoices');
      await mkdir(outputDir, { recursive: true });
      const outputPath = join(outputDir, `ownerclan_replies_${new Date().toISOString().slice(0, 10)}.json`);
      await writeFile(outputPath, JSON.stringify({ inquiries: replies, checkedAt: new Date().toISOString() }, null, 2));
      console.log(`\n💾 저장: ${outputPath}`);
      return;
    }

    // 검색 모드
    if (searchKeyword) {
      await collector.searchOrder(searchKeyword);
    }

    const results = await collector.collectOrders(maxPages);

    // 미발송 건 문의
    const notShipped = results.filter(r => r.status === 'paid' && !r.trackingNumber);
    if (inquiryMode && notShipped.length > 0) {
      console.log(`\n💬 미발송 ${notShipped.length}건 문의 진행...`);
      for (const order of notShipped.slice(0, 5)) {  // 최대 5건
        const title = collector.getInquiryTitle(order.orderNumber);
        const content = collector.getInquiryContent(order.orderNumber);
        await collector.sendInquiry(order.orderNumber, title, content);
        await collector.page.waitForTimeout(2000);
      }
    }

    // 결과 요약
    console.log('\n' + '='.repeat(50));
    console.log('📊 수집 결과:');
    console.log(`  전체: ${results.length}건`);
    console.log(`  배송완료: ${results.filter(r => r.status === 'delivered').length}건`);
    console.log(`  배송중: ${results.filter(r => r.status === 'shipping').length}건`);
    console.log(`  결제완료/대기: ${results.filter(r => r.status === 'paid').length}건`);

    const collected = results.filter(r => r.carrier && r.trackingNumber);
    console.log(`  송장수집: ${collected.length}건`);

    // 결과 저장
    const outputDir = join(__dirname, '../../output/invoices');
    await mkdir(outputDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outputPath = join(outputDir, `ownerclan_results_${timestamp}.json`);
    await writeFile(outputPath, JSON.stringify({
      results,
      summary: {
        total: results.length,
        delivered: results.filter(r => r.status === 'delivered').length,
        shipping: results.filter(r => r.status === 'shipping').length,
        paid: results.filter(r => r.status === 'paid').length,
        collected: collected.length
      }
    }, null, 2));
    console.log(`\n💾 저장: ${outputPath}`);

  } finally {
    await collector.stop();
  }
}

main().catch(console.error);

export { OwnerclanCollector };
