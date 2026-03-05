/**
 * 지마켓 송장 수집 Skill
 *
 * My G에서 주문별 택배사/송장번호 수집
 * - 옥션과 유사한 ESM 구조
 * - 세션 저장/로드
 * - 문의하기/답변확인 기능 포함
 *
 * 사용법:
 *   node skills/invoice/gmarket.collector.js --my-orders
 *   node skills/invoice/gmarket.collector.js --check-replies
 *   node skills/invoice/gmarket.collector.js --orders "123,456" --inquiry
 */

import { chromium } from 'playwright';
import { config } from 'dotenv';
import { existsSync } from 'fs';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

config();

const __dirname = dirname(fileURLToPath(import.meta.url));

class GmarketCollector {
  constructor(options = {}) {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.headless = options.headless ?? false;
    this.sessionPath = join(__dirname, '../../sessions/gmarket.json');
  }

  async start() {
    this.browser = await chromium.launch({
      headless: this.headless
    });

    const contextOptions = {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      viewport: { width: 1920, height: 1080 }
    };

    // 세션이 있으면 로드
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

  /**
   * Cloudflare 체크 대기
   */
  async waitForCloudflare() {
    const page = this.page;

    const isCloudflare = await page.locator('text=Checking your browser').isVisible({ timeout: 2000 }).catch(() => false)
      || await page.locator('text=봇이 아님').isVisible({ timeout: 1000 }).catch(() => false)
      || await page.locator('iframe[src*="challenges.cloudflare.com"]').isVisible({ timeout: 1000 }).catch(() => false);

    if (isCloudflare) {
      console.log('⏳ Cloudflare 보안 체크 중... 자동 대기');
      await page.waitForFunction(() => {
        const cf = document.querySelector('iframe[src*="challenges.cloudflare.com"]');
        return !cf;
      }, { timeout: 30000 }).catch(() => {});
      console.log('✅ Cloudflare 통과');
      await this.humanDelay(1000, 2000);
    }
  }

  /**
   * 로그인 수행
   */
  async login() {
    const page = this.page;
    const id = process.env.GMARKET_BUYER_ID;
    const pw = process.env.GMARKET_BUYER_PW;

    if (!id || !pw) {
      throw new Error('GMARKET_BUYER_ID, GMARKET_BUYER_PW 환경변수 설정 필요');
    }

    console.log('🔐 지마켓 로그인...');
    // codegen 기반 셀렉터
    await page.goto('https://www.gmarket.co.kr/');
    await page.waitForLoadState('domcontentloaded');
    await this.waitForCloudflare();

    try {
      // 로그인 버튼/영역 클릭
      const loginArea = page.locator('text=로그인').first();
      if (await loginArea.isVisible({ timeout: 3000 })) {
        await loginArea.click();
        await page.waitForTimeout(2000);
      }

      // codegen 기록 기반
      const idInput = page.getByRole('textbox', { name: '아이디를 입력해주세요' });
      const pwInput = page.getByRole('textbox', { name: '비밀번호를 입력해주세요' });

      await this.humanDelay(500, 1000);
      await idInput.click();
      await this.humanDelay(100, 300);
      await idInput.fill(id);

      await this.humanDelay(300, 600);
      await pwInput.click();
      await this.humanDelay(100, 300);
      await pwInput.fill(pw);

      await this.humanDelay(500, 1000);
      await page.getByRole('button', { name: '로그인' }).click();

      await page.waitForLoadState('domcontentloaded');
      await this.waitForCloudflare();
      await this.humanDelay(2000, 3000);

      // 로그인 성공 확인
      if (!page.url().includes('signin') && !page.url().includes('login')) {
        await this.saveSession();
        console.log('✅ 로그인 완료');
        return true;
      }
    } catch (error) {
      console.log('⚠️ 자동 로그인 실패:', error.message);
    }

    // 수동 로그인 대기
    console.log('브라우저에서 로그인 완료 후 60초 내에 진행됩니다...');
    await page.waitForURL(url => !url.href.includes('signin') && !url.href.includes('login'), { timeout: 60000 });
    await this.saveSession();
    console.log('✅ 로그인 완료');
    return true;
  }

  /**
   * 세션 저장
   */
  async saveSession() {
    const sessionDir = dirname(this.sessionPath);
    await mkdir(sessionDir, { recursive: true });

    const storage = await this.context.storageState();
    await writeFile(this.sessionPath, JSON.stringify(storage, null, 2));
    console.log('💾 세션 저장 완료');
  }

  /**
   * My G 주문내역 페이지 이동
   */
  async goToMyOrders() {
    const page = this.page;

    console.log('🌐 지마켓 마이페이지 접속...');
    // 올바른 마이페이지 URL
    await page.goto('https://my.gmarket.co.kr/ko/pc/main');
    await page.waitForTimeout(3000);

    // Cloudflare 체크
    await this.waitForCloudflare();

    console.log('📋 나의 지마켓 페이지');
    console.log('   URL:', page.url());

    // 구매내역 클릭
    const orderLink = page.locator('a:has-text("구매내역"), a:has-text("주문내역"), a[href*="order"]').first();
    if (await orderLink.isVisible({ timeout: 3000 })) {
      await orderLink.click();
      await page.waitForTimeout(3000);
      console.log('   주문내역 페이지 이동');
      console.log('   URL:', page.url());
    }
  }

  /**
   * 전체 주문 로드 (주문내역 전체보기)
   */
  async loadAllOrders() {
    const page = this.page;

    const viewAllLink = page.getByRole('link', { name: '주문내역 전체보기' });
    if (await viewAllLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await viewAllLink.click();
      await page.waitForTimeout(2000);
      console.log('📜 전체 주문내역 페이지');
    }
  }

  /**
   * 주문목록에서 주문 정보 추출
   * 지마켓은 주문번호 버튼 형태: "주문번호4412971712"
   */
  async getOrderNumbers() {
    const page = this.page;
    await page.waitForTimeout(3000);

    // 주문번호 버튼들에서 추출
    const orderButtons = await page.locator('button[class*="order"], button:has-text("주문번호")').all();
    const orders = [];

    for (const btn of orderButtons) {
      const btnText = await btn.textContent().catch(() => '');
      const match = btnText.match(/주문번호(\d{10})/);
      if (match) {
        orders.push(match[1]);
      }
    }

    // 중복 제거
    const orderNumbers = [...new Set(orders)];
    console.log(`📦 발견된 주문: ${orderNumbers.length}건`);
    if (orderNumbers.length > 0) {
      console.log(`   첫 5개: ${orderNumbers.slice(0, 5).join(', ')}`);
    }
    return orderNumbers;
  }

  /**
   * 단일 주문 송장 수집
   * 지마켓: 배송조회 버튼 클릭 → iframe 팝업에서 택배사/송장 추출
   */
  async collectFromMyOrders(orderNumber) {
    const page = this.page;

    console.log(`\n📦 주문 조회: ${orderNumber}`);

    const result = {
      orderNumber,
      market: 'gmarket',
      carrier: null,
      trackingNumber: null,
      status: null,
      productNumber: null,
      collectedAt: new Date().toISOString()
    };

    try {
      // 해당 주문 영역 찾기
      const orderSection = page.locator(`text=주문번호${orderNumber}`).locator('..').locator('..').locator('..');

      // 상태 확인 (배송완료, 결제완료, 취소완료 등)
      const sectionText = await orderSection.textContent().catch(() => '');

      if (sectionText.includes('배송완료')) {
        result.status = 'delivered';
      } else if (sectionText.includes('배송중')) {
        result.status = 'shipping';
      } else if (sectionText.includes('결제완료')) {
        result.status = 'paid';
      } else if (sectionText.includes('취소완료')) {
        result.status = 'cancelled';
        console.log('  ❌ 취소완료');
        return result;
      }

      // 상품번호 추출 (문의내역 매칭용)
      const productMatch = sectionText.match(/상품번호\s*(\d+)/);
      if (productMatch) {
        result.productNumber = productMatch[1];
      }

      // 배송조회 버튼 찾기
      const trackingBtn = orderSection.getByRole('button', { name: '배송조회' });
      const deliveredBtn = orderSection.getByRole('button', { name: '배송완료' });

      let btnToClick = null;
      if (await trackingBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        btnToClick = trackingBtn;
      } else if (await deliveredBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        btnToClick = deliveredBtn;
      }

      if (btnToClick) {
        await btnToClick.click();
        await page.waitForTimeout(1500);

        // iframe 팝업에서 정보 추출
        const popupFrame = page.locator('#layers iframe[name="popLayerIframe"]').contentFrame();

        if (await popupFrame.locator('body').isVisible({ timeout: 3000 }).catch(() => false)) {
          const popupText = await popupFrame.locator('body').textContent().catch(() => '');

          // 택배사 추출
          const carriers = ['CJ택배', 'CJ대한통운', '롯데택배', '한진택배', '우체국택배', '로젠택배', '경동택배'];
          for (const carrier of carriers) {
            if (popupText.includes(carrier)) {
              result.carrier = carrier;
              break;
            }
          }

          // 송장번호 추출 (10-14자리)
          const trackingMatches = popupText.match(/\b(\d{10,14})\b/g) || [];
          for (const num of trackingMatches) {
            if (num !== orderNumber) {
              result.trackingNumber = num;
              break;
            }
          }

          // 팝업 닫기
          const closeBtn = popupFrame.getByRole('button', { name: '레이어 닫기' });
          if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
            await closeBtn.click();
            await page.waitForTimeout(500);
          }

          if (result.carrier && result.trackingNumber) {
            result.status = 'collected';
            console.log(`  ✅ ${result.carrier}: ${result.trackingNumber}`);
          } else {
            result.status = 'partial';
            console.log(`  ⚠️ 부분 수집 - 택배사: ${result.carrier}, 송장: ${result.trackingNumber}`);
          }
        }
      } else {
        // 배송조회 버튼 없음
        if (result.status === 'paid') {
          result.status = 'not_shipped';
          console.log('  ⏳ 미발송');
        } else {
          console.log(`  📦 상태: ${result.status || 'unknown'}`);
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
   * @param {string} orderNumber - 주문번호
   * @param {string} title - 문의 제목
   * @param {string} content - 문의 내용
   */
  async sendInquiry(orderNumber, title, content) {
    const page = this.page;

    console.log(`\n💬 문의 작성: ${orderNumber}`);

    try {
      // 해당 주문 영역 찾기
      const orderSection = page.locator(`text=주문번호${orderNumber}`).locator('..').locator('..').locator('..');

      // 문의하기 버튼 클릭
      const inquiryBtn = orderSection.getByRole('button', { name: '문의하기' });
      if (!await inquiryBtn.isVisible({ timeout: 3000 })) {
        console.log('  ⚠️ 문의하기 버튼 없음');
        return { success: false, reason: 'no_inquiry_button' };
      }

      await inquiryBtn.click();
      await page.waitForTimeout(1000);

      // 판매자 문의 버튼 클릭
      const sellerInquiryBtn = page.getByRole('button', { name: '판매자 문의' });
      if (await sellerInquiryBtn.isVisible({ timeout: 2000 })) {
        await sellerInquiryBtn.click();
        await page.waitForTimeout(1500);
      }

      // iframe 내 문의 폼 작성
      const popupFrame = page.locator('#layers iframe[name="popLayerIframe"]').contentFrame();

      // 배송 카테고리 선택
      const deliveryRadio = popupFrame.getByRole('radio', { name: '배송' });
      if (await deliveryRadio.isVisible({ timeout: 2000 })) {
        await deliveryRadio.check();
        await page.waitForTimeout(300);
      }

      // 제목 입력
      await popupFrame.locator('#txt_title').fill(title);
      await page.waitForTimeout(200);

      // 내용 입력
      await popupFrame.locator('#ta_content').fill(content);
      await page.waitForTimeout(200);

      // 비밀글 체크
      const secretCheck = popupFrame.getByRole('checkbox', { name: /비밀글로 문의하기/ });
      if (await secretCheck.isVisible({ timeout: 1000 })) {
        await secretCheck.check();
      }

      // 문의하기 버튼 클릭
      page.once('dialog', dialog => {
        dialog.accept().catch(() => {});
      });

      await popupFrame.getByRole('link', { name: '문의하기' }).click();
      await page.waitForTimeout(2000);

      console.log('  ✅ 문의 등록 완료');
      return { success: true, orderNumber };

    } catch (error) {
      console.error(`  ❌ 문의 실패: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * 텍스트에서 JS/HTML 코드 여부 체크
   */
  isCodeContent(text) {
    if (!text) return true;
    const codePatterns = [
      /[{}\[\]]+.*=.*[;,]/,
      /<\/?[a-z]+>/i,
      /function\s*\(/,
      /\bvar\s+\w+/,
      /\bconst\s+\w+/,
      /\blet\s+\w+/,
      /\bresult\[/,
      /\bMemberID\b/,
      /\.innerHTML/,
      /\+\s*["']/,
      /["']\s*\+/,
      /<strong>/,
      /\$\(.*\)/,
    ];
    return codePatterns.some(pattern => pattern.test(text));
  }

  /**
   * 텍스트 정제
   */
  cleanReplyText(text) {
    if (!text) return null;
    if (this.isCodeContent(text)) return null;

    let cleaned = text.trim();
    cleaned = cleaned.replace(/\d{2,4}-\d{2}-\d{2}$/, '').trim();
    cleaned = cleaned.replace(/^\d{2,4}-\d{2}-\d{2}/, '').trim();

    if (cleaned.length < 3) return null;
    return cleaned;
  }

  /**
   * 문의 답변 확인
   * - 문의 내용/제목에서 [주문번호:XXXXXXXXXX] 패턴으로 주문번호 파싱
   * - 상품번호도 함께 추출 (백업용)
   * @param {string|null} targetOrderNumber - 특정 주문번호 필터 (null이면 전체)
   */
  async checkInquiryReplies(targetOrderNumber = null) {
    const page = this.page;

    console.log('\n📬 문의 답변 확인...');

    // 문의내역 페이지로 이동
    const inquiryLink = page.getByRole('link', { name: /문의내역/ });
    if (await inquiryLink.isVisible({ timeout: 3000 })) {
      await inquiryLink.click();
      await page.waitForTimeout(3000);
    }

    const inquiries = [];

    // 문의 목록 조회 (버튼 형태)
    const inquiryItems = await page.locator('button:has-text("접수완료"), button:has-text("답변완료")').all();

    for (const item of inquiryItems) {
      const itemText = await item.textContent().catch(() => '');

      const inquiry = {
        orderNumber: null,      // 우리 주문번호 (문의 내용에서 추출)
        productNumber: null,    // 지마켓 상품번호
        productName: null,
        status: itemText.includes('답변완료') ? 'answered' : 'waiting',
        title: null,
        myInquiry: null,
        replyContent: null
      };

      // 상품번호 추출 (10자리 숫자)
      const productMatch = itemText.match(/(\d{10})/);
      if (productMatch) {
        inquiry.productNumber = productMatch[1];
      }

      // 제목에서 주문번호 패턴 찾기: [주문번호] 또는 [XXXXXXXXXX]
      const titleOrderMatch = itemText.match(/\[(\d{10,})\]|\[주문번호[:\s]*(\d+)\]/);
      if (titleOrderMatch) {
        inquiry.orderNumber = titleOrderMatch[1] || titleOrderMatch[2];
      }

      try {
        // 상세 펼치기
        await item.click();
        await page.waitForTimeout(1500);

        // 상세 내용 영역 전체 텍스트
        const detailText = await page.locator('body').textContent().catch(() => '');

        // 상품번호 추출: "상품번호 4345668428" 패턴
        const pnMatch = detailText.match(/상품번호\s*(\d{10})/);
        if (pnMatch) {
          inquiry.productNumber = pnMatch[1];
        }

        // 문의 내용에서 주문번호 추출: [주문번호:4412971712] 또는 [4412971712]
        const contentOrderMatch = detailText.match(/\[주문번호[:\s]*(\d+)\]|\[(\d{10})\]/);
        if (contentOrderMatch) {
          inquiry.orderNumber = contentOrderMatch[1] || contentOrderMatch[2];
        }

        // 특정 주문번호 필터
        if (targetOrderNumber && inquiry.orderNumber !== targetOrderNumber) continue;

        // 제목 추출 (접수완료/답변완료 뒤, 카테고리 전)
        const titleMatch = itemText.match(/(?:접수완료|답변완료)\s+(.+?)\s+(?:배송|상품|취소|기타|반품)/);
        if (titleMatch) {
          inquiry.title = titleMatch[1].trim();
        }

        // 내 문의 내용
        const myInquiryMatch = detailText.match(/\[주문번호[:\s]*\d+\](.+?)(?:\d{4}-\d{2}-\d{2}|$)/s);
        if (myInquiryMatch) {
          inquiry.myInquiry = myInquiryMatch[1].trim().substring(0, 200);
        }

        // 답변 내용 (답변완료인 경우)
        if (inquiry.status === 'answered') {
          // 답변 패턴들
          const replyPatterns = [
            /답변입니다[.\s]*(.+?)(?:추가문의|$)/s,
            /상품문의답변[.\s]*입니다[.\s]*(.+?)(?:추가문의|$)/s,
            /안녕하세요[,.\s]*(.+?)(?:감사합니다|추가문의|$)/s,
            /고객님[,.\s]*(.+?)(?:감사합니다|추가문의|$)/s
          ];

          for (const pattern of replyPatterns) {
            const replyMatch = detailText.match(pattern);
            if (replyMatch) {
              let reply = replyMatch[1].trim();
              // 시간 패턴 제거: "오후 1:07:31" 등
              reply = reply.replace(/^(오전|오후)\s*\d{1,2}:\d{2}(:\d{2})?\s*/g, '');
              reply = reply.replace(/\s*(오전|오후)\s*\d{1,2}:\d{2}(:\d{2})?/g, '');
              if (!this.isCodeContent(reply) && reply.length > 5) {
                inquiry.replyContent = reply.substring(0, 200);
                break;
              }
            }
          }
        }

      } catch (e) {
        // 파싱 실패해도 계속
      }

      inquiries.push(inquiry);
      const displayId = inquiry.orderNumber || inquiry.productNumber || '(ID없음)';
      console.log(`  ${displayId}: ${inquiry.status}`);
      if (inquiry.title) console.log(`    제목: ${inquiry.title.substring(0, 40)}`);
      if (inquiry.replyContent) console.log(`    답변: ${inquiry.replyContent.substring(0, 50)}`);
    }

    console.log(`\n  총 ${inquiries.length}건 문의`);
    console.log(`  답변완료: ${inquiries.filter(i => i.status === 'answered').length}건`);
    console.log(`  대기중: ${inquiries.filter(i => i.status === 'waiting').length}건`);

    return inquiries;
  }

  /**
   * 상품번호로 주문번호 매핑 조회
   * (주문목록에서 상품번호-주문번호 매핑 생성)
   */
  async getProductOrderMapping() {
    const page = this.page;
    const mapping = {};

    // 주문 영역들 순회
    const orderSections = await page.locator('button:has-text("주문번호")').all();

    for (const btn of orderSections) {
      const btnText = await btn.textContent().catch(() => '');
      const orderMatch = btnText.match(/주문번호(\d{10})/);
      if (!orderMatch) continue;

      const orderNumber = orderMatch[1];

      // 해당 주문 영역에서 상품번호 찾기
      const section = btn.locator('..').locator('..').locator('..');
      const sectionText = await section.textContent().catch(() => '');
      const productMatch = sectionText.match(/상품번호\s*(\d+)/);

      if (productMatch) {
        mapping[productMatch[1]] = orderNumber;
      }
    }

    return mapping;
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

  /**
   * 문의 제목 템플릿 (주문번호 포함)
   */
  getInquiryTitle(orderNumber) {
    return `[${orderNumber}] 배송 일정 문의`;
  }
}

// CLI 실행
async function main() {
  const args = process.argv.slice(2);

  const ordersIndex = args.indexOf('--orders');
  const orders = ordersIndex !== -1 ? args[ordersIndex + 1].split(',') : null;
  const myOrders = args.includes('--my-orders');
  const inquiryMode = args.includes('--inquiry');
  const checkReplies = args.includes('--check-replies');

  if (!orders && !myOrders && !checkReplies) {
    console.log('지마켓 송장 수집 도구');
    console.log('');
    console.log('사용법:');
    console.log('  --my-orders              : My G 전체 주문 수집');
    console.log('  --orders "번호1,번호2"   : 특정 주문번호들 수집');
    console.log('  --inquiry                : 미발송 건 문의하기');
    console.log('  --check-replies          : 문의 답변 확인');
    console.log('  --visible                : 브라우저 표시');
    console.log('');
    console.log('환경변수:');
    console.log('  GMARKET_BUYER_ID         : 지마켓 구매자 ID');
    console.log('  GMARKET_BUYER_PW         : 지마켓 구매자 비밀번호');
    return;
  }

  const visible = args.includes('--visible');
  const collector = new GmarketCollector({ headless: !visible });

  try {
    await collector.start();
    await collector.goToMyOrders();
    await collector.loadAllOrders();

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

      if (result.status === 'not_shipped' || result.status === 'paid') {
        notShipped.push(orderNumber);
      }

      await collector.page.waitForTimeout(500);
    }

    // 미발송 건 문의
    if (inquiryMode && notShipped.length > 0) {
      console.log(`\n💬 미발송 ${notShipped.length}건 문의 진행...`);
      for (const orderNumber of notShipped) {
        const title = collector.getInquiryTitle(orderNumber);
        const content = collector.getInquiryTemplate(orderNumber);
        await collector.sendInquiry(orderNumber, title, content);
        await collector.page.waitForTimeout(1000);
      }
    }

    // 결과 요약
    console.log('\n' + '='.repeat(50));
    console.log('📊 수집 결과:');
    console.log(`  전체: ${results.length}건`);
    console.log(`  수집완료: ${results.filter(r => r.status === 'collected').length}건`);
    console.log(`  미발송: ${results.filter(r => r.status === 'not_shipped' || r.status === 'paid').length}건`);
    console.log(`  기타: ${results.filter(r => !['collected', 'not_shipped', 'paid'].includes(r.status)).length}건`);

    // 결과 저장
    const outputDir = join(__dirname, '../../output');
    await mkdir(outputDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outputPath = join(outputDir, `gmarket_results_${timestamp}.json`);
    await writeFile(outputPath, JSON.stringify({
      results,
      summary: {
        total: results.length,
        collected: results.filter(r => r.status === 'collected').length,
        notShipped: results.filter(r => r.status === 'not_shipped' || r.status === 'paid').length
      }
    }, null, 2));
    console.log(`\n💾 저장: ${outputPath}`);

  } finally {
    await collector.stop();
  }
}

main().catch(console.error);

export { GmarketCollector };
