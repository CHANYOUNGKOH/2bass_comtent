#!/usr/bin/env node
/**
 * tts-style-test.js
 * 대본 스타일 3종(A:팩트투척, B:문제→원인→해결, C:질문+답변) 비교
 * 같은 SSOT로 Claude 3회 호출 → Schedar TTS 합성
 *
 * Usage: node scripts/tts-style-test.js [postId]
 *        postId 없으면 data/ssot-posts/ 의 첫 번째 파일 사용
 * 출력: output/video/_style_test/style_{A,B,C}.mp3 + .txt
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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

const TTS_VOICE = 'ko-KR-Chirp3-HD-Enceladus';

// ── SSOT 선택 ──
let postId = process.argv[2];
const ssotDir = path.join(ROOT, 'data/ssot-posts');
if (!postId) {
  const files = fs.readdirSync(ssotDir).filter(f => f.endsWith('.json'));
  if (files.length === 0) { console.error('SSOT 파일 없음'); process.exit(1); }
  postId = files[0].replace('.json', '');
  console.log(`postId 미지정 → ${postId} 사용`);
}

const ssotPath = path.join(ssotDir, `${postId}.json`);
if (!fs.existsSync(ssotPath)) { console.error(`SSOT 없음: ${ssotPath}`); process.exit(1); }
const ssot = JSON.parse(fs.readFileSync(ssotPath, 'utf8'));

const vehicle = `${ssot.vehicle?.brand || ''} ${ssot.vehicle?.model || ''}`.trim();
const workType = ssot.work?.type || '';
const keyPoints = (ssot.work?.keyPoints || []).join(', ');
const challenge = ssot.work?.challenge || '';
const solution = ssot.work?.solution || '';

const factSheet = `차량: ${vehicle}
작업: ${workType}
핵심포인트: ${keyPoints || '없음'}
챌린지: ${challenge || '없음'}
솔루션: ${solution || '없음'}`;

// ── 3가지 스타일 프롬프트 ──
const COMMON_RULES = `
규칙:
- segments 3~4개
- segments.tts 전체 합쳐서 50~80자
- overlay는 핵심 요약 (짧게!)
- 팩트시트에 없는 내용 날조 금지
- 영문 발음 한글로: "6P→식스피, 4P→포피, CTS-V→씨티에스브이, AP Racing→에이피레이싱"
- 훅은 2줄, \\n으로 구분, 줄당 7자 이내
- ~합니다/입니다 통일. 해요체 금지
- JSON만 출력, 설명 없이

출력 JSON:
{
  "hook": "훅 2줄\\n줄바꿈",
  "segments": [
    { "tts": "TTS 나레이션", "overlay": "자막 10자 이내" }
  ]
}`;

const STYLES = [
  {
    id: 'A',
    name: '팩트 투척',
    system: `너는 자동차 브레이크 전문점 "투베이스"의 릴스 나레이션 작가다.

━━━ 스타일 A: 팩트 투척 ━━━
- 정비사가 팩트를 툭툭 던지듯, 건조하고 짧게 끊기
- "밀린다고요? 개수가 답 아닙니다."
- 감정 배제. 사실만. 권위 있는 단정.
${COMMON_RULES}`,
  },
  {
    id: 'B',
    name: '문제→원인→해결',
    system: `너는 자동차 브레이크 전문점 "투베이스"의 릴스 나레이션 작가다.

━━━ 스타일 B: 문제→원인→해결 ━━━
- 3막 흐름: 문제 제기 → 원인 설명 → 해결/결론
- "울림 안 멈춥니다. 순정이 원인. 교체, 해결."
- 인과관계가 명확하게 드러나도록.
${COMMON_RULES}`,
  },
  {
    id: 'C',
    name: '질문+답변',
    system: `너는 자동차 브레이크 전문점 "투베이스"의 릴스 나레이션 작가다.

━━━ 스타일 C: 질문+답변 ━━━
- 훅에서 질문으로 시선 잡기 → 답변으로 전개
- "왜 울어요? → 이게 답입니다."
- 시청자에게 말 거는 느낌. 하지만 건조한 톤 유지.
${COMMON_RULES}`,
  },
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
    const err = await resp.text();
    console.error(`TTS 오류 ${resp.status}:`, err.slice(0, 300));
    return null;
  }
  return (await resp.json()).audioContent;
}

// ── 메인 ──
const outDir = path.join(ROOT, 'output/video/_style_test');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

console.log(`SSOT: ${postId}`);
console.log(`차량: ${vehicle} | 작업: ${workType}`);
console.log(`음성: ${TTS_VOICE}`);
console.log(`스타일 3종 비교\n`);

const token = await getAccessToken();

for (const style of STYLES) {
  console.log(`━━━ 스타일 ${style.id}: ${style.name} ━━━`);

  // 1) Claude 호출
  const prompt = {
    system: style.system,
    user: `━━━ 팩트시트 ━━━\n${factSheet}\n\n위 팩트시트 기반으로 릴스 나레이션 스크립트 JSON을 생성해.`,
  };

  let script;
  try {
    script = await callClaude(prompt, 'haiku');
  } catch (e) {
    console.error(`  Claude 오류: ${e.message}`);
    continue;
  }

  console.log(`  훅: "${script.hook}"`);
  script.segments.forEach((s, i) => console.log(`  seg${i}: "${s.tts}" | ${s.overlay}`));

  // 대본 저장
  const allTts = script.segments.map(s => s.tts).join(' ');
  const txtFile = path.join(outDir, `style_${style.id}.txt`);
  fs.writeFileSync(txtFile, `[스타일 ${style.id}: ${style.name}]\n훅: ${script.hook}\n\n${script.segments.map((s, i) => `seg${i}: ${s.tts} | 자막: ${s.overlay}`).join('\n')}\n\nTTS 전문: ${allTts}\n글자수: ${allTts.length}자`);

  // 2) TTS 합성 (전체 세그먼트 이어서)
  const audioBase64 = await synthesize(token, allTts);
  if (audioBase64) {
    const buf = Buffer.from(audioBase64, 'base64');
    const mp3File = path.join(outDir, `style_${style.id}.mp3`);
    fs.writeFileSync(mp3File, buf);
    console.log(`  TTS: ${(buf.length / 1024).toFixed(0)}KB → style_${style.id}.mp3`);
  } else {
    console.log(`  TTS 실패`);
  }
  console.log();
}

console.log(`출력 폴더: ${outDir}`);
console.log('style_{A,B,C}.mp3 재생 + .txt 대본 비교하세요.');
