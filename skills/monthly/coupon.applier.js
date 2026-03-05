/**
 * 쿠폰 적용 Skill
 *
 * 월간 쿠폰 재발급/적용
 * - 기존 쿠폰 상태 확인
 * - 신규 쿠폰 생성
 * - 쿠폰 복사 (이전 설정 재사용)
 *
 * 사용법:
 *   node skills/monthly/coupon.applier.js --list          # 현재 쿠폰 목록
 *   node skills/monthly/coupon.applier.js --create        # 신규 쿠폰 생성
 *   node skills/monthly/coupon.applier.js --dry-run       # 테스트 실행
 */

import { BaseSkill } from '../utils/base.skill.js';

class CouponApplierSkill extends BaseSkill {
  constructor(options = {}) {
    super({
      name: 'coupon-applier',
      market: 'naver-seller',
      ...options
    });
    this.loadMarketSelectors();
  }

  /**
   * 현재 쿠폰 목록 조회
   */
  async listCoupons() {
    const page = this.page;
    const selectors = this.selectors.selectors.monthly.coupon;

    // 쿠폰 관리 페이지 이동
    await page.goto(this.getUrl('coupon'));
    await this.waitForLoading();

    // 쿠폰 목록 추출
    const couponRows = await page.$$(selectors.coupon_list.selector);
    const coupons = [];

    for (const row of couponRows) {
      const name = await row.$eval('.coupon-name', el => el.textContent.trim())
        .catch(() => '');
      const discountType = await row.$eval('.discount-type', el => el.textContent.trim())
        .catch(() => '');
      const discountValue = await row.$eval('.discount-value', el => el.textContent.trim())
        .catch(() => '');
      const period = await row.$eval('.coupon-period', el => el.textContent.trim())
        .catch(() => '');
      const status = await row.$eval('.coupon-status', el => el.textContent.trim())
        .catch(() => '');

      coupons.push({
        name,
        discountType,
        discountValue,
        period,
        status,
        element: row
      });
    }

    console.log(`📋 쿠폰 목록: ${coupons.length}건`);
    coupons.forEach((c, i) => {
      console.log(`  ${i + 1}. ${c.name}`);
      console.log(`     할인: ${c.discountType} ${c.discountValue}`);
      console.log(`     기간: ${c.period}`);
      console.log(`     상태: ${c.status}`);
    });

    return coupons;
  }

  /**
   * 신규 쿠폰 생성
   * @param {Object} couponInfo - 쿠폰 정보
   */
  async createCoupon(couponInfo) {
    const page = this.page;
    const selectors = this.selectors.selectors.monthly.coupon;

    // Dry-run 모드
    if (this.logDryRun('쿠폰 생성', couponInfo)) {
      return { success: true, dryRun: true, couponInfo };
    }

    // 쿠폰 관리 페이지 이동
    await page.goto(this.getUrl('coupon'));
    await this.waitForLoading();

    // 쿠폰 생성 버튼 클릭
    await page.click(selectors.create_btn.selector);
    await this.waitForLoading();

    // 쿠폰 정보 입력
    await page.fill(selectors.coupon_name.selector, couponInfo.name);
    await page.selectOption(selectors.discount_type.selector, couponInfo.discountType);
    await page.fill(selectors.discount_value.selector, couponInfo.discountValue.toString());
    await page.fill(selectors.start_date.selector, couponInfo.startDate);
    await page.fill(selectors.end_date.selector, couponInfo.endDate);

    await this.saveEvidence('before-create-coupon');

    // 저장
    await page.click(selectors.save_btn.selector);
    await this.handleModal('confirm');
    await this.waitForLoading();

    await this.saveEvidence('after-create-coupon');

    const result = {
      success: true,
      action: 'create',
      couponInfo
    };

    await this.saveLog(result);
    return result;
  }

  /**
   * 월간 쿠폰 자동 생성 (이전 달 기준)
   */
  async createMonthlyCoupons() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    // 이번 달 시작~끝
    const startDate = `${year}-${month.toString().padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${month.toString().padStart(2, '0')}-${lastDay}`;

    // 기본 쿠폰 템플릿
    const templates = [
      {
        name: `${month}월 신규회원 10% 할인`,
        discountType: 'percent',
        discountValue: 10,
        startDate,
        endDate
      },
      {
        name: `${month}월 재구매 5% 할인`,
        discountType: 'percent',
        discountValue: 5,
        startDate,
        endDate
      },
      {
        name: `${month}월 2000원 할인쿠폰`,
        discountType: 'fixed',
        discountValue: 2000,
        startDate,
        endDate
      }
    ];

    const results = [];

    for (const template of templates) {
      console.log(`📝 쿠폰 생성 중: ${template.name}`);
      const result = await this.createCoupon(template);
      results.push(result);
    }

    return {
      success: true,
      month: `${year}-${month.toString().padStart(2, '0')}`,
      coupons: results
    };
  }

  /**
   * 만료된 쿠폰 복사 (같은 설정으로 새 기간)
   * @param {string} couponName - 복사할 쿠폰 이름
   * @param {string} newStartDate - 새 시작일
   * @param {string} newEndDate - 새 종료일
   */
  async copyCoupon(couponName, newStartDate, newEndDate) {
    const page = this.page;
    const selectors = this.selectors.selectors.monthly.coupon;

    // Dry-run 모드
    if (this.logDryRun('쿠폰 복사', { couponName, newStartDate, newEndDate })) {
      return { success: true, dryRun: true, couponName };
    }

    // 쿠폰 관리 페이지 이동
    await page.goto(this.getUrl('coupon'));
    await this.waitForLoading();

    // 쿠폰 찾기
    const couponRow = await page.locator(
      `${selectors.coupon_list.selector}:has-text("${couponName}")`
    ).first();

    if (!await couponRow.isVisible()) {
      throw new Error(`쿠폰을 찾을 수 없음: ${couponName}`);
    }

    // 복사 버튼 클릭 (UI에 따라 수정 필요)
    await couponRow.locator('.btn-copy').click();
    await this.waitForLoading();

    // 새 기간 설정
    await page.fill(selectors.start_date.selector, newStartDate);
    await page.fill(selectors.end_date.selector, newEndDate);

    await this.saveEvidence('before-copy-coupon');

    // 저장
    await page.click(selectors.save_btn.selector);
    await this.handleModal('confirm');
    await this.waitForLoading();

    await this.saveEvidence('after-copy-coupon');

    const result = {
      success: true,
      action: 'copy',
      originalCoupon: couponName,
      newPeriod: { startDate: newStartDate, endDate: newEndDate }
    };

    await this.saveLog(result);
    return result;
  }
}

// CLI 실행
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const listOnly = args.includes('--list');
  const create = args.includes('--create');
  const monthly = args.includes('--monthly');

  const skill = new CouponApplierSkill({ dryRun });

  if (listOnly) {
    await skill.run(async (page) => {
      const coupons = await skill.listCoupons();
      return coupons.map(c => ({
        name: c.name,
        discountType: c.discountType,
        discountValue: c.discountValue,
        period: c.period,
        status: c.status
      }));
    });
  } else if (monthly || dryRun) {
    await skill.run(async (page) => {
      return await skill.createMonthlyCoupons();
    });
  } else if (create) {
    await skill.run(async (page) => {
      // 예시 쿠폰
      const testCoupon = {
        name: '테스트 쿠폰',
        discountType: 'percent',
        discountValue: 10,
        startDate: '2024-03-01',
        endDate: '2024-03-31'
      };
      return await skill.createCoupon(testCoupon);
    });
  } else {
    console.log('사용법:');
    console.log('  --list     : 현재 쿠폰 목록');
    console.log('  --create   : 신규 쿠폰 생성');
    console.log('  --monthly  : 월간 쿠폰 자동 생성');
    console.log('  --dry-run  : 테스트 실행 (실제 처리 안함)');
  }
}

main().catch(console.error);

export { CouponApplierSkill };
