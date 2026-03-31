#!/usr/bin/env node
/**
 * tts-bgm-combo-test.js
 * Schedar 음성으로 테스트 문장 TTS 합성 → BGM 6종과 조합 비교
 * ffmpeg로 TTS(100%) + BGM(12%) 오버레이
 *
 * Usage: node scripts/tts-bgm-combo-test.js
 * 출력: output/video/_bgm_test/combo_{bgmId}.mp3
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const FFMPEG = require('ffmpeg-static');

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

const TTS_VOICE = 'ko-KR-Chirp3-HD-Enceladus';
const TEST_TEXT = '6피스톤 달았는데 밀린다고요? 피스톤 개수가 답이 아닙니다. 이게 맞는 세팅입니다.';

const BGM_IDS = ['132', '371', '441', '471', '623', '759'];

// ── Google Cloud TTS 인증 ──
async function getAccessToken() {
  const keyPath = path.join(ROOT, 'google-tts-key.json');
  if (!fs.existsSync(keyPath)) {
    console.error('google-tts-key.json 없음');
    process.exit(1);
  }

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
    console.error('토큰 발급 실패:', await resp.text());
    process.exit(1);
  }
  return (await resp.json()).access_token;
}

async function synthesize(token, text) {
  const url = 'https://texttospeech.googleapis.com/v1/text:synthesize';
  const body = {
    input: { text },
    voice: { languageCode: 'ko-KR', name: TTS_VOICE },
    audioConfig: { audioEncoding: 'MP3' },
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
    console.error(`TTS 오류 ${resp.status}:`, (await resp.text()).slice(0, 300));
    process.exit(1);
  }
  return (await resp.json()).audioContent; // base64
}

// ── 메인 ──
const outDir = path.join(ROOT, 'output/video/_bgm_test');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

console.log(`음성: ${TTS_VOICE}`);
console.log(`문장: "${TEST_TEXT}"`);
console.log(`BGM ${BGM_IDS.length}개 조합 테스트\n`);

// 1) TTS 합성
console.log('TTS 합성 중...');
const token = await getAccessToken();
const audioBase64 = await synthesize(token, TEST_TEXT);
const ttsBuf = Buffer.from(audioBase64, 'base64');
const ttsFile = path.join(outDir, '_tts_only.mp3');
fs.writeFileSync(ttsFile, ttsBuf);
console.log(`TTS 완료: ${(ttsBuf.length / 1024).toFixed(0)}KB\n`);

// 2) 각 BGM과 조합
for (const bgmId of BGM_IDS) {
  const bgmFile = path.join(ROOT, 'video/assets', `bgm_${bgmId}.mp3`);
  if (!fs.existsSync(bgmFile)) {
    console.log(`  bgm_${bgmId}.mp3 없음 — 건너뜀`);
    continue;
  }

  const outFile = path.join(outDir, `combo_${bgmId}.mp3`);
  process.stdout.write(`  bgm_${bgmId} + TTS ... `);

  try {
    // TTS 볼륨 100%, BGM 볼륨 12%, TTS 길이에 맞춰 종료
    execSync(
      `"${FFMPEG}" -y -i "${ttsFile}" -i "${bgmFile}" -filter_complex "[1:a]volume=0.12[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=2" -ac 2 -ar 44100 "${outFile}"`,
      { stdio: 'pipe', timeout: 30000 },
    );
    const size = fs.statSync(outFile).size;
    console.log(`OK ${(size / 1024).toFixed(0)}KB`);
  } catch (e) {
    console.log(`FAIL: ${e.message.slice(0, 100)}`);
  }
}

console.log(`\n출력 폴더: ${outDir}`);
console.log('각 combo_{bgmId}.mp3 를 재생해서 비교하세요.');
