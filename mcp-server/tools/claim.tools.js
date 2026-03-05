/**
 * 클레임(예외 처리) 관련 MCP 도구 정의
 */

import { DirectDeliverySkill } from '../../skills/claims/direct.delivery.js';
import { DelayHandlerSkill } from '../../skills/claims/delay.handler.js';
import { ReturnHandlerSkill } from '../../skills/claims/return.handler.js';
import { ExchangeHandlerSkill } from '../../skills/claims/exchange.handler.js';

// 도구 정의
export const claimTools = [
  // 직접전달
  {
    name: 'list_direct_delivery_orders',
    description: '직접전달이 필요한 주문 목록을 조회합니다. 별도 송장 입력이 필요한 해외배송, 특수배송 등의 주문입니다.',
    inputSchema: {
      type: 'object',
      properties: {
        market: {
          type: 'string',
          description: '마켓 (기본값: naver-seller)',
          default: 'naver-seller'
        }
      }
    }
  },
  {
    name: 'claim_process_direct_delivery',
    description: '직접전달 주문을 처리합니다. 택배사와 송장번호를 입력하여 발송 처리합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        order_ids: {
          type: 'array',
          items: { type: 'string' },
          description: '처리할 주문번호 목록'
        },
        carrier: {
          type: 'string',
          description: '택배사 (예: CJ대한통운, 롯데택배, 우체국)'
        },
        tracking_number: {
          type: 'string',
          description: '송장번호'
        },
        dry_run: {
          type: 'boolean',
          description: '테스트 모드 (실제 처리하지 않음)',
          default: true
        }
      },
      required: ['order_ids', 'carrier', 'tracking_number']
    }
  },

  // 배송지연
  {
    name: 'list_delayed_orders',
    description: '배송지연 처리가 필요한 주문 목록을 조회합니다.',
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
    name: 'claim_handle_delay',
    description: '배송지연 주문을 처리합니다. 지연 사유와 예상 발송일을 입력합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        order_ids: {
          type: 'array',
          items: { type: 'string' },
          description: '처리할 주문번호 목록'
        },
        reason: {
          type: 'string',
          enum: ['production', 'stock', 'supplier', 'weather', 'holiday', 'other'],
          description: '지연 사유 (production: 제작 지연, stock: 재고 부족, supplier: 공급사 지연, weather: 기상 악화, holiday: 연휴, other: 기타)'
        },
        detail: {
          type: 'string',
          description: '상세 사유 (선택)'
        },
        expected_date: {
          type: 'string',
          description: '예상 발송일 (YYYY-MM-DD 형식)'
        },
        dry_run: {
          type: 'boolean',
          default: true
        }
      },
      required: ['order_ids', 'reason', 'expected_date']
    }
  },

  // 반품
  {
    name: 'list_pending_returns',
    description: '반품 대기 목록을 조회합니다.',
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
    name: 'claim_approve_returns',
    description: '반품 요청을 승인합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        order_ids: {
          type: 'array',
          items: { type: 'string' },
          description: '승인할 주문번호 목록'
        },
        dry_run: {
          type: 'boolean',
          default: true
        }
      },
      required: ['order_ids']
    }
  },
  {
    name: 'claim_reject_returns',
    description: '반품 요청을 거절합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        order_ids: {
          type: 'array',
          items: { type: 'string' },
          description: '거절할 주문번호 목록'
        },
        reason: {
          type: 'string',
          enum: ['product_damage', 'tag_removed', 'used', 'period_exceeded', 'missing_parts', 'other'],
          description: '거절 사유'
        },
        detail: {
          type: 'string',
          description: '상세 사유'
        },
        dry_run: {
          type: 'boolean',
          default: true
        }
      },
      required: ['order_ids', 'reason']
    }
  },

  // 교환
  {
    name: 'list_pending_exchanges',
    description: '교환 대기 목록을 조회합니다.',
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
    name: 'claim_reject_exchanges',
    description: '교환 요청을 거절합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        order_ids: {
          type: 'array',
          items: { type: 'string' },
          description: '거절할 주문번호 목록'
        },
        reason: {
          type: 'string',
          enum: ['no_stock', 'product_damage', 'used', 'period_exceeded', 'other'],
          description: '거절 사유'
        },
        detail: {
          type: 'string',
          description: '상세 사유'
        },
        dry_run: {
          type: 'boolean',
          default: true
        }
      },
      required: ['order_ids', 'reason']
    }
  }
];

// 도구 실행
export async function executeClaimTool(name, args) {
  const dryRun = args.dry_run !== false; // 기본값 true

  switch (name) {
    // 직접전달
    case 'list_direct_delivery_orders': {
      const skill = new DirectDeliverySkill({ dryRun: true });
      return await skill.run(async () => {
        const orders = await skill.listOrders();
        return {
          success: true,
          count: orders.length,
          orders: orders.map(o => ({
            orderNumber: o.orderNumber,
            productName: o.productName,
            buyerName: o.buyerName
          }))
        };
      });
    }

    case 'claim_process_direct_delivery': {
      const skill = new DirectDeliverySkill({ dryRun });
      return await skill.run(async () => {
        return await skill.processOrders(args.order_ids, {
          carrier: args.carrier,
          trackingNumber: args.tracking_number
        });
      });
    }

    // 배송지연
    case 'list_delayed_orders': {
      const skill = new DelayHandlerSkill({ dryRun: true });
      return await skill.run(async () => {
        const orders = await skill.listDelayedOrders();
        return {
          success: true,
          count: orders.length,
          orders: orders.map(o => ({
            orderNumber: o.orderNumber,
            productName: o.productName,
            dueDate: o.dueDate
          }))
        };
      });
    }

    case 'claim_handle_delay': {
      const skill = new DelayHandlerSkill({ dryRun });
      return await skill.run(async () => {
        return await skill.processDelay(args.order_ids, {
          reason: args.reason,
          detail: args.detail || '',
          expectedDate: args.expected_date
        });
      });
    }

    // 반품
    case 'list_pending_returns': {
      const skill = new ReturnHandlerSkill({ dryRun: true });
      return await skill.run(async () => {
        const returns = await skill.listPendingReturns();
        return {
          success: true,
          count: returns.length,
          returns: returns.map(r => ({
            orderNumber: r.orderNumber,
            productName: r.productName,
            returnReason: r.returnReason
          }))
        };
      });
    }

    case 'claim_approve_returns': {
      const skill = new ReturnHandlerSkill({ dryRun });
      return await skill.run(async () => {
        return await skill.approveReturns(args.order_ids);
      });
    }

    case 'claim_reject_returns': {
      const skill = new ReturnHandlerSkill({ dryRun });
      return await skill.run(async () => {
        return await skill.rejectReturns(args.order_ids, {
          reason: args.reason,
          detail: args.detail || ''
        });
      });
    }

    // 교환
    case 'list_pending_exchanges': {
      const skill = new ExchangeHandlerSkill({ dryRun: true });
      return await skill.run(async () => {
        const exchanges = await skill.listPendingExchanges();
        return {
          success: true,
          count: exchanges.length,
          exchanges: exchanges.map(e => ({
            orderNumber: e.orderNumber,
            productName: e.productName,
            exchangeReason: e.exchangeReason,
            requestedOption: e.requestedOption
          }))
        };
      });
    }

    case 'claim_reject_exchanges': {
      const skill = new ExchangeHandlerSkill({ dryRun });
      return await skill.run(async () => {
        return await skill.rejectExchanges(args.order_ids, {
          reason: args.reason,
          detail: args.detail || ''
        });
      });
    }

    default:
      throw new Error(`알 수 없는 클레임 도구: ${name}`);
  }
}
