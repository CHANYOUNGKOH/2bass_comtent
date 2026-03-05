/**
 * 교환 처리 Skill
 *
 * 교환 요청에 대한 거절 처리
 * - 재고 없음, 상품 훼손 등의 사유로 교환 불가 시 거절
 *
 * 사용법:
 *   node skills/claims/exchange.handler.js --list          # 교환 요청 목록 조회
 *   node skills/claims/exchange.handler.js --dry-run       # 테스트 실행
 *   node skills/claims/exchange.handler.js --reject        # 교환 거절
 */

import { BaseSkill } from '../utils/base.skill.js';

class ExchangeHandlerSkill extends BaseSkill {
  constructor(options = {}) {
    super({
      name: 'exchange-handler',
      market: 'naver-seller',
      ...options
    });
    this.loadMarketSelectors();
  }

  /**
   * 교환 대기 목록 조회
   */
  async listPendingExchanges() {
    const page = this.page;
    const selectors = this.selectors.selectors.claim_management.exchange;

    // 교환 관리 페이지 이동
    await page.goto(this.getUrl('claim_list'));
    await page.click(selectors.tab.selector);
    await this.waitForLoading();

    // 교환 목록 추출
    const exchangeRows = await page.$$(selectors.pending_list.selector);
    const exchanges = [];

    for (const row of exchangeRows) {
      const orderNumber = await row.$eval(
        selectors.order_number.selector,
        el => el.textContent.trim()
      ).catch(() => '');

      const productName = await row.$eval('.product-name', el => el.textContent.trim())
        .catch(() => '');

      const exchangeReason = await row.$eval('.exchange-reason', el => el.textContent.trim())
        .catch(() => '');

      const requestedOption = await row.$eval('.requested-option', el => el.textContent.trim())
        .catch(() => '');

      exchanges.push({
        orderNumber,
        productName,
        exchangeReason,
        requestedOption,
        element: row
      });
    }

    console.log(`📋 교환 대기 건: ${exchanges.length}건`);
    exchanges.forEach((e, i) => {
      console.log(`  ${i + 1}. [${e.orderNumber}] ${e.productName}`);
      console.log(`     사유: ${e.exchangeReason}`);
      console.log(`     요청 옵션: ${e.requestedOption}`);
    });

    return exchanges;
  }

  /**
   * 교환 거절
   * @param {Array} orderIds - 거절할 주문번호 배열
   * @param {Object} rejectInfo - 거절 정보 { reason, detail }
   */
  async rejectExchanges(orderIds, rejectInfo) {
    const page = this.page;
    const selectors = this.selectors.selectors.claim_management.exchange;
    const reasons = this.selectors.exchange_reject_reasons;

    // Dry-run 모드
    if (this.logDryRun('교환 거절', { orderIds, rejectInfo })) {
      return { success: true, dryRun: true, orderIds, action: 'reject' };
    }

    // 거절 사유 유효성 검사
    const validReason = reasons.find(r => r.value === rejectInfo.reason);
    if (!validReason) {
      throw new Error(`유효하지 않은 거절 사유: ${rejectInfo.reason}`);
    }

    // 교환 관리 페이지 이동
    await page.goto(this.getUrl('claim_list'));
    await page.click(selectors.tab.selector);
    await this.waitForLoading();

    const processed = [];
    const failed = [];

    for (const orderId of orderIds) {
      try {
        const exchangeRow = await page.locator(
          `${selectors.pending_list.selector}:has-text("${orderId}")`
        ).first();

        if (!await exchangeRow.isVisible()) {
          failed.push({ orderId, reason: '교환 요청을 찾을 수 없음' });
          continue;
        }

        await exchangeRow.locator(selectors.checkbox.selector).check();
        processed.push(orderId);
        console.log(`✅ 선택: ${orderId}`);

      } catch (error) {
        failed.push({ orderId, reason: error.message });
        console.error(`❌ 선택 실패: ${orderId} - ${error.message}`);
      }
    }

    if (processed.length > 0) {
      // 거절 버튼 클릭
      await page.click(selectors.reject_btn.selector);

      // 거절 사유 선택
      await page.selectOption(selectors.reject_reason_select.selector, rejectInfo.reason);

      // 상세 사유 입력
      if (rejectInfo.detail) {
        await page.fill(selectors.reject_reason_input.selector, rejectInfo.detail);
      }

      await this.saveEvidence('before-reject');

      await this.handleModal('confirm');
      await this.waitForLoading();

      await this.saveEvidence('after-reject');
    }

    const result = {
      success: true,
      action: 'reject',
      rejectReason: validReason.label,
      processed,
      failed,
      total: orderIds.length
    };

    await this.saveLog(result);
    return result;
  }

  /**
   * 재고 없음으로 일괄 거절
   */
  async rejectNoStock(orderIds) {
    return this.rejectExchanges(orderIds, {
      reason: 'no_stock',
      detail: '요청하신 옵션의 재고가 없어 교환이 불가합니다.'
    });
  }
}

// CLI 실행
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const listOnly = args.includes('--list');
  const reject = args.includes('--reject');

  const skill = new ExchangeHandlerSkill({ dryRun });

  if (listOnly) {
    await skill.run(async (page) => {
      const exchanges = await skill.listPendingExchanges();
      return exchanges.map(e => ({
        orderNumber: e.orderNumber,
        productName: e.productName,
        exchangeReason: e.exchangeReason,
        requestedOption: e.requestedOption
      }));
    });
  } else if (reject || dryRun) {
    await skill.run(async (page) => {
      const testOrderIds = ['202403020001'];
      const testRejectInfo = {
        reason: 'no_stock',
        detail: '요청하신 옵션의 재고가 없습니다.'
      };
      return await skill.rejectExchanges(testOrderIds, testRejectInfo);
    });
  } else {
    console.log('사용법:');
    console.log('  --list     : 교환 대기 목록 조회');
    console.log('  --reject   : 교환 거절');
    console.log('  --dry-run  : 테스트 실행 (실제 처리 안함)');
  }
}

main().catch(console.error);

export { ExchangeHandlerSkill };
