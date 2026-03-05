/**
 * 배송지연 처리 Skill
 *
 * 배송지연: 발송 기한 내 발송이 어려운 주문에 대해 지연 사유 입력
 * - 생산 지연, 재고 부족, 기상 악화 등
 *
 * 사용법:
 *   node skills/claims/delay.handler.js --list          # 지연 대상 주문 조회
 *   node skills/claims/delay.handler.js --dry-run       # 테스트 실행
 *   node skills/claims/delay.handler.js --process       # 실제 처리
 */

import { BaseSkill } from '../utils/base.skill.js';

class DelayHandlerSkill extends BaseSkill {
  constructor(options = {}) {
    super({
      name: 'delay-handler',
      market: 'naver-seller',
      ...options
    });
    this.loadMarketSelectors();
  }

  /**
   * 배송지연 대상 주문 목록 조회
   */
  async listDelayedOrders() {
    const page = this.page;
    const selectors = this.selectors.selectors.order_management.delay;

    // 배송지연 탭 클릭
    await page.goto(this.getUrl('order_list'));
    await page.click(selectors.tab.selector);
    await this.waitForLoading();

    // 주문 목록 추출
    const orderRows = await page.$$(selectors.order_list.selector);
    const orders = [];

    for (const row of orderRows) {
      const orderNumber = await row.$eval('.order-number', el => el.textContent.trim())
        .catch(() => '');
      const productName = await row.$eval('.product-name', el => el.textContent.trim())
        .catch(() => '');
      const dueDate = await row.$eval('.due-date', el => el.textContent.trim())
        .catch(() => '');

      orders.push({
        orderNumber,
        productName,
        dueDate,
        element: row
      });
    }

    console.log(`📋 배송지연 대상 주문: ${orders.length}건`);
    orders.forEach((order, i) => {
      console.log(`  ${i + 1}. [${order.orderNumber}] ${order.productName} (기한: ${order.dueDate})`);
    });

    return orders;
  }

  /**
   * 배송지연 처리
   * @param {Array} orderIds - 처리할 주문번호 배열
   * @param {Object} delayInfo - 지연 정보 { reason, detail, expectedDate }
   */
  async processDelay(orderIds, delayInfo) {
    const page = this.page;
    const selectors = this.selectors.selectors.order_management.delay;
    const reasons = this.selectors.delay_reasons;

    // Dry-run 모드
    if (this.logDryRun('배송지연 처리', { orderIds, delayInfo })) {
      return { success: true, dryRun: true, orderIds };
    }

    // 지연 사유 유효성 검사
    const validReason = reasons.find(r => r.value === delayInfo.reason);
    if (!validReason) {
      throw new Error(`유효하지 않은 지연 사유: ${delayInfo.reason}`);
    }

    // 배송지연 페이지 이동
    await page.goto(this.getUrl('order_list'));
    await page.click(selectors.tab.selector);
    await this.waitForLoading();

    const processed = [];
    const failed = [];

    for (const orderId of orderIds) {
      try {
        // 주문 찾기
        const orderRow = await page.locator(
          `${selectors.order_list.selector}:has-text("${orderId}")`
        ).first();

        if (!await orderRow.isVisible()) {
          failed.push({ orderId, reason: '주문을 찾을 수 없음' });
          continue;
        }

        // 체크박스 선택
        await orderRow.locator(selectors.checkbox.selector).check();

        processed.push(orderId);
        console.log(`✅ 선택: ${orderId}`);

      } catch (error) {
        failed.push({ orderId, reason: error.message });
        console.error(`❌ 선택 실패: ${orderId} - ${error.message}`);
      }
    }

    if (processed.length > 0) {
      // 지연 사유 선택
      await page.selectOption(selectors.reason_select.selector, delayInfo.reason);

      // 상세 사유 입력 (있는 경우)
      if (delayInfo.detail) {
        await page.fill(selectors.reason_input.selector, delayInfo.detail);
      }

      // 예상 발송일 입력
      if (delayInfo.expectedDate) {
        await page.fill(selectors.expected_date.selector, delayInfo.expectedDate);
      }

      // 처리 전 스크린샷
      await this.saveEvidence('before-delay');

      // 지연 처리 버튼 클릭
      await page.click(selectors.process_btn.selector);
      await this.handleModal('confirm');
      await this.waitForLoading();

      // 처리 후 스크린샷
      await this.saveEvidence('after-delay');
    }

    const result = {
      success: true,
      processed,
      failed,
      delayReason: validReason.label,
      total: orderIds.length
    };

    await this.saveLog(result);
    return result;
  }

  /**
   * 일괄 지연 처리 (동일 사유)
   */
  async bulkDelay(orderIds, reason, expectedDate) {
    return this.processDelay(orderIds, {
      reason,
      expectedDate,
      detail: ''
    });
  }
}

// CLI 실행
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const listOnly = args.includes('--list');
  const process = args.includes('--process');

  const skill = new DelayHandlerSkill({ dryRun });

  if (listOnly) {
    await skill.run(async (page) => {
      const orders = await skill.listDelayedOrders();
      return orders.map(o => ({
        orderNumber: o.orderNumber,
        productName: o.productName,
        dueDate: o.dueDate
      }));
    });
  } else if (process || dryRun) {
    await skill.run(async (page) => {
      // 예시 처리
      const testOrderIds = ['202403020001'];
      const testDelayInfo = {
        reason: 'production',
        detail: '제작 일정 지연',
        expectedDate: '2024-03-10'
      };

      return await skill.processDelay(testOrderIds, testDelayInfo);
    });
  } else {
    console.log('사용법:');
    console.log('  --list     : 배송지연 대상 주문 조회');
    console.log('  --dry-run  : 테스트 실행 (실제 처리 안함)');
    console.log('  --process  : 실제 처리');
  }
}

main().catch(console.error);

export { DelayHandlerSkill };
