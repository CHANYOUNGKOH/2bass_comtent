#!/usr/bin/env node
/**
 * build-publish-package.js
 * 발행 패키지 빌드: publish-ready/ 에 오프라인 대시보드 + 포스트 HTML + 이미지 + 서버 파일 생성
 *
 * Usage:
 *   node scripts/build-publish-package.js              # publish-ready/ 에 빌드
 *   node scripts/build-publish-package.js --zip         # + ZIP 생성
 *   node scripts/build-publish-package.js --out=경로    # 출력 디렉토리 지정
 *   node scripts/build-publish-package.js --full        # 프로젝트 전체 ZIP (PDF 제외)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

// ── naver-blog-publish-html.js에서 함수 import ──
import {
  buildIndexHtml,
  buildPostHtml,
  scanPosts,
  absImgDir,
  V2_DIR,
} from './naver-blog-publish-html.js';

// ── Args parsing ──
const args = process.argv.slice(2);
const zipMode = args.includes('--zip');
const outArg = args.find(a => a.startsWith('--out='));
const OUT_DIR = outArg ? path.resolve(outArg.slice(6)) : path.join(ROOT, 'publish-ready');

const IMAGES_SRC = path.join(ROOT, 'output', 'images');
const ASSETS_SRC = path.join(ROOT, 'assets');

// ── Helpers ──
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function cleanDir(dir, keep = []) {
  if (!fs.existsSync(dir)) return;
  const keepSet = new Set(keep.map(f => f.toLowerCase()));
  for (const f of fs.readdirSync(dir)) {
    if (keepSet.has(f.toLowerCase())) continue;
    const fp = path.join(dir, f);
    const stat = fs.statSync(fp);
    if (stat.isDirectory()) {
      fs.rmSync(fp, { recursive: true, force: true });
    } else {
      fs.unlinkSync(fp);
    }
  }
}

function copyDirRecursive(src, dest) {
  ensureDir(dest);
  for (const entry of fs.readdirSync(src)) {
    const srcPath = path.join(src, entry);
    const destPath = path.join(dest, entry);
    const stat = fs.statSync(srcPath);
    if (stat.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function copyFile(src, dest) {
  if (fs.existsSync(src)) {
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
    return true;
  }
  return false;
}

// ── 절대경로 → 상대경로 치환 ──
function fixAbsolutePaths(html) {
  // Windows 절대경로 패턴들
  const rootEscaped = ROOT.replace(/\\/g, '\\\\');
  const rootForward = ROOT.replace(/\\/g, '/');

  // output\images\ → ../images/
  const patterns = [
    // 이스케이프된 백슬래시 (JSON/JS 내)
    { find: rootEscaped + '\\\\output\\\\images\\\\', replace: '../images/' },
    { find: rootEscaped + '\\\\output\\\\images', replace: '../images' },
    { find: rootEscaped + '\\\\assets\\\\', replace: '../assets/' },
    { find: rootEscaped + '\\\\assets', replace: '../assets' },
    // 일반 백슬래시
    { find: ROOT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\\\output\\\\images\\\\', replace: '../images/' },
    // Forward slash 버전
    { find: rootForward + '/output/images/', replace: '../images/' },
    { find: rootForward + '/output/images', replace: '../images' },
    { find: rootForward + '/assets/', replace: '../assets/' },
    { find: rootForward + '/assets', replace: '../assets' },
  ];

  for (const p of patterns) {
    html = html.split(p.find).join(p.replace);
  }

  // 추가: 남은 Windows 절대경로 정리 (C:\Users\...\output\images\)
  html = html.replace(/C:\\\\Users\\\\[^"']*?\\\\output\\\\images\\\\/gi, '../images/');
  html = html.replace(/C:\\\\Users\\\\[^"']*?\\\\assets\\\\/gi, '../assets/');
  html = html.replace(/C:\/Users\/[^"']*?\/output\/images\//gi, '../images/');
  html = html.replace(/C:\/Users\/[^"']*?\/assets\//gi, '../assets/');

  return html;
}

// ── Main build ──
async function build() {
  console.log('=== 발행 패키지 빌드 시작 ===');
  console.log(`출력 디렉토리: ${OUT_DIR}`);

  // 1. 디렉토리 초기화 (manifest.json 보존)
  console.log('\n[1/8] 디렉토리 초기화...');
  ensureDir(OUT_DIR);
  cleanDir(path.join(OUT_DIR, 'html'));
  cleanDir(path.join(OUT_DIR, 'images'));
  cleanDir(path.join(OUT_DIR, 'assets'));

  // 2. 포스트 스캔 + HTML 생성
  console.log('[2/8] 포스트 스캔...');
  const { posts, blog2Map } = scanPosts();
  const allPostIds = posts.map(p => p.postId);
  console.log(`  ${posts.length}개 포스트 발견`);

  // 대시보드 데이터 행 생성 (EMBEDDED_DATA용)
  // manual-server.js의 scanDashboardData()와 동일한 형태
  const SSOT_DIR = path.join(ROOT, 'data', 'ssot-posts');
  const STATUS_FILE = path.join(ROOT, 'data', 'publish', 'naver-v2-status.json');
  const status = fs.existsSync(STATUS_FILE)
    ? JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'))
    : { posts: {} };

  const META_DIR = path.join(ROOT, 'data/publish/meta');
  const DAANGN_DIR = path.join(ROOT, 'data/publish/daangn');
  const v2Set = new Set();
  if (fs.existsSync(V2_DIR)) {
    fs.readdirSync(V2_DIR)
      .filter(f => f.endsWith('.json') && !f.startsWith('_'))
      .forEach(f => v2Set.add(f.replace('.json', '').replace('_blog2', '')));
  }
  const metaSet = new Set();
  const daangnSet = new Set();
  if (fs.existsSync(META_DIR)) {
    fs.readdirSync(META_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'))
      .forEach(f => metaSet.add(f.replace('.json', '')));
  }
  if (fs.existsSync(DAANGN_DIR)) {
    fs.readdirSync(DAANGN_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'))
      .forEach(f => daangnSet.add(f.replace('.json', '')));
  }

  const embeddedRows = [];
  const ssotFiles = fs.readdirSync(SSOT_DIR)
    .filter(f => f.endsWith('.json') && !f.startsWith('_'))
    .sort();

  for (const f of ssotFiles) {
    try {
      const ssot = JSON.parse(fs.readFileSync(path.join(SSOT_DIR, f), 'utf8'));
      if (ssot.isNotice) continue;
      const postId = ssot.postId;
      const brand = (ssot.vehicle && ssot.vehicle.brand) || '';
      const model = (ssot.vehicle && ssot.vehicle.model) || '';
      const workType = String((ssot.work && ssot.work.type) || '');
      const imgCount = (ssot.images && ssot.images.count) || 0;
      const videoCount = (ssot.images && ssot.images.videos && ssot.images.videos.length) || 0;
      const dateRaw = ssot.publishedAt || ssot.createdAt || '';
      const date = dateRaw ? dateRaw.slice(0, 10).replace(/\//g, '-') : '';

      // 이미지 추출 상태
      const imgDir = path.join(IMAGES_SRC, postId);
      let imgExtracted = 0;
      if (fs.existsSync(imgDir)) {
        imgExtracted = fs.readdirSync(imgDir).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f)).length;
      }

      // Naver 상태
      let b1 = 'none', b2 = 'none';
      const blog1Exists = v2Set.has(postId);
      const blog2Exists = fs.existsSync(path.join(V2_DIR, `${postId}_blog2.json`));
      if (blog1Exists) {
        const st = status.posts[postId];
        if (st && st.blog1) b1 = st.blog1.status || 'generated';
        else if (st && st.status) b1 = st.status;
        else b1 = 'generated';
      }
      if (blog2Exists) {
        const st = status.posts[postId];
        b2 = (st && st.blog2?.status === 'published') ? 'published' : 'generated';
      }

      embeddedRows.push({
        id: postId, brand, model, work: workType,
        img: imgCount, imgExtracted, vid: videoCount,
        warn: 0, date, priority: 0,
        b1, b2,
        meta: metaSet.has(postId) ? 'generated' : 'none',
        daangn: daangnSet.has(postId) ? 'generated' : 'none',
        video: null,
      });
    } catch { /* skip */ }
  }

  // 3. 대시보드 HTML 생성 (EMBEDDED_DATA 포함)
  console.log('[3/8] 대시보드 HTML 생성 (EMBEDDED_DATA 포함)...');
  let indexHtml = buildIndexHtml(embeddedRows, { embeddedData: embeddedRows });
  indexHtml = fixAbsolutePaths(indexHtml);
  ensureDir(path.join(OUT_DIR, 'html'));
  fs.writeFileSync(path.join(OUT_DIR, '_index.html'), indexHtml, 'utf8');
  console.log(`  ${embeddedRows.length}개 행 임베드됨`);

  // 4. 개별 포스트 HTML 생성
  console.log('[4/8] 포스트 HTML 생성...');
  const htmlDir = path.join(OUT_DIR, 'html');
  ensureDir(htmlDir);
  let htmlCount = 0;
  const usedPostIds = new Set();
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    const blog2Post = blog2Map[post.postId] || null;
    let html = buildPostHtml(post, allPostIds, i, blog2Post);
    html = fixAbsolutePaths(html);
    fs.writeFileSync(path.join(htmlDir, `${post.postId}.html`), html, 'utf8');
    usedPostIds.add(post.postId);
    htmlCount++;
  }
  console.log(`  ${htmlCount}개 포스트 HTML`);

  // 5. 이미지 복사 (사용된 postId만)
  console.log('[5/8] 이미지 복사...');
  let imgCopied = 0;
  for (const postId of usedPostIds) {
    const srcDir = path.join(IMAGES_SRC, postId);
    if (!fs.existsSync(srcDir)) continue;
    const destDir = path.join(OUT_DIR, 'images', postId);
    copyDirRecursive(srcDir, destDir);
    imgCopied++;
  }
  console.log(`  ${imgCopied}개 포스트 이미지 디렉토리`);

  // 6. 에셋 복사
  console.log('[6/8] 에셋 복사...');
  if (fs.existsSync(ASSETS_SRC)) {
    copyDirRecursive(ASSETS_SRC, path.join(OUT_DIR, 'assets'));
  }

  // 7. 서버 파일 복사 + env.config 템플릿
  console.log('[7/8] 서버 파일 복사...');
  copyFile(path.join(ROOT, 'scripts', 'manual-server.js'), path.join(OUT_DIR, 'server.js'));

  // start-dashboard.bat (패키지용 — 최소 ASCII, BOM 없음, 한글 없음)
  const batLines = [
    '@echo off',
    'cd /d "%~dp0"',
    'if exist "node\\node.exe" (set "PATH=%~dp0node;%PATH%")',
    'where node >nul 2>&1',
    'if errorlevel 1 (',
    '    echo Node.js not found. Install from https://nodejs.org/',
    '    pause',
    '    exit /b 1',
    ')',
    'node bootstrap.js',
    'if errorlevel 1 (pause)',
  ];
  const batContent = batLines.join('\r\n') + '\r\n';
  fs.writeFileSync(path.join(OUT_DIR, 'start-dashboard.bat'), batContent, 'utf8');

  // bootstrap.js (패키지용 — 모든 시작 로직)
  copyFile(path.join(ROOT, 'scripts', 'bootstrap.js'), path.join(OUT_DIR, 'bootstrap.js'));

  // _content-shared.js (manual-server.js가 import)
  copyFile(path.join(ROOT, 'scripts', '_content-shared.js'), path.join(OUT_DIR, '_content-shared.js'));

  // package.json (npm install 용)
  const pkgSrc = path.join(ROOT, 'package.json');
  if (fs.existsSync(pkgSrc)) {
    const pkg = JSON.parse(fs.readFileSync(pkgSrc, 'utf8'));
    const minPkg = {
      name: pkg.name || 'publish-package',
      version: pkg.version || '1.0.0',
      type: 'module',
      dependencies: pkg.dependencies || {},
    };
    fs.writeFileSync(path.join(OUT_DIR, 'package.json'), JSON.stringify(minPkg, null, 2), 'utf8');
  }

  // env.config 템플릿
  const envTemplate = `# ━━━ Claude AI 블로그 생성용 ━━━
# 방법1: Claude Code CLI 설치 (구독) → 자동 감지
# 방법2: API Key 직접 입력 (대시보드 설정 페이지에서도 입력 가능)
ANTHROPIC_API_KEY=

# ━━━ 네이버 검색광고 API (키워드 검색량) ━━━
# 투베이스 기본값 — 직접 발급 시 아래 교체
# 발급: 네이버 검색광고 센터 (searchad.naver.com) → 도구 → API 관리
NAVER_AD_CUSTOMER_ID=1418388
NAVER_AD_API_KEY=0100000000b5267306fe5b6cc7d79001ac6a36ea2b303868335c7e3e32ce2d85eb43c7ee22
NAVER_AD_SECRET_KEY=AQAAAAC1JnMG/ltsx9eQAaxqNuor82A6PpRiorEL78qa1ML85A==

# ━━━ 네이버 데이터랩 API (검색어 트렌드) ━━━
# 투베이스 기본값 — 직접 발급 시 아래 교체
# 발급: developers.naver.com → 애플리케이션 등록 후 Client ID/Secret 발급
NAVER_DATALAB_CLIENT_ID=S52JnQm6sS0WRsM64aRQ
NAVER_DATALAB_CLIENT_SECRET=oQAPfj_c7Z
`;
  const envDest = path.join(OUT_DIR, 'env.config');
  if (!fs.existsSync(envDest)) {
    fs.writeFileSync(envDest, envTemplate, 'utf8');
    console.log('  env.config 템플릿 생성');
  } else {
    console.log('  env.config 이미 존재 — 보존');
  }

  // 매니페스트 생성
  const today = new Date().toISOString().slice(0, 10);
  const manifest = {
    version: today,
    postCount: posts.length,
    embeddedRows: embeddedRows.length,
    platforms: ['naver'],
    builtAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  console.log('[8/8] 매니페스트 생성 완료');
  console.log(`\n=== 빌드 완료 ===`);
  console.log(`  포스트: ${posts.length}개`);
  console.log(`  HTML: ${htmlCount}개`);
  console.log(`  이미지: ${imgCopied}개 디렉토리`);
  console.log(`  출력: ${OUT_DIR}`);

  // --zip 옵션
  if (zipMode) {
    console.log('\nZIP 생성 중...');
    const zipName = `투베이스_블로그_발행패키지_v${today}.zip`;
    const zipPath = path.join(path.dirname(OUT_DIR), zipName);
    try {
      // 임시 ASCII 파일명으로 생성 후 rename (한글 파일명 인코딩 이슈 우회)
      const tmpZip = path.join(path.dirname(OUT_DIR), `_publish_package_${today}.zip`);
      if (fs.existsSync(tmpZip)) fs.unlinkSync(tmpZip);
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
      // .NET ZipFile 직접 사용 (Compress-Archive BinaryReader 버그 우회)
      const psCmd = `Add-Type -Assembly 'System.IO.Compression.FileSystem'; [System.IO.Compression.ZipFile]::CreateFromDirectory('${OUT_DIR}', '${tmpZip}')`;
      execSync(`powershell -NoProfile -Command "${psCmd}"`, { stdio: 'inherit', timeout: 120000 });
      fs.renameSync(tmpZip, zipPath);
      if (fs.existsSync(zipPath)) {
        const sizeMB = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1);
        console.log(`ZIP: ${zipPath} (${sizeMB} MB)`);
      } else {
        console.log('ZIP 파일 생성 확인 필요: ' + zipPath);
      }
    } catch (e) {
      console.error('ZIP 생성 실패:', e.message);
      console.log('수동으로 ZIP 하세요: ' + OUT_DIR);
    }
  }
}

// ── --full 모드: 필요한 파일만 스테이징 → ZIP ──
async function buildFull() {
  console.log('=== 프로젝트 배포 ZIP 생성 ===\n');

  const today = new Date().toISOString().slice(0, 10);
  const zipName = `투베이스_프로젝트_v${today}.zip`;
  const zipPath = path.join(ROOT, '..', zipName);
  const tmpZip = path.join(ROOT, '..', `_project_${today}.zip`);
  const stageDir = path.join(ROOT, '..', '_project_stage');

  // 스테이징 디렉토리 초기화
  if (fs.existsSync(stageDir)) fs.rmSync(stageDir, { recursive: true, force: true });
  ensureDir(stageDir);

  // 포함할 항목 정의
  const includes = [
    // 핵심 데이터
    'data/ssot-posts',
    'data/publish',
    'data/content/dedup',   // posts-unique.json (이미지 추출 시 PDF↔postId 매핑)
    // 이미지
    'output/images',
    'output/naver-blog-analytics',
    // 에셋
    'assets',
    // 스크립트
    'scripts',
    'docs',
  ];

  // 루트 파일
  const rootFiles = [
    'package.json',
    'env.config',
    'start-dashboard.bat',
    'run-generate-blog.bat',
    'fix-paths.cjs',
  ];

  // 복사
  let totalMB = 0;
  for (const inc of includes) {
    const src = path.join(ROOT, inc);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(stageDir, inc);
    console.log(`  [복사] ${inc}`);
    copyDirRecursive(src, dest);
  }
  for (const f of rootFiles) {
    const src = path.join(ROOT, f);
    if (!fs.existsSync(src)) continue;
    if (f === 'package.json') {
      // 수신자에게 필요한 의존성만 포함 (playwright/MCP 등 제외)
      const pkg = JSON.parse(fs.readFileSync(src, 'utf8'));
      const essentialDeps = {
        '@anthropic-ai/sdk': pkg.dependencies['@anthropic-ai/sdk'],
        '@napi-rs/canvas': pkg.dependencies['@napi-rs/canvas'],
        'pdfjs-dist': pkg.dependencies['pdfjs-dist'],
        'xlsx': pkg.dependencies['xlsx'],
      };
      const filteredPkg = {
        name: pkg.name || 'playwright-mcp-ecommerce',
        version: pkg.version || '1.0.0',
        type: 'module',
        dependencies: essentialDeps,
      };
      fs.writeFileSync(path.join(stageDir, f), JSON.stringify(filteredPkg, null, 2), 'utf8');
      console.log('  [OK] package.json 필터링 (playwright/MCP/dotenv/js-yaml 제외)');
    } else {
      fs.copyFileSync(src, path.join(stageDir, f));
    }
  }

  // data/work 빈 폴더 생성 + 키워드 캐시 복사
  const workDir = path.join(stageDir, 'data', 'work');
  ensureDir(workDir);
  const kvSrc = path.join(ROOT, 'data/work/keyword-volume-cache.json');
  if (fs.existsSync(kvSrc)) {
    fs.copyFileSync(kvSrc, path.join(workDir, 'keyword-volume-cache.json'));
    console.log('  [OK] keyword-volume-cache.json 복사됨');
  }

  // Form/Guide HTML 복사 (서버 FORM_PATHS가 data/publish/naver-v2-html/ 체크)
  const formSrc = path.join(ROOT, 'publish-package/html/new-post-form.html');
  const guideSrc = path.join(ROOT, 'publish-package/html/work-guide.html');
  const htmlDest = path.join(stageDir, 'data/publish/naver-v2-html');
  ensureDir(htmlDest);
  if (fs.existsSync(formSrc)) fs.copyFileSync(formSrc, path.join(htmlDest, 'new-post-form.html'));
  if (fs.existsSync(guideSrc)) fs.copyFileSync(guideSrc, path.join(htmlDest, 'work-guide.html'));
  console.log('  [OK] new-post-form.html, work-guide.html 복사됨');

  // stageDir/data/publish/naver-v2-html/*.html 일괄 절대경로 → 상대경로 치환
  const stagedHtmlDir = path.join(stageDir, 'data/publish/naver-v2-html');
  if (fs.existsSync(stagedHtmlDir)) {
    for (const f of fs.readdirSync(stagedHtmlDir).filter(f => f.endsWith('.html'))) {
      const fp = path.join(stagedHtmlDir, f);
      let html = fs.readFileSync(fp, 'utf8');
      html = fixAbsolutePaths(html);
      fs.writeFileSync(fp, html, 'utf8');
    }
    console.log('  [OK] HTML 절대경로 → 상대경로 치환 완료');
  }

  // output/naver-blog-pdfs 빈 폴더 생성 (PDF 넣을 위치 안내)
  const pdfPlaceholder = path.join(stageDir, 'output', 'naver-blog-pdfs');
  ensureDir(pdfPlaceholder);
  fs.writeFileSync(path.join(pdfPlaceholder, '_여기에_PDF_넣기.txt'),
    'output/naver-blog-pdfs/ 폴더에 PDF 원본 파일을 넣어주세요.\n960개 PDF 파일이 필요합니다.\n', 'utf8');

  // README 안내 파일
  fs.writeFileSync(path.join(stageDir, 'README.txt'), `투베이스 콘텐츠 대시보드
========================

[설치 순서]

1. 이 폴더 전체를 원하는 위치에 압축 해제
2. output\\naver-blog-pdfs\\ 폴더에 PDF 원본 파일 넣기 (별도 전달)
3. start-dashboard.bat 더블클릭 (Node.js 포함됨, 별도 설치 불필요)
   → 최초 실행 시 의존성 자동 설치 (npm install)
   → 브라우저에서 http://localhost:3100 자동 열림

[주요 파일]

start-dashboard.bat    대시보드 서버 시작 (열람/발행 마킹)
run-generate-blog.bat  블로그 생성 (이미지추출/글생성)
env.config             API 키 설정 (네이버/Claude)

[API 키 설정 — env.config]

  1) Claude API Key (블로그 글 생성에 필요)
     - 방법A: Claude Code CLI 설치 (구독) → 자동 감지
     - 방법B: env.config 의 ANTHROPIC_API_KEY= 에 sk-ant-... 키 입력
       또는 대시보드 설정 페이지에서 입력 가능

  2) 네이버 검색광고 API (키워드 검색량 — 기본값 설정됨)
     - NAVER_AD_CUSTOMER_ID / API_KEY / SECRET_KEY
     - 기본값: 투베이스 계정 키 (변경 불필요)
     - 직접 발급 시: searchad.naver.com → 도구 → API 관리

  3) 네이버 데이터랩 API (검색어 트렌드 — 기본값 설정됨)
     - NAVER_DATALAB_CLIENT_ID / CLIENT_SECRET
     - 기본값: 투베이스 계정 키 (변경 불필요)
     - 직접 발급 시: developers.naver.com → 애플리케이션 등록

[블로그 생성]

1. start-dashboard.bat으로 대시보드 열기
2. 포스트 선택 → 네이버 생성 버튼
   또는 run-generate-blog.bat으로 배치 생성

[문의]
투베이스 담당자에게 연락
`, 'utf8');

  // ── Portable Node.js 번들 ──
  const NODE_VERSION = 'v20.18.0';
  const NODE_ZIP_URL = `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-win-x64.zip`;
  const nodeDir = path.join(stageDir, 'node');

  if (!fs.existsSync(nodeDir)) {
    console.log(`\n[SETUP] Downloading portable Node.js ${NODE_VERSION}...`);
    const tmpNodeZip = path.join(stageDir, '_node.zip');
    execSync(`powershell -NoProfile -Command "Invoke-WebRequest -Uri '${NODE_ZIP_URL}' -OutFile '${tmpNodeZip}'"`,
      { stdio: 'inherit', timeout: 120000 });
    // 압축 해제 → node-v20.18.0-win-x64/ → node/ 로 rename
    execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${tmpNodeZip}' -DestinationPath '${stageDir}' -Force"`,
      { stdio: 'inherit', timeout: 60000 });
    const extracted = path.join(stageDir, `node-${NODE_VERSION}-win-x64`);
    fs.renameSync(extracted, nodeDir);
    fs.unlinkSync(tmpNodeZip);
    console.log(`  [OK] Portable Node.js bundled → node/`);
  }

  // ── 빌드 검증 ──
  console.log('\n[검증] 핵심 파일 확인...');
  const requiredFiles = [
    'scripts/manual-server.js',
    'scripts/naver-blog-publish-html.js',
    'scripts/_content-shared.js',
    'scripts/bootstrap.js',
    'start-dashboard.bat',
    'package.json',
    'data/publish/naver-v2-html/new-post-form.html',
    'data/publish/naver-v2-html/work-guide.html',
    'data/work/keyword-volume-cache.json',
    'data/content/dedup/posts-unique.json',
  ];
  let verifyOk = true;
  for (const rf of requiredFiles) {
    const fp = path.join(stageDir, rf);
    if (fs.existsSync(fp)) {
      console.log(`  [OK] ${rf}`);
    } else {
      console.log(`  [MISSING] ${rf}`);
      verifyOk = false;
    }
  }
  // ssot-posts 파일 수 검증
  const ssotStaged = path.join(stageDir, 'data', 'ssot-posts');
  if (fs.existsSync(ssotStaged)) {
    const ssotCount = fs.readdirSync(ssotStaged).filter(f => f.endsWith('.json')).length;
    console.log(`  [OK] data/ssot-posts: ${ssotCount}개 JSON`);
    if (ssotCount === 0) {
      console.log(`  [WARN] ssot-posts에 JSON 파일이 없습니다!`);
      verifyOk = false;
    }
  } else {
    console.log(`  [MISSING] data/ssot-posts/`);
    verifyOk = false;
  }
  if (!verifyOk) {
    console.log('\n[WARN] 일부 필수 파일이 누락됨 — 패키지가 정상 동작하지 않을 수 있습니다.');
  }

  // ZIP 생성
  if (fs.existsSync(tmpZip)) fs.unlinkSync(tmpZip);
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

  console.log('\nZIP 압축 중...');
  const psCmd = `Add-Type -Assembly 'System.IO.Compression.FileSystem'; [System.IO.Compression.ZipFile]::CreateFromDirectory('${stageDir}', '${tmpZip}')`;
  try {
    execSync(`powershell -NoProfile -Command "${psCmd}"`, { stdio: 'inherit', timeout: 600000 });
    fs.renameSync(tmpZip, zipPath);
    if (fs.existsSync(zipPath)) {
      const sizeMB = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1);
      console.log(`\n✅ ZIP: ${zipPath} (${sizeMB} MB)`);
    }
  } catch (e) {
    console.error('ZIP 실패:', e.message);
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }

  console.log('\n상대방 전달:');
  console.log('  1. 위 ZIP (코드 + SSOT + 이미지 + Node.js 포함)');
  console.log('  2. output/naver-blog-pdfs/ 에 PDF 960개 별도 전달');
  console.log('  3. start-dashboard.bat 더블클릭 (Node.js 설치 불필요)');
}

const fullMode = args.includes('--full');
if (fullMode) {
  buildFull().catch(e => { console.error('빌드 실패:', e); process.exit(1); });
} else {
  build().catch(e => { console.error('빌드 실패:', e); process.exit(1); });
}
