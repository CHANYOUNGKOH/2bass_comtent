#!/usr/bin/env node
/**
 * tts-voice-test.js
 * Chirp3-HD 남성 음성 비교 테스트
 * 같은 문장을 여러 음성으로 합성 → output/video/_voice_test/ 에 저장
 *
 * Usage: node scripts/tts-voice-test.js
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

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

// ── 테스트 문장 (릴스 톤) ──
const TEST_TEXT = '6피스톤 달았는데 밀린다고요? 피스톤 개수가 답이 아닙니다. 이게 맞는 세팅입니다.';

// ── 테스트할 음성 목록 (Chirp3-HD 남성 + 현재 Neural2-C 비교용) ──
const VOICES = [
  // 1차 테스트 제외 (Charon, Fenrir, Enceladus, Schedar, Puck)
  // 나머지 11개
  { name: 'ko-KR-Chirp3-HD-Achird' },
  { name: 'ko-KR-Chirp3-HD-Algenib' },
  { name: 'ko-KR-Chirp3-HD-Algieba' },
  { name: 'ko-KR-Chirp3-HD-Alnilam' },
  { name: 'ko-KR-Chirp3-HD-Iapetus' },
  { name: 'ko-KR-Chirp3-HD-Orus' },
  { name: 'ko-KR-Chirp3-HD-Rasalgethi' },
  { name: 'ko-KR-Chirp3-HD-Sadachbia' },
  { name: 'ko-KR-Chirp3-HD-Sadaltager' },
  { name: 'ko-KR-Chirp3-HD-Umbriel' },
  { name: 'ko-KR-Chirp3-HD-Zubenelgenubi' },
];

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

async function synthesize(token, voiceName, text) {
  const url = 'https://texttospeech.googleapis.com/v1/text:synthesize';
  const body = {
    input: { text },
    voice: {
      languageCode: 'ko-KR',
      name: voiceName,
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
    return { error: `${resp.status}: ${err.slice(0, 200)}` };
  }

  const data = await resp.json();
  return { audio: data.audioContent };
}

// ── 메인 ──
const outDir = path.join(ROOT, 'output/video/_voice_test');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

console.log(`테스트 문장: "${TEST_TEXT}"`);
console.log(`음성 ${VOICES.length}개 비교\n`);

const token = await getAccessToken();

for (const voice of VOICES) {
  process.stdout.write(`  ${voice.name} ... `);
  const result = await synthesize(token, voice.name, TEST_TEXT);

  if (result.error) {
    console.log(`❌ ${result.error}`);
    continue;
  }

  const buf = Buffer.from(result.audio, 'base64');
  const shortName = voice.name.replace('ko-KR-', '');
  const outFile = path.join(outDir, `${shortName}.mp3`);
  fs.writeFileSync(outFile, buf);
  const durSec = (buf.length / 4000).toFixed(1);
  console.log(`✅ ${(buf.length / 1024).toFixed(0)}KB ~${durSec}s → ${shortName}.mp3`);
}

console.log(`\n출력 폴더: ${outDir}`);
console.log('각 파일을 재생해서 비교해보세요.');
