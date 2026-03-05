/**
 * Playwright MCP 서버
 *
 * Claude와 연동하여 자연어 명령으로 이커머스 자동화 작업 수행
 *
 * 사용법:
 *   node mcp-server/server.js
 *
 * Claude 설정:
 *   "mcpServers": {
 *     "ecommerce": {
 *       "command": "node",
 *       "args": ["path/to/mcp-server/server.js"]
 *     }
 *   }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// 도구 정의 가져오기
import { claimTools, executeClaimTool } from './tools/claim.tools.js';
import { monthlyTools, executeMonthlyTool } from './tools/monthly.tools.js';
import { wholesaleTools, executeWholesaleTool } from './tools/wholesale.tools.js';

// 모든 도구 통합
const allTools = [
  ...claimTools,
  ...monthlyTools,
  ...wholesaleTools
];

// 도구 실행 라우터
async function executeTool(name, args) {
  // 클레임 도구
  if (name.startsWith('claim_') || name.startsWith('list_')) {
    return await executeClaimTool(name, args);
  }

  // 월간 작업 도구
  if (name.startsWith('collect_vat') || name.startsWith('apply_coupon') || name.startsWith('coupon_')) {
    return await executeMonthlyTool(name, args);
  }

  // 도매처 도구
  if (name.startsWith('wholesale_') || name.startsWith('invoice_') || name.startsWith('inquiry_')) {
    return await executeWholesaleTool(name, args);
  }

  throw new Error(`알 수 없는 도구: ${name}`);
}

// MCP 서버 생성
const server = new Server(
  {
    name: 'ecommerce-automation',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// 도구 목록 핸들러
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: allTools,
  };
});

// 도구 실행 핸들러
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    console.error(`[MCP] 도구 실행: ${name}`);
    console.error(`[MCP] 인자:`, JSON.stringify(args, null, 2));

    const result = await executeTool(name, args || {});

    console.error(`[MCP] 결과:`, JSON.stringify(result, null, 2));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    console.error(`[MCP] 에러:`, error);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error.message,
          }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

// 서버 시작
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[MCP] 이커머스 자동화 서버 시작됨');
}

main().catch(console.error);
