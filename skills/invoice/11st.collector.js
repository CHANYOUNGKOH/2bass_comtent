/**
 * 11번가 송장 수집 Skill
 *
 * MY11번가에서 주문별 택배사/송장번호 수집
 * - 세션 저장/로드
 * - 문의하기/답변확인 기능 포함
 *
 * 사용법:
 *   node skills/invoice/11st.collector.js --my-orders
 *   node skills/invoice/11st.collector.js --check-replies
 */

import { chromium } from 'playwright';
import { config } from 'dotenv';
import { existsSync } from 'fs';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

config();

const __dirname = dirname(fileURLToPath(import.meta.url));

class ElevenStreetCollector {
  constructor(options = {}) {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.headless = options.headless ?? true;
    this.sessionPath = join(__dirname, '../../sessions/11st.json');
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

    await this.page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
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
    const id = process.env.ST_BUYER_ID;
    const pw = process.env.ST_BUYER_PW;

    if (!id || !pw) {
      throw new Error('ST_BUYER_ID, ST_BUYER_PW 환경변수 설정 필요');
    }

    console.log('🔐 11번가 로그인...');
    await page.goto('https://login.11st.co.kr/auth/v2/login');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    try {
      const idInput = page.getByRole('textbox', { name: '아이디' });
      const pwInput = page.getByRole('textbox', { name: '비밀번호' });

      await this.humanDelay(500, 1000);
      await idInput.click();
      await idInput.fill(id);

      await this.humanDelay(300, 600);
      await pwInput.click();
      await pwInput.fill(pw);

      await this.humanDelay(500, 1000);
      await page.getByRole('button', { name: '로그인' }).click();

      await page.waitForTimeout(3000);

      // 공용 PC 알림 스킵
      const skipBtn = page.getByRole('link', { name: '공용 PC 일 경우 다음에 할게요' });
      if (await skipBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await skipBtn.click();
        await page.waitForTimeout(1000);
      }

      await this.saveSession();
      console.log('✅ 로그인 완료');
      return true;

    } catch (error) {
      console.log('⚠️ 자동 로그인 실패:', error.message);
      return false;
    }
  }

  /**
   * 주문/배송조회 페이지 이동
   */
  async goToMyOrders() {
    const page = this.page;

    console.log('🌐 11번가 주문/배송조회...');
    await page.goto('https://buy.11st.co.kr/my11st/order/OrderList.tmall');
    await page.waitForTimeout(3000);

    // 로그인 필요 시 (리다이렉트 확인)
    if (page.url().includes('login')) {
      await this.login();
      await page.goto('https://buy.11st.co.kr/my11st/order/OrderList.tmall');
      await page.waitForTimeout(3000);
    }

    console.log('📋 주문/배송조회 페이지');
    console.log('   URL:', page.url());
  }

  /**
   * 주문번호 추출 (17자리: 20260202037691986)
   */
  async getOrderNumbers() {
    const page = this.page;
    await page.waitForTimeout(3000);

    const bodyText = await page.textContent('body').catch(() => '');

    // 11번가 주문번호 패턴: 17자리 숫자 (2026으로 시작)
    const allMatches = bodyText.match(/\b(202\d{14})\b/g) || [];
    const orderNumbers = [...new Set(allMatches)];

    console.log(`📦 발견된 주문: ${orderNumbers.length}건`);
    if (orderNumbers.length > 0) {
      console.log(`   첫 5개: ${orderNumbers.slice(0, 5).join(', ')}`);
    }
    return orderNumbers;
  }

  /**
   * 단일 주문 송장 수집
   */
  async collectFromMyOrders(orderNumber) {
    const page = this.page;

    console.log(`\n📦 주문 조회: ${orderNumber}`);

    const result = {
      orderNumber,
      market: '11st',
      carrier: null,
      trackingNumber: null,
      status: null,
      collectedAt: new Date().toISOString()
    };

    try {
      // 해당 주문 행 찾기
      const orderRow = page.locator(`tr:has-text("${orderNumber}")`).first();

      if (!await orderRow.isVisible({ timeout: 3000 }).catch(() => false)) {
        result.status = 'not_found';
        console.log('  ⚠️ 주문을 찾을 수 없음');
        return result;
      }

      // 배송조회 링크 찾기
      const trackingLink = orderRow.getByRole('link', { name: '배송조회' });

      if (await trackingLink.isVisible({ timeout: 2000 }).catch(() => false)) {
        // 배송조회 팝업 열기
        const popupPromise = page.waitForEvent('popup');
        await trackingLink.click();
        const popup = await popupPromise;

        await popup.waitForLoadState('networkidle').catch(() => {});
        await popup.waitForTimeout(2000);

        // 팝업에서 택배사/송장번호 추출
        const popupText = await popup.textContent('body').catch(() => '');

        // 택배사 추출
        const carriers = [
          { name: 'CJ대한통운', pattern: /CJ대한통운/ },
          { name: '롯데택배', pattern: /롯데택배/ },
          { name: '한진택배', pattern: /한진택배/ },
          { name: '우체국택배', pattern: /우체국택배/ },
          { name: '로젠택배', pattern: /로젠택배/ },
          { name: '경동택배', pattern: /경동택배/ }
        ];

        for (const c of carriers) {
          if (c.pattern.test(popupText)) {
            result.carrier = c.name;
            break;
          }
        }

        // 송장번호 추출 (10-14자리)
        const trackingMatches = popupText.match(/\b(\d{10,14})\b/g) || [];
        for (const num of trackingMatches) {
          if (!orderNumber.includes(num)) {
            result.trackingNumber = num;
            break;
          }
        }

        await popup.close().catch(() => {});

        if (result.carrier && result.trackingNumber) {
          result.status = 'collected';
          console.log(`  ✅ ${result.carrier}: ${result.trackingNumber}`);
        } else {
          result.status = 'partial';
          console.log(`  ⚠️ 부분 수집`);
        }

      } else {
        // 배송조회 버튼 없음 - 상태 확인
        const rowText = await orderRow.textContent().catch(() => '');

        if (rowText.includes('구매확정') || rowText.includes('배송완료')) {
          result.status = 'delivered';
          console.log('  📦 배송완료');
        } else if (rowText.includes('취소') || rowText.includes('환불')) {
          result.status = 'cancelled';
          console.log('  ❌ 취소/환불');
        } else {
          result.status = 'not_shipped';
          console.log('  ⏳ 미발송');
        }
      }

    } catch (error) {
      console.error(`  ❌ 수집 실패: ${error.message}`);
      result.status = 'error';
      result.error = error.message;
    }

    return result;
  }

  /**
   * 판매자에게 문의하기
   */
  async sendInquiry(orderNumber, content) {
    const page = this.page;

    console.log(`\n💬 문의 작성: ${orderNumber}`);

    try {
      // 해당 주문 행에서 판매자문의 링크 찾기
      const orderRow = page.locator(`tr:has-text("${orderNumber}")`).first();
      const inquiryLink = orderRow.getByRole('link', { name: '판매자문의' });

      if (!await inquiryLink.isVisible({ timeout: 3000 })) {
        console.log('  ⚠️ 판매자문의 버튼 없음');
        return { success: false, reason: 'no_inquiry_button' };
      }

      // 팝업 열기
      const popupPromise = page.waitForEvent('popup');
      await inquiryLink.click();
      const popup = await popupPromise;

      await popup.waitForLoadState('domcontentloaded');
      await popup.waitForTimeout(1500);

      // 배송 카테고리 선택
      const deliveryRadio = popup.getByRole('radio', { name: '배송' });
      if (await deliveryRadio.isVisible({ timeout: 2000 })) {
        await deliveryRadio.check();
        await popup.waitForTimeout(300);
      }

      // 내용 입력
      const contentInput = popup.getByRole('textbox', { name: '내용' });
      await contentInput.fill(content);

      // dialog 처리
      popup.once('dialog', dialog => {
        dialog.accept().catch(() => {});
      });

      // 등록 버튼 클릭
      await popup.getByRole('button', { name: '등록' }).click();
      await popup.waitForTimeout(2000);

      console.log('  ✅ 문의 등록 완료');
      return { success: true, orderNumber };

    } catch (error) {
      console.error(`  ❌ 문의 실패: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * 문의 답변 확인 (상품 Q&A 페이지)
   */
  async checkInquiryReplies(targetOrderNumber = null) {
    const page = this.page;

    console.log('\n📬 문의 답변 확인...');

    // 상품 Q&A 페이지로 직접 이동
    await page.goto('https://www.11st.co.kr/product/MyProductQnaAction.tmall?method=getMyProductQnaList');
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(3000);

    console.log('   Q&A URL:', page.url());

    // 기간 확장 (3년)
    try {
      // 시작년도 셀렉트 찾기 - 조회기간 영역 내
      const yearSelects = page.locator('select');
      const yearCount = await yearSelects.count();
      console.log(`   셀렉트 ${yearCount}개`);

      // 첫번째 년도 셀렉트가 시작년도
      if (yearCount >= 2) {
        await yearSelects.nth(0).selectOption('2023');
        await page.waitForTimeout(500);
        console.log('   시작년도 2023 선택');
      }

      // 검색 버튼 찾기 (클래스나 이미지 기반)
      const searchBtn = page.locator('.btn_search, input[type="image"][alt*="조회"], a.btn_srch, a:has-text("조회하기")').first();
      if (await searchBtn.isVisible({ timeout: 2000 })) {
        await searchBtn.click();
        console.log('   검색 버튼 클릭');
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(3000);
      } else {
        // 대체: 검색 이미지 클릭
        const imgBtn = page.locator('img[src*="btn"], img[alt*="검색"], img[alt*="조회"]').first();
        if (await imgBtn.isVisible({ timeout: 1000 })) {
          await imgBtn.click();
          console.log('   이미지 버튼 클릭');
          await page.waitForLoadState('networkidle').catch(() => {});
          await page.waitForTimeout(3000);
        }
      }
    } catch (e) {
      console.log('   기간 설정 스킵:', e.message);
    }

    // Q&A 테이블 파싱
    // 테이블 구조: 번호 | 상품명 | 판매자 | 문의내용 | 작성일
    const rows = page.locator('table tbody tr').filter({ hasNot: page.locator('th') });
    const rowCount = await rows.count();
    console.log(`   문의 행 수: ${rowCount}`);

    const inquiries = [];

    // 각 행 파싱
    for (let i = 0; i < rowCount; i++) {
      const row = rows.nth(i);
      const rowText = (await row.textContent().catch(() => '')).replace(/\s+/g, ' ').trim();

      // 빈 행 스킵
      if (!rowText || rowText.length < 10 || rowText.includes('등록된 상품Q&A가 없습니다')) continue;

      const inquiry = {
        orderNumber: null,
        status: 'unknown',
        productName: null,
        seller: null,
        title: null,
        date: null,
        replyContent: null
      };

      // 상태 판별: [미답] 또는 [답변]
      if (rowText.includes('[미답]') || rowText.includes('미답변')) {
        inquiry.status = 'waiting';
      } else if (rowText.includes('[답변]') || rowText.includes('답변완료')) {
        inquiry.status = 'answered';
      }

      // 셀 추출
      const cells = row.locator('td');
      const cellCount = await cells.count();

      if (cellCount >= 4) {
        inquiry.productName = (await cells.nth(1).textContent().catch(() => '')).replace(/\s+/g, ' ').trim().substring(0, 50);
        inquiry.seller = (await cells.nth(2).textContent().catch(() => '')).replace(/\s+/g, ' ').trim();

        const contentCell = await cells.nth(3).textContent().catch(() => '');
        inquiry.title = contentCell.replace(/\[미답\]|\[답변\]|미답변|답변완료/g, '').replace(/\s+/g, ' ').trim().substring(0, 50);

        inquiry.date = (await cells.nth(4).textContent().catch(() => '')).replace(/\s+/g, ' ').trim();
      }

      // 주문번호 추출 (문의 내용에서)
      const orderMatch = rowText.match(/(202\d{14})/);
      if (orderMatch) {
        inquiry.orderNumber = orderMatch[1];
      }

      // 답변 내용은 목록에서만 확인 (상세 클릭 생략)
      // 필요시 별도로 상세 조회 가능

      if (targetOrderNumber && inquiry.orderNumber !== targetOrderNumber) continue;

      // 유효한 문의만 추가 (상품명 있는 경우)
      if (inquiry.productName) {
        inquiries.push(inquiry);
        console.log(`   ${i + 1}. ${inquiry.status}: ${inquiry.title || inquiry.productName}`);
      }
    }

    // 결과 출력
    for (const inq of inquiries) {
      const displayId = inq.orderNumber || '(주문번호없음)';
      console.log(`  ${displayId}: ${inq.status}`);
      if (inq.title) console.log(`    제목: ${inq.title.substring(0, 40)}`);
      if (inq.replyContent) console.log(`    답변: ${inq.replyContent.substring(0, 40)}`);
    }

    console.log(`\n  총 ${inquiries.length}건 문의`);
    console.log(`  답변완료: ${inquiries.filter(i => i.status === 'answered').length}건`);
    console.log(`  대기중: ${inquiries.filter(i => i.status === 'waiting').length}건`);

    return inquiries;
  }

  /**
   * 문의 내용 템플릿 (주문번호 포함)
   */
  getInquiryTemplate(orderNumber) {
    const today = new Date().toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });
    return `[주문번호:${orderNumber}] 배송 일정 문의

1. 출고예정일:
2. 재고부족시 재입고일정:
3. 품절시 빠른환불 위해 판매자 직접취소 부탁드립니다.

※ 유선안내 필요시 010-5950-2949 문자부탁 (전화통화 어려움)`;
  }
}

// CLI
async function main() {
  const args = process.argv.slice(2);

  const ordersIndex = args.indexOf('--orders');
  const orders = ordersIndex !== -1 ? args[ordersIndex + 1].split(',') : null;
  const myOrders = args.includes('--my-orders');
  const inquiryMode = args.includes('--inquiry');
  const checkReplies = args.includes('--check-replies');

  if (!orders && !myOrders && !checkReplies) {
    console.log('11번가 송장 수집 도구');
    console.log('');
    console.log('세션 저장:');
    console.log('  npx playwright codegen https://www.11st.co.kr --save-storage=sessions/11st.json');
    console.log('');
    console.log('사용법:');
    console.log('  --my-orders      : 전체 주문 수집');
    console.log('  --check-replies  : 문의 답변 확인');
    console.log('  --inquiry        : 미발송 건 문의하기');
    console.log('  --visible        : 브라우저 표시');
    return;
  }

  const visible = args.includes('--visible');
  const collector = new ElevenStreetCollector({ headless: !visible });

  try {
    await collector.start();
    await collector.goToMyOrders();

    if (checkReplies) {
      const replies = await collector.checkInquiryReplies();
      console.log('\n📊 문의 현황:');
      console.log(JSON.stringify(replies, null, 2));
      return;
    }

    const orderNumbers = orders || await collector.getOrderNumbers();
    const results = [];
    const notShipped = [];

    for (const orderNumber of orderNumbers) {
      const result = await collector.collectFromMyOrders(orderNumber.trim());
      results.push(result);

      if (result.status === 'not_shipped') {
        notShipped.push(orderNumber);
      }

      await collector.page.waitForTimeout(500);
    }

    // 미발송 건 문의
    if (inquiryMode && notShipped.length > 0) {
      console.log(`\n💬 미발송 ${notShipped.length}건 문의 진행...`);
      for (const orderNumber of notShipped) {
        const template = collector.getInquiryTemplate(orderNumber);
        await collector.sendInquiry(orderNumber, template);
        await collector.page.waitForTimeout(1000);
      }
    }

    // 결과 요약
    console.log('\n' + '='.repeat(50));
    console.log('📊 수집 결과:');
    console.log(`  전체: ${results.length}건`);
    console.log(`  수집완료: ${results.filter(r => r.status === 'collected').length}건`);
    console.log(`  미발송: ${results.filter(r => r.status === 'not_shipped').length}건`);
    console.log(`  기타: ${results.filter(r => !['collected', 'not_shipped'].includes(r.status)).length}건`);

    // 결과 저장
    const outputDir = join(__dirname, '../../output');
    await mkdir(outputDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outputPath = join(outputDir, `11st_results_${timestamp}.json`);
    await writeFile(outputPath, JSON.stringify({
      results,
      summary: {
        total: results.length,
        collected: results.filter(r => r.status === 'collected').length,
        notShipped: results.filter(r => r.status === 'not_shipped').length
      }
    }, null, 2));
    console.log(`\n💾 저장: ${outputPath}`);

  } finally {
    await collector.stop();
  }
}

main().catch(console.error);

export { ElevenStreetCollector };
