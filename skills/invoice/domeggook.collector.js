/**
 * 도매꾹 송장 수집 Skill
 *
 * 주문목록에서 주문번호/수령인/택배사/송장번호/상태 수집
 * 문의하기 및 답변확인 기능 포함
 *
 * 사용법:
 *   node skills/invoice/domeggook.collector.js --my-orders
 *   node skills/invoice/domeggook.collector.js --check-replies
 *   node skills/invoice/domeggook.collector.js --my-orders --inquiry
 */

import { chromium } from 'playwright';
import { config } from 'dotenv';
import { existsSync } from 'fs';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

config();

const __dirname = dirname(fileURLToPath(import.meta.url));

class DomeggookCollector {
  constructor(options = {}) {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.headless = options.headless ?? true;
    this.sessionPath = join(__dirname, '../../sessions/domeggook.json');
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
    const id = process.env.DOMEGGOOK_BUYER_ID;
    const pw = process.env.DOMEGGOOK_BUYER_PW;

    if (!id || !pw) {
      throw new Error('DOMEGGOOK_BUYER_ID, DOMEGGOOK_BUYER_PW 환경변수 설정 필요');
    }

    console.log('🔐 도매꾹 로그인...');
    await page.goto('https://domeggook.com/main/');
    await page.waitForTimeout(2000);

    // 이미 로그인 상태 확인
    const loginLink = page.getByRole('link', { name: '로그인' });
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
    await page.getByRole('button', { name: '로그인하기' }).click();

    await page.waitForTimeout(3000);
    await this.saveSession();
    console.log('✅ 로그인 완료');
    return true;
  }

  /**
   * 주문 전체목록 페이지 이동
   */
  async goToMyOrders() {
    const page = this.page;

    console.log('🌐 도매꾹 주문목록...');

    // 주문목록 직접 이동
    await page.goto('https://domeggook.com/main/myBuy/order/my_orderList.php');
    await page.waitForTimeout(3000);

    // 로그인 필요 시
    if (page.url().includes('login') || page.url().includes('member') || page.url().includes('formCert')) {
      await this.login();
      await page.goto('https://domeggook.com/main/myBuy/order/my_orderList.php');
      await page.waitForTimeout(3000);
    }

    // 전체목록 탭 클릭 (필요시)
    const allListLink = page.getByRole('link', { name: '전체목록' });
    if (await allListLink.isVisible({ timeout: 2000 }).catch(() => false)) {
      await allListLink.click();
      await page.waitForTimeout(2000);
    }

    console.log('📋 주문목록 페이지');
    console.log('   URL:', page.url());
  }

  /**
   * 주문목록 수집
   * 테이블 구조: 주문번호 | 상품 | 상태 | 수령인 | 배송정보(택배사/송장)
   */
  async collectOrders() {
    const page = this.page;
    const results = [];

    console.log('\n📦 주문 수집 중...');

    // 테이블 행 가져오기
    const rows = page.locator('table tbody tr');
    const rowCount = await rows.count();
    console.log(`   테이블 행 수: ${rowCount}`);

    for (let i = 0; i < rowCount; i++) {
      const row = rows.nth(i);
      const rowText = (await row.textContent().catch(() => '')).replace(/\s+/g, ' ').trim();

      // 빈 행 스킵
      if (!rowText || rowText.length < 10) continue;

      const order = {
        orderNumber: null,
        productName: null,
        status: null,
        recipient: null,
        carrier: null,
        trackingNumber: null,
        market: 'domeggook',
        collectedAt: new Date().toISOString()
      };

      // 주문번호 추출 (OR로 시작하는 패턴)
      const orderMatch = rowText.match(/OR\d{8,}/);
      if (orderMatch) {
        order.orderNumber = orderMatch[0];
      } else {
        continue; // 주문번호 없으면 스킵
      }

      // 상태 추출
      if (rowText.includes('배송완료')) {
        order.status = 'delivered';
      } else if (rowText.includes('배송중')) {
        order.status = 'shipping';
      } else if (rowText.includes('결제완료')) {
        order.status = 'paid';
      } else if (rowText.includes('상품준비')) {
        order.status = 'preparing';
      }

      // 택배사/송장번호 추출
      const carriers = [
        { name: 'CJ대한통운', pattern: /CJ대한통운/ },
        { name: '한진택배', pattern: /한진택배/ },
        { name: '롯데택배', pattern: /롯데택배/ },
        { name: '로젠택배', pattern: /로젠택배/ },
        { name: '우체국택배', pattern: /우체국택배/ },
        { name: '경동택배', pattern: /경동택배/ }
      ];

      for (const c of carriers) {
        if (c.pattern.test(rowText)) {
          order.carrier = c.name;
          break;
        }
      }

      // 송장번호 추출 (10-14자리, 주문번호 아닌 것)
      const trackingMatches = rowText.match(/\b(\d{10,14})\b/g) || [];
      for (const num of trackingMatches) {
        if (!num.startsWith('OR') && !order.orderNumber?.includes(num)) {
          order.trackingNumber = num;
          break;
        }
      }

      // 셀 단위 추출 시도
      const cells = row.locator('td');
      const cellCount = await cells.count();

      // 테이블 구조: 주문번호 | 상품 | 상태 | 수령인 | 배송정보 | ...
      if (cellCount >= 4) {
        // 각 셀 텍스트 추출
        const cellTexts = [];
        for (let j = 0; j < cellCount; j++) {
          const cellText = (await cells.nth(j).textContent().catch(() => '')).replace(/\s+/g, ' ').trim();
          cellTexts.push(cellText);
        }

        // 수령인 찾기 (상태가 아니고, 주문번호가 아니고, 한글 이름인 셀)
        const statusKeywords = ['결제완료', '배송완료', '배송중', '상품준비', '취소', '환불'];
        for (const cellText of cellTexts) {
          // 상태/택배 키워드 스킵
          if (statusKeywords.some(s => cellText.includes(s))) continue;
          if (cellText.includes('택배') || cellText.includes('배송조회')) continue;
          if (cellText.includes('OR')) continue;
          if (cellText.match(/\d{10,}/)) continue;  // 송장번호 스킵

          // 한글 이름 (2-4글자) 또는 기관명
          if (/^[가-힣]{2,4}$/.test(cellText)) {
            order.recipient = cellText;
            break;
          }
          // 기관명 등 (괄호 포함 가능)
          if (/^[가-힣\(\)]{4,20}$/.test(cellText) && !order.recipient) {
            order.recipient = cellText;
          }
        }
      }

      results.push(order);

      // 로그
      const statusIcon = order.status === 'delivered' ? '✅' : order.status === 'shipping' ? '🚚' : '⏳';
      console.log(`   ${statusIcon} ${order.orderNumber}: ${order.carrier || '-'} ${order.trackingNumber || '-'} (${order.recipient || '-'})`);
    }

    return results;
  }

  /**
   * 상품 문의하기
   */
  async sendInquiry(orderNumber, title, content) {
    const page = this.page;

    console.log(`\n💬 문의 작성: ${orderNumber}`);

    try {
      // 해당 주문 행 찾기
      const orderRow = page.locator(`tr:has-text("${orderNumber}")`).first();
      if (!await orderRow.isVisible({ timeout: 3000 })) {
        console.log('  ⚠️ 주문을 찾을 수 없음');
        return { success: false, reason: 'order_not_found' };
      }

      // 상품링크 클릭 (문의 iframe 열기)
      const productLink = orderRow.locator('a').first();
      await productLink.click();
      await page.waitForTimeout(2000);

      // iframe 찾기
      const iframe = page.locator('iframe[name="supportIframe"]').contentFrame();

      // 문의글 작성 버튼 클릭
      const writeBtn = iframe.getByRole('button', { name: '문의글 작성' });
      if (await writeBtn.isVisible({ timeout: 3000 })) {
        await writeBtn.click();
        await page.waitForTimeout(1000);
      }

      // 제목 입력
      await iframe.locator('input[name="title"]').fill(title);
      await this.humanDelay(300, 500);

      // 내용 입력
      await iframe.locator('textarea[name="memo"]').fill(content);
      await this.humanDelay(300, 500);

      // 비밀글 체크 (기본 체크)
      const secretCheck = iframe.locator('input[type="checkbox"]').first();
      if (await secretCheck.isVisible({ timeout: 1000 }).catch(() => false)) {
        const isChecked = await secretCheck.isChecked();
        if (!isChecked) await secretCheck.check();
      }

      // dialog 처리
      page.once('dialog', dialog => {
        dialog.accept().catch(() => {});
      });

      // 등록 버튼 클릭
      const submitBtn = iframe.getByRole('button', { name: /등록|작성/ });
      if (await submitBtn.isVisible({ timeout: 2000 })) {
        await submitBtn.click();
        await page.waitForTimeout(2000);
      }

      console.log('  ✅ 문의 등록 완료');
      return { success: true, orderNumber };

    } catch (error) {
      console.error(`  ❌ 문의 실패: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * 문의 답변 확인 (상품문의 일괄 조회)
   * URL: https://domeme.domeggook.com/main/myBuy/support/my_itemSupport.php
   */
  async checkInquiryReplies(orderNumber = null) {
    const page = this.page;

    console.log('\n📬 문의 답변 확인...');

    // 상품문의 일괄 조회 페이지
    await page.goto('https://domeme.domeggook.com/main/myBuy/support/my_itemSupport.php');
    await page.waitForTimeout(3000);

    // 로그인 필요 시
    if (page.url().includes('login') || page.url().includes('member')) {
      await this.login();
      await page.goto('https://domeme.domeggook.com/main/myBuy/support/my_itemSupport.php');
      await page.waitForTimeout(3000);
    }

    console.log('   URL:', page.url());

    const inquiries = [];

    try {
      // 문의 목록 테이블 파싱
      const rows = page.locator('table tbody tr, table tr').filter({ hasNot: page.locator('th') });
      const rowCount = await rows.count();
      console.log(`   문의 목록 ${rowCount}건`);

      for (let i = 0; i < rowCount; i++) {
        const row = rows.nth(i);
        const rowText = (await row.textContent().catch(() => '')).replace(/\s+/g, ' ').trim();

        // 빈 행, 헤더, 안내문 스킵
        if (!rowText || rowText.length < 10) continue;
        if (rowText.includes('글번호') && rowText.includes('글상태')) continue;
        if (rowText.includes('상품이 삭제된 경우')) continue;

        const inquiry = {
          orderNumber: null,
          productName: null,
          title: null,
          status: 'unknown',
          date: null,
          replyContent: null
        };

        // 상태 판별
        if (rowText.includes('답변완료')) {
          inquiry.status = 'answered';
        } else if (rowText.includes('답변대기')) {
          inquiry.status = 'waiting';
        }

        // 주문번호 추출
        const orderMatch = rowText.match(/OR\d{8,}/);
        if (orderMatch) {
          inquiry.orderNumber = orderMatch[0];
        }

        // 제목에서 주문번호 추출 시도
        const titleOrderMatch = rowText.match(/\[OR(\d{8,})\]/);
        if (titleOrderMatch) {
          inquiry.orderNumber = 'OR' + titleOrderMatch[1];
        }

        // 특정 주문번호 필터
        if (orderNumber && inquiry.orderNumber !== orderNumber) continue;

        // 셀 단위 추출
        const cells = row.locator('td');
        const cellCount = await cells.count();

        if (cellCount >= 3) {
          // 제목 추출 (링크 텍스트)
          const titleLink = row.locator('a').first();
          if (await titleLink.isVisible({ timeout: 500 }).catch(() => false)) {
            inquiry.title = (await titleLink.textContent().catch(() => '')).replace(/\s+/g, ' ').trim();
          }

          // 날짜 추출
          const dateMatch = rowText.match(/\d{4}[-\/\.]\d{2}[-\/\.]\d{2}/);
          if (dateMatch) {
            inquiry.date = dateMatch[0];
          }
        }

        if (inquiry.title || inquiry.orderNumber) {
          inquiries.push(inquiry);
          const displayId = inquiry.orderNumber || '(주문번호없음)';
          console.log(`   ${inquiry.status}: ${displayId} - ${inquiry.title?.substring(0, 30) || ''}`);
        }
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
  const orderNumber = args.find(a => a.startsWith('--order='))?.split('=')[1];

  if (!myOrders && !checkReplies) {
    console.log('도매꾹 송장 수집 도구');
    console.log('');
    console.log('세션 저장:');
    console.log('  npx playwright codegen https://domeggook.com --save-storage=sessions/domeggook.json');
    console.log('');
    console.log('사용법:');
    console.log('  --my-orders      : 전체 주문 수집');
    console.log('  --check-replies  : 문의 답변 확인');
    console.log('  --inquiry        : 미발송 건 문의하기');
    console.log('  --order=OR...    : 특정 주문번호');
    console.log('  --visible        : 브라우저 표시');
    return;
  }

  const visible = args.includes('--visible');
  const collector = new DomeggookCollector({ headless: !visible });

  try {
    await collector.start();
    await collector.goToMyOrders();

    if (checkReplies) {
      const replies = await collector.checkInquiryReplies(orderNumber);

      // 결과 저장
      const outputDir = join(__dirname, '../../output/invoices');
      await mkdir(outputDir, { recursive: true });
      const outputPath = join(outputDir, `domeggook_replies_${new Date().toISOString().slice(0, 10)}.json`);
      await writeFile(outputPath, JSON.stringify({ inquiries: replies, checkedAt: new Date().toISOString() }, null, 2));
      console.log(`\n💾 저장: ${outputPath}`);
      return;
    }

    const results = await collector.collectOrders();
    const notShipped = results.filter(r => r.status === 'paid' || r.status === 'preparing');

    // 미발송 건 문의
    if (inquiryMode && notShipped.length > 0) {
      console.log(`\n💬 미발송 ${notShipped.length}건 문의 진행...`);
      for (const order of notShipped) {
        const title = collector.getInquiryTitle(order.orderNumber);
        const content = collector.getInquiryContent(order.orderNumber);
        await collector.sendInquiry(order.orderNumber, title, content);
        await collector.page.waitForTimeout(1500);
      }
    }

    // 결과 요약
    console.log('\n' + '='.repeat(50));
    console.log('📊 수집 결과:');
    console.log(`  전체: ${results.length}건`);
    console.log(`  배송완료: ${results.filter(r => r.status === 'delivered').length}건`);
    console.log(`  배송중: ${results.filter(r => r.status === 'shipping').length}건`);
    console.log(`  결제완료/준비중: ${notShipped.length}건`);

    // 송장 수집된 건
    const collected = results.filter(r => r.carrier && r.trackingNumber);
    console.log(`  송장수집: ${collected.length}건`);

    // 결과 저장
    const outputDir = join(__dirname, '../../output/invoices');
    await mkdir(outputDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outputPath = join(outputDir, `domeggook_results_${timestamp}.json`);
    await writeFile(outputPath, JSON.stringify({
      results,
      summary: {
        total: results.length,
        delivered: results.filter(r => r.status === 'delivered').length,
        shipping: results.filter(r => r.status === 'shipping').length,
        notShipped: notShipped.length,
        collected: collected.length
      }
    }, null, 2));
    console.log(`\n💾 저장: ${outputPath}`);

  } finally {
    await collector.stop();
  }
}

main().catch(console.error);

export { DomeggookCollector };
