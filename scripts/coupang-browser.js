/**
 * 쿠팡 브라우저 - Stealth 모드 + Chrome 프로필
 *
 * 사용법:
 *   node scripts/coupang-browser.js
 *   node scripts/coupang-browser.js --save-session
 */

import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Stealth 플러그인 적용
chromium.use(StealthPlugin());

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const saveSession = process.argv.includes('--save-session');

  console.log('🚀 쿠팡 브라우저 시작 (Stealth 모드)...');

  // 방법 1: Stealth + 일반 컨텍스트
  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',  // 실제 Chrome 사용
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--window-size=1920,1080',
    ]
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });

  const page = await context.newPage();

  // webdriver 탐지 우회
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['ko-KR', 'ko', 'en-US', 'en'] });

    // Chrome 속성 추가
    window.chrome = { runtime: {} };

    // permissions 우회
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications' ?
        Promise.resolve({ state: Notification.permission }) :
        originalQuery(parameters)
    );
  });

  console.log('🌐 쿠팡 접속 중...');
  await page.goto('https://www.coupang.com', { waitUntil: 'domcontentloaded' });

  console.log('');
  console.log('='.repeat(50));
  console.log('브라우저가 열렸습니다.');
  console.log('');
  console.log('1. 로그인하세요');
  console.log('2. 마이쿠팡 → 주문목록 이동');
  console.log('3. 배송조회, 문의하기 등 테스트');
  console.log('');
  if (saveSession) {
    console.log('완료 후 터미널에서 Enter를 누르면 세션이 저장됩니다.');
  } else {
    console.log('브라우저를 닫으면 종료됩니다.');
    console.log('세션 저장하려면: node scripts/coupang-browser.js --save-session');
  }
  console.log('='.repeat(50));

  if (saveSession) {
    // Enter 키 대기
    await new Promise(resolve => {
      process.stdin.once('data', resolve);
    });

    // 세션 저장
    const sessionDir = join(__dirname, '../sessions');
    await mkdir(sessionDir, { recursive: true });

    const storage = await context.storageState();
    const sessionPath = join(sessionDir, 'coupang.json');
    await writeFile(sessionPath, JSON.stringify(storage, null, 2));
    console.log(`\n💾 세션 저장: ${sessionPath}`);

    await browser.close();
  } else {
    // 브라우저 닫힐 때까지 대기
    await new Promise(resolve => {
      browser.on('disconnected', resolve);
    });
  }

  console.log('👋 종료');
}

main().catch(console.error);
