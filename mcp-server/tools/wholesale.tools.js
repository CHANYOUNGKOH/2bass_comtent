/**
 * 도매처 관리 관련 MCP 도구 정의
 */

// 스킬은 나중에 구현 예정 - 일단 도구 정의만
// import { InvoiceCollectorSkill } from '../../skills/wholesale/invoice.collector.js';
// import { InquirySenderSkill } from '../../skills/wholesale/inquiry.sender.js';

// 도구 정의
export const wholesaleTools = [
  // 송장 수집
  {
    name: 'wholesale_list_sites',
    description: '등록된 도매처 사이트 목록을 조회합니다.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'invoice_collect',
    description: '도매처에서 발주 건의 송장 정보(택배사, 송장번호)를 수집합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        site: {
          type: 'string',
          description: '도매처 사이트 ID'
        },
        order_ids: {
          type: 'array',
          items: { type: 'string' },
          description: '수집할 발주번호 목록 (비어있으면 전체)'
        },
        dry_run: {
          type: 'boolean',
          default: true
        }
      },
      required: ['site']
    }
  },
  {
    name: 'invoice_collect_all',
    description: '모든 도매처에서 오늘 발송된 송장 정보를 일괄 수집합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        dry_run: {
          type: 'boolean',
          default: true
        }
      }
    }
  },

  // 배송문의
  {
    name: 'inquiry_list_pending',
    description: '미발송 상태로 N일 이상 경과한 발주 건 목록을 조회합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        days: {
          type: 'number',
          description: '경과 일수 (기본값: 2)',
          default: 2
        },
        site: {
          type: 'string',
          description: '특정 도매처만 조회 (비어있으면 전체)'
        }
      }
    }
  },
  {
    name: 'inquiry_send',
    description: '미발송 건에 대해 배송문의 메시지를 발송합니다. 발주일로부터 최초 1회만 발송됩니다.',
    inputSchema: {
      type: 'object',
      properties: {
        site: {
          type: 'string',
          description: '도매처 사이트 ID'
        },
        order_ids: {
          type: 'array',
          items: { type: 'string' },
          description: '문의할 발주번호 목록'
        },
        message: {
          type: 'string',
          description: '문의 메시지 (비어있으면 기본 메시지 사용)'
        },
        dry_run: {
          type: 'boolean',
          default: true
        }
      },
      required: ['site', 'order_ids']
    }
  },
  {
    name: 'inquiry_send_all_pending',
    description: '모든 도매처의 미발송 건에 대해 자동으로 배송문의를 발송합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        days: {
          type: 'number',
          description: '최소 경과 일수',
          default: 2
        },
        dry_run: {
          type: 'boolean',
          default: true
        }
      }
    }
  }
];

// 등록된 도매처 목록 (예시)
const wholesaleSites = [
  { id: 'site-a', name: '도매처A', url: 'https://wholesale-a.com' },
  { id: 'site-b', name: '도매처B', url: 'https://wholesale-b.com' },
];

// 도구 실행
export async function executeWholesaleTool(name, args) {
  const dryRun = args.dry_run !== false;

  switch (name) {
    case 'wholesale_list_sites': {
      return {
        success: true,
        count: wholesaleSites.length,
        sites: wholesaleSites
      };
    }

    case 'invoice_collect': {
      // TODO: InvoiceCollectorSkill 구현 후 연동
      if (dryRun) {
        return {
          success: true,
          dryRun: true,
          site: args.site,
          message: '송장 수집 기능은 도매처 셀렉터 설정 후 사용 가능합니다.',
          example: {
            orderIds: args.order_ids || ['ORD-001', 'ORD-002'],
            invoices: [
              { orderId: 'ORD-001', carrier: 'CJ대한통운', trackingNumber: '1234567890' },
              { orderId: 'ORD-002', carrier: '롯데택배', trackingNumber: '0987654321' }
            ]
          }
        };
      }

      throw new Error('실제 송장 수집은 도매처 셀렉터 설정이 필요합니다.');
    }

    case 'invoice_collect_all': {
      if (dryRun) {
        return {
          success: true,
          dryRun: true,
          message: '모든 도매처 송장 일괄 수집 (테스트)',
          sites: wholesaleSites.map(s => ({
            id: s.id,
            name: s.name,
            collectedCount: Math.floor(Math.random() * 10)
          }))
        };
      }

      throw new Error('실제 송장 수집은 도매처 셀렉터 설정이 필요합니다.');
    }

    case 'inquiry_list_pending': {
      // 미발송 건 조회 (예시 데이터)
      return {
        success: true,
        days: args.days || 2,
        site: args.site || '전체',
        count: 3,
        pendingOrders: [
          { orderId: 'ORD-003', site: 'site-a', orderDate: '2024-02-28', daysPassed: 3 },
          { orderId: 'ORD-004', site: 'site-a', orderDate: '2024-02-28', daysPassed: 3 },
          { orderId: 'ORD-005', site: 'site-b', orderDate: '2024-02-29', daysPassed: 2 }
        ]
      };
    }

    case 'inquiry_send': {
      if (dryRun) {
        const defaultMessage = '안녕하세요. 발주 건 배송 일정 확인 부탁드립니다.';

        return {
          success: true,
          dryRun: true,
          site: args.site,
          orderIds: args.order_ids,
          message: args.message || defaultMessage,
          note: '실제 발송은 dry_run=false로 설정하세요.'
        };
      }

      throw new Error('실제 문의 발송은 도매처 셀렉터 설정이 필요합니다.');
    }

    case 'inquiry_send_all_pending': {
      if (dryRun) {
        return {
          success: true,
          dryRun: true,
          days: args.days || 2,
          message: '미발송 건 전체 문의 발송 (테스트)',
          wouldSend: [
            { site: 'site-a', orderIds: ['ORD-003', 'ORD-004'] },
            { site: 'site-b', orderIds: ['ORD-005'] }
          ]
        };
      }

      throw new Error('실제 문의 발송은 도매처 셀렉터 설정이 필요합니다.');
    }

    default:
      throw new Error(`알 수 없는 도매처 도구: ${name}`);
  }
}
