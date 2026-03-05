/**
 * Dry-Run 모드 관리
 *
 * 실제 작업을 수행하지 않고 시뮬레이션만 수행
 * - 실제 클릭/입력 대신 로그만 출력
 * - 결과 미리보기 제공
 */

/**
 * Dry-Run 래퍼 클래스
 */
export class DryRunWrapper {
  constructor(page, options = {}) {
    this.page = page;
    this.enabled = options.enabled ?? true;
    this.actions = [];
    this.verbose = options.verbose ?? true;
  }

  /**
   * 액션 기록
   */
  log(action, details = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      action,
      ...details
    };

    this.actions.push(entry);

    if (this.verbose) {
      console.log(`🔍 [DRY-RUN] ${action}:`, JSON.stringify(details, null, 2));
    }
  }

  /**
   * 클릭 시뮬레이션
   */
  async click(selector, options = {}) {
    this.log('click', { selector, options });

    if (!this.enabled) {
      return await this.page.click(selector, options);
    }

    // Dry-run: 요소 존재 확인만
    const element = await this.page.$(selector);
    if (!element) {
      throw new Error(`요소를 찾을 수 없음: ${selector}`);
    }

    return { simulated: true, selector };
  }

  /**
   * 입력 시뮬레이션
   */
  async fill(selector, value, options = {}) {
    this.log('fill', { selector, value: value.substring(0, 20) + '...', options });

    if (!this.enabled) {
      return await this.page.fill(selector, value, options);
    }

    const element = await this.page.$(selector);
    if (!element) {
      throw new Error(`요소를 찾을 수 없음: ${selector}`);
    }

    return { simulated: true, selector, valueLength: value.length };
  }

  /**
   * 선택 시뮬레이션
   */
  async selectOption(selector, value) {
    this.log('selectOption', { selector, value });

    if (!this.enabled) {
      return await this.page.selectOption(selector, value);
    }

    const element = await this.page.$(selector);
    if (!element) {
      throw new Error(`요소를 찾을 수 없음: ${selector}`);
    }

    return { simulated: true, selector, selectedValue: value };
  }

  /**
   * 체크박스 시뮬레이션
   */
  async check(selector) {
    this.log('check', { selector });

    if (!this.enabled) {
      return await this.page.check(selector);
    }

    return { simulated: true, selector };
  }

  /**
   * 결과 요약
   */
  getSummary() {
    const summary = {
      totalActions: this.actions.length,
      actionTypes: {},
      timeline: this.actions
    };

    for (const action of this.actions) {
      summary.actionTypes[action.action] = (summary.actionTypes[action.action] || 0) + 1;
    }

    return summary;
  }

  /**
   * 결과 출력
   */
  printSummary() {
    const summary = this.getSummary();

    console.log('\n📊 Dry-Run 요약:');
    console.log(`  총 액션: ${summary.totalActions}개`);
    console.log('  액션별 횟수:');

    for (const [action, count] of Object.entries(summary.actionTypes)) {
      console.log(`    - ${action}: ${count}회`);
    }

    return summary;
  }
}

/**
 * 함수를 Dry-Run 모드로 실행
 */
export function withDryRun(fn, options = {}) {
  return async (...args) => {
    const dryRun = options.dryRun ?? args[args.length - 1]?.dryRun ?? false;

    if (dryRun) {
      console.log('🔍 [DRY-RUN 모드] 실제 작업을 수행하지 않습니다.');

      const result = await fn(...args);

      return {
        ...result,
        dryRun: true,
        message: '실제 작업은 수행되지 않았습니다. dry_run=false로 실행하세요.'
      };
    }

    return await fn(...args);
  };
}

export default { DryRunWrapper, withDryRun };
