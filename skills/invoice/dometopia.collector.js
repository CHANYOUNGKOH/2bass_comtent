/**
 * 도매토피아 송장 수집 Skill
 *
 * 주문목록에서 주문번호/상품명/택배사/송장번호/상태 수집
 * - 문의하기는 셀러관리자에서 직접 진행 (미구현)
 * - 14시 이후 주문인데 송장 없으면 알림
 * - 문의내역 확인: https://dometopia.com/mypage/myqna_catalog
 *
 * 사용법:
 *   node skills/invoice/dometopia.collector.js --my-orders
 *   node skills/invoice/dometopia.collector.js --check-replies
 */

import { chromium } from 'playwright';
import { config } from 'dotenv';
import { existsSync } from 'fs';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

config();

const __dirname = dirname(fileURLToPath(import.meta.url));

class DometopiaCollector {
  constructor(options = {}) {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.headless = options.headless ?? true;
    this.sessionPath = join(__dirname, '../../sessions/dometopia.json');
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
    const id = process.env.DOMETOPIA_BUYER_ID;
    const pw = process.env.DOMETOPIA_BUYER_PW;

    if (!id || !pw) {
      throw new Error('DOMETOPIA_BUYER_ID, DOMETOPIA_BUYER_PW 환경변수 설정 필요');
    }

    console.log('🔐 도매토피아 로그인...');
    await page.goto('https://dometopia.com/member/login');
    await page.waitForTimeout(2000);

    await page.getByRole('textbox', { name: '아이디' }).fill(id);
    await this.humanDelay(300, 500);
    await page.getByRole('textbox', { name: '비밀번호' }).fill(pw);
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
  async goToMyOrders() {
    const page = this.page;

    console.log('🌐 도매토피아 주문목록...');
    await page.goto('https://dometopia.com/main/index');
    await page.waitForTimeout(2000);

    // 로그인 확인
    const loginLink = page.getByRole('link', { name: '로그인' });
    if (await loginLink.isVisible({ timeout: 2000 }).catch(() => false)) {
      await this.login();
    }

    // 주문배송조회 클릭
    const orderLink = page.getByRole('link', { name: '주문배송조회' });
    if (await orderLink.isVisible({ timeout: 3000 })) {
      await orderLink.click();
      await page.waitForTimeout(2000);
    }

    console.log('📋 주문목록 페이지');
    console.log('   URL:', page.url());
  }

  /**
   * 주문 수집
   * 테이블: 주문번호 | 상품명 | 주문일 | 주문금액 | 발송 정보
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
      if (!rowText || rowText.length < 20) continue;

      const order = {
        orderNumber: null,
        productName: null,
        orderDate: null,
        status: null,
        carrier: null,
        trackingNumber: null,
        needsAttention: false,  // 14시 이후 주문인데 송장 없음
        market: 'dometopia',
        collectedAt: new Date().toISOString()
      };

      // 주문번호 추출 (19자리)
      const orderMatch = rowText.match(/(\d{19})/);
      if (orderMatch) {
        order.orderNumber = orderMatch[1];
      } else {
        continue;
      }

      // 셀 단위 추출
      const cells = row.locator('td');
      const cellCount = await cells.count();

      // 테이블 구조 (6셀): 주문번호 | 빈칸 | 상품명 | 주문일 | 주문금액 | 발송상태
      if (cellCount >= 6) {
        // 상품명 (세번째 셀 - index 2)
        order.productName = (await cells.nth(2).textContent().catch(() => '')).replace(/\s+/g, ' ').trim().substring(0, 50);

        // 주문일 (네번째 셀 - index 3)
        order.orderDate = (await cells.nth(3).textContent().catch(() => '')).trim();

        // 발송 정보 (여섯번째 셀 - index 5) - "결제확인" 또는 "배송중 배송조회"
        const shippingCell = cells.nth(5);
        const shippingText = (await shippingCell.textContent().catch(() => '')).replace(/\s+/g, ' ').trim();

        // 상태 판별
        if (shippingText.includes('배송완료')) {
          order.status = 'delivered';
        } else if (shippingText.includes('배송중')) {
          order.status = 'shipping';
        } else if (shippingText.includes('결제확인') || shippingText.includes('결제완료')) {
          order.status = 'paid';
        }

        // 택배사/송장번호 패턴
        const carriers = [
          { name: 'CJ대한통운', pattern: /CJ대한통운[:\s]*(\d{10,14})/ },
          { name: 'CJ대한통운', pattern: /CJ[:\s]*(\d{10,14})/ },
          { name: '한진택배', pattern: /한진택배?[:\s]*(\d{10,14})/ },
          { name: '롯데택배', pattern: /롯데택배?[:\s]*(\d{10,14})/ },
          { name: '로젠택배', pattern: /로젠택배?[:\s]*(\d{10,14})/ },
          { name: '우체국택배', pattern: /우체국택배?[:\s]*(\d{10,14})/ },
          { name: '경동택배', pattern: /경동택배?[:\s]*(\d{10,14})/ },
          { name: '대신택배', pattern: /대신택배?[:\s]*(\d{10,14})/ }
        ];

        // 배송조회 버튼이 있으면 클릭해서 추출
        if (shippingText.includes('배송조회')) {
          try {
            // 다양한 셀렉터 시도
            let trackingBtn = shippingCell.getByRole('link', { name: '배송조회' });
            if (!await trackingBtn.isVisible({ timeout: 500 }).catch(() => false)) {
              trackingBtn = shippingCell.getByRole('button', { name: '배송조회' });
            }
            if (!await trackingBtn.isVisible({ timeout: 500 }).catch(() => false)) {
              trackingBtn = shippingCell.locator('a').filter({ hasText: '배송조회' });
            }
            if (!await trackingBtn.isVisible({ timeout: 500 }).catch(() => false)) {
              trackingBtn = shippingCell.getByText('배송조회');
            }

            if (await trackingBtn.isVisible({ timeout: 1000 })) {
              await trackingBtn.click();
              await page.waitForTimeout(2500);

              // 모달/팝업에서 추출
              const modalText = await page.textContent('body').catch(() => '');

              for (const c of carriers) {
                const match = modalText.match(c.pattern);
                if (match) {
                  order.carrier = c.name;
                  order.trackingNumber = match[1];
                  break;
                }
              }

              // 모달 닫기 (다양한 방법 시도)
              const closeSelectors = [
                'button:has-text("닫기")',
                'button:has-text("close")',
                '.modal-close',
                '.close',
                '[aria-label="닫기"]',
                '.btn-close'
              ];

              for (const sel of closeSelectors) {
                const closeBtn = page.locator(sel).first();
                if (await closeBtn.isVisible({ timeout: 500 }).catch(() => false)) {
                  await closeBtn.click();
                  await page.waitForTimeout(500);
                  break;
                }
              }

              // ESC 키로도 시도
              await page.keyboard.press('Escape');
              await page.waitForTimeout(300);
            }
          } catch (e) {
            // 무시
          }
        }
      }

      // 14시 이후 주문인데 송장 없으면 알림 필요
      if (order.status === 'paid' && !order.trackingNumber) {
        // 오늘 또는 어제 주문인지 확인
        const today = new Date().toISOString().slice(0, 10);
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

        if (order.orderDate?.includes(today.slice(5)) || order.orderDate?.includes(yesterday.slice(5))) {
          order.needsAttention = true;
        }
      }

      results.push(order);

      // 로그
      const statusIcon = order.status === 'delivered' ? '✅' :
                         order.status === 'shipping' ? '🚚' :
                         order.needsAttention ? '⚠️' : '⏳';
      console.log(`   ${statusIcon} ${order.orderNumber}: ${order.carrier || '-'} ${order.trackingNumber || '-'}`);
    }

    return results;
  }

  /**
   * 문의 답변 확인
   * URL: https://dometopia.com/mypage/myqna_catalog
   * 테이블: 번호 | 분류 | 문의 | 상태 | 문의일
   */
  async checkInquiryReplies() {
    const page = this.page;

    console.log('\n📬 문의 답변 확인...');

    // 문의내역 페이지 이동
    await page.goto('https://dometopia.com/mypage/myqna_catalog');
    await page.waitForTimeout(3000);

    // 로그인 필요 시
    if (page.url().includes('login')) {
      await this.login();
      await page.goto('https://dometopia.com/mypage/myqna_catalog');
      await page.waitForTimeout(3000);
    }

    console.log('   URL:', page.url());

    const inquiries = [];

    try {
      // 테이블 행 파싱
      const rows = page.locator('#bbslist tr, table tbody tr').filter({ hasNot: page.locator('th') });
      const rowCount = await rows.count();
      console.log(`   테이블 행 ${rowCount}개`);

      for (let i = 0; i < rowCount; i++) {
        const row = rows.nth(i);
        const cells = row.locator('td');
        const cellCount = await cells.count();

        if (cellCount < 4) continue;

        const inquiry = {
          no: null,
          category: null,
          title: null,
          status: 'unknown',
          createdAt: null
        };

        // 번호
        inquiry.no = (await cells.nth(0).textContent().catch(() => '')).trim();

        // 분류
        inquiry.category = (await cells.nth(1).textContent().catch(() => '')).trim();

        // 문의 제목
        inquiry.title = (await cells.nth(2).textContent().catch(() => '')).replace(/\s+/g, ' ').trim();

        // 상태
        const statusText = (await cells.nth(3).textContent().catch(() => '')).trim();
        if (statusText.includes('답변완료')) {
          inquiry.status = 'answered';
        } else if (statusText.includes('대기') || statusText.includes('접수')) {
          inquiry.status = 'waiting';
        }

        // 문의일
        inquiry.createdAt = (await cells.nth(4).textContent().catch(() => '')).trim();

        // 빈 행 스킵
        if (!inquiry.no || !inquiry.title) continue;

        inquiries.push(inquiry);

        const statusIcon = inquiry.status === 'answered' ? '✅' : '⏳';
        console.log(`   ${statusIcon} ${inquiry.no}: ${inquiry.category} - ${inquiry.title.substring(0, 30)}`);
      }

    } catch (error) {
      console.error(`   ❌ 확인 실패: ${error.message}`);
    }

    console.log(`\n  총 ${inquiries.length}건 문의`);
    console.log(`  답변완료: ${inquiries.filter(i => i.status === 'answered').length}건`);
    console.log(`  대기중: ${inquiries.filter(i => i.status === 'waiting').length}건`);

    return inquiries;
  }
}

// CLI
async function main() {
  const args = process.argv.slice(2);

  const myOrders = args.includes('--my-orders');
  const checkReplies = args.includes('--check-replies');

  if (!myOrders && !checkReplies) {
    console.log('도매토피아 송장 수집 도구');
    console.log('');
    console.log('세션 저장:');
    console.log('  npx playwright codegen https://dometopia.com --save-storage=sessions/dometopia.json');
    console.log('');
    console.log('사용법:');
    console.log('  --my-orders      : 전체 주문 수집');
    console.log('  --check-replies  : 문의 답변 확인');
    console.log('  --visible        : 브라우저 표시');
    console.log('');
    console.log('※ 문의하기는 셀러관리자에서 직접 진행');
    console.log('※ ⚠️ 표시: 14시 이후 주문인데 송장 없음 (확인 필요)');
    return;
  }

  const visible = args.includes('--visible');
  const collector = new DometopiaCollector({ headless: !visible });

  try {
    await collector.start();

    if (checkReplies) {
      await collector.goToMyOrders();  // 로그인 확인용
      const replies = await collector.checkInquiryReplies();

      // 결과 저장
      const outputDir = join(__dirname, '../../output/invoices');
      await mkdir(outputDir, { recursive: true });
      const outputPath = join(outputDir, `dometopia_replies_${new Date().toISOString().slice(0, 10)}.json`);
      await writeFile(outputPath, JSON.stringify({ inquiries: replies, checkedAt: new Date().toISOString() }, null, 2));
      console.log(`\n💾 저장: ${outputPath}`);
      return;
    }

    await collector.goToMyOrders();
    const results = await collector.collectOrders();

    // 결과 요약
    console.log('\n' + '='.repeat(50));
    console.log('📊 수집 결과:');
    console.log(`  전체: ${results.length}건`);
    console.log(`  배송완료: ${results.filter(r => r.status === 'delivered').length}건`);
    console.log(`  배송중: ${results.filter(r => r.status === 'shipping').length}건`);
    console.log(`  결제확인: ${results.filter(r => r.status === 'paid').length}건`);

    const collected = results.filter(r => r.carrier && r.trackingNumber);
    console.log(`  송장수집: ${collected.length}건`);

    // 주의 필요 건
    const needsAttention = results.filter(r => r.needsAttention);
    if (needsAttention.length > 0) {
      console.log(`\n⚠️ 확인 필요 ${needsAttention.length}건 (14시 이후 주문, 송장 없음):`);
      for (const order of needsAttention) {
        console.log(`   - ${order.orderNumber} (${order.orderDate})`);
      }
      console.log('   → 셀러관리자에서 직접 확인/문의 필요');
    }

    // 결과 저장
    const outputDir = join(__dirname, '../../output/invoices');
    await mkdir(outputDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outputPath = join(outputDir, `dometopia_results_${timestamp}.json`);
    await writeFile(outputPath, JSON.stringify({
      results,
      summary: {
        total: results.length,
        delivered: results.filter(r => r.status === 'delivered').length,
        shipping: results.filter(r => r.status === 'shipping').length,
        paid: results.filter(r => r.status === 'paid').length,
        collected: collected.length,
        needsAttention: needsAttention.length
      }
    }, null, 2));
    console.log(`\n💾 저장: ${outputPath}`);

  } finally {
    await collector.stop();
  }
}

main().catch(console.error);

export { DometopiaCollector };
