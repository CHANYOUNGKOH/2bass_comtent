/**
 * 직접전달 주문 처리 Skill
 *
 * 직접전달: 판매자가 직접 택배사/송장번호를 입력해야 하는 주문
 * - 해외배송, 특수배송, 대형화물 등
 *
 * 사용법:
 *   node skills/claims/direct.delivery.js --list          # 대상 주문 조회
 *   node skills/claims/direct.delivery.js --dry-run       # 테스트 실행
 *   node skills/claims/direct.delivery.js --process       # 실제 처리
 */

import { BaseSkill } from '../utils/base.skill.js';

class DirectDeliverySkill extends BaseSkill {
  constructor(options = {}) {
    super({
      name: 'direct-delivery',
      market: 'naver-seller',
      ...options
    });
    this.loadMarketSelectors();
  }

  /**
   * 직접전달 대상 주문 목록 조회
   */
  async listOrders() {
    const page = this.page;
    const selectors = this.selectors.selectors.order_management.direct_delivery;

    // 직접전달 페이지 이동
    await page.goto(this.getUrl('direct_delivery'));
    await this.waitForLoading();

    // 주문 목록 추출
    const orderRows = await page.$$(selectors.order_list.selector);
    const orders = [];

    for (const row of orderRows) {
      const orderNumber = await row.$eval(
        selectors.order_number.selector,
        el => el.textContent.trim()
      ).catch(() => '');

      const productName = await row.$eval(
        selectors.product_name.selector,
        el => el.textContent.trim()
      ).catch(() => '');

      const buyerName = await row.$eval(
        selectors.buyer_name.selector,
        el => el.textContent.trim()
      ).catch(() => '');

      orders.push({
        orderNumber,
        productName,
        buyerName,
        element: row
      });
    }

    console.log(`📋 직접전달 대상 주문: ${orders.length}건`);
    orders.forEach((order, i) => {
      console.log(`  ${i + 1}. [${order.orderNumber}] ${order.productName} (${order.buyerName})`);
    });

    return orders;
  }

  /**
   * 직접전달 주문 처리
   * @param {Array} orderIds - 처리할 주문번호 배열
   * @param {Object} deliveryInfo - 배송 정보 { carrier, trackingNumber }
   */
  async processOrders(orderIds, deliveryInfo) {
    const page = this.page;
    const selectors = this.selectors.selectors.order_management.direct_delivery;

    // Dry-run 모드
    if (this.logDryRun('직접전달 처리', { orderIds, deliveryInfo })) {
      return { success: true, dryRun: true, orderIds };
    }

    // 직접전달 페이지 이동
    await page.goto(this.getUrl('direct_delivery'));
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

        // 택배사 선택
        await orderRow.locator(selectors.carrier_select.selector)
          .selectOption(deliveryInfo.carrier);

        // 송장번호 입력
        await orderRow.locator(selectors.tracking_input.selector)
          .fill(deliveryInfo.trackingNumber);

        processed.push(orderId);
        console.log(`✅ 입력 완료: ${orderId}`);

      } catch (error) {
        failed.push({ orderId, reason: error.message });
        console.error(`❌ 처리 실패: ${orderId} - ${error.message}`);
      }
    }

    // 처리 버튼 클릭 전 스크린샷
    await this.saveEvidence('before-process');

    // 일괄 처리
    if (processed.length > 0) {
      await page.click(selectors.process_btn.selector);
      await this.handleModal('confirm');
      await this.waitForLoading();

      // 처리 후 스크린샷
      await this.saveEvidence('after-process');
    }

    const result = {
      success: true,
      processed,
      failed,
      total: orderIds.length
    };

    await this.saveLog(result);
    return result;
  }

  /**
   * 단일 주문 직접전달 처리
   */
  async processSingleOrder(orderId, carrier, trackingNumber) {
    return this.processOrders([orderId], { carrier, trackingNumber });
  }
}

// CLI 실행
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const listOnly = args.includes('--list');
  const process = args.includes('--process');

  const skill = new DirectDeliverySkill({ dryRun });

  if (listOnly) {
    // 조회만
    await skill.run(async (page) => {
      const orders = await skill.listOrders();
      return orders.map(o => ({
        orderNumber: o.orderNumber,
        productName: o.productName,
        buyerName: o.buyerName
      }));
    });
  } else if (process || dryRun) {
    // 처리 (예시 - 실제로는 MCP에서 파라미터 전달)
    await skill.run(async (page) => {
      // 예시 주문 처리
      const testOrderIds = ['202403020001'];
      const testDeliveryInfo = {
        carrier: 'CJ대한통운',
        trackingNumber: '1234567890123'
      };

      return await skill.processOrders(testOrderIds, testDeliveryInfo);
    });
  } else {
    console.log('사용법:');
    console.log('  --list     : 직접전달 대상 주문 조회');
    console.log('  --dry-run  : 테스트 실행 (실제 처리 안함)');
    console.log('  --process  : 실제 처리');
  }
}

main().catch(console.error);

export { DirectDeliverySkill };
