/**
 * 실행 전 확인 시스템
 *
 * 중요한 작업 실행 전 사용자 확인 요청
 * - 작업 내용 미리보기
 * - 영향 범위 표시
 * - 확인 후 실행
 */

import { createInterface } from 'readline';

/**
 * 확인 프롬프트 (CLI용)
 */
export async function confirm(message, options = {}) {
  const defaultValue = options.default ?? false;

  // 환경 변수로 자동 승인 (CI/CD 등)
  if (process.env.AUTO_CONFIRM === 'true') {
    console.log(`${message} [자동 승인됨]`);
    return true;
  }

  // 비대화형 환경에서는 기본값 반환
  if (!process.stdin.isTTY) {
    console.log(`${message} [비대화형 환경 - 기본값: ${defaultValue}]`);
    return defaultValue;
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    const prompt = defaultValue ? '[Y/n]' : '[y/N]';

    rl.question(`${message} ${prompt} `, (answer) => {
      rl.close();

      const normalized = answer.toLowerCase().trim();

      if (normalized === '') {
        resolve(defaultValue);
      } else if (normalized === 'y' || normalized === 'yes') {
        resolve(true);
      } else {
        resolve(false);
      }
    });
  });
}

/**
 * 작업 미리보기 및 확인
 */
export async function confirmAction(actionName, details, options = {}) {
  console.log('\n' + '='.repeat(60));
  console.log(`📋 작업: ${actionName}`);
  console.log('='.repeat(60));

  // 상세 내용 출력
  if (Array.isArray(details)) {
    details.forEach((item, i) => {
      console.log(`  ${i + 1}. ${item}`);
    });
  } else if (typeof details === 'object') {
    for (const [key, value] of Object.entries(details)) {
      if (Array.isArray(value)) {
        console.log(`  ${key}: ${value.length}건`);
        value.slice(0, 5).forEach(v => console.log(`    - ${v}`));
        if (value.length > 5) {
          console.log(`    ... 외 ${value.length - 5}건`);
        }
      } else {
        console.log(`  ${key}: ${value}`);
      }
    }
  } else {
    console.log(`  ${details}`);
  }

  console.log('='.repeat(60));

  // 위험 작업 경고
  if (options.dangerous) {
    console.log('⚠️  주의: 이 작업은 되돌릴 수 없습니다!');
  }

  // 확인
  return await confirm('\n이 작업을 실행하시겠습니까?', options);
}

/**
 * 작업 실행 래퍼 (확인 후 실행)
 */
export async function withConfirmation(actionName, details, actionFn, options = {}) {
  const confirmed = await confirmAction(actionName, details, options);

  if (!confirmed) {
    console.log('❌ 작업이 취소되었습니다.');
    return { cancelled: true };
  }

  console.log('✅ 작업을 실행합니다...\n');

  try {
    const result = await actionFn();
    console.log('\n✅ 작업이 완료되었습니다.');
    return { cancelled: false, success: true, result };
  } catch (error) {
    console.error('\n❌ 작업 중 에러 발생:', error.message);
    return { cancelled: false, success: false, error: error.message };
  }
}

/**
 * 다중 선택 확인
 */
export async function selectItems(items, options = {}) {
  const itemLabel = options.label || '항목';

  console.log(`\n📋 ${itemLabel} 목록 (${items.length}건):`);

  items.forEach((item, i) => {
    const display = options.display ? options.display(item) : item;
    console.log(`  ${i + 1}. ${display}`);
  });

  // 비대화형 환경
  if (!process.stdin.isTTY) {
    console.log('[비대화형 환경 - 전체 선택됨]');
    return items;
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question('\n처리할 번호를 입력하세요 (예: 1,3,5 / 전체: all / 취소: q): ', (answer) => {
      rl.close();

      const normalized = answer.toLowerCase().trim();

      if (normalized === 'q' || normalized === '') {
        console.log('❌ 취소되었습니다.');
        resolve([]);
        return;
      }

      if (normalized === 'all') {
        resolve(items);
        return;
      }

      // 번호 파싱
      const indices = normalized.split(',')
        .map(s => parseInt(s.trim()) - 1)
        .filter(i => i >= 0 && i < items.length);

      const selected = indices.map(i => items[i]);
      console.log(`\n${selected.length}건 선택됨`);

      resolve(selected);
    });
  });
}

/**
 * 단계별 확인 (여러 단계 작업)
 */
export class StepConfirmation {
  constructor(steps) {
    this.steps = steps;
    this.currentStep = 0;
    this.completedSteps = [];
  }

  /**
   * 다음 단계 확인
   */
  async confirmNext() {
    if (this.currentStep >= this.steps.length) {
      return { done: true };
    }

    const step = this.steps[this.currentStep];

    console.log(`\n📌 단계 ${this.currentStep + 1}/${this.steps.length}: ${step.name}`);

    if (step.description) {
      console.log(`   ${step.description}`);
    }

    const confirmed = await confirm('이 단계를 실행하시겠습니까?');

    if (!confirmed) {
      return { done: false, skipped: true, step };
    }

    try {
      const result = await step.action();
      this.completedSteps.push({ step, result });
      this.currentStep++;

      return { done: false, success: true, step, result };
    } catch (error) {
      return { done: false, success: false, step, error: error.message };
    }
  }

  /**
   * 모든 단계 실행
   */
  async runAll() {
    const results = [];

    while (this.currentStep < this.steps.length) {
      const result = await this.confirmNext();
      results.push(result);

      if (result.skipped || !result.success) {
        break;
      }
    }

    return {
      completed: this.currentStep,
      total: this.steps.length,
      results
    };
  }
}

export default {
  confirm,
  confirmAction,
  withConfirmation,
  selectItems,
  StepConfirmation
};
