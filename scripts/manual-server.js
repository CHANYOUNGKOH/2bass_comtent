#!/usr/bin/env node
/**
 * manual-server.js
 * 수동 포스트 입력 → SSOT 저장 → 블로그 생성 → 대시보드 갱신 로컬 서버
 *
 * 의존성: node:http, node:fs, node:path, node:child_process (외부 패키지 없음)
 *
 * 사용법:
 *   npm run manual:server          # 기본 포트 3100
 *   PORT=8080 npm run manual:server
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { execSync } from 'node:child_process';
import { normalizeBrand, normalizeModel } from './_content-shared.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const PORT = parseInt(process.env.PORT || '3100', 10);
const ENV_FILE = path.join(ROOT, 'env.config');

// .env 파일 로드 (dotenv 없이 직접)
function loadEnvFile() {
  if (!fs.existsSync(ENV_FILE)) return;
  const lines = fs.readFileSync(ENV_FILE, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnvFile();
// 네이버 API 키 로드 확인
if (process.env.NAVER_AD_CUSTOMER_ID) {
  console.log('[env] NAVER_AD 키 로드됨 (CUSTOMER_ID: ' + process.env.NAVER_AD_CUSTOMER_ID + ')');
} else {
  console.log('[env] NAVER_AD 키 미설정 — .env 파일 확인 필요');
}

const KV_CACHE_PATH = path.join(ROOT, 'data/work/keyword-volume-cache.json');
const SSOT_DIR = path.join(ROOT, 'data/ssot-posts');
const PUBLISH_DIR = path.join(ROOT, 'data/publish/naver-v2');
const HTML_DIR = path.join(ROOT, 'data/publish/naver-v2-html');
const IMAGES_DIR = path.join(ROOT, 'output/images');
const MANIFEST_FILE = path.join(IMAGES_DIR, 'manifest.json');
const STATUS_FILE = path.join(ROOT, 'data/publish/naver-v2-status.json');
const FORM_PATHS = [
  path.join(ROOT, 'docs/new-post-form.html'),
  path.join(ROOT, 'publish-package/html/new-post-form.html'),
  path.join(ROOT, 'publish-ready/html/new-post-form.html'),
  path.join(ROOT, 'data/publish/naver-v2-html/new-post-form.html'),
];
const GUIDE_PATHS = [
  path.join(ROOT, 'docs/work-guide.html'),
  path.join(ROOT, 'publish-package/html/work-guide.html'),
  path.join(ROOT, 'publish-ready/html/work-guide.html'),
  path.join(ROOT, 'data/publish/naver-v2-html/work-guide.html'),
];
const INDEX_HTML = path.join(HTML_DIR, '_index.html');

// ── helpers ──
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function readBodyRaw(req, maxBytes = 50 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const contentLen = parseInt(req.headers['content-length'] || '0', 10);
    if (contentLen > maxBytes) return reject(new Error('요청이 너무 큽니다 (50MB 초과)'));
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > maxBytes) { req.destroy(); return reject(new Error('요청이 너무 큽니다')); }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseMultipart(buf, contentType) {
  const m = contentType.match(/boundary=(?:"([^"]+)"|([^\s;]+))/);
  if (!m) throw new Error('boundary 없음');
  const boundary = '--' + (m[1] || m[2]);
  const parts = [];
  let start = buf.indexOf(boundary) + boundary.length;

  while (true) {
    // skip CRLF after boundary
    if (buf[start] === 0x0d) start += 2;
    else if (buf[start] === 0x0a) start += 1;

    // check for end boundary
    if (buf[start] === 0x2d && buf[start + 1] === 0x2d) break; // '--'

    // find header/body separator (double CRLF)
    const headerEnd = buf.indexOf('\r\n\r\n', start);
    if (headerEnd === -1) break;
    const headerStr = buf.slice(start, headerEnd).toString('utf8');

    const bodyStart = headerEnd + 4;
    const nextBoundary = buf.indexOf(boundary, bodyStart);
    if (nextBoundary === -1) break;
    // body ends 2 bytes before boundary (CRLF)
    let bodyEnd = nextBoundary - 2;
    if (bodyEnd < bodyStart) bodyEnd = bodyStart;

    const body = buf.slice(bodyStart, bodyEnd);

    // parse headers
    const nameMatch = headerStr.match(/name="([^"]+)"/);
    const filenameMatch = headerStr.match(/filename="([^"]+)"/);
    parts.push({
      name: nameMatch ? nameMatch[1] : '',
      filename: filenameMatch ? filenameMatch[1] : null,
      data: body,
    });

    start = nextBoundary + boundary.length;
  }

  const fields = {};
  const files = [];
  for (const p of parts) {
    if (p.filename) {
      files.push({ filename: p.filename, data: p.data });
    } else {
      fields[p.name] = p.data.toString('utf8');
    }
  }
  return { fields, files };
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function runScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const proc = fork(scriptPath, args, {
      cwd: ROOT, silent: true,
    });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(`exit ${code}: ${stderr.slice(0, 300)}`));
      resolve(stdout);
    });
    proc.on('error', reject);
  });
}

// ── server mode script injection ──
function getFormHtml() {
  // Find first existing form file
  const formPath = FORM_PATHS.find(p => fs.existsSync(p));
  if (!formPath) return null;
  let html = fs.readFileSync(formPath, 'utf8');

  // Inject server-mode flag before </body>
  const serverScript = `\n<script>window.__SERVER_MODE__ = true;</script>`;
  html = html.replace('</body>', serverScript + '\n</body>');
  return html;
}

// ── static file serving for dashboard assets ──
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

function serveStatic(res, filePath) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

// ── scanDashboardData: SSOT 기반 대시보드 데이터 스캔 ──
function loadManifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8')); }
  catch { return {}; }
}

function getImgExtracted(postId, ssot, manifest) {
  // 1. manifest에 done === true → manifest count
  if (manifest[postId]?.done) return manifest[postId].count || 0;
  // 2. SSOT images.dir 설정됨 → 디렉토리 내 jpg/png 카운트
  if (ssot.images?.dir) {
    const dirPath = path.resolve(ROOT, ssot.images.dir);
    try {
      const files = fs.readdirSync(dirPath).filter(f => /\.(jpg|jpeg|png)$/i.test(f));
      return files.length;
    } catch { /* dir 없음 */ }
  }
  // 3. 둘 다 없으면 0
  return 0;
}

function loadKvCache() {
  try {
    if (!fs.existsSync(KV_CACHE_PATH)) return {};
    const raw = JSON.parse(fs.readFileSync(KV_CACHE_PATH, 'utf8'));
    return raw.keywords || {};
  } catch { return {}; }
}

function calcPriority(ssot, kwMap) {
  const w = ssot.work || {};
  const v = ssot.vehicle || {};
  const parts = (w.parts || []).join(' ').replace(/\s/g, '').toLowerCase();
  const wtype = (w.type || '').replace(/\s/g, '').toLowerCase();
  const model = (v.model || '').replace(/\s/g, '').toLowerCase();
  const brand = (v.brand || '').replace(/\s/g, '').toLowerCase();
  const symptomRaw = ssot.consumer?.directDemand?.symptom;
  const symptom = (Array.isArray(symptomRaw) ? symptomRaw.join(' ') : (symptomRaw || '')).replace(/\s/g, '').toLowerCase();
  const searchText = `${parts} ${wtype} ${model} ${brand} ${symptom}`;

  let score = 0;
  // 캐시 키워드 매칭 (볼륨 × 경쟁도 보정 × 트렌드 보정)
  for (const [kw, data] of Object.entries(kwMap)) {
    const kwLow = kw.toLowerCase();
    if (searchText.includes(kwLow)) {
      const vol = data.total || 0;
      const comp = { '높음': 0.7, '중간': 1.0, '낮음': 1.3 }[data.comp] || 1.0;
      const rawTrend = data.trend || 1.0;
      const trend = Math.min(1.3, Math.max(0.7, rawTrend)); // clamp 0.7~1.3
      score += vol * comp * trend;
    }
  }
  // 범용 부품 키워드 매칭 (캐시에 없어도 기본 점수)
  if (/브레이크|brake/i.test(searchText)) score += 100;
  if (/캘리퍼|caliper|펠라|4p|6p|피스톤/i.test(searchText)) score += 150;
  if (/브렘보|brembo/i.test(searchText)) score += 200;
  if (/디스크|disc|로터|rotor/i.test(searchText)) score += 100;
  if (/패드|pad/i.test(searchText)) score += 80;
  if (/연마/i.test(searchText)) score += 50;
  if (/허브링|허브익스텐더|허브연장|허브스페이서/i.test(searchText)) score += 40;
  if (/확장킷|확장셋|리어확장/i.test(searchText)) score += 60;
  if (/호스|라인|파이프/i.test(searchText)) score += 30;
  // 증상 보너스
  if (/떨림|소음|밀림|쏠림|편마모/.test(searchText)) score += 300;
  // 인기 차종 보너스
  if (/그랜저|쏘나타|k5|k7|스포티지|투싼|싼타페|팰리세이드|카니발/.test(model)) score += 200;
  if (/bmw|벤츠|아우디|제네시스/.test(brand)) score += 250;
  return Math.round(score);
}

function scanDashboardData() {
  const status = fs.existsSync(STATUS_FILE)
    ? JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'))
    : { posts: {} };

  const manifest = loadManifest();
  const kwMap = loadKvCache();

  const ssotFiles = fs.readdirSync(SSOT_DIR)
    .filter(f => f.endsWith('.json') && !f.startsWith('_'))
    .sort();

  // Platform publish dirs
  const v2Set = new Set();
  if (fs.existsSync(PUBLISH_DIR)) {
    fs.readdirSync(PUBLISH_DIR)
      .filter(f => f.endsWith('.json') && !f.startsWith('_'))
      .forEach(f => v2Set.add(f.replace('.json', '')));
  }
  const META_DIR = path.join(ROOT, 'data/publish/meta');
  const DAANGN_DIR = path.join(ROOT, 'data/publish/daangn');
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

  const rows = [];
  for (const f of ssotFiles) {
    try {
      const ssot = JSON.parse(fs.readFileSync(path.join(SSOT_DIR, f), 'utf8'));
      const postId = ssot.postId;
      const brand = normalizeBrand((ssot.vehicle && ssot.vehicle.brand) || '');
      const model = normalizeModel((ssot.vehicle && ssot.vehicle.model) || '');
      const workType = String((ssot.work && ssot.work.type) || '');
      const imgCount = (ssot.images && ssot.images.count) || 0;
      const videoCount = (ssot.images && ssot.images.videos && ssot.images.videos.length) || 0;
      const reviewNeeded = ssot.validation && ssot.validation.reviewNeeded;
      const imgExtracted = getImgExtracted(postId, ssot, manifest);

      // 날짜 추출
      const dateRaw = ssot.publishedAt || ssot.createdAt || '';
      const date = dateRaw ? dateRaw.slice(0, 10).replace(/\//g, '-') : '';

      // Naver b1/b2 status
      let blog1Status = 'none';
      let blog2Status = 'none';
      const blog1Exists = v2Set.has(postId);
      const blog2Exists = fs.existsSync(path.join(PUBLISH_DIR, `${postId}_blog2.json`));
      if (blog1Exists) {
        const st = status.posts[postId];
        if (st && st.blog1) {
          blog1Status = st.blog1.status || 'generated';
        } else if (st && st.status) {
          blog1Status = st.status;
        } else {
          blog1Status = 'generated';
        }
      }
      if (blog2Exists) {
        const st = status.posts[postId];
        blog2Status = (st && st.blog2?.status === 'published') ? 'published' : 'generated';
      }

      // 공지/비작업 글은 대시보드에서 숨김
      if (ssot.isNotice) continue;

      const priority = calcPriority(ssot, kwMap);

      rows.push({
        id: postId, brand, model, work: workType,
        img: imgCount, imgExtracted, vid: videoCount,
        warn: reviewNeeded ? 1 : 0,
        date, priority,
        b1: blog1Status, b2: blog2Status,
        meta: metaSet.has(postId) ? 'generated' : 'none',
        daangn: daangnSet.has(postId) ? 'generated' : 'none',
        video: null,
      });
    } catch { /* skip */ }
  }
  return rows;
}

// ── request handler ──
async function handler(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // CORS (local dev)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── GET / → 대시보드 (SERVER_MODE 주입) ──
  if (req.method === 'GET' && pathname === '/') {
    if (fs.existsSync(INDEX_HTML)) {
      let html = fs.readFileSync(INDEX_HTML, 'utf8');
      html = html.replace('</body>', '<script>window.__SERVER_MODE__=true;</script>\n</body>');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } else {
      res.writeHead(500);
      res.end('대시보드 HTML 없음. node scripts/naver-blog-publish-html.js 먼저 실행하세요.');
    }
    return;
  }

  // ── GET /new-post-form.html → form with server-mode injection ──
  if (req.method === 'GET' && pathname === '/new-post-form.html') {
    const html = getFormHtml();
    if (!html) { res.writeHead(500); res.end('Form HTML not found'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // ── GET /work-guide.html → guide with server-mode injection ──
  if (req.method === 'GET' && pathname === '/work-guide.html') {
    const gp = GUIDE_PATHS.find(p => fs.existsSync(p));
    if (!gp) { res.writeHead(404); res.end('Guide HTML not found'); return; }
    let html = fs.readFileSync(gp, 'utf8');
    html = html.replace('</body>', '\n<script>window.__SERVER_MODE__=true;</script>\n</body>');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // ── GET /dashboard → 대시보드 (호환용 리다이렉트) ──
  if (req.method === 'GET' && pathname === '/dashboard') {
    res.writeHead(302, { Location: '/' });
    res.end();
    return;
  }

  // ── GET /api/server-info ──
  if (req.method === 'GET' && pathname === '/api/server-info') {
    json(res, 200, { server: true, version: '1.0' });
    return;
  }

  // ── GET /api/test-credit — API 크레딧 테스트 (여러 모델 시도) ──
  if (req.method === 'GET' && pathname === '/api/test-credit') {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic();
    const candidates = [
      'claude-sonnet-4-6-latest',
      'claude-sonnet-4-6',
      'claude-sonnet-4-5-20250514',
      'claude-3-7-sonnet-latest',
      'claude-3-5-sonnet-20241022',
      'claude-3-5-sonnet-latest',
    ];
    const results = [];
    for (const m of candidates) {
      try {
        const r = await client.messages.create({
          model: m, max_tokens: 5,
          messages: [{ role: 'user', content: 'say ok' }],
        });
        results.push({ model: m, ok: true, response: r.content[0]?.text });
        break; // 성공하면 중단
      } catch (e) {
        results.push({ model: m, ok: false, status: e.status, error: e.message?.slice(0, 100) });
      }
    }
    json(res, 200, { results });
    return;
  }

  // ── GET /api/auth-status — Claude 인증 상태 확인 ──
  if (req.method === 'GET' && pathname === '/api/auth-status') {
    const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
    let cliInstalled = false;
    try {
      execSync('claude --version', { stdio: 'pipe', timeout: 5000 });
      cliInstalled = true;
    } catch { /* not available */ }
    const cliDisabled = process.env.__CLI_AUTH_DISABLED === '1';
    const hasCliAuth = cliInstalled && !cliDisabled;

    const mode = hasApiKey ? 'api_key' : hasCliAuth ? 'cli' : 'none';
    const keyPreview = hasApiKey
      ? process.env.ANTHROPIC_API_KEY.slice(0, 10) + '...' + process.env.ANTHROPIC_API_KEY.slice(-4)
      : null;

    json(res, 200, {
      authenticated: mode !== 'none',
      mode,
      keyPreview,
      cliInstalled,
      cliDisabled,
      model: process.env.BLOG_MODEL || 'sonnet',
    });
    return;
  }

  // ── POST /api/disconnect-auth — 인증 해제 ──
  if (req.method === 'POST' && pathname === '/api/disconnect-auth') {
    try {
      const body = await readBody(req);
      const { target } = JSON.parse(body); // 'cli' | 'api_key'

      if (target === 'cli') {
        process.env.__CLI_AUTH_DISABLED = '1';
        console.log('[auth] Claude CLI 인증 비활성화');
        json(res, 200, { ok: true, message: 'Claude CLI 인증이 비활성화되었습니다' });
      } else if (target === 'api_key') {
        delete process.env.ANTHROPIC_API_KEY;
        // .env에서도 제거
        if (fs.existsSync(ENV_FILE)) {
          const lines = fs.readFileSync(ENV_FILE, 'utf8').split('\n');
          const filtered = lines.filter(l => !l.trim().startsWith('ANTHROPIC_API_KEY='));
          const content = filtered.join('\n').trim();
          if (content) fs.writeFileSync(ENV_FILE, content + '\n');
          else fs.unlinkSync(ENV_FILE);
        }
        console.log('[auth] API Key 제거됨');
        json(res, 200, { ok: true, message: 'API Key가 제거되었습니다' });
      } else {
        json(res, 400, { error: 'target은 cli 또는 api_key여야 합니다' });
      }
    } catch (e) {
      json(res, 500, { error: e.message });
    }
    return;
  }

  // ── POST /api/reconnect-cli — CLI 인증 재활성화 ──
  if (req.method === 'POST' && pathname === '/api/reconnect-cli') {
    delete process.env.__CLI_AUTH_DISABLED;
    console.log('[auth] Claude CLI 인증 재활성화');
    json(res, 200, { ok: true, message: 'Claude CLI 인증이 재활성화되었습니다' });
    return;
  }

  // ── POST /api/set-api-key — API 키 설정 (.env에 저장) ──
  if (req.method === 'POST' && pathname === '/api/set-api-key') {
    try {
      const body = await readBody(req);
      const { apiKey } = JSON.parse(body);
      if (!apiKey || !apiKey.startsWith('sk-ant-')) {
        return json(res, 400, { error: 'API Key는 sk-ant-로 시작해야 합니다' });
      }

      // .env 파일 업데이트 (기존 키 교체 또는 추가)
      let envContent = '';
      if (fs.existsSync(ENV_FILE)) {
        const lines = fs.readFileSync(ENV_FILE, 'utf8').split('\n');
        const filtered = lines.filter(l => !l.trim().startsWith('ANTHROPIC_API_KEY='));
        envContent = filtered.join('\n').trim();
        if (envContent) envContent += '\n';
      }
      envContent += `ANTHROPIC_API_KEY=${apiKey}\n`;
      fs.writeFileSync(ENV_FILE, envContent);

      // 현재 프로세스에도 반영
      process.env.ANTHROPIC_API_KEY = apiKey;

      console.log(`[auth] API Key 설정됨 (${apiKey.slice(0, 10)}...)`);
      json(res, 200, { ok: true, keyPreview: apiKey.slice(0, 10) + '...' + apiKey.slice(-4), note: '글 생성 시 새 API Key가 적용됩니다' });
    } catch (e) {
      json(res, 500, { error: e.message });
    }
    return;
  }

  // ── POST /api/set-naver-keys — 네이버 API 키 설정 (env.config에 저장) ──
  if (req.method === 'POST' && pathname === '/api/set-naver-keys') {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body);
      const keyMap = {
        NAVER_AD_CUSTOMER_ID: data.customerId,
        NAVER_AD_API_KEY: data.apiKey,
        NAVER_AD_SECRET_KEY: data.secretKey,
        NAVER_DATALAB_CLIENT_ID: data.datalabClientId,
        NAVER_DATALAB_CLIENT_SECRET: data.datalabClientSecret,
      };

      // env.config 업데이트
      let envContent = '';
      if (fs.existsSync(ENV_FILE)) {
        envContent = fs.readFileSync(ENV_FILE, 'utf8');
      }
      for (const [envKey, val] of Object.entries(keyMap)) {
        if (val === undefined || val === null) continue;
        const re = new RegExp(`^${envKey}=.*$`, 'm');
        if (re.test(envContent)) {
          envContent = envContent.replace(re, `${envKey}=${val}`);
        } else {
          envContent = envContent.trimEnd() + '\n' + `${envKey}=${val}\n`;
        }
        process.env[envKey] = val;
      }
      fs.writeFileSync(ENV_FILE, envContent);

      console.log('[auth] 네이버 API 키 설정됨');
      json(res, 200, { ok: true, message: '네이버 API 키 저장 완료' });
    } catch (e) {
      json(res, 500, { error: e.message });
    }
    return;
  }

  // ── GET /api/ssot-suggestions — SSOT 기반 자동완성 데이터 ──
  if (req.method === 'GET' && pathname === '/api/ssot-suggestions') {
    try {
      const files = fs.readdirSync(SSOT_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
      const brands = {}, modelsByBrand = {}, workTypes = {}, partsByWork = {}, allParts = {};
      for (const f of files) {
        try {
          const s = JSON.parse(fs.readFileSync(path.join(SSOT_DIR, f), 'utf8'));
          const b = normalizeBrand(s.vehicle?.brand);
          const m = normalizeModel(s.vehicle?.model);
          const w = s.work?.type;
          if (b) {
            brands[b] = (brands[b] || 0) + 1;
            if (m) {
              if (!modelsByBrand[b]) modelsByBrand[b] = {};
              modelsByBrand[b][m] = (modelsByBrand[b][m] || 0) + 1;
            }
          }
          if (w) {
            workTypes[w] = (workTypes[w] || 0) + 1;
            for (const p of (s.work?.parts || [])) {
              allParts[p] = (allParts[p] || 0) + 1;
              if (!partsByWork[w]) partsByWork[w] = {};
              partsByWork[w][p] = (partsByWork[w][p] || 0) + 1;
            }
          }
        } catch { /* skip bad file */ }
      }
      const sortDesc = obj => Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ name: k, count: v }));
      const sortedModels = {};
      for (const [b, ms] of Object.entries(modelsByBrand)) {
        sortedModels[b] = sortDesc(ms).slice(0, 30);
      }
      const sortedPartsByWork = {};
      for (const [w, ps] of Object.entries(partsByWork)) {
        sortedPartsByWork[w] = sortDesc(ps).slice(0, 20);
      }
      json(res, 200, {
        brands: sortDesc(brands),
        modelsByBrand: sortedModels,
        workTypes: sortDesc(workTypes).filter(w => !['공지','휴무','이벤트','마케팅','일상'].includes(w.name)),
        partsByWork: sortedPartsByWork,
        allParts: sortDesc(allParts).slice(0, 50),
      });
    } catch (e) {
      json(res, 500, { error: e.message });
    }
    return;
  }

  // ── GET /api/dashboard-data ──
  if (req.method === 'GET' && pathname === '/api/dashboard-data') {
    try {
      const rows = scanDashboardData();
      json(res, 200, { rows, updatedAt: new Date().toISOString() });
    } catch (e) {
      json(res, 500, { error: e.message });
    }
    return;
  }

  // ── POST /api/extract-images (SSE streaming) ──
  if (req.method === 'POST' && pathname === '/api/extract-images') {
    try {
      const body = await readBody(req);
      const { postId, force } = JSON.parse(body);
      if (!postId) return json(res, 400, { error: 'postId 필수' });

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      function send(type, data) {
        res.write('data: ' + JSON.stringify({ type, ...data }) + '\n\n');
      }

      send('start', { postId });
      console.log(`[extract-images] ${postId} 시작${force ? ' (force)' : ''}`);

      const extractScript = path.join(ROOT, 'scripts/content-extract-images.js');
      const args = ['--postId', postId];
      if (force) args.push('--force');
      const proc = fork(extractScript, args, { cwd: ROOT, silent: true });

      proc.stdout.on('data', d => {
        const msg = d.toString().trim();
        if (msg) send('progress', { message: msg });
      });
      proc.stderr.on('data', d => {
        const msg = d.toString().trim();
        if (msg) send('log', { message: msg });
      });
      proc.on('close', code => {
        if (code !== 0) {
          send('error', { message: `이미지 추출 실패 (exit ${code})` });
        } else {
          // manifest에서 추출 결과 읽기
          const manifest = loadManifest();
          const entry = manifest[postId] || {};
          const extracted = entry.count || 0;
          const expected = entry.expected || 0;
          const incomplete = expected > 0 && extracted < expected;
          send('done', {
            ok: true, postId, count: extracted,
            ...(incomplete && { warning: `${expected}장 중 ${extracted}장만 추출됨 (${expected - extracted}장 누락)` })
          });
          console.log(`[extract-images] ${postId} 완료 (${extracted}장${incomplete ? ` ⚠ 기대:${expected}` : ''})`);
        }
        res.end();
      });
      proc.on('error', err => {
        send('error', { message: err.message });
        res.end();
      });
    } catch (e) {
      if (res.headersSent) {
        res.write('data: ' + JSON.stringify({ type: 'error', message: e.message }) + '\n\n');
        res.end();
      } else {
        json(res, 500, { error: e.message });
      }
    }
    return;
  }

  // ── POST /api/generate (SSE streaming) ──
  if (req.method === 'POST' && pathname === '/api/generate') {
    try {
      const body = await readBody(req);
      const { postId, platform, target } = JSON.parse(body);
      if (!postId) return json(res, 400, { error: 'postId 필수' });
      if (!platform) return json(res, 400, { error: 'platform 필수' });

      // SSE response headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      function send(type, data) {
        res.write('data: ' + JSON.stringify({ type, ...data }) + '\n\n');
      }

      send('start', { postId, target });
      console.log(`[generate] ${postId} / ${platform}${target ? '/' + target : ''} 시작`);

      if (platform !== 'naver') {
        send('error', { message: `지원하지 않는 플랫폼: ${platform}. 현재 naver만 가능` });
        res.end();
        return;
      }

      const b1File = path.join(PUBLISH_DIR, `${postId}.json`);
      const b2File = path.join(PUBLISH_DIR, `${postId}_blog2.json`);
      const needB1 = !fs.existsSync(b1File);
      const needB2 = !fs.existsSync(b2File);
      const genScript = path.join(ROOT, 'scripts/content-generate-naver-blog.js');

      function runScriptSSE(scriptPath, args) {
        return new Promise((resolve, reject) => {
          const proc = fork(scriptPath, args, { cwd: ROOT, silent: true });
          let lastStderr = '';
          proc.stdout.on('data', d => {
            const msg = d.toString().trim();
            if (msg) {
              console.log(`  ┃ ${msg}`);
              send('progress', { message: msg });
            }
          });
          proc.stderr.on('data', d => {
            const msg = d.toString().trim();
            if (msg) {
              lastStderr = msg;
              console.error(`  ┃ ${msg}`);
              send('log', { message: msg });
            }
          });
          proc.on('close', code => {
            if (code !== 0) reject(new Error(`exit ${code}: ${lastStderr}`));
            else resolve();
          });
          proc.on('error', reject);
        });
      }

      // HTML 누락 시 skipped 경로에서도 생성
      async function ensureHtml() {
        const htmlFile = path.join(HTML_DIR, `${postId}.html`);
        if (!fs.existsSync(htmlFile)) {
          console.log(`[generate] HTML 누락 — 생성: ${postId}`);
          send('progress', { message: 'HTML 생성 중...' });
          try {
            await runScriptSSE(path.join(ROOT, 'scripts/naver-blog-publish-html.js'), [postId]);
          } catch (e) {
            console.error(`[generate] HTML 생성 실패:`, e.message);
          }
        }
      }

      if (target === 'b1') {
        if (!needB1) {
          await ensureHtml();
          send('done', { ok: true, postId, target, skipped: true });
          res.end();
          return;
        }
        send('progress', { message: 'Blog1 생성 시작...' });
        await runScriptSSE(genScript, [postId]);
      } else if (target === 'b2') {
        if (!fs.existsSync(b1File)) {
          send('error', { message: 'B1이 먼저 필요합니다' });
          res.end();
          return;
        }
        if (!needB2) {
          await ensureHtml();
          send('done', { ok: true, postId, target, skipped: true });
          res.end();
          return;
        }
        send('progress', { message: 'Blog2 생성 시작...' });
        await runScriptSSE(genScript, [postId, '--blog2']);
      } else {
        if (!needB1 && !needB2) {
          await ensureHtml();
          send('done', { ok: true, postId, skipped: true });
          res.end();
          return;
        }
        if (needB1) {
          send('progress', { message: 'Blog1 생성 시작...' });
          await runScriptSSE(genScript, [postId]);
        }
        if (needB2) {
          send('progress', { message: 'Blog2 생성 시작...' });
          await runScriptSSE(genScript, [postId, '--blog2']);
        }
      }

      // HTML 재생성
      send('progress', { message: 'HTML 생성 중...' });
      let htmlWarning = null;
      try {
        await runScriptSSE(path.join(ROOT, 'scripts/naver-blog-publish-html.js'), [postId]);
      } catch (htmlErr) {
        console.error(`[generate] HTML 생성 실패 (콘텐츠는 성공):`, htmlErr.message);
        htmlWarning = `HTML 생성 실패: ${htmlErr.message}`;
        send('warning', { message: htmlWarning });
      }

      // HTML 파일 존재 여부 직접 검증
      const htmlFile = path.join(HTML_DIR, `${postId}.html`);
      if (!fs.existsSync(htmlFile)) {
        console.error(`[generate] ⚠ HTML 파일 미생성: ${htmlFile}`);
        console.error(`[generate]   blog1 JSON: ${fs.existsSync(path.join(PUBLISH_DIR, `${postId}.json`))}`);
        console.error(`[generate]   blog2 JSON: ${fs.existsSync(path.join(PUBLISH_DIR, `${postId}_blog2.json`))}`);
        // fallback: execSync로 직접 재시도
        try {
          const { execSync: execSyncLocal } = await import('node:child_process');
          execSyncLocal(`node scripts/naver-blog-publish-html.js ${postId}`, { cwd: ROOT, stdio: 'pipe', timeout: 30000 });
          if (fs.existsSync(htmlFile)) {
            console.log(`[generate] ✅ execSync fallback으로 HTML 생성 성공`);
            send('progress', { message: 'HTML 생성 완료 (재시도 성공)' });
          } else {
            htmlWarning = (htmlWarning || '') + ' / execSync fallback도 실패';
            console.error(`[generate] execSync fallback도 HTML 미생성`);
          }
        } catch (fallbackErr) {
          console.error(`[generate] execSync fallback 오류:`, fallbackErr.message);
          htmlWarning = (htmlWarning || '') + ` / fallback: ${fallbackErr.message}`;
        }
      }

      const generated = [];
      if (target === 'b1' || (!target && needB1)) generated.push('b1');
      if (target === 'b2' || (!target && needB2)) generated.push('b2');
      console.log(`[generate] ${postId} / ${platform}${target ? '/' + target : ''} 완료 (generated: ${generated.join(',')})${htmlWarning ? ' ⚠ HTML실패' : ''}`);
      send('done', { ok: true, postId, target, generated, ...(htmlWarning && { warning: htmlWarning }) });
      res.end();
    } catch (e) {
      console.error(`[generate] 실패:`, e.message);
      // If headers already sent (SSE mode), send error event
      if (res.headersSent) {
        res.write('data: ' + JSON.stringify({ type: 'error', message: e.message }) + '\n\n');
        res.end();
      } else {
        json(res, 500, { error: e.message });
      }
    }
    return;
  }

  // ── POST /api/save-ssot ──
  if (req.method === 'POST' && pathname === '/api/save-ssot') {
    try {
      const body = await readBody(req);
      const ssot = JSON.parse(body);
      if (!ssot.postId) return json(res, 400, { error: 'postId 필수' });

      ensureDir(SSOT_DIR);
      const filePath = path.join(SSOT_DIR, `${ssot.postId}.json`);
      fs.writeFileSync(filePath, JSON.stringify(ssot, null, 2));
      console.log(`[save-ssot] ${ssot.postId}`);
      json(res, 200, { ok: true, postId: ssot.postId, path: filePath });
    } catch (e) {
      json(res, 500, { error: e.message });
    }
    return;
  }

  // ── POST /api/save-ssot-with-images ──
  if (req.method === 'POST' && pathname === '/api/save-ssot-with-images') {
    try {
      const raw = await readBodyRaw(req);
      const { fields, files } = parseMultipart(raw, req.headers['content-type'] || '');
      if (!fields.ssot) return json(res, 400, { error: 'ssot 필드 필수' });

      const ssot = JSON.parse(fields.ssot);
      if (!ssot.postId) return json(res, 400, { error: 'postId 필수' });

      // Save images
      const imgDir = path.join(IMAGES_DIR, ssot.postId);
      ensureDir(imgDir);
      for (const f of files) {
        const imgPath = path.join(imgDir, f.filename);
        fs.writeFileSync(imgPath, f.data);
      }

      // Patch SSOT with images.dir
      if (ssot.images) {
        ssot.images.dir = `output/images/${ssot.postId}`;
      }

      // Save SSOT
      ensureDir(SSOT_DIR);
      const filePath = path.join(SSOT_DIR, `${ssot.postId}.json`);
      fs.writeFileSync(filePath, JSON.stringify(ssot, null, 2));
      console.log(`[save-ssot-with-images] ${ssot.postId} (${files.length}장)`);
      json(res, 200, { ok: true, postId: ssot.postId, imageCount: files.length });
    } catch (e) {
      json(res, 500, { error: e.message });
    }
    return;
  }

  // ── POST /api/pipeline ──
  if (req.method === 'POST' && pathname === '/api/pipeline') {
    try {
      const body = await readBody(req);
      const { postId } = JSON.parse(body);
      if (!postId) return json(res, 400, { error: 'postId 필수' });

      console.log(`[pipeline] ${postId} 시작`);
      const scriptPath = path.join(ROOT, 'scripts/content-manual-pipeline.js');
      const output = await runScript(scriptPath, ['--publish-only', postId]);
      console.log(`[pipeline] ${postId} 완료`);
      json(res, 200, { ok: true, postId, output: output.slice(-500) });
    } catch (e) {
      console.error(`[pipeline] 실패:`, e.message);
      json(res, 500, { error: e.message });
    }
    return;
  }

  // ── GET /api/status/:postId ──
  if (req.method === 'GET' && pathname.startsWith('/api/status/')) {
    const postId = pathname.split('/api/status/')[1];
    if (!postId) return json(res, 400, { error: 'postId 필수' });

    const ssotPath = path.join(SSOT_DIR, `${postId}.json`);
    const blogPath = path.join(PUBLISH_DIR, `${postId}.json`);
    const htmlPath = path.join(HTML_DIR, `${postId}.html`);

    json(res, 200, {
      postId,
      ssot: fs.existsSync(ssotPath),
      blog: fs.existsSync(blogPath),
      html: fs.existsSync(htmlPath),
    });
    return;
  }

  // ── Static files: uploaded images (support both /output/images/ and /images/) ──
  if (req.method === 'GET' && (pathname.startsWith('/output/images/') || pathname.startsWith('/images/'))) {
    // Normalize: /images/xxx → output/images/xxx
    const mappedPath = pathname.startsWith('/images/')
      ? 'output' + pathname
      : pathname.slice(1);  // remove leading /
    const safePath = path.normalize(mappedPath).replace(/^(\.\.[/\\])+/, '');
    const filePath = path.join(ROOT, safePath);
    if (filePath.startsWith(path.join(ROOT, 'output', 'images')) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      serveStatic(res, filePath);
      return;
    }
  }

  // ── GET /api/keyword-cache-status ──
  if (req.method === 'GET' && pathname === '/api/keyword-cache-status') {
    try {
      if (!fs.existsSync(KV_CACHE_PATH)) {
        return json(res, 200, { exists: false, message: '캐시 없음 — 하드코딩 fallback 사용 중' });
      }
      const cache = JSON.parse(fs.readFileSync(KV_CACHE_PATH, 'utf8'));
      const updatedAt = cache.meta?.updatedAt || '';
      const age = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86400000);
      const count = Object.keys(cache.keywords || {}).length;
      const stale = age > 30;
      // 상위 10개 키워드
      const top10 = Object.entries(cache.keywords || {})
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 10)
        .map(([kw, v]) => ({ keyword: kw, total: v.total, comp: v.comp }));
      json(res, 200, { exists: true, updatedAt, ageDays: age, count, stale, top10 });
    } catch (e) {
      json(res, 500, { error: e.message });
    }
    return;
  }

  // ── POST /api/refresh-keywords — 키워드 검색량 갱신 ──
  if (req.method === 'POST' && pathname === '/api/refresh-keywords') {
    try {
      const hasKeys = process.env.NAVER_AD_CUSTOMER_ID && process.env.NAVER_AD_API_KEY && process.env.NAVER_AD_SECRET_KEY;
      if (!hasKeys) {
        return json(res, 400, { error: '네이버 API 환경변수 미설정 (NAVER_AD_CUSTOMER_ID, NAVER_AD_API_KEY, NAVER_AD_SECRET_KEY)' });
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      function send(type, data) {
        res.write('data: ' + JSON.stringify({ type, ...data }) + '\n\n');
      }

      send('start', { message: '키워드 검색량 갱신 시작...' });
      const kvScript = path.join(ROOT, 'scripts/naver-keyword-volume.js');
      const proc = fork(kvScript, ['--scan'], { cwd: ROOT, silent: true });

      proc.stdout.on('data', d => {
        const msg = d.toString().trim();
        if (msg) send('progress', { message: msg });
      });
      proc.stderr.on('data', d => {
        const msg = d.toString().trim();
        if (msg) send('log', { message: msg });
      });
      proc.on('close', code => {
        if (code !== 0) {
          send('error', { message: `갱신 실패 (exit ${code}). env.config의 네이버 API 키(NAVER_AD_CUSTOMER_ID, NAVER_AD_API_KEY, NAVER_AD_SECRET_KEY)를 확인하세요. 직접 발급: searchad.naver.com → 도구 → API 관리` });
        } else {
          send('done', { ok: true, message: '키워드 검색량 갱신 완료' });
        }
        res.end();
      });
      proc.on('error', err => {
        send('error', { message: `갱신 프로세스 오류: ${err.message}. 네이버 API 키를 확인하세요.` });
        res.end();
      });
    } catch (e) {
      if (res.headersSent) {
        res.write('data: ' + JSON.stringify({ type: 'error', message: e.message }) + '\n\n');
        res.end();
      } else {
        json(res, 500, { error: e.message });
      }
    }
    return;
  }

  // ── Static files from HTML_DIR (dashboard assets) ──
  if (req.method === 'GET') {
    const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    const filePath = path.join(HTML_DIR, safePath);
    const exists = fs.existsSync(filePath);
    const isFile = exists && fs.statSync(filePath).isFile();
    const startsOk = filePath.startsWith(HTML_DIR);
    if (startsOk && exists && isFile) {
      if (filePath.endsWith('.html')) {
        let html = fs.readFileSync(filePath, 'utf8');
        const rootEscaped = ROOT.replace(/\\/g, '\\\\');
        html = html.replace('</head>',
          `<script>window.__ROOT_DIR__="${rootEscaped}";</script>\n</head>`);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } else {
        serveStatic(res, filePath);
      }
      return;
    }
    // 디버그: HTML 요청인데 못 찾은 경우
    if (pathname.endsWith('.html')) {
      console.error(`[404] ${pathname} → filePath=${filePath} | startsWith=${startsOk} | exists=${exists} | isFile=${isFile}`);
    }
  }

  res.writeHead(404);
  res.end('Not found');
}

// ── start ──
const server = http.createServer(handler);
server.listen(PORT, () => {
  console.log(`━━━ 투베이스 콘텐츠 대시보드 서버 ━━━`);
  console.log(`http://localhost:${PORT}              대시보드`);
  console.log(`http://localhost:${PORT}/new-post-form.html  새 글 작성`);
  console.log(`http://localhost:${PORT}/work-guide.html     작업 가이드`);
  console.log(`\nCtrl+C 로 종료`);
});
