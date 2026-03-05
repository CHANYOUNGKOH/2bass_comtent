/**
 * 도매처 송장 수집 Skill
 *
 * 도매처 사이트에서 발주 건의 송장 정보를 수집
 * - 택배사, 송장번호 추출
 * - 발송 완료된 건 필터링
 *
 * 사용법:
 *   node skills/wholesale/invoice.collector.js --site site-a
 *   node skills/wholesale/invoice.collector.js --all
 *   node skills/wholesale/invoice.collector.js --dry-run
 */

import { BaseSkill } from '../utils/base.skill.js';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

class InvoiceCollectorSkill extends BaseSkill {
  constructor(options = {}) {
    super({
      name: 'invoice-collector',
      ...options
    });
    this.site = options.site || null;
    this.dataPath = join(__dirname, '../../output/exports/invoices');
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
   * 발주 목록에서 송장 정보 수집
   */
  async collectInvoices(orderIds = null) {
    const page = this.page;

    if (!this.selectors) {
      throw new Error('사이트 셀렉터가 로드되지 않았습니다');
    }

    const selectors = this.selectors.selectors.order_list;

    // 주문 목록 페이지 이동
    await page.goto(this.selectors.urls.order_list);
    await this.waitForLoading();

    const invoices = [];
    let processedPages = 0;

    // 페이지네이션 순회
    await this.iteratePages(async (pageNum) => {
      processedPages = pageNum;

      const orderRows = await page.$$(selectors.table.selector);

      for (const row of orderRows) {
        try {
          const orderNumber = await row.$eval(
            selectors.order_number.selector,
            el => el.textContent.trim()
          ).catch(() => '');

          // 특정 주문만 수집하는 경우 필터링
          if (orderIds && !orderIds.includes(orderNumber)) {
            continue;
          }

          const status = await row.$eval(
            selectors.status.selector,
            el => el.textContent.trim()
          ).catch(() => '');

          // 발송완료 상태만 수집
          if (!status.includes('발송') && !status.includes('배송')) {
            continue;
          }

          const carrier = await row.$eval(
            selectors.carrier.selector,
            el => el.textContent.trim()
          ).catch(() => '');

          const trackingNumber = await row.$eval(
            selectors.tracking_number.selector,
            el => el.textContent.trim()
          ).catch(() => '');

          if (carrier && trackingNumber) {
            invoices.push({
              site: this.site,
              orderNumber,
              carrier,
              trackingNumber,
              status,
              collectedAt: new Date().toISOString()
            });

            console.log(`✅ 송장 수집: ${orderNumber} - ${carrier} ${trackingNumber}`);
          }
        } catch (error) {
          console.error(`⚠️ 행 처리 중 에러:`, error.message);
        }
      }
    });

    console.log(`📊 총 ${invoices.length}건 송장 수집 완료 (${processedPages} 페이지)`);

    return invoices;
  }

  /**
   * 수집된 송장 저장
   */
  async saveInvoices(invoices) {
    await mkdir(this.dataPath, { recursive: true });

    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `${this.site}_${timestamp}.json`;
    const filepath = join(this.dataPath, filename);

    // 기존 파일 병합
    let existingData = [];
    if (existsSync(filepath)) {
      const content = await readFile(filepath, 'utf8');
      existingData = JSON.parse(content);
    }

    // 중복 제거
    const merged = [...existingData];
    for (const invoice of invoices) {
      const exists = merged.some(
        i => i.orderNumber === invoice.orderNumber && i.site === invoice.site
      );
      if (!exists) {
        merged.push(invoice);
      }
    }

    await writeFile(filepath, JSON.stringify(merged, null, 2));
    console.log(`💾 송장 저장: ${filepath} (${merged.length}건)`);

    return filepath;
  }

  /**
   * 전체 수집 및 저장
   */
  async collect(orderIds = null) {
    // Dry-run 모드
    if (this.logDryRun('송장 수집', { site: this.site, orderIds })) {
      return {
        success: true,
        dryRun: true,
        site: this.site,
        message: '송장 수집 테스트'
      };
    }

    const invoices = await this.collectInvoices(orderIds);

    if (invoices.length > 0) {
      await this.saveInvoices(invoices);
    }

    await this.saveEvidence('invoice-collection');

    const result = {
      success: true,
      site: this.site,
      collected: invoices.length,
      invoices
    };

    await this.saveLog(result);
    return result;
  }
}

// 모든 도매처 수집
async function collectAll(dryRun = false) {
  const sites = ['site-a', 'site-b']; // 설정된 도매처 목록
  const results = {};

  for (const siteId of sites) {
    console.log(`\n🏪 ${siteId} 송장 수집 시작...`);

    try {
      const skill = new InvoiceCollectorSkill({ dryRun });
      skill.loadSiteSelectors(siteId);

      const result = await skill.run(async () => {
        return await skill.collect();
      });

      results[siteId] = result;
    } catch (error) {
      console.error(`❌ ${siteId} 수집 실패:`, error.message);
      results[siteId] = { success: false, error: error.message };
    }
  }

  return {
    success: true,
    sites: results
  };
}

// CLI 실행
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const all = args.includes('--all');

  // --site 파싱
  const siteIndex = args.indexOf('--site');
  const site = siteIndex !== -1 ? args[siteIndex + 1] : null;

  if (all) {
    const results = await collectAll(dryRun);
    console.log('\n📊 전체 결과:', JSON.stringify(results, null, 2));
  } else if (site) {
    const skill = new InvoiceCollectorSkill({ dryRun });

    try {
      skill.loadSiteSelectors(site);
    } catch (e) {
      console.error(`❌ 사이트 셀렉터 로드 실패: ${e.message}`);
      console.log('💡 selectors/wholesale/ 폴더에 사이트 YAML 파일을 추가하세요.');
      process.exit(1);
    }

    await skill.run(async () => {
      return await skill.collect();
    });
  } else {
    console.log('사용법:');
    console.log('  --site <id>  : 특정 도매처 송장 수집');
    console.log('  --all        : 모든 도매처 송장 수집');
    console.log('  --dry-run    : 테스트 실행');
  }
}

main().catch(console.error);

export { InvoiceCollectorSkill, collectAll };
