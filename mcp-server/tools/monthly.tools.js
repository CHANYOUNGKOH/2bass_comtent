/**
 * 월간 작업 관련 MCP 도구 정의
 */

import { VatCollectorSkill } from '../../skills/monthly/vat.collector.js';
import { CouponApplierSkill } from '../../skills/monthly/coupon.applier.js';

// 도구 정의
export const monthlyTools = [
  // 부가세 자료 수집
  {
    name: 'collect_vat_data',
    description: '부가세 신고용 매출/매입 자료를 수집합니다. 특정 월 또는 분기의 자료를 다운로드합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        year: {
          type: 'number',
          description: '년도 (예: 2024)'
        },
        month: {
          type: 'number',
          description: '월 (1-12)'
        },
        quarter: {
          type: 'number',
          description: '분기 (1-4) - month 대신 사용'
        },
        market: {
          type: 'string',
          description: '마켓 (기본값: naver-seller)',
          default: 'naver-seller'
        },
        dry_run: {
          type: 'boolean',
          default: true
        }
      },
      required: ['year']
    }
  },
  {
    name: 'collect_vat_all_markets',
    description: '모든 마켓의 부가세 자료를 수집합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        year: {
          type: 'number',
          description: '년도'
        },
        month: {
          type: 'number',
          description: '월'
        },
        markets: {
          type: 'array',
          items: { type: 'string' },
          description: '수집할 마켓 목록',
          default: ['naver-seller', 'coupang-wing', 'esm-seller']
        },
        dry_run: {
          type: 'boolean',
          default: true
        }
      },
      required: ['year', 'month']
    }
  },

  // 쿠폰 관리
  {
    name: 'coupon_list',
    description: '현재 등록된 쿠폰 목록을 조회합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        market: {
          type: 'string',
          default: 'naver-seller'
        }
      }
    }
  },
  {
    name: 'coupon_create',
    description: '새 쿠폰을 생성합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: '쿠폰 이름'
        },
        discount_type: {
          type: 'string',
          enum: ['percent', 'fixed'],
          description: '할인 유형 (percent: 비율, fixed: 정액)'
        },
        discount_value: {
          type: 'number',
          description: '할인 값 (비율: 0-100, 정액: 원 단위)'
        },
        start_date: {
          type: 'string',
          description: '시작일 (YYYY-MM-DD)'
        },
        end_date: {
          type: 'string',
          description: '종료일 (YYYY-MM-DD)'
        },
        dry_run: {
          type: 'boolean',
          default: true
        }
      },
      required: ['name', 'discount_type', 'discount_value', 'start_date', 'end_date']
    }
  },
  {
    name: 'apply_monthly_coupons',
    description: '이번 달 기본 쿠폰 템플릿을 자동 생성합니다. (신규회원 할인, 재구매 할인 등)',
    inputSchema: {
      type: 'object',
      properties: {
        market: {
          type: 'string',
          default: 'naver-seller'
        },
        dry_run: {
          type: 'boolean',
          default: true
        }
      }
    }
  },
  {
    name: 'coupon_copy',
    description: '기존 쿠폰을 복사하여 새 기간으로 생성합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        coupon_name: {
          type: 'string',
          description: '복사할 쿠폰 이름'
        },
        new_start_date: {
          type: 'string',
          description: '새 시작일'
        },
        new_end_date: {
          type: 'string',
          description: '새 종료일'
        },
        dry_run: {
          type: 'boolean',
          default: true
        }
      },
      required: ['coupon_name', 'new_start_date', 'new_end_date']
    }
  }
];

// 도구 실행
export async function executeMonthlyTool(name, args) {
  const dryRun = args.dry_run !== false;

  switch (name) {
    // 부가세 자료 수집
    case 'collect_vat_data': {
      const skill = new VatCollectorSkill({ dryRun });

      return await skill.run(async () => {
        if (args.quarter) {
          return await skill.collectQuarterlyData(args.year, args.quarter);
        } else {
          const month = args.month || new Date().getMonth(); // 기본: 지난달
          return await skill.collectMonthlyData(args.year, month);
        }
      });
    }

    case 'collect_vat_all_markets': {
      const skill = new VatCollectorSkill({ dryRun });
      const markets = args.markets || ['naver-seller', 'coupang-wing', 'esm-seller'];

      return await skill.run(async () => {
        return await skill.collectFromMultipleMarkets(markets, args.year, args.month);
      });
    }

    // 쿠폰 관리
    case 'coupon_list': {
      const skill = new CouponApplierSkill({ dryRun: true });

      return await skill.run(async () => {
        const coupons = await skill.listCoupons();
        return {
          success: true,
          count: coupons.length,
          coupons: coupons.map(c => ({
            name: c.name,
            discountType: c.discountType,
            discountValue: c.discountValue,
            period: c.period,
            status: c.status
          }))
        };
      });
    }

    case 'coupon_create': {
      const skill = new CouponApplierSkill({ dryRun });

      return await skill.run(async () => {
        return await skill.createCoupon({
          name: args.name,
          discountType: args.discount_type,
          discountValue: args.discount_value,
          startDate: args.start_date,
          endDate: args.end_date
        });
      });
    }

    case 'apply_monthly_coupons': {
      const skill = new CouponApplierSkill({ dryRun });

      return await skill.run(async () => {
        return await skill.createMonthlyCoupons();
      });
    }

    case 'coupon_copy': {
      const skill = new CouponApplierSkill({ dryRun });

      return await skill.run(async () => {
        return await skill.copyCoupon(
          args.coupon_name,
          args.new_start_date,
          args.new_end_date
        );
      });
    }

    default:
      throw new Error(`알 수 없는 월간 작업 도구: ${name}`);
  }
}
