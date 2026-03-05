/**
 * 모든 Skill의 베이스 클래스
 * 공통 기능: 브라우저 관리, 에러 처리, 로깅, 셀렉터 관리
 */

import { chromium } from 'playwright';
import { config } from 'dotenv';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadSelectors, getSelector } from '../../core/selector.loader.js';

config();

const __dirname = dirname(fileURLToPath(import.meta.url));

export class BaseSkill {
  constructor(options = {}) {
    this.name = options.name || 'unnamed-skill';
    this.headless = options.headless ?? false;
    this.slowMo = options.slowMo ?? 50;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.market = options.market || null;
    this.selectors = null;
    this.dryRun = options.dryRun ?? false;
  }

  // YAML 셀렉터 로드
  loadMarketSelectors(market = this.market) {
    if (!market) {
      throw new Error('마켓이 지정되지 않았습니다');
    }
    this.selectors = loadSelectors(market);
    return this.selectors;
  }

  // 셀렉터 경로로 요소 가져오기
  getSelector(path) {
    if (!this.selectors) {
      throw new Error('셀렉터가 로드되지 않았습니다. loadMarketSelectors()를 먼저 호출하세요');
    }
    return getSelector(this.selectors, path);
  }

  // URL 가져오기
  getUrl(name) {
    if (!this.selectors?.urls) {
      throw new Error('URL이 정의되지 않았습니다');
    }
    return this.selectors.urls[name];
  }

  // 브라우저 시작
  async start() {
    console.log(`🚀 [${this.name}] 시작...`);

    this.browser = await chromium.launch({
      headless: this.headless,
      slowMo: this.slowMo,
    });

    this.context = await this.browser.newContext();
    this.page = await this.context.newPage();

    return this.page;
  }

  // 브라우저 종료
  async stop() {
    if (this.browser) {
      await this.browser.close();
      console.log(`🔚 [${this.name}] 종료`);
    }
  }

  // 에러 발생시 스크린샷 저장
  async captureError(error) {
    const screenshotDir = join(__dirname, '../../errors');
    await mkdir(screenshotDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${this.name}_${timestamp}.png`;
    const filepath = join(screenshotDir, filename);

    if (this.page) {
      await this.page.screenshot({ path: filepath, fullPage: true });
      console.log(`📸 에러 스크린샷 저장: ${filepath}`);
    }

    // 에러 로그 저장
    const logfile = join(screenshotDir, `${this.name}_${timestamp}.log`);
    await writeFile(logfile, `Error: ${error.message}\n\nStack: ${error.stack}`);
  }

  // 안전한 실행 래퍼
  async run(task) {
    try {
      await this.start();
      const result = await task(this.page);
      return { success: true, data: result };
    } catch (error) {
      console.error(`❌ [${this.name}] 에러:`, error.message);
      await this.captureError(error);
      return { success: false, error: error.message };
    } finally {
      await this.stop();
    }
  }

  // 세션 저장 (로그인 상태 유지)
  async saveSession(filename) {
    const sessionDir = join(__dirname, '../../sessions');
    await mkdir(sessionDir, { recursive: true });

    const filepath = join(sessionDir, `${filename}.json`);
    const storage = await this.context.storageState();
    await writeFile(filepath, JSON.stringify(storage, null, 2));

    console.log(`💾 세션 저장: ${filepath}`);
    return filepath;
  }

  // 저장된 세션 로드
  async loadSession(filename) {
    const filepath = join(__dirname, '../../sessions', `${filename}.json`);

    this.browser = await chromium.launch({
      headless: this.headless,
      slowMo: this.slowMo,
    });

    this.context = await this.browser.newContext({
      storageState: filepath
    });

    this.page = await this.context.newPage();
    console.log(`📂 세션 로드: ${filepath}`);

    return this.page;
  }

  // 세션이 있으면 로드, 없으면 새로 시작
  async startWithSession(sessionName) {
    const sessionPath = join(__dirname, '../../sessions', `${sessionName}.json`);

    if (existsSync(sessionPath)) {
      return await this.loadSession(sessionName);
    } else {
      console.log(`⚠️ 세션 없음 - 새 브라우저 시작`);
      return await this.start();
    }
  }

  // 로딩 대기
  async waitForLoading() {
    const loadingSelector = this.getSelector('common.loading_spinner');
    try {
      await this.page.waitForSelector(loadingSelector, { state: 'hidden', timeout: 30000 });
    } catch (e) {
      // 로딩 스피너가 없으면 무시
    }
  }

  // 모달 대기 및 확인
  async handleModal(action = 'confirm') {
    const modalSelector = this.getSelector('common.modal_overlay');
    try {
      await this.page.waitForSelector(modalSelector, { timeout: 5000 });

      if (action === 'confirm') {
        await this.page.click(this.getSelector('common.confirm_btn'));
      } else {
        await this.page.click(this.getSelector('common.cancel_btn'));
      }
    } catch (e) {
      // 모달이 없으면 무시
    }
  }

  // 스크린샷 저장 (증거용)
  async saveEvidence(name) {
    const evidenceDir = join(__dirname, '../../output/screenshots');
    await mkdir(evidenceDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${this.name}_${name}_${timestamp}.png`;
    const filepath = join(evidenceDir, filename);

    await this.page.screenshot({ path: filepath, fullPage: true });
    console.log(`📸 증거 스크린샷: ${filepath}`);

    return filepath;
  }

  // 테이블 데이터 추출
  async extractTableData(rowSelector, columns) {
    const rows = await this.page.$$(rowSelector);
    const data = [];

    for (const row of rows) {
      const rowData = {};
      for (const [key, selector] of Object.entries(columns)) {
        const cell = await row.$(selector);
        rowData[key] = cell ? await cell.textContent() : '';
      }
      data.push(rowData);
    }

    return data;
  }

  // 페이지네이션 순회
  async iteratePages(callback) {
    let hasNextPage = true;
    let pageNum = 1;

    while (hasNextPage) {
      console.log(`📄 페이지 ${pageNum} 처리 중...`);
      await callback(pageNum);

      try {
        const nextBtn = await this.page.$(this.getSelector('common.next_page'));
        if (nextBtn && await nextBtn.isEnabled()) {
          await nextBtn.click();
          await this.waitForLoading();
          pageNum++;
        } else {
          hasNextPage = false;
        }
      } catch (e) {
        hasNextPage = false;
      }
    }
  }

  // Dry-run 모드 로깅
  logDryRun(action, data) {
    if (this.dryRun) {
      console.log(`🔍 [DRY-RUN] ${action}:`, JSON.stringify(data, null, 2));
      return true;
    }
    return false;
  }

  // 결과 로그 저장
  async saveLog(data) {
    const logDir = join(__dirname, '../../output/logs');
    await mkdir(logDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${this.name}_${timestamp}.json`;
    const filepath = join(logDir, filename);

    await writeFile(filepath, JSON.stringify(data, null, 2));
    console.log(`📝 로그 저장: ${filepath}`);

    return filepath;
  }
}
