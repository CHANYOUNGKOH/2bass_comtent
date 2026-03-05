/**
 * 반품 처리 Skill
 *
 * 반품 요청에 대한 승인/거절/수정 처리
 * - 반품 승인: 수거 진행
 * - 반품 거절: 사유 입력 후 거절
 * - 반품 수정: 반품 사유 변경
 *
 * 사용법:
 *   node skills/claims/return.handler.js --list          # 반품 요청 목록 조회
 *   node skills/claims/return.handler.js --dry-run       # 테스트 실행
 *   node skills/claims/return.handler.js --approve       # 반품 승인
 *   node skills/claims/return.handler.js --reject        # 반품 거절
 */

import { BaseSkill } from '../utils/base.skill.js';

class ReturnHandlerSkill extends BaseSkill {
  constructor(options = {}) {
    super({
      name: 'return-handler',
      market: 'naver-seller',
      ...options
    });
    this.loadMarketSelectors();
  }

  /**
   * 반품 대기 목록 조회
   */
  async listPendingReturns() {
    const page = this.page;
    const selectors = this.selectors.selectors.claim_management.return;

    // 반품 관리 페이지 이동
    await page.goto(this.getUrl('claim_list'));
    await page.click(selectors.tab.selector);
    await this.waitForLoading();

    // 반품 목록 추출
    const returnRows = await page.$$(selectors.pending_list.selector);
    const returns = [];

    for (const row of returnRows) {
      const orderNumber = await row.$eval(
        selectors.order_number.selector,
        el => el.textContent.trim()
      ).catch(() => '');

      const productName = await row.$eval(
        selectors.product_name.selector,
        el => el.textContent.trim()
      ).catch(() => '');

      const returnReason = await row.$eval(
        selectors.return_reason.selector,
        el => el.textContent.trim()
      ).catch(() => '');

      returns.push({
        orderNumber,
        productName,
        returnReason,
        element: row
      });
    }

    console.log(`📋 반품 대기 건: ${returns.length}건`);
    returns.forEach((r, i) => {
      console.log(`  ${i + 1}. [${r.orderNumber}] ${r.productName}`);
      console.log(`     사유: ${r.returnReason}`);
    });

    return returns;
  }

  /**
   * 반품 승인
   * @param {Array} orderIds - 승인할 주문번호 배열
   */
  async approveReturns(orderIds) {
    const page = this.page;
    const selectors = this.selectors.selectors.claim_management.return;

    // Dry-run 모드
    if (this.logDryRun('반품 승인', { orderIds })) {
      return { success: true, dryRun: true, orderIds, action: 'approve' };
    }

    // 반품 관리 페이지 이동
    await page.goto(this.getUrl('claim_list'));
    await page.click(selectors.tab.selector);
    await this.waitForLoading();

    const processed = [];
    const failed = [];

    for (const orderId of orderIds) {
      try {
        const returnRow = await page.locator(
          `${selectors.pending_list.selector}:has-text("${orderId}")`
        ).first();

        if (!await returnRow.isVisible()) {
          failed.push({ orderId, reason: '반품 요청을 찾을 수 없음' });
          continue;
        }

        await returnRow.locator(selectors.checkbox.selector).check();
        processed.push(orderId);
        console.log(`✅ 선택: ${orderId}`);

      } catch (error) {
        failed.push({ orderId, reason: error.message });
        console.error(`❌ 선택 실패: ${orderId} - ${error.message}`);
      }
    }

    if (processed.length > 0) {
      await this.saveEvidence('before-approve');

      await page.click(selectors.approve_btn.selector);
      await this.handleModal('confirm');
      await this.waitForLoading();

      await this.saveEvidence('after-approve');
    }

    const result = {
      success: true,
      action: 'approve',
      processed,
      failed,
      total: orderIds.length
    };

    await this.saveLog(result);
    return result;
  }

  /**
   * 반품 거절
   * @param {Array} orderIds - 거절할 주문번호 배열
   * @param {Object} rejectInfo - 거절 정보 { reason, detail }
   */
  async rejectReturns(orderIds, rejectInfo) {
    const page = this.page;
    const selectors = this.selectors.selectors.claim_management.return;
    const reasons = this.selectors.return_reject_reasons;

    // Dry-run 모드
    if (this.logDryRun('반품 거절', { orderIds, rejectInfo })) {
      return { success: true, dryRun: true, orderIds, action: 'reject' };
    }

    // 거절 사유 유효성 검사
    const validReason = reasons.find(r => r.value === rejectInfo.reason);
    if (!validReason) {
      throw new Error(`유효하지 않은 거절 사유: ${rejectInfo.reason}`);
    }

    // 반품 관리 페이지 이동
    await page.goto(this.getUrl('claim_list'));
    await page.click(selectors.tab.selector);
    await this.waitForLoading();

    const processed = [];
    const failed = [];

    for (const orderId of orderIds) {
      try {
        const returnRow = await page.locator(
          `${selectors.pending_list.selector}:has-text("${orderId}")`
        ).first();

        if (!await returnRow.isVisible()) {
          failed.push({ orderId, reason: '반품 요청을 찾을 수 없음' });
          continue;
        }

        await returnRow.locator(selectors.checkbox.selector).check();
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
   * 반품 사유 변경 (판매자 귀책 → 구매자 귀책 등)
   * @param {string} orderId - 주문번호
   * @param {string} newReason - 새 반품 사유
   */
  async modifyReturnReason(orderId, newReason) {
    const page = this.page;
    const selectors = this.selectors.selectors.claim_management.return;

    // Dry-run 모드
    if (this.logDryRun('반품 사유 변경', { orderId, newReason })) {
      return { success: true, dryRun: true, orderId, action: 'modify' };
    }

    // 반품 관리 페이지 이동
    await page.goto(this.getUrl('claim_list'));
    await page.click(selectors.tab.selector);
    await this.waitForLoading();

    try {
      const returnRow = await page.locator(
        `${selectors.pending_list.selector}:has-text("${orderId}")`
      ).first();

      if (!await returnRow.isVisible()) {
        throw new Error('반품 요청을 찾을 수 없음');
      }

      await returnRow.locator(selectors.checkbox.selector).check();

      await this.saveEvidence('before-modify');

      await page.click(selectors.modify_btn.selector);

      // 사유 변경 모달에서 처리
      // (실제 UI에 따라 수정 필요)
      await this.handleModal('confirm');
      await this.waitForLoading();

      await this.saveEvidence('after-modify');

      const result = {
        success: true,
        action: 'modify',
        orderId,
        newReason
      };

      await this.saveLog(result);
      return result;

    } catch (error) {
      return {
        success: false,
        error: error.message,
        orderId
      };
    }
  }
}

// CLI 실행
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const listOnly = args.includes('--list');
  const approve = args.includes('--approve');
  const reject = args.includes('--reject');

  const skill = new ReturnHandlerSkill({ dryRun });

  if (listOnly) {
    await skill.run(async (page) => {
      const returns = await skill.listPendingReturns();
      return returns.map(r => ({
        orderNumber: r.orderNumber,
        productName: r.productName,
        returnReason: r.returnReason
      }));
    });
  } else if (approve) {
    await skill.run(async (page) => {
      const testOrderIds = ['202403020001'];
      return await skill.approveReturns(testOrderIds);
    });
  } else if (reject || dryRun) {
    await skill.run(async (page) => {
      const testOrderIds = ['202403020001'];
      const testRejectInfo = {
        reason: 'product_damage',
        detail: '상품 훼손으로 인해 반품 불가'
      };
      return await skill.rejectReturns(testOrderIds, testRejectInfo);
    });
  } else {
    console.log('사용법:');
    console.log('  --list     : 반품 대기 목록 조회');
    console.log('  --approve  : 반품 승인');
    console.log('  --reject   : 반품 거절');
    console.log('  --dry-run  : 테스트 실행 (실제 처리 안함)');
  }
}

main().catch(console.error);

export { ReturnHandlerSkill };
