/**
 * 증거 로깅 시스템
 *
 * 모든 자동화 작업의 증거를 기록
 * - 스크린샷 저장
 * - 상세 로그 기록
 * - 작업 타임라인 생성
 */

import { mkdir, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class EvidenceLogger {
  constructor(options = {}) {
    this.sessionId = options.sessionId || this.generateSessionId();
    this.skillName = options.skillName || 'unknown';
    this.basePath = join(__dirname, '../output');
    this.entries = [];
    this.startTime = new Date();
  }

  /**
   * 세션 ID 생성
   */
  generateSessionId() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const random = Math.random().toString(36).substring(2, 8);
    return `${timestamp}-${random}`;
  }

  /**
   * 세션 폴더 경로
   */
  getSessionPath() {
    return join(this.basePath, 'sessions', this.sessionId);
  }

  /**
   * 로그 항목 추가
   */
  async log(type, message, data = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      elapsed: Date.now() - this.startTime.getTime(),
      type,
      message,
      data
    };

    this.entries.push(entry);

    // 콘솔 출력
    const typeEmoji = {
      info: 'ℹ️',
      action: '▶️',
      success: '✅',
      error: '❌',
      warning: '⚠️',
      screenshot: '📸'
    };

    console.log(`${typeEmoji[type] || '📝'} [${entry.elapsed}ms] ${message}`);

    return entry;
  }

  /**
   * 스크린샷 저장
   */
  async screenshot(page, name, options = {}) {
    const sessionPath = this.getSessionPath();
    const screenshotPath = join(sessionPath, 'screenshots');
    await mkdir(screenshotPath, { recursive: true });

    const filename = `${this.entries.length.toString().padStart(3, '0')}_${name}.png`;
    const filepath = join(screenshotPath, filename);

    await page.screenshot({
      path: filepath,
      fullPage: options.fullPage ?? true
    });

    await this.log('screenshot', `스크린샷 저장: ${name}`, {
      filename,
      fullPage: options.fullPage ?? true
    });

    return filepath;
  }

  /**
   * 액션 시작 기록
   */
  async startAction(actionName, data = {}) {
    return await this.log('action', `시작: ${actionName}`, {
      ...data,
      status: 'started'
    });
  }

  /**
   * 액션 완료 기록
   */
  async endAction(actionName, result = {}) {
    return await this.log('success', `완료: ${actionName}`, {
      ...result,
      status: 'completed'
    });
  }

  /**
   * 에러 기록
   */
  async logError(error, context = {}) {
    return await this.log('error', `에러: ${error.message}`, {
      ...context,
      errorMessage: error.message,
      errorStack: error.stack
    });
  }

  /**
   * 세션 요약 생성
   */
  getSummary() {
    const endTime = new Date();
    const duration = endTime.getTime() - this.startTime.getTime();

    const summary = {
      sessionId: this.sessionId,
      skillName: this.skillName,
      startTime: this.startTime.toISOString(),
      endTime: endTime.toISOString(),
      durationMs: duration,
      durationFormatted: this.formatDuration(duration),
      totalEntries: this.entries.length,
      entriesByType: {},
      hasErrors: false
    };

    for (const entry of this.entries) {
      summary.entriesByType[entry.type] = (summary.entriesByType[entry.type] || 0) + 1;
      if (entry.type === 'error') {
        summary.hasErrors = true;
      }
    }

    return summary;
  }

  /**
   * 시간 포맷팅
   */
  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes > 0) {
      return `${minutes}분 ${remainingSeconds}초`;
    }
    return `${seconds}초`;
  }

  /**
   * 전체 로그 저장
   */
  async save() {
    const sessionPath = this.getSessionPath();
    await mkdir(sessionPath, { recursive: true });

    const summary = this.getSummary();

    // 요약 저장
    const summaryPath = join(sessionPath, 'summary.json');
    await writeFile(summaryPath, JSON.stringify(summary, null, 2));

    // 전체 로그 저장
    const logPath = join(sessionPath, 'log.json');
    await writeFile(logPath, JSON.stringify({
      summary,
      entries: this.entries
    }, null, 2));

    // 타임라인 (읽기 쉬운 형식)
    const timelinePath = join(sessionPath, 'timeline.txt');
    const timeline = this.entries.map(e => {
      const time = new Date(e.timestamp).toLocaleTimeString();
      return `[${time}] [${e.type.toUpperCase()}] ${e.message}`;
    }).join('\n');

    await writeFile(timelinePath, `세션: ${this.sessionId}\n시작: ${this.startTime}\n\n${timeline}`);

    console.log(`\n💾 증거 로그 저장: ${sessionPath}`);

    return {
      sessionPath,
      files: ['summary.json', 'log.json', 'timeline.txt']
    };
  }

  /**
   * 요약 출력
   */
  printSummary() {
    const summary = this.getSummary();

    console.log('\n📊 작업 요약:');
    console.log(`  세션 ID: ${summary.sessionId}`);
    console.log(`  실행 시간: ${summary.durationFormatted}`);
    console.log(`  총 기록: ${summary.totalEntries}건`);

    if (summary.hasErrors) {
      console.log('  ⚠️ 에러 발생');
    } else {
      console.log('  ✅ 정상 완료');
    }

    return summary;
  }
}

/**
 * 증거 로깅 데코레이터
 */
export function withEvidenceLogging(skillName) {
  return function(target, propertyKey, descriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function(...args) {
      const logger = new EvidenceLogger({ skillName });

      try {
        await logger.startAction(propertyKey);
        const result = await originalMethod.apply(this, [...args, logger]);
        await logger.endAction(propertyKey, { result });
        return result;
      } catch (error) {
        await logger.logError(error, { method: propertyKey });
        throw error;
      } finally {
        await logger.save();
        logger.printSummary();
      }
    };

    return descriptor;
  };
}

export default { EvidenceLogger, withEvidenceLogging };
