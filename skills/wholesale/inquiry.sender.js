/**
 * 배송문의 자동화 Skill
 *
 * 미발송 건에 대해 도매처에 배송문의 발송
 * - 발주 후 N일 경과한 미발송 건 확인
 * - 최초 1회만 문의 발송 (중복 방지)
 *
 * 사용법:
 *   node skills/wholesale/inquiry.sender.js --list
 *   node skills/wholesale/inquiry.sender.js --site site-a
 *   node skills/wholesale/inquiry.sender.js --all
 *   node skills/wholesale/inquiry.sender.js --dry-run
 */

import { BaseSkill } from '../utils/base.skill.js';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

class InquirySenderSkill extends BaseSkill {
  constructor(options = {}) {
    super({
      name: 'inquiry-sender',
      ...options
    });
    this.site = options.site || null;
    this.minDays = options.minDays || 2; // 최소 경과 일수
    this.historyPath = join(__dirname, '../../output/logs/inquiry-history.json');
  }

  /**
   * 도매처 셀렉터 로드
   */
  loadSiteSelectors(siteId) {
    this.site = siteId;
    this.market = `wholesale/${siteId}`;
    return this.loadMarketSelectors();
  }

  /**
   * 문의 발송 이력 로드
   */
  async loadHistory() {
    if (!existsSync(this.historyPath)) {
      return {};
    }

    const content = await readFile(this.historyPath, 'utf8');
    return JSON.parse(content);
  }

  /**
   * 문의 발송 이력 저장
   */
  async saveHistory(history) {
    const dir = dirname(this.historyPath);
    await mkdir(dir, { recursive: true });
    await writeFile(this.historyPath, JSON.stringify(history, null, 2));
  }

  /**
   * 이미 문의한 주문인지 확인
   */
  async hasInquired(orderNumber) {
    const history = await this.loadHistory();
    const key = `${this.site}:${orderNumber}`;
    return !!history[key];
  }

  /**
   * 문의 이력 기록
   */
  async recordInquiry(orderNumber) {
    const history = await this.loadHistory();
    const key = `${this.site}:${orderNumber}`;
    history[key] = {
      site: this.site,
      orderNumber,
      inquiredAt: new Date().toISOString()
    };
    await this.saveHistory(history);
  }

  /**
   * 미발송 주문 목록 조회
   */
  async listPendingOrders() {
    const page = this.page;

    if (!this.selectors) {
      throw new Error('사이트 셀렉터가 로드되지 않았습니다');
    }

    const selectors = this.selectors.selectors.order_list;

    // 주문 목록 페이지 이동
    await page.goto(this.selectors.urls.order_list);
    await this.waitForLoading();

    const pendingOrders = [];
    const today = new Date();

    const orderRows = await page.$$(selectors.table.selector);

    for (const row of orderRows) {
      try {
        const orderNumber = await row.$eval(
          selectors.order_number.selector,
          el => el.textContent.trim()
        ).catch(() => '');

        const status = await row.$eval(
          selectors.status.selector,
          el => el.textContent.trim()
        ).catch(() => '');

        const orderDateStr = await row.$eval(
          selectors.order_date.selector,
          el => el.textContent.trim()
        ).catch(() => '');

        // 발송 전 상태만
        if (status.includes('발송') || status.includes('배송')) {
          continue;
        }

        // 경과 일수 계산
        const orderDate = new Date(orderDateStr);
        const daysPassed = Math.floor((today - orderDate) / (1000 * 60 * 60 * 24));

        if (daysPassed >= this.minDays) {
          // 이미 문의했는지 확인
          const alreadyInquired = await this.hasInquired(orderNumber);

          pendingOrders.push({
            site: this.site,
            orderNumber,
            status,
            orderDate: orderDateStr,
            daysPassed,
            alreadyInquired
          });
        }
      } catch (error) {
        console.error(`⚠️ 행 처리 중 에러:`, error.message);
      }
    }

    console.log(`📋 미발송 주문 (${this.minDays}일+ 경과): ${pendingOrders.length}건`);
    pendingOrders.forEach((o, i) => {
      const inquiredMark = o.alreadyInquired ? ' [문의완료]' : '';
      console.log(`  ${i + 1}. [${o.orderNumber}] ${o.status} (${o.daysPassed}일 경과)${inquiredMark}`);
    });

    return pendingOrders;
  }

  /**
   * 배송문의 발송
   */
  async sendInquiry(orderNumber, message = null) {
    const page = this.page;
    const selectors = this.selectors.selectors.inquiry;

    // 기본 메시지
    const defaultMessage = `안녕하세요.

발주번호 ${orderNumber} 건의 배송 일정 확인 부탁드립니다.
발주 후 ${this.minDays}일 이상 경과하여 문의드립니다.

감사합니다.`;

    const inquiryMessage = message || defaultMessage;

    // 문의 페이지 이동
    await page.goto(this.selectors.urls.inquiry);
    await this.waitForLoading();

    // 주문 선택
    await page.selectOption(selectors.order_select.selector, orderNumber);

    // 문의 카테고리 선택 (배송문의)
    await page.selectOption(selectors.category.selector, 'shipping');

    // 제목 입력
    const title = `[배송문의] 발주번호 ${orderNumber} 배송 일정 확인`;
    await page.fill(selectors.title.selector, title);

    // 내용 입력
    await page.fill(selectors.content.selector, inquiryMessage);

    // 스크린샷
    await this.saveEvidence(`inquiry-${orderNumber}`);

    // 제출
    await page.click(selectors.submit_btn.selector);
    await this.handleModal('confirm');
    await this.waitForLoading();

    // 이력 기록
    await this.recordInquiry(orderNumber);

    console.log(`✅ 문의 발송 완료: ${orderNumber}`);

    return {
      success: true,
      orderNumber,
      title,
      message: inquiryMessage
    };
  }

  /**
   * 미발송 건 일괄 문의
   */
  async sendBulkInquiries() {
    // Dry-run 모드
    if (this.dryRun) {
      const pendingOrders = await this.listPendingOrders();
      const toInquire = pendingOrders.filter(o => !o.alreadyInquired);

      return {
        success: true,
        dryRun: true,
        site: this.site,
        totalPending: pendingOrders.length,
        alreadyInquired: pendingOrders.length - toInquire.length,
        wouldInquire: toInquire.map(o => o.orderNumber)
      };
    }

    const pendingOrders = await this.listPendingOrders();
    const toInquire = pendingOrders.filter(o => !o.alreadyInquired);

    const results = [];

    for (const order of toInquire) {
      try {
        const result = await this.sendInquiry(order.orderNumber);
        results.push(result);
      } catch (error) {
        console.error(`❌ ${order.orderNumber} 문의 실패:`, error.message);
        results.push({
          success: false,
          orderNumber: order.orderNumber,
          error: error.message
        });
      }
    }

    const finalResult = {
      success: true,
      site: this.site,
      totalPending: pendingOrders.length,
      sent: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results
    };

    await this.saveLog(finalResult);
    return finalResult;
  }
}

// CLI 실행
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const listOnly = args.includes('--list');
  const all = args.includes('--all');

  // --site 파싱
  const siteIndex = args.indexOf('--site');
  const site = siteIndex !== -1 ? args[siteIndex + 1] : null;

  // --days 파싱
  const daysIndex = args.indexOf('--days');
  const minDays = daysIndex !== -1 ? parseInt(args[daysIndex + 1]) : 2;

  if (all) {
    const sites = ['site-a', 'site-b'];
    const results = {};

    for (const siteId of sites) {
      console.log(`\n🏪 ${siteId} 문의 처리...`);

      try {
        const skill = new InquirySenderSkill({ dryRun, minDays });
        skill.loadSiteSelectors(siteId);

        const result = await skill.run(async () => {
          return await skill.sendBulkInquiries();
        });

        results[siteId] = result;
      } catch (error) {
        console.error(`❌ ${siteId} 처리 실패:`, error.message);
        results[siteId] = { success: false, error: error.message };
      }
    }

    console.log('\n📊 전체 결과:', JSON.stringify(results, null, 2));
  } else if (site) {
    const skill = new InquirySenderSkill({ dryRun, minDays });

    try {
      skill.loadSiteSelectors(site);
    } catch (e) {
      console.error(`❌ 사이트 셀렉터 로드 실패: ${e.message}`);
      process.exit(1);
    }

    await skill.run(async () => {
      if (listOnly) {
        return await skill.listPendingOrders();
      } else {
        return await skill.sendBulkInquiries();
      }
    });
  } else {
    console.log('사용법:');
    console.log('  --site <id>  : 특정 도매처 문의 발송');
    console.log('  --all        : 모든 도매처 문의 발송');
    console.log('  --list       : 미발송 목록 조회만');
    console.log('  --days <n>   : 최소 경과 일수 (기본: 2)');
    console.log('  --dry-run    : 테스트 실행');
  }
}

main().catch(console.error);

export { InquirySenderSkill };
