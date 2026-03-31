#!/usr/bin/env node
/**
 * video-render-sample.js
 * SSOT 기반 릴스 밈 스타일 영상 렌더링
 * 4막 구조: Cold Open → 브랜드 스팅 → 나레이션 세그먼트 → CTA
 *
 * Usage: node scripts/video-render-sample.js <postId>
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { callClaude } from './_content-shared.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

// env.config 로드
const envFile = path.join(ROOT, 'env.config');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

const postId = process.argv[2];
if (!postId) {
  console.error('Usage: node scripts/video-render-sample.js <postId>');
  process.exit(1);
}

// SSOT 읽기
const ssotPath = path.join(ROOT, 'data/ssot-posts', `${postId}.json`);
if (!fs.existsSync(ssotPath)) {
  console.error(`SSOT 없음: ${ssotPath}`);
  process.exit(1);
}
const ssot = JSON.parse(fs.readFileSync(ssotPath, 'utf8'));

// ── Claude API → 릴스 톤 나레이션 스크립트 생성 ──
async function generateVideoScript(ssot) {
  const vehicle = `${ssot.vehicle?.brand || ''} ${ssot.vehicle?.model || ''}`.trim();
  const workType = ssot.work?.type || '';
  const keyPoints = (ssot.work?.keyPoints || []).join(', ');
  const challenge = ssot.work?.challenge || '';
  const solution = ssot.work?.solution || '';

  const prompt = {
    system: `너는 자동차 브레이크 전문점 "투베이스"의 릴스 나레이션 작가다.
15~20초 분량 스크립트를 만들어.

━━━ 톤: 팩트 투척 ━━━
- 정비사가 팩트를 툭툭 던지듯, 건조하고 짧게 끊기
- 한 문장 최대 20자. 감정 배제. 사실만. 권위 있는 단정.
- 보고서체 절대 금지: "~작업입니다", "~진행하였습니다" 쓰면 실격
- ~합니다/입니다 통일. 해요체 금지.

좋은 예: "밀린다고요? 개수가 답 아닙니다. 이게 맞는 세팅입니다."
나쁜 예: "벤츠 S350, CTS-V 브렘보 4P 킷 교체 작업입니다."

━━━ 영문 발음 규칙 ━━━
영문은 반드시 한글 발음으로 작성:
6P→식스피, 4P→포피, 2P→투피, CTS-V→씨티에스브이, AP Racing→에이피레이싱,
BMW→비엠더블유, Brembo→브렘보

━━━ 훅 규칙 ━━━
- 2줄, \\n으로 구분
- 줄당 7자 이내
예: "밀린다고요?\\n답 나왔습니다"

━━━ 출력 JSON ━━━
{
  "hook": "훅 2줄\\n구분",
  "segments": [
    { "tts": "TTS 나레이션 문장", "overlay": "화면 자막 10자 이내" }
  ]
}

규칙:
- segments 3~4개
- segments.tts 전체 합쳐서 50~80자
- overlay는 핵심 요약 (짧게!)
- 팩트시트에 없는 내용 날조 금지
- tagline 생성하지 마. 태그라인은 하드코딩됨.
- JSON만 출력, 설명 없이`,

    user: `━━━ 팩트시트 ━━━
차량: ${vehicle}
작업: ${workType}
핵심포인트: ${keyPoints || '없음'}
챌린지: ${challenge || '없음'}
솔루션: ${solution || '없음'}

위 팩트시트를 기반으로 릴스 나레이션 스크립트 JSON을 생성해.`,
  };

  const result = await callClaude(prompt, 'haiku');
  // callClaude already parses JSON
  return result;
}

// ── Google Cloud TTS (서비스 계정 JWT 인증) ──
async function getAccessToken() {
  const keyPath = path.join(ROOT, 'google-tts-key.json');
  if (!fs.existsSync(keyPath)) return null;

  const key = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  const now = Math.floor(Date.now() / 1000);

  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })).toString('base64url');

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const signature = sign.sign(key.private_key, 'base64url');
  const jwt = `${header}.${payload}.${signature}`;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!resp.ok) {
    console.error('[TTS] 토큰 발급 실패:', await resp.text());
    return null;
  }
  return (await resp.json()).access_token;
}

const TTS_VOICE = 'ko-KR-Chirp3-HD-Enceladus';

async function synthesizeOneSegment(token, text) {
  const url = 'https://texttospeech.googleapis.com/v1/text:synthesize';
  const body = {
    input: { text },
    voice: {
      languageCode: 'ko-KR',
      name: TTS_VOICE,
    },
    audioConfig: {
      audioEncoding: 'MP3',
    },
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.text();
    console.error(`[TTS] API 오류 ${resp.status}: ${err.slice(0, 300)}`);
    return null;
  }

  const data = await resp.json();
  return data.audioContent; // base64
}

// MP3 base64 → 대략적 재생 시간 (초)
function estimateMp3DurationFromBase64(base64str) {
  const bytes = Buffer.from(base64str, 'base64').length;
  // Google TTS MP3 ~32kbps → bytes/sec ≈ 4000
  return bytes / 4000;
}

// 세그먼트별 TTS 병렬 호출
async function synthesizeSegments(segments) {
  const token = await getAccessToken();
  if (!token) {
    console.log('[TTS] 인증 실패 — 나레이션 생략');
    return null;
  }

  const promises = segments.map((seg) => {
    return synthesizeOneSegment(token, seg.tts);
  });

  const results = await Promise.all(promises);

  return results.map((audioBase64, i) => {
    if (!audioBase64) return null;
    const durationSec = estimateMp3DurationFromBase64(audioBase64);
    const dataUri = `data:audio/mp3;base64,${audioBase64}`;
    console.log(`[TTS] seg${i}: "${segments[i].tts.slice(0, 25)}…" → ${durationSec.toFixed(1)}s`);
    return {
      audioDataUri: dataUri,
      durationSec,
      overlay: segments[i].overlay,
    };
  });
}

// ── 이미지 수집 ──
const imgDir = path.join(ROOT, 'output/images', postId);
let images = [];
if (fs.existsSync(imgDir)) {
  images = fs.readdirSync(imgDir)
    .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
    .sort()
    .map(f => path.resolve(imgDir, f));
}

if (images.length === 0) {
  console.error(`이미지 없음: ${imgDir}`);
  process.exit(1);
}

// 사진 N장 선택 (균등 간격)
function selectImages(imgs, count) {
  if (imgs.length <= count) return imgs;
  const step = (imgs.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, i) => imgs[Math.round(i * step)]);
}

// 이미지를 base64 data URI로 변환
function imageToDataUri(src) {
  const buf = fs.readFileSync(src);
  const ext = path.extname(src).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

// 오디오 파일을 base64 data URI로
function audioToDataUri(filePath, mime = 'audio/wav') {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const buf = fs.readFileSync(filePath);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

// ── 메인 실행 ──
const outDir = path.join(ROOT, 'output/video');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const assetsDir = path.join(ROOT, 'video/assets');

// 1) 나레이션 스크립트 생성 (Claude API)
console.log(`\n━━━ 나레이션 스크립트 생성 ━━━`);
const script = await generateVideoScript(ssot);
console.log(`[훅] "${script.hook}"`);
console.log(`[세그먼트] ${script.segments.length}개:`);
script.segments.forEach((s, i) => console.log(`  ${i}: "${s.tts}" | 자막: "${s.overlay}"`));

// 2) 세그먼트별 TTS 생성 (병렬)
console.log(`\n━━━ TTS 생성 ━━━`);
const ttsResults = await synthesizeSegments(script.segments);

// 3) 이미지 선택 (세그먼트 수 + cold open용 1장)
const segCount = script.segments.length;
const selected = selectImages(images, segCount + 1); // +1 for cold open reuse
const base64Images = selected.map(imageToDataUri);

// 4) narrationSegments 구성 + 타이밍 계산
const FPS = 30;
const COLD_OPEN_SEC = 1.5;
const STING_SEC = 1.0;
const CTA_SEC = 2.5;

const narrationSegments = script.segments.map((seg, i) => {
  const ttsResult = ttsResults?.[i];
  const durationSec = ttsResult ? Math.max(ttsResult.durationSec, 2.5) : 3.5;
  // 약간의 여유 (+0.3초)
  const paddedSec = durationSec + 0.3;
  return {
    audioDataUri: ttsResult?.audioDataUri || null,
    durationFrames: Math.round(paddedSec * FPS),
    overlay: seg.overlay,
  };
});

const narrationTotalSec = narrationSegments.reduce((sum, s) => sum + s.durationFrames / FPS, 0);
const totalSec = COLD_OPEN_SEC + STING_SEC + narrationTotalSec + CTA_SEC;
const totalFrames = Math.round(totalSec * FPS);

console.log(`\n[타이밍] Cold Open ${COLD_OPEN_SEC}s + Sting ${STING_SEC}s + 나레이션 ${narrationTotalSec.toFixed(1)}s + CTA ${CTA_SEC}s = ${totalSec.toFixed(1)}s (${totalFrames}프레임)`);

// 5) props 조립
const props = {
  images: base64Images,
  hookText: script.hook,
  tagline: '브레이크는 투베이스가 답입니다',
  uspLine: '브레이크 전문점 · 20년 업력',
  narrationSegments,
  bgmAudio: audioToDataUri(path.join(assetsDir, 'bgm_132.mp3'), 'audio/mp3'),
  sfxIntro: audioToDataUri(path.join(assetsDir, 'sfx_2569.wav'), 'audio/wav'),
  sfxSting: audioToDataUri(path.join(assetsDir, 'sfx_metal_hit.wav'), 'audio/wav'),
};

// 6) Remotion 렌더
const outFile = path.join(outDir, `${postId}.mp4`);
const propsFile = path.join(outDir, `_props_${postId}.json`);
fs.writeFileSync(propsFile, JSON.stringify(props));

console.log(`\n━━━ 영상 렌더 시작 ━━━`);
console.log(`포스트: ${postId}`);
console.log(`차량: ${ssot.vehicle?.brand} ${ssot.vehicle?.model}`);
console.log(`작업: ${ssot.work?.type}`);
console.log(`사진: ${selected.length}장 | 세그먼트: ${segCount}개`);
console.log(`출력: ${outFile}`);

const entryPoint = path.join(ROOT, 'video/src/index.js');
const configFile = path.join(ROOT, 'video/remotion.config.js');
const cmd = [
  'npx', 'remotion', 'render',
  `"${entryPoint}"`,
  'BrakeShopVideo',
  `"${outFile}"`,
  `"--props=${propsFile}"`,
  `"--config=${configFile}"`,
  `--frames=0-${totalFrames - 1}`,
  '--concurrency=2',
].join(' ');

try {
  execSync(cmd, { cwd: ROOT, stdio: 'inherit', timeout: 600000 });
  console.log(`\n✅ 렌더 완료: ${outFile}`);
} catch (e) {
  console.error(`\n❌ 렌더 실패:`, e.message);
  process.exit(1);
} finally {
  try { fs.unlinkSync(propsFile); } catch {}
}
