/**
 * 부가세 자료 수집 Skill
 *
 * 월간 부가세 신고용 자료 수집
 * - 매출 자료 다운로드
 * - 매입 자료 다운로드
 * - 정산 내역 다운로드
 *
 * 사용법:
 *   node skills/monthly/vat.collector.js --month 2024-02     # 특정 월 자료 수집
 *   node skills/monthly/vat.collector.js --quarter 2024-Q1   # 분기 자료 수집
 *   node skills/monthly/vat.collector.js --dry-run           # 테스트 실행
 */

import { BaseSkill } from '../utils/base.skill.js';
import { mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

class VatCollectorSkill extends BaseSkill {
  constructor(options = {}) {
    super({
      name: 'vat-collector',
      market: 'naver-seller',
      ...options
    });
    this.loadMarketSelectors();
    this.downloadPath = join(__dirname, '../../output/exports/vat');
  }

  /**
   * 다운로드 폴더 준비
   */
  async prepareDownloadFolder(year, month) {
    const folder = join(this.downloadPath, `${year}-${month.toString().padStart(2, '0')}`);
    await mkdir(folder, { recursive: true });
    return folder;
  }

  /**
   * 특정 월 부가세 자료 수집
   * @param {number} year - 년도
   * @param {number} month - 월
   */
  async collectMonthlyData(year, month) {
    const page = this.page;
    const selectors = this.selectors.selectors.monthly.vat;

    // Dry-run 모드
    if (this.logDryRun('부가세 자료 수집', { year, month })) {
      return {
        success: true,
        dryRun: true,
        year,
        month,
        files: ['매출자료.xlsx', '매입자료.xlsx', '정산내역.xlsx']
      };
    }

    // 다운로드 폴더 준비
    const downloadFolder = await this.prepareDownloadFolder(year, month);

    // 다운로드 이벤트 설정
    const downloadPromise = page.waitForEvent('download');

    // 부가세 자료 페이지 이동
    await page.goto(this.getUrl('vat_data'));
    await this.waitForLoading();

    // 년도/월 선택
    await page.selectOption(selectors.year_select.selector, year.toString());
    await page.selectOption(selectors.month_select.selector, month.toString());
    await this.waitForLoading();

    const downloadedFiles = [];

    // 1. 매출 자료 다운로드
    try {
      await page.click(selectors.download_sales.selector);
      const salesDownload = await downloadPromise;
      const salesPath = join(downloadFolder, `매출자료_${year}${month.toString().padStart(2, '0')}.xlsx`);
      await salesDownload.saveAs(salesPath);
      downloadedFiles.push(salesPath);
      console.log(`✅ 매출 자료 다운로드: ${salesPath}`);
    } catch (e) {
      console.error(`❌ 매출 자료 다운로드 실패: ${e.message}`);
    }

    // 2. 매입 자료 다운로드
    try {
      const purchaseDownloadPromise = page.waitForEvent('download');
      await page.click(selectors.download_purchase.selector);
      const purchaseDownload = await purchaseDownloadPromise;
      const purchasePath = join(downloadFolder, `매입자료_${year}${month.toString().padStart(2, '0')}.xlsx`);
      await purchaseDownload.saveAs(purchasePath);
      downloadedFiles.push(purchasePath);
      console.log(`✅ 매입 자료 다운로드: ${purchasePath}`);
    } catch (e) {
      console.error(`❌ 매입 자료 다운로드 실패: ${e.message}`);
    }

    await this.saveEvidence('vat-collection');

    const result = {
      success: true,
      year,
      month,
      downloadFolder,
      files: downloadedFiles
    };

    await this.saveLog(result);
    return result;
  }

  /**
   * 분기 자료 수집
   * @param {number} year - 년도
   * @param {number} quarter - 분기 (1-4)
   */
  async collectQuarterlyData(year, quarter) {
    const startMonth = (quarter - 1) * 3 + 1;
    const months = [startMonth, startMonth + 1, startMonth + 2];

    const results = [];

    for (const month of months) {
      console.log(`📅 ${year}년 ${month}월 자료 수집 중...`);
      const result = await this.collectMonthlyData(year, month);
      results.push(result);
    }

    return {
      success: true,
      year,
      quarter,
      months: results
    };
  }

  /**
   * 여러 마켓 부가세 자료 수집
   * @param {Array} markets - 마켓 목록
   * @param {number} year - 년도
   * @param {number} month - 월
   */
  async collectFromMultipleMarkets(markets, year, month) {
    const results = {};

    for (const market of markets) {
      console.log(`🏪 ${market} 부가세 자료 수집 중...`);

      try {
        this.loadMarketSelectors(market);
        const result = await this.collectMonthlyData(year, month);
        results[market] = result;
      } catch (e) {
        console.error(`❌ ${market} 수집 실패: ${e.message}`);
        results[market] = { success: false, error: e.message };
      }
    }

    return {
      success: true,
      year,
      month,
      markets: results
    };
  }
}

// CLI 실행
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  // --month 파싱
  const monthIndex = args.indexOf('--month');
  let year, month;

  if (monthIndex !== -1 && args[monthIndex + 1]) {
    const [y, m] = args[monthIndex + 1].split('-').map(Number);
    year = y;
    month = m;
  } else {
    // 기본값: 지난달
    const now = new Date();
    now.setMonth(now.getMonth() - 1);
    year = now.getFullYear();
    month = now.getMonth() + 1;
  }

  // --quarter 파싱
  const quarterIndex = args.indexOf('--quarter');
  let quarter = null;

  if (quarterIndex !== -1 && args[quarterIndex + 1]) {
    const match = args[quarterIndex + 1].match(/(\d{4})-Q(\d)/);
    if (match) {
      year = parseInt(match[1]);
      quarter = parseInt(match[2]);
    }
  }

  const skill = new VatCollectorSkill({ dryRun });

  await skill.run(async (page) => {
    if (quarter) {
      return await skill.collectQuarterlyData(year, quarter);
    } else {
      return await skill.collectMonthlyData(year, month);
    }
  });
}

main().catch(console.error);

export { VatCollectorSkill };
