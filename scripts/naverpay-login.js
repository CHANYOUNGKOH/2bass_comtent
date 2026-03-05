/**
 * 네이버페이 로그인 + 세션 저장
 * 로그인 후 브라우저 열어둠 (수동 탐색 가능)
 */

import { chromium } from 'playwright';
import { config } from 'dotenv';
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

config();

const __dirname = dirname(fileURLToPath(import.meta.url));
// 구매자용 계정 (소매처 주문 확인, 송장 수집)
const NAVER_ID = process.env.NAVER_BUYER_ID;
const NAVER_PW = process.env.NAVER_BUYER_PW;

async function main() {
  console.log('🚀 네이버페이 로그인 시작...\n');

  const browser = await chromium.launch({
    headless: false,
    slowMo: 100
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  // 네이버 로그인 페이지
  await page.goto('https://nid.naver.com/nidlogin.login');
  console.log('📄 로그인 페이지 로드');

  // 아이디 입력
  await page.getByRole('textbox', { name: '아이디 또는 전화번호' }).fill(NAVER_ID);

  // 비밀번호 입력
  await page.getByRole('textbox', { name: '비밀번호' }).fill(NAVER_PW);

  // 로그인 버튼 클릭
  await page.getByRole('button', { name: '로그인', exact: true }).click();

  // 로그인 완료 대기
  await page.waitForLoadState('networkidle');

  // 캡차/2단계 인증 체크
  const currentUrl = page.url();
  if (currentUrl.includes('nid.naver.com')) {
    console.log('⚠️ 추가 인증 필요 - 브라우저에서 직접 완료해주세요');
    console.log('   완료 후 Enter 키를 누르세요...');

    // 사용자 입력 대기
    await new Promise(resolve => {
      process.stdin.once('data', resolve);
    });
  }

  console.log('✅ 로그인 성공!');

  // 테스트: 네이버페이 주문 페이지 이동
  const testOrderUrl = 'https://orders.pay.naver.com/order/status/2026020914567401';
  console.log(`\n📦 주문 페이지 이동: ${testOrderUrl}`);
  await page.goto(testOrderUrl);
  await page.waitForLoadState('networkidle');

  // 세션 저장
  const sessionDir = join(__dirname, '../sessions');
  await mkdir(sessionDir, { recursive: true });
  const sessionPath = join(sessionDir, 'naverpay.json');

  const storage = await context.storageState();
  await writeFile(sessionPath, JSON.stringify(storage, null, 2));
  console.log(`💾 세션 저장: ${sessionPath}`);

  // 페이지 내용 출력 (디버깅용)
  console.log('\n📋 현재 페이지 제목:', await page.title());
  console.log('📋 현재 URL:', page.url());

  // 브라우저 열어둠 - 수동 탐색 가능
  console.log('\n🔍 브라우저가 열려있습니다. 페이지 구조 확인 후 Ctrl+C로 종료하세요.');

  // 무한 대기 (Ctrl+C로 종료)
  await new Promise(() => {});
}

main().catch(console.error);
