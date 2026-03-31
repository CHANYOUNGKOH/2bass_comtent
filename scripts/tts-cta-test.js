#!/usr/bin/env node
/**
 * tts-cta-test.js
 * CTA 화면 태그라인 후보 비교 — 2.5초 짧은 영상 3개 렌더
 *
 * Usage: node scripts/tts-cta-test.js
 * 출력: output/video/_cta_test/cta_{1,2,3}.mp4
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const FPS = 30;
const CTA_SEC = 2.5;
const CTA_FRAMES = Math.round(CTA_SEC * FPS);

// ── 태그라인 후보 + USP ──
const CANDIDATES = [
  {
    id: 1,
    tagline: '브레이크는 투베이스가 답입니다',
    usp: '브레이크 전문점 · 20년 업력',
  },
  {
    id: 2,
    tagline: '20년, 브레이크만 했습니다',
    usp: '이상한 데서 튜닝하다 오는 차, 여기서 끝냅니다',
  },
  {
    id: 3,
    tagline: '브레이크는 안전입니다. 투베이스',
    usp: '브레이크 = 안전 · 전문점이 드문 이유',
  },
];

const outDir = path.join(ROOT, 'output/video/_cta_test');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const entryPoint = path.join(ROOT, 'video/src/index.js');
const configFile = path.join(ROOT, 'video/remotion.config.js');

console.log(`CTA 태그라인 비교 렌더 (${CTA_SEC}s × ${CANDIDATES.length}개)\n`);

for (const c of CANDIDATES) {
  console.log(`  #${c.id}: "${c.tagline}" / USP: "${c.usp}"`);

  // CTA만 렌더하기 위해 최소 props 구성
  // 이미지 없이 CTA만 보이도록: Cold Open 0프레임, Sting 0프레임, 나레이션 0프레임
  const props = {
    images: [],
    hookText: '',
    tagline: c.tagline,
    uspLine: c.usp,
    narrationSegments: [],
    bgmAudio: null,
    sfxIntro: null,
    sfxSting: null,
  };

  const propsFile = path.join(outDir, `_props_cta_${c.id}.json`);
  fs.writeFileSync(propsFile, JSON.stringify(props));

  const outFile = path.join(outDir, `cta_${c.id}.mp4`);
  const cmd = [
    'npx', 'remotion', 'render',
    `"${entryPoint}"`,
    'BrakeShopVideo',
    `"${outFile}"`,
    `"--props=${propsFile}"`,
    `"--config=${configFile}"`,
    `--frames=0-${CTA_FRAMES - 1}`,
    '--concurrency=2',
  ].join(' ');

  try {
    execSync(cmd, { cwd: ROOT, stdio: 'inherit', timeout: 120000 });
    console.log(`  -> cta_${c.id}.mp4\n`);
  } catch (e) {
    console.error(`  렌더 실패: ${e.message.slice(0, 100)}\n`);
  } finally {
    try { fs.unlinkSync(propsFile); } catch {}
  }
}

console.log(`출력 폴더: ${outDir}`);
console.log('cta_{1,2,3}.mp4 재생해서 태그라인 + USP 비주얼 비교하세요.');
