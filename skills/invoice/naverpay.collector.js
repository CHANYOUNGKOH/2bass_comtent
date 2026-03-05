/**
 * 네이버페이 송장 수집 Skill
 *
 * 주문 URL에서 택배사/송장번호 수집
 * - 배송조회 버튼이 활성화된 주문만 수집 가능
 *
 * 사용법:
 *   node skills/invoice/naverpay.collector.js --url "https://orders.pay.naver.com/order/status/2026020914567401"
 *   node skills/invoice/naverpay.collector.js --excel "path/to/orders.xlsx"
 */

import { chromium } from 'playwright';
import { config } from 'dotenv';
import { existsSync } from 'fs';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const INQUIRY_HISTORY_PATH = join(__dirname, '../../data/inquiry_history.json');

/**
 * 문의 이력 로드
 */
async function loadInquiryHistory() {
  try {
    if (existsSync(INQUIRY_HISTORY_PATH)) {
      const data = JSON.parse(await readFile(INQUIRY_HISTORY_PATH, 'utf8'));
      return data.inquiries || {};
    }
  } catch (e) {
    console.error('문의 이력 로드 실패:', e.message);
  }
  return {};
}

/**
 * 문의 이력 저장
 */
async function saveInquiryHistory(inquiries) {
  const data = {
    _meta: {
      description: "문의 이력 관리 (나중에 OrderHelper DB와 통합 예정)",
      updated_at: new Date().toISOString()
    },
    inquiries
  };

  await mkdir(dirname(INQUIRY_HISTORY_PATH), { recursive: true });
  await writeFile(INQUIRY_HISTORY_PATH, JSON.stringify(data, null, 2));
}

/**
 * 문의 이력 조회
 */
async function getInquiryRecord(orderNumber) {
  const inquiries = await loadInquiryHistory();
  return inquiries[orderNumber] || null;
}

/**
 * 문의 이력 업데이트
 */
async function updateInquiryRecord(orderNumber, record) {
  const inquiries = await loadInquiryHistory();
  inquiries[orderNumber] = {
    ...inquiries[orderNumber],
    ...record,
    updated_at: new Date().toISOString()
  };
  await saveInquiryHistory(inquiries);
  return inquiries[orderNumber];
}

class NaverPayCollector {
  constructor(options = {}) {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.headless = options.headless ?? false;
    this.sessionPath = join(__dirname, '../../sessions/naverpay.json');
  }

  async start() {
    this.browser = await chromium.launch({
      headless: this.headless,
      slowMo: 50
    });

    // 세션이 있으면 로드
    if (existsSync(this.sessionPath)) {
      console.log('📂 저장된 세션 로드...');
      const sessionData = JSON.parse(await readFile(this.sessionPath, 'utf8'));
      this.context = await this.browser.newContext({ storageState: sessionData });
    } else {
      this.context = await this.browser.newContext();
    }

    this.page = await this.context.newPage();
    return this.page;
  }

  async stop() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  /**
   * 로그인 필요 여부 확인
   */
  async checkLogin() {
    const url = this.page.url();
    return !url.includes('nid.naver.com');
  }

  /**
   * 로그인 수행
   */
  async login() {
    const page = this.page;
    const id = process.env.NAVER_BUYER_ID;
    const pw = process.env.NAVER_BUYER_PW;

    if (!id || !pw) {
      throw new Error('NAVER_BUYER_ID, NAVER_BUYER_PW 환경변수 설정 필요');
    }

    await page.goto('https://nid.naver.com/nidlogin.login');

    await page.getByRole('textbox', { name: '아이디 또는 전화번호' }).fill(id);
    await page.getByRole('textbox', { name: '비밀번호' }).fill(pw);
    await page.getByRole('button', { name: '로그인', exact: true }).click();

    await page.waitForLoadState('networkidle');

    // 2단계 인증 체크
    if (page.url().includes('nid.naver.com')) {
      console.log('⚠️ 2단계 인증 필요 - 브라우저에서 완료해주세요');
      // 로그인 완료 대기 (최대 60초)
      await page.waitForURL(url => !url.href.includes('nid.naver.com'), { timeout: 60000 });
    }

    // 세션 저장
    await this.saveSession();
    console.log('✅ 로그인 완료');
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
   * 단일 주문 송장 수집
   * @param {string} orderUrl - 주문 URL
   */
  async collectSingle(orderUrl) {
    const page = this.page;

    // 주문번호 추출
    const orderNumber = orderUrl.split('/').pop();
    console.log(`\n📦 주문 조회: ${orderNumber}`);

    await page.goto(orderUrl);
    await page.waitForLoadState('networkidle');

    // 로그인 필요 시
    if (page.url().includes('nid.naver.com')) {
      console.log('🔐 로그인 필요...');
      await this.login();
      await page.goto(orderUrl);
      await page.waitForLoadState('networkidle');
    }

    // 송장 정보 수집
    const result = {
      orderUrl,
      orderNumber,
      carrier: null,
      trackingNumber: null,
      status: null,
      collectedAt: new Date().toISOString()
    };

    try {
      // 배송조회 버튼 모두 찾기 (합배송 케이스 대응)
      const trackingBtns = page.getByRole('button', { name: '배송조회' });
      const btnCount = await trackingBtns.count();

      if (btnCount > 0) {
        console.log(`📍 배송조회 버튼 ${btnCount}개 발견`);

        // 알려진 택배사 목록
        const carriers = [
          'CJ대한통운', '롯데택배', '한진택배', '우체국택배',
          '로젠택배', '경동택배', '대신택배', 'GSpostbox',
          '일양택배', '천일택배', '건영택배', '기타택배'
        ];

        // 각 배송조회 버튼별로 수집
        const trackingInfos = [];

        for (let i = 0; i < btnCount; i++) {
          console.log(`  [${i + 1}/${btnCount}] 배송조회 클릭`);

          // 페이지 새로고침 후 버튼 다시 찾기 (모달 닫힘 보장)
          if (i > 0) {
            await page.goto(orderUrl);
            await page.waitForLoadState('networkidle');
          }

          // 버튼 다시 찾아서 클릭
          const btns = page.getByRole('button', { name: '배송조회' });
          await btns.nth(i).click();
          await page.waitForLoadState('networkidle');
          await page.waitForTimeout(500);

          const pageText = await page.textContent('body');
          let carrier = null;
          let trackingNumber = null;

          // 택배사 찾기
          for (const c of carriers) {
            if (pageText.includes(c)) {
              carrier = c;
              break;
            }
          }

          // 송장번호 찾기 (10-14자리 숫자, 주문번호 제외)
          const trackingMatches = pageText.match(/\b(\d{10,14})\b/g);
          if (trackingMatches) {
            trackingNumber = trackingMatches.find(n => n !== orderNumber && !n.startsWith('202')) || trackingMatches[0];
          }

          if (carrier && trackingNumber) {
            // 중복 체크
            const exists = trackingInfos.some(t => t.trackingNumber === trackingNumber);
            if (!exists) {
              trackingInfos.push({ carrier, trackingNumber });
              console.log(`    택배사: ${carrier}, 송장: ${trackingNumber}`);
            } else {
              console.log(`    (중복) ${carrier}, ${trackingNumber}`);
            }
          }
        }

        // 결과 저장
        if (trackingInfos.length === 1) {
          result.carrier = trackingInfos[0].carrier;
          result.trackingNumber = trackingInfos[0].trackingNumber;
        } else if (trackingInfos.length > 1) {
          // 합배송: 여러 송장
          result.carrier = trackingInfos.map(t => t.carrier).join(', ');
          result.trackingNumber = trackingInfos.map(t => t.trackingNumber).join(', ');
          result.trackingInfos = trackingInfos;
        }

        result.status = trackingInfos.length > 0 ? 'collected' : 'no_tracking';

      } else {
        // 배송조회 버튼 없음 - 미발송 상태
        result.status = 'not_shipped';
        console.log('⚠️ 배송조회 버튼 없음 - 미발송 상태');
      }

      console.log(`  상태: ${result.status}`);

    } catch (error) {
      console.error(`❌ 수집 실패: ${error.message}`);
      result.status = 'error';
      result.error = error.message;
    }

    return result;
  }

  /**
   * 여러 주문 송장 수집
   * @param {Array} orderUrls - 주문 URL 배열
   */
  async collectMultiple(orderUrls) {
    const results = [];

    for (const url of orderUrls) {
      const result = await this.collectSingle(url);
      results.push(result);

      // 요청 간격
      await this.page.waitForTimeout(1000);
    }

    return results;
  }

  /**
   * 문의 템플릿 생성
   */
  getInquiryTemplate(orderNumber, type = 'delivery') {
    const today = new Date().toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });

    const templates = {
      delivery: {
        title: `[${today}] 배송 일정 문의`,
        content: `1. 출고예정일:\n2. 재고부족시 재입고일정:\n3. 품절시 빠른환불 위해 판매자 직접취소 부탁드립니다.\n\n※ 유선안내 필요시 010-5950-2949 문자부탁 (전화통화 어려움)`
      },
      status: {
        title: `[${today}] 주문 상태 문의`,
        content: `1. 현재 진행상태:\n2. 예상 완료일:\n\n※ 유선안내 필요시 010-5950-2949 문자부탁 (전화통화 어려움)`
      }
    };

    return templates[type] || templates.delivery;
  }

  /**
   * 주문 페이지에서 1:1 문의 등록
   * @param {string} orderUrl - 주문 URL
   * @param {object} options - { title, content, category, productIndex }
   */
  async submitInquiry(orderUrl, options = {}) {
    const page = this.page;
    const orderNumber = orderUrl.split('/').pop();

    // 템플릿 사용
    const template = this.getInquiryTemplate(orderNumber, options.type || 'delivery');
    const title = options.title || template.title;
    const content = options.content || template.content;
    const category = options.category || 'DELIVERY';

    console.log(`\n📝 문의 작성: ${orderNumber}`);
    console.log(`   제목: ${title}`);

    await page.goto(orderUrl);
    await page.waitForLoadState('networkidle');

    // 로그인 필요 시
    if (page.url().includes('nid.naver.com')) {
      console.log('🔐 로그인 필요...');
      await this.login();
      await page.goto(orderUrl);
      await page.waitForLoadState('networkidle');
    }

    const result = {
      orderUrl,
      orderNumber,
      action: 'inquiry',
      title,
      content,
      status: null,
      submittedAt: null
    };

    try {
      // 1. "문의하기" 버튼 클릭
      const inquiryBtn = page.getByRole('button', { name: '문의하기' });
      if (!await inquiryBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log('⚠️ 문의하기 버튼 없음');
        result.status = 'no_inquiry_button';
        return result;
      }

      await inquiryBtn.click();
      await page.waitForTimeout(500);

      // 2. "1:1 문의" 버튼 클릭 → 팝업 대기
      const popupPromise = page.waitForEvent('popup');
      await page.getByRole('button', { name: '1:1 문의' }).click();
      const popup = await popupPromise;
      await popup.waitForLoadState('networkidle');

      console.log('📍 1:1 문의 팝업 열림');

      // 3. 상품 선택 (첫 번째 또는 지정된 상품)
      const productSelect = popup.locator('#productNo');
      if (await productSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
        const productOptions = await productSelect.locator('option').all();
        if (productOptions.length > 1) {
          // 첫 번째 실제 상품 선택 (index 0은 보통 "선택하세요")
          const productValue = await productOptions[1].getAttribute('value');
          await productSelect.selectOption(productValue);
          console.log(`   상품 선택: ${productValue}`);
        }
      }

      // 4. 문의 유형 선택
      const categorySelect = popup.locator('#inquiryCategory');
      if (await categorySelect.isVisible({ timeout: 1000 }).catch(() => false)) {
        await categorySelect.selectOption(category);
        console.log(`   유형: ${category}`);
      }

      // 5. 제목 입력
      await popup.getByRole('textbox', { name: '제목' }).fill(title);

      // 6. 내용 입력
      await popup.getByRole('textbox', { name: '내용' }).fill(content);

      // 7. 확인 버튼 클릭 (dialog 처리)
      popup.once('dialog', async dialog => {
        console.log(`   Dialog: ${dialog.message()}`);
        await dialog.accept();
      });

      await popup.getByRole('link', { name: '확인' }).click();
      await page.waitForTimeout(1000);

      // 8. 모달 닫기
      const closeBtn = page.getByRole('button', { name: '모달 닫기' });
      if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await closeBtn.click();
      }

      console.log('✅ 문의 등록 완료');
      result.status = 'submitted';
      result.submittedAt = new Date().toISOString();

    } catch (error) {
      console.error(`❌ 문의 실패: ${error.message}`);
      await this.saveScreenshot(`inquiry_error_${orderNumber}`);
      result.status = 'error';
      result.error = error.message;
    }

    return result;
  }

  /**
   * 전체 문의 답변 확인 (URL 불필요)
   * 판매자 문의 목록 페이지 직접 접근
   */
  async checkAllInquiryReplies() {
    const page = this.page;

    console.log('\n📬 전체 문의 답변 확인...');

    // 판매자 문의 목록 페이지 직접 접근
    await page.goto('https://m.pay.naver.com/mobile/shoppingInquiry/list?fromPC=Y');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // 로그인 필요 시
    if (page.url().includes('nid.naver.com')) {
      console.log('🔐 로그인 필요...');
      await this.login();
      await page.goto('https://m.pay.naver.com/mobile/shoppingInquiry/list?fromPC=Y');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);
    }

    const inquiries = [];

    try {
      // 전체 페이지 텍스트
      const pageText = await page.textContent('body').catch(() => '');

      // 총 문의 건수 추출
      const totalMatch = pageText.match(/문의 총 (\d+)건/);
      if (totalMatch) {
        console.log(`  문의 총 ${totalMatch[1]}건`);
      }

      // 패턴: "미답변 주문번호 XXXXXXXXXX" 또는 "답변완료 주문번호 XXXXXXXXXX"
      // 미답변 문의 추출
      const waitingMatches = pageText.match(/미답변\s*주문번호\s*(\d+)/g) || [];
      for (const match of waitingMatches) {
        const orderNum = match.match(/(\d+)/)?.[1];
        if (orderNum && !inquiries.some(i => i.orderNumber === orderNum)) {
          inquiries.push({
            orderNumber: orderNum,
            status: 'waiting',
            hasReply: false
          });
        }
      }

      // 답변완료 문의 추출
      const answeredMatches = pageText.match(/답변완료\s*주문번호\s*(\d+)/g) || [];
      for (const match of answeredMatches) {
        const orderNum = match.match(/(\d+)/)?.[1];
        if (orderNum && !inquiries.some(i => i.orderNumber === orderNum)) {
          inquiries.push({
            orderNumber: orderNum,
            status: 'answered',
            hasReply: true
          });
        }
      }

      // 각 문의 출력
      for (const inq of inquiries) {
        console.log(`  ${inq.orderNumber}: ${inq.status}`);
      }

    } catch (error) {
      console.error(`  ❌ 파싱 실패: ${error.message}`);
    }

    // 결과 요약
    console.log(`\n  총 ${inquiries.length}건 문의`);
    console.log(`  답변완료: ${inquiries.filter(i => i.status === 'answered').length}건`);
    console.log(`  대기중: ${inquiries.filter(i => i.status === 'waiting').length}건`);

    return {
      inquiries,
      total: inquiries.length,
      answered: inquiries.filter(i => i.status === 'answered').length,
      waiting: inquiries.filter(i => i.status === 'waiting').length,
      checkedAt: new Date().toISOString()
    };
  }

  /**
   * 판매자 문의 내역 확인 (결제내역 페이지에서)
   * @param {string} orderNumber - 주문번호 (특정 주문만 필터링, null이면 전체)
   */
  async checkInquiryReply(orderNumber = null) {
    const page = this.page;

    console.log(`\n🔍 판매자 문의 내역 확인`);
    if (orderNumber) {
      console.log(`   주문번호 필터: ${orderNumber}`);
    }

    // 결제내역 페이지로 이동
    await page.goto('https://pay.naver.com/pc/history?page=1');
    await page.waitForLoadState('networkidle');

    // 로그인 필요 시
    if (page.url().includes('nid.naver.com')) {
      console.log('🔐 로그인 필요...');
      await this.login();
      await page.goto('https://pay.naver.com/pc/history?page=1');
      await page.waitForLoadState('networkidle');
    }

    const result = {
      action: 'check_reply',
      orderNumber,
      inquiries: [],
      checkedAt: new Date().toISOString()
    };

    try {
      // "판매자 문의" 클릭 → 팝업 대기
      const popupPromise = page.waitForEvent('popup');
      await page.getByRole('link', { name: '판매자 문의' }).click();
      const popup = await popupPromise;
      await popup.waitForLoadState('networkidle');

      console.log('📍 판매자 문의 팝업 열림');

      // 문의 목록 파싱
      const pageText = await popup.textContent('body');

      // 주문번호로 필터링 (있는 경우)
      if (orderNumber && pageText.includes(orderNumber)) {
        console.log(`   주문번호 ${orderNumber} 문의 발견`);

        // 미답변/답변완료 확인
        if (pageText.includes('미답변')) {
          result.inquiries.push({
            orderNumber,
            status: 'waiting',
            hasReply: false
          });
          console.log('   상태: 미답변');
        } else if (pageText.includes('답변완료')) {
          result.inquiries.push({
            orderNumber,
            status: 'answered',
            hasReply: true
          });
          console.log('   상태: 답변완료');
        }
      } else if (!orderNumber) {
        // 전체 문의 목록 파싱
        // 미답변 건수 확인
        const waitingMatch = pageText.match(/미답변.*?(\d+)/);
        const answeredMatch = pageText.match(/답변완료.*?(\d+)/);

        if (waitingMatch) {
          result.inquiries.push({
            status: 'waiting',
            count: parseInt(waitingMatch[1]) || 0
          });
        }
        if (answeredMatch) {
          result.inquiries.push({
            status: 'answered',
            count: parseInt(answeredMatch[1]) || 0
          });
        }

        console.log(`   미답변: ${waitingMatch ? waitingMatch[1] : 0}건`);
        console.log(`   답변완료: ${answeredMatch ? answeredMatch[1] : 0}건`);
      }

      // 스크린샷 저장 (디버그용)
      await this.saveScreenshot('inquiry_list');

      // 팝업 닫기
      await popup.close();

      result.status = 'checked';

    } catch (error) {
      console.error(`❌ 확인 실패: ${error.message}`);
      await this.saveScreenshot('inquiry_check_error');
      result.status = 'error';
      result.error = error.message;
    }

    return result;
  }

  /**
   * 주문 전체 처리 (수집 → 문의 체크 → 문의/답변확인)
   * @param {string} orderUrl - 주문 URL
   * @param {object} options - { skipInquiry: false, forceInquiry: false }
   */
  async processOrder(orderUrl, options = {}) {
    const { skipInquiry = false } = options;
    const orderNumber = orderUrl.split('/').pop();

    console.log(`\n${'='.repeat(50)}`);
    console.log(`📦 주문 처리: ${orderNumber}`);
    console.log(`${'='.repeat(50)}`);

    const result = {
      orderUrl,
      orderNumber,
      processedAt: new Date().toISOString(),
      collection: null,
      inquiry: null
    };

    // 1. 송장 수집 시도
    console.log('\n[1단계] 송장 수집 시도');
    const collectionResult = await this.collectSingle(orderUrl);
    result.collection = collectionResult;

    // 수집 성공 → 완료
    if (collectionResult.status === 'collected') {
      console.log(`✅ 수집 완료: ${collectionResult.carrier} / ${collectionResult.trackingNumber}`);
      result.finalStatus = 'collected';
      return result;
    }

    // 문의 단계 스킵 옵션
    if (skipInquiry) {
      console.log('ℹ️ 문의 단계 스킵 (옵션)');
      result.finalStatus = collectionResult.status;
      return result;
    }

    // 2. 미발송 상태 → 문의 처리
    if (collectionResult.status === 'not_shipped') {
      console.log('\n[2단계] 기존 문의 확인');

      // 로컬 이력 먼저 확인 (사이트 접속 최소화)
      const localRecord = await getInquiryRecord(orderNumber);

      if (localRecord && localRecord.inquiry_status === 'waiting') {
        console.log(`⏳ 로컬 기록: ${localRecord.inquiry_date} 문의 대기 중`);
        result.inquiry = {
          action: 'waiting_reply',
          source: 'local',
          ...localRecord
        };
        result.finalStatus = 'waiting_reply';

      } else if (localRecord && localRecord.inquiry_status === 'answered') {
        console.log(`📬 로컬 기록: ${localRecord.inquiry_reply_date} 답변 수신`);
        result.inquiry = {
          action: 'reply_received',
          source: 'local',
          ...localRecord
        };
        result.finalStatus = 'reply_received';

      } else {
        // 로컬 기록 없음 → 사이트에서 확인
        const inquiryCheck = await this.checkInquiryReply(orderNumber);

        if (inquiryCheck.inquiries && inquiryCheck.inquiries.length > 0) {
          // 사이트에 기존 문의 있음
          const hasReply = inquiryCheck.inquiries.some(i => i.hasReply || i.status === 'answered');

          if (hasReply) {
            console.log('📬 답변 있음 - 확인 필요');
            await updateInquiryRecord(orderNumber, {
              inquiry_status: 'answered',
              inquiry_reply_date: new Date().toISOString()
            });
            result.inquiry = { action: 'reply_received', ...inquiryCheck };
            result.finalStatus = 'reply_received';
          } else {
            console.log('⏳ 기존 문의 대기 중 - 추가 문의 안함');
            await updateInquiryRecord(orderNumber, {
              inquiry_status: 'waiting'
            });
            result.inquiry = { action: 'waiting_reply', ...inquiryCheck };
            result.finalStatus = 'waiting_reply';
          }
        } else {
          // 기존 문의 없음 → 새 문의 등록
          console.log('\n[3단계] 새 문의 등록');
          const inquiryResult = await this.submitInquiry(orderUrl);
          result.inquiry = inquiryResult;

          if (inquiryResult.status === 'submitted') {
            console.log('📝 문의 등록 완료');
            // 로컬 이력 저장
            await updateInquiryRecord(orderNumber, {
              inquiry_date: new Date().toISOString(),
              inquiry_status: 'waiting',
              inquiry_title: inquiryResult.title,
              order_url: orderUrl
            });
            result.finalStatus = 'inquiry_submitted';
          } else {
            console.log(`⚠️ 문의 등록 실패: ${inquiryResult.status}`);
            result.finalStatus = 'inquiry_failed';
          }
        }
      }
    } else {
      // 기타 상태 (error 등)
      result.finalStatus = collectionResult.status;
    }

    console.log(`\n📊 최종 상태: ${result.finalStatus}`);
    return result;
  }

  /**
   * 여러 주문 전체 처리
   * @param {Array} orderUrls - 주문 URL 배열
   * @param {object} options - { skipInquiry, collectOnly }
   */
  async processMultiple(orderUrls, options = {}) {
    const { collectOnly = false } = options;

    console.log(`\n📋 총 ${orderUrls.length}건 처리 시작`);

    const results = {
      total: orderUrls.length,
      collected: [],
      notShipped: [],
      inquirySubmitted: [],
      waitingReply: [],
      replyReceived: [],
      errors: []
    };

    for (let i = 0; i < orderUrls.length; i++) {
      const url = orderUrls[i];
      console.log(`\n[${i + 1}/${orderUrls.length}]`);

      try {
        const result = await this.processOrder(url, { skipInquiry: collectOnly });

        switch (result.finalStatus) {
          case 'collected':
            results.collected.push(result);
            break;
          case 'not_shipped':
            results.notShipped.push(result);
            break;
          case 'inquiry_submitted':
            results.inquirySubmitted.push(result);
            break;
          case 'waiting_reply':
            results.waitingReply.push(result);
            break;
          case 'reply_received':
            results.replyReceived.push(result);
            break;
          default:
            results.errors.push(result);
        }

        // 요청 간격
        if (i < orderUrls.length - 1) {
          await this.page.waitForTimeout(1500);
        }

      } catch (error) {
        console.error(`❌ 처리 실패: ${error.message}`);
        results.errors.push({
          orderUrl: url,
          error: error.message
        });
      }
    }

    // 요약 출력
    console.log(`\n${'='.repeat(50)}`);
    console.log('📊 처리 결과 요약');
    console.log(`${'='.repeat(50)}`);
    console.log(`  ✅ 수집 완료: ${results.collected.length}건`);
    console.log(`  ⏳ 미발송: ${results.notShipped.length}건`);
    console.log(`  📝 문의 등록: ${results.inquirySubmitted.length}건`);
    console.log(`  💬 답변 대기: ${results.waitingReply.length}건`);
    console.log(`  📬 답변 수신: ${results.replyReceived.length}건`);
    console.log(`  ❌ 에러: ${results.errors.length}건`);

    return results;
  }

  /**
   * 스크린샷 저장
   */
  async saveScreenshot(name) {
    const screenshotDir = join(__dirname, '../../output/screenshots');
    await mkdir(screenshotDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filepath = join(screenshotDir, `naverpay_${name}_${timestamp}.png`);

    await this.page.screenshot({ path: filepath, fullPage: true });
    console.log(`📸 스크린샷: ${filepath}`);

    return filepath;
  }
}

// CLI 실행
async function main() {
  const args = process.argv.slice(2);

  // --url 파싱 (단일)
  const urlIndex = args.indexOf('--url');
  const url = urlIndex !== -1 ? args[urlIndex + 1] : null;

  // --urls 파싱 (배치 - JSON 배열)
  const urlsIndex = args.indexOf('--urls');
  let urls = null;
  if (urlsIndex !== -1) {
    try {
      urls = JSON.parse(args[urlsIndex + 1]);
    } catch (e) {
      console.error('--urls JSON 파싱 실패:', e.message);
      return;
    }
  }

  // --action 파싱 (collect, inquiry, check-reply, inquiry-batch)
  const actionIndex = args.indexOf('--action');
  const action = actionIndex !== -1 ? args[actionIndex + 1] : 'collect';

  // --debug 모드
  const debug = args.includes('--debug');

  // --check-replies: URL 없이 전체 문의 확인
  const checkReplies = args.includes('--check-replies');

  // --visible 모드
  const visible = args.includes('--visible');

  if (!url && !urls && !checkReplies) {
    console.log('네이버페이 송장 수집 / 문의 도구');
    console.log('');
    console.log('사용법:');
    console.log('  --url <주문URL>        : 단일 주문 URL');
    console.log('  --urls <JSON배열>      : 배치 처리 (브라우저 1회 실행)');
    console.log('  --action <액션>        : collect(기본), inquiry, check-reply');
    console.log('  --check-replies        : 전체 문의 답변 확인 (URL 불필요)');
    console.log('  --visible              : 브라우저 표시');
    console.log('  --debug                : 디버그 모드');
    console.log('');
    console.log('■ 트랙1: 송장/택배사 수집');
    console.log('  collect      : 송장 수집 (기본)');
    console.log('');
    console.log('■ 트랙2: 문의 처리');
    console.log('  inquiry      : 문의 등록 (단일)');
    console.log('  check-reply  : 답변 확인 (단일 URL)');
    console.log('  --check-replies: 전체 문의 목록 확인');
    console.log('');
    console.log('예시:');
    console.log('  node naverpay.collector.js --url "https://..." --action collect');
    console.log('  node naverpay.collector.js --urls \'["url1","url2"]\' --action collect');
    console.log('  node naverpay.collector.js --check-replies');
    return;
  }

  const collector = new NaverPayCollector({ headless: !visible });

  try {
    await collector.start();

    let result;

    // --check-replies: 전체 문의 확인 (URL 불필요)
    if (checkReplies) {
      result = await collector.checkAllInquiryReplies();
    } else if (urls && urls.length > 0) {
      // 배치 모드: 여러 URL 한 번에 처리
      console.log(`\n📦 배치 수집 시작: ${urls.length}건`);
      const results = await collector.collectMultiple(urls);

      // 결과 집계
      const collected = results.filter(r => r.status === 'collected').length;
      const notShipped = results.filter(r => r.status === 'not_shipped').length;

      result = {
        results,
        summary: {
          total: results.length,
          collected,
          notShipped
        }
      };

      // 배치 결과 저장
      const outputDir = join(__dirname, '../../output/invoices');
      await mkdir(outputDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const outputPath = join(outputDir, `naverpay_results_${timestamp}.json`);
      await writeFile(outputPath, JSON.stringify(result, null, 2));
      console.log(`\n💾 저장: ${outputPath}`);

      console.log('\n📊 결과:');
      console.log(`  전체: ${results.length}건`);
      console.log(`  수집: ${collected}건`);
      console.log(`  미발송: ${notShipped}건`);
      return;
    } else {
      switch (action) {
        // 트랙2: 문의 처리
        case 'inquiry':
          result = await collector.submitInquiry(url, {});
          // 이력 저장
          if (result.status === 'submitted') {
            await updateInquiryRecord(result.orderNumber, {
              inquiry_date: new Date().toISOString(),
              inquiry_status: 'waiting',
              inquiry_title: result.title,
              order_url: url
            });
          }
          break;

        case 'check-reply':
          const orderNum = url ? url.split('/').pop() : null;
          result = await collector.checkInquiryReply(orderNum);
          break;

        // 트랙1: 송장 수집 (기본)
        case 'collect':
        default:
          result = await collector.collectSingle(url);
          break;
      }
    }

    if (debug) {
      await collector.saveScreenshot('debug');
    }

    console.log('\n📊 결과:');
    console.log(JSON.stringify(result, null, 2));

    // 결과 저장
    const outputDir = join(__dirname, '../../output/invoices');
    await mkdir(outputDir, { recursive: true });

    const outputPath = join(outputDir, `naverpay_${action}_${result.orderNumber}.json`);
    await writeFile(outputPath, JSON.stringify(result, null, 2));
    console.log(`\n💾 저장: ${outputPath}`);

  } finally {
    await collector.stop();
  }
}

main().catch(console.error);

export { NaverPayCollector };
