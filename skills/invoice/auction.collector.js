/**
 * 옥션 송장 수집 Skill
 *
 * 마이옥션에서 주문별 택배사/송장번호 수집
 * - iframe 구조 처리 (#ifStepInProcessOrder)
 * - 배송조회 팝업에서 정보 추출
 * - 문의하기 기능 포함
 *
 * 사용법:
 *   node skills/invoice/auction.collector.js --orders "1707662828,1707289569"
 *   node skills/invoice/auction.collector.js --my-orders
 */

import { chromium } from 'playwright';
import { config } from 'dotenv';
import { existsSync } from 'fs';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

config();

const __dirname = dirname(fileURLToPath(import.meta.url));

class AuctionCollector {
  constructor(options = {}) {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.headless = options.headless ?? false;
    this.sessionPath = join(__dirname, '../../sessions/auction.json');
  }

  async start() {
    this.browser = await chromium.launch({
      headless: this.headless
    });

    // 컨텍스트 설정
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

  /**
   * 랜덤 딜레이 (사람처럼)
   */
  async humanDelay(min = 500, max = 1500) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await this.page.waitForTimeout(delay);
  }

  /**
   * Cloudflare 체크 대기
   */
  async waitForCloudflare() {
    const page = this.page;

    // Cloudflare 체크 페이지인지 확인
    const isCloudflare = await page.locator('text=Checking your browser').isVisible({ timeout: 2000 }).catch(() => false)
      || await page.locator('text=보안 문자').isVisible({ timeout: 1000 }).catch(() => false)
      || await page.locator('#challenge-running').isVisible({ timeout: 1000 }).catch(() => false);

    if (isCloudflare) {
      console.log('⏳ Cloudflare 보안 체크 중... 수동으로 확인해주세요');
      // 최대 60초 대기
      await page.waitForFunction(() => {
        return !document.querySelector('#challenge-running')
          && !document.body.textContent.includes('Checking your browser');
      }, { timeout: 60000 });
      console.log('✅ Cloudflare 통과');
      await this.humanDelay(1000, 2000);
    }
  }

  async stop() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  /**
   * 로그인 수행
   */
  async login() {
    const page = this.page;
    const id = process.env.AUCTION_BUYER_ID;
    const pw = process.env.AUCTION_BUYER_PW;

    if (!id || !pw) {
      throw new Error('ESM_BUYER_ID, ESM_BUYER_PW 환경변수 설정 필요');
    }

    console.log('🔐 옥션 로그인...');
    await page.goto('https://signin.auction.co.kr/Authenticate/MobileLogin.aspx?url=https%3A%2F%2Fwww.auction.co.kr%2F');
    await page.waitForLoadState('domcontentloaded');
    await this.waitForCloudflare();

    try {
      // codegen 기록 기반 셀렉터
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
      await this.humanDelay(1000, 2000);

      // 로그인 성공 확인
      if (!page.url().includes('signin')) {
        await this.saveSession();
        console.log('✅ 로그인 완료');
        return true;
      }
    } catch (error) {
      console.log('⚠️ 자동 로그인 실패:', error.message);
    }

    // 수동 로그인 대기
    console.log('브라우저에서 로그인 완료 후 60초 내에 진행됩니다...');
    await page.waitForURL(url => !url.href.includes('signin'), { timeout: 60000 });
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
   * 마이옥션 주문내역 페이지 이동
   */
  async goToMyOrders() {
    const page = this.page;

    console.log('🌐 옥션 접속...');
    await page.goto('https://www.auction.co.kr/');
    await page.waitForTimeout(3000);

    // 마이옥션 클릭
    const myAuctionLink = page.getByRole('link', { name: '마이옥션' });
    if (await myAuctionLink.isVisible({ timeout: 5000 })) {
      await myAuctionLink.click();
      await page.waitForTimeout(3000);
    }

    console.log('📋 마이옥션 주문내역 페이지');
    console.log('   URL:', page.url());
  }

  /**
   * 주문목록 더 로드 (전체보기)
   */
  async loadAllOrders() {
    const page = this.page;

    try {
      const orderFrame = page.locator('#ifStepInProcessOrder').contentFrame();
      const showAllBtn = orderFrame.getByRole('link', { name: '전체보기' });

      if (await showAllBtn.isVisible({ timeout: 2000 })) {
        await showAllBtn.click();
        await page.waitForTimeout(2000);
        console.log('📜 전체 주문 로드');
      }
    } catch (e) {
      // 더보기 버튼 없음
    }
  }

  /**
   * 주문 목록에서 주문번호들 추출
   */
  async getOrderNumbers() {
    const page = this.page;

    // iframe이 로드될 때까지 충분히 대기
    await page.waitForTimeout(5000);

    // iframe 확인 (여러 방법 시도)
    let frameLocator = page.locator('#ifStepInProcessOrder');
    let frameExists = await frameLocator.isVisible({ timeout: 5000 }).catch(() => false);

    // iframe이 없으면 다른 셀렉터 시도
    if (!frameExists) {
      frameLocator = page.locator('iframe[name="ifStepInProcessOrder"]');
      frameExists = await frameLocator.isVisible({ timeout: 2000 }).catch(() => false);
    }

    // 여전히 없으면 모든 iframe 확인
    if (!frameExists) {
      const iframes = await page.locator('iframe').all();
      console.log('   페이지 내 iframe 수:', iframes.length);
      for (let i = 0; i < iframes.length; i++) {
        const id = await iframes[i].getAttribute('id').catch(() => '');
        const name = await iframes[i].getAttribute('name').catch(() => '');
        console.log(`   iframe[${i}]: id="${id}", name="${name}"`);
      }
    }

    console.log('   iframe 존재:', frameExists);

    if (!frameExists) {
      console.log('   ⚠️ iframe을 찾을 수 없음');
      return [];
    }

    const orderFrame = frameLocator.contentFrame();

    // iframe 전체 텍스트에서 10자리 숫자 추출
    const bodyText = await orderFrame.locator('body').textContent().catch(() => '');
    console.log('   iframe 텍스트 길이:', bodyText.length);

    // 10자리 숫자 패턴 (주문번호)
    const allMatches = bodyText.match(/\d{10}/g) || [];
    console.log('   10자리 숫자 수:', allMatches.length);

    // 중복 제거 및 유효한 주문번호만 필터 (170, 255 등으로 시작하는 것)
    const orderNumbers = [...new Set(allMatches)].filter(num => {
      return num.startsWith('17') || num.startsWith('25') || num.startsWith('16');
    });

    console.log(`📦 발견된 주문: ${orderNumbers.length}건`);
    if (orderNumbers.length > 0) {
      console.log(`   첫 5개: ${orderNumbers.slice(0, 5).join(', ')}`);
    }
    return orderNumbers;
  }

  /**
   * 단일 주문 송장 수집 (마이옥션 페이지에서)
   * @param {string} orderNumber - 주문번호
   */
  async collectFromMyOrders(orderNumber) {
    const page = this.page;
    const orderFrame = page.locator('#ifStepInProcessOrder').contentFrame();

    console.log(`\n📦 주문 조회: ${orderNumber}`);

    const result = {
      orderNumber,
      market: 'auction',
      carrier: null,
      trackingNumber: null,
      status: null,
      collectedAt: new Date().toISOString()
    };

    try {
      // 해당 주문 행 찾기
      const orderRow = orderFrame.locator(`tr:has-text("${orderNumber}")`).first();

      if (!await orderRow.isVisible({ timeout: 3000 })) {
        result.status = 'not_found';
        console.log('  ⚠️ 주문을 찾을 수 없음');
        return result;
      }

      // 배송조회 링크 찾기
      const trackingLink = orderRow.getByRole('link', { name: '배송조회' });

      if (await trackingLink.isVisible({ timeout: 2000 })) {
        // 배송조회 팝업 열기
        const popupPromise = page.waitForEvent('popup');
        await trackingLink.click();
        const popup = await popupPromise;

        await popup.waitForLoadState('networkidle');
        await popup.waitForTimeout(1000);

        // 팝업에서 택배사/송장번호 추출
        const popupText = await popup.textContent('body');

        // 택배사 매칭
        const carriers = [
          'CJ대한통운', '롯데택배', '한진택배', '우체국택배',
          '로젠택배', '경동택배', '대신택배', 'GSpostbox',
          '일양택배', '천일택배', '건영택배', '우체국'
        ];

        for (const carrier of carriers) {
          if (popupText.includes(carrier)) {
            result.carrier = carrier;
            break;
          }
        }

        // 송장번호 추출 (10-14자리 숫자)
        const trackingMatches = popupText.match(/\b(\d{10,14})\b/g);
        if (trackingMatches && trackingMatches.length > 0) {
          // 주문번호가 아닌 송장번호 찾기
          for (const num of trackingMatches) {
            if (num !== orderNumber && !orderNumber.includes(num)) {
              result.trackingNumber = num;
              break;
            }
          }
        }

        // 팝업 닫기
        try {
          await popup.getByRole('link', { name: '창닫기' }).click();
        } catch (e) {
          await popup.close();
        }

        if (result.carrier && result.trackingNumber) {
          result.status = 'collected';
          console.log(`  ✅ ${result.carrier}: ${result.trackingNumber}`);
        } else {
          result.status = 'partial';
          console.log(`  ⚠️ 부분 수집 - 택배사: ${result.carrier}, 송장: ${result.trackingNumber}`);
        }

      } else {
        // 배송조회 버튼 없음 - 상태 확인
        const statusCell = orderRow.locator('td.status, td:has(.status-msg)').first();
        const statusText = await statusCell.textContent().catch(() => '');

        if (statusText.includes('배송완료') || statusText.includes('거래완료')) {
          result.status = 'delivered_no_tracking';
          console.log('  📦 배송완료 (조회 불가)');
        } else if (statusText.includes('환불') || statusText.includes('취소')) {
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
   * @param {string} orderNumber - 주문번호
   * @param {string} content - 문의 내용
   */
  async sendInquiry(orderNumber, content) {
    const page = this.page;

    console.log(`\n💬 문의 작성: ${orderNumber}`);

    // 마이옥션에서 해당 주문 찾기
    const orderFrame = page.locator('#ifStepInProcessOrder').contentFrame();

    // 주문번호로 해당 행의 버튼 영역 찾기
    // codegen: locator('#rptList_ctl00_trOrderButtons').getByRole('link', { name: '판매자문의' })
    const orderRows = await orderFrame.locator('tr').all();
    let targetButtonRow = null;

    for (const row of orderRows) {
      const text = await row.textContent().catch(() => '');
      if (text.includes(orderNumber)) {
        // 다음 형제 행에서 버튼 찾기 (버튼은 별도 행에 있음)
        targetButtonRow = row;
        break;
      }
    }

    // 판매자문의 링크 찾기
    const inquiryLink = orderFrame.getByRole('link', { name: '판매자문의' }).first();

    if (!await inquiryLink.isVisible({ timeout: 3000 })) {
      console.log('  ⚠️ 판매자문의 버튼 없음');
      return { success: false, reason: 'no_inquiry_button' };
    }

    // 문의 팝업 열기
    const popupPromise = page.waitForEvent('popup');
    await inquiryLink.click();
    const popup = await popupPromise;

    await popup.waitForLoadState('domcontentloaded');
    await popup.waitForTimeout(1000);

    try {
      // 배송 카테고리 선택
      await popup.getByRole('radio', { name: '배송' }).check();

      // 내용 입력
      await popup.locator('#txtContent').fill(content);

      // 비밀글 체크
      const secretCheckbox = popup.getByText('비밀글로 문의하기');
      if (await secretCheckbox.isVisible({ timeout: 1000 })) {
        await secretCheckbox.click();
      }

      // 등록 버튼 클릭 (여러 셀렉터 시도)
      const submitBtn = popup.locator('#bottombutton');
      const submitBtn2 = popup.getByRole('button', { name: '게시물등록' });

      if (await submitBtn.isVisible({ timeout: 1000 })) {
        await submitBtn.click();
      } else if (await submitBtn2.isVisible({ timeout: 1000 })) {
        await submitBtn2.click();
      }

      await popup.waitForTimeout(1500);

      // 팝업 닫기
      try {
        const closeBtn = popup.getByRole('link', { name: '닫기' });
        if (await closeBtn.isVisible({ timeout: 2000 })) {
          await closeBtn.click();
        } else {
          await popup.close();
        }
      } catch (e) {
        await popup.close().catch(() => {});
      }

      console.log('  ✅ 문의 등록 완료');
      return { success: true, orderNumber };

    } catch (error) {
      console.error(`  ❌ 문의 실패: ${error.message}`);
      await popup.close().catch(() => {});
      return { success: false, error: error.message };
    }
  }

  /**
   * 텍스트에서 JS/HTML 코드 여부 체크
   */
  isCodeContent(text) {
    if (!text) return true;
    const codePatterns = [
      /[{}\[\]]+.*=.*[;,]/,    // JS 객체/배열 패턴
      /<\/?[a-z]+>/i,           // HTML 태그
      /function\s*\(/,          // function 키워드
      /\bvar\s+\w+/,            // var 선언
      /\bconst\s+\w+/,          // const 선언
      /\blet\s+\w+/,            // let 선언
      /\bresult\[/,             // result[i] 패턴
      /\bMemberID\b/,           // 코드 변수명
      /\.innerHTML/,            // DOM 속성
      /\+\s*["']/,              // 문자열 연결
      /["']\s*\+/,              // 문자열 연결
      /<strong>/,               // HTML strong 태그
      /\$\(.*\)/,               // jQuery 패턴
    ];

    return codePatterns.some(pattern => pattern.test(text));
  }

  /**
   * 텍스트 정제 (코드 및 불필요 문자 제거)
   */
  cleanReplyText(text) {
    if (!text) return null;

    // JS/HTML 코드면 무효
    if (this.isCodeContent(text)) return null;

    // 앞뒤 공백, 날짜 패턴 제거
    let cleaned = text.trim();
    cleaned = cleaned.replace(/\d{2,4}-\d{2}-\d{2}$/, '').trim();
    cleaned = cleaned.replace(/^\d{2,4}-\d{2}-\d{2}/, '').trim();

    // 너무 짧으면 무효
    if (cleaned.length < 3) return null;

    return cleaned;
  }

  /**
   * 문의 답변 확인 (특정 주문번호 또는 전체)
   * @param {string|null} targetOrderNumber - 특정 주문번호 (null이면 전체)
   */
  async checkInquiryReplies(targetOrderNumber = null) {
    const page = this.page;

    console.log('\n📬 문의 답변 확인...');

    // 마이옥션 좌측 메뉴에서 상품문의 클릭
    await page.waitForTimeout(3000); // 페이지 로드 대기

    const leftMenuFrame = page.locator('#ifMyAuctionLeftMenu');
    if (!await leftMenuFrame.isVisible({ timeout: 5000 })) {
      console.log('  좌측메뉴 iframe 없음');
      return [];
    }

    const leftMenu = leftMenuFrame.contentFrame();
    const inquiryLink = leftMenu.locator('a:has-text("상품문의")').first();

    if (!await inquiryLink.isVisible({ timeout: 5000 })) {
      console.log('  상품문의 메뉴 없음');
      return [];
    }

    await inquiryLink.click();
    await page.waitForTimeout(3000);

    // 6개월 조회로 확장
    const sixMonthBtn = page.getByRole('link', { name: '6개월' });
    if (await sixMonthBtn.isVisible({ timeout: 2000 })) {
      await sixMonthBtn.click();
      await page.waitForTimeout(1000);
      const searchBtn = page.locator('#btnSearch');
      if (await searchBtn.isVisible({ timeout: 1000 })) {
        await searchBtn.click();
        await page.waitForTimeout(2000);
      }
    }

    // 문의 목록 파싱
    const inquiries = [];

    // 테이블 행 순회
    const rows = await page.locator('table tr').all();

    for (const row of rows) {
      const rowText = await row.textContent().catch(() => '');

      // 주문번호 [숫자10자리] 패턴 찾기
      const orderMatch = rowText.match(/\[(\d{10})\]/);
      if (!orderMatch) continue;

      const orderNumber = orderMatch[1];

      // 특정 주문번호 필터
      if (targetOrderNumber && orderNumber !== targetOrderNumber) continue;

      const inquiry = {
        orderNumber,
        status: 'waiting',
        myInquiry: null,
        replyContent: null,
        sellerName: null
      };

      try {
        // 해당 행 클릭하여 상세 펼치기
        await row.click();
        await page.waitForTimeout(1500);

        // 답변 완료 상태 체크 (먼저)
        if (rowText.includes('답변완료')) {
          inquiry.status = 'answered';
        }

        // 디버그: 현재 펼쳐진 영역 전체 HTML 구조 확인
        const expandedArea = await page.locator('div[style*="display: block"], div[class*="view"], div[class*="detail"], .board_view, .qna_view').all();

        // 클릭 후 나타나는 상세 영역 텍스트 추출
        let detailText = '';

        // 방법 1: 클릭한 행 다음의 tr 또는 div
        const nextElements = await page.locator(`tr:has-text("[${orderNumber}]") ~ tr, tr:has-text("[${orderNumber}]") + div`).all();
        for (const el of nextElements.slice(0, 3)) { // 다음 3개 요소만 확인
          const text = await el.textContent().catch(() => '');
          if (text && text.length > 10 && !text.includes(orderNumber)) {
            detailText += text + '\n';
          }
        }

        // 방법 2: 페이지 내 가시적 상세 영역 (.view, .detail 등)
        if (!detailText) {
          for (const area of expandedArea) {
            if (await area.isVisible({ timeout: 300 }).catch(() => false)) {
              const text = await area.textContent().catch(() => '');
              if (text && text.length > 20) {
                detailText += text + '\n';
              }
            }
          }
        }

        // 디버그 출력 (첫 번째 문의만)
        if (inquiries.length === 0 && detailText) {
          console.log(`    [DEBUG] 상세영역 텍스트(200자): ${detailText.substring(0, 200).replace(/\n/g, '↵')}`);
        }

        // 내 문의 추출: 작성자mygy*** 또는 mygym*** 다음 텍스트
        const myMatch = detailText.match(/작성자myg[ym]?\*{2,3}(.+?)(?:작성시간|\d{2}-\d{2}-\d{2})/s);
        if (myMatch) {
          const content = myMatch[1].trim();
          if (!this.isCodeContent(content)) {
            inquiry.myInquiry = content;
          }
        }

        // 답변 추출: 내 아이디가 아닌 작성자 찾기
        // 패턴: 작성자{판매자이름}{답변내용}작성시간
        const authorBlocks = detailText.split(/(?=작성자)/);
        for (const block of authorBlocks) {
          // 판매자 블록 (내 아이디 아닌 것)
          if (block.startsWith('작성자') && !block.includes('myg')) {
            // 작성자명 추출
            const nameMatch = block.match(/^작성자([가-힣a-zA-Z0-9_]{2,20})/);
            if (nameMatch) {
              const sellerName = nameMatch[1];
              // 작성자명 다음 내용
              const afterName = block.substring(block.indexOf(sellerName) + sellerName.length);
              // 작성시간 또는 날짜 전까지
              const contentMatch = afterName.match(/(.+?)(?:작성시간|\d{2}-\d{2}-\d{2}|비공개|$)/s);
              if (contentMatch) {
                const content = contentMatch[1].trim();
                if (!this.isCodeContent(content) && content.length >= 3) {
                  inquiry.replyContent = content;
                  inquiry.sellerName = sellerName;
                  inquiry.status = 'answered';
                  break;
                }
              }
            }
          }
        }

        // Fallback: 전체 텍스트에서 "답변" 키워드 후 내용
        if (!inquiry.replyContent && inquiry.status === 'answered') {
          const replyMatch = detailText.match(/답변[:\s]*(.{10,100})/);
          if (replyMatch && !this.isCodeContent(replyMatch[1])) {
            inquiry.replyContent = replyMatch[1].trim();
          } else {
            inquiry.replyContent = '(답변 내용 파싱 실패)';
          }
        }

      } catch (e) {
        console.log(`    [ERROR] ${e.message}`);
        // 파싱 실패해도 계속 진행
      }

      inquiries.push(inquiry);
      console.log(`  ${orderNumber}: ${inquiry.status}`);
      if (inquiry.myInquiry) console.log(`    문의: ${inquiry.myInquiry.substring(0, 50)}`);
      if (inquiry.replyContent) console.log(`    답변: ${inquiry.replyContent.substring(0, 50)}`);
    }

    console.log(`\n  총 ${inquiries.length}건 문의`);
    console.log(`  답변완료: ${inquiries.filter(i => i.status === 'answered').length}건`);
    console.log(`  대기중: ${inquiries.filter(i => i.status === 'waiting').length}건`);

    return inquiries;
  }

  /**
   * 특정 주문의 문의 답변 가져오기
   * @param {string} orderNumber - 주문번호
   */
  async getInquiryReply(orderNumber) {
    const replies = await this.checkInquiryReplies(orderNumber);
    return replies.find(r => r.orderNumber === orderNumber) || null;
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

// CLI 실행
async function main() {
  const args = process.argv.slice(2);

  const ordersIndex = args.indexOf('--orders');
  const orders = ordersIndex !== -1 ? args[ordersIndex + 1].split(',') : null;

  const myOrders = args.includes('--my-orders');
  const inquiryMode = args.includes('--inquiry');
  const checkReplies = args.includes('--check-replies');

  if (!orders && !myOrders && !checkReplies) {
    console.log('옥션 송장 수집 도구');
    console.log('');
    console.log('사용법:');
    console.log('  --orders "번호1,번호2"   : 특정 주문번호들 수집');
    console.log('  --my-orders              : 마이옥션 전체 주문 수집');
    console.log('  --inquiry                : 미발송 건 문의하기');
    console.log('  --check-replies          : 문의 답변 확인');
    console.log('');
    console.log('환경변수:');
    console.log('  ESM_BUYER_ID             : 옥션 구매자 ID');
    console.log('  ESM_BUYER_PW             : 옥션 구매자 비밀번호');
    return;
  }

  const visible = args.includes('--visible');
  const collector = new AuctionCollector({ headless: !visible });

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

    // 주문번호 목록
    const orderNumbers = orders || await collector.getOrderNumbers();
    const results = [];
    const notShipped = [];

    // 각 주문 수집
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
    const outputPath = join(outputDir, `auction_results_${timestamp}.json`);
    await writeFile(outputPath, JSON.stringify({ results, summary: {
      total: results.length,
      collected: results.filter(r => r.status === 'collected').length,
      notShipped: results.filter(r => r.status === 'not_shipped').length
    }}, null, 2));
    console.log(`\n💾 저장: ${outputPath}`);

  } finally {
    await collector.stop();
  }
}

main().catch(console.error);

export { AuctionCollector };
