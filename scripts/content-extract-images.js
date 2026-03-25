/**
 * content-extract-images.js
 * 전체 1912개 포스트에서 이미지 추출
 * - posts-unique.json 기준, PDF별로 묶어서 처리 (효율)
 * - output/images/{postId}/ 에 저장
 * - 이미 추출된 건 스킵 (증분)
 * - manifest: output/images/manifest.json
 */
import { mkdir, writeFile, readFile, access } from 'fs/promises';
import path from 'path';
import { createCanvas, ImageData } from '@napi-rs/canvas';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

import { readdir } from 'fs/promises';

const ROOT        = process.cwd();
const UNIQUE_PATH = process.env.UNIQUE_PATH   || 'data/content/dedup/posts-unique.json';
const PDF_DIRS    = (process.env.PDF_DIR || 'data/work/inbox').split(',').map(d => d.trim());
const OUT_DIR     = process.env.IMAGE_OUT_DIR || 'output/images';
const MANIFEST    = path.join(ROOT, OUT_DIR, 'manifest.json');
const MIN_W       = Number(process.env.IMG_MIN_W || 200);
const MIN_H       = Number(process.env.IMG_MIN_H || 150);
const LIMIT       = Number(process.env.IMG_LIMIT  || 0); // 0=전체

// PDF 파일명 → 절대경로 캐시 (하위 디렉토리 재귀 탐색)
const _pdfCache = new Map();
async function buildPdfCache() {
  if (_pdfCache.size) return;
  for (const dir of PDF_DIRS) {
    const absDir = path.resolve(ROOT, dir);
    if (!await exists(absDir)) continue;
    await _scanDir(absDir);
  }
}
async function _scanDir(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await _scanDir(full);
    else if (e.name.toLowerCase().endsWith('.pdf')) _pdfCache.set(e.name, full);
  }
}
function findPdf(sourceName) {
  return _pdfCache.get(sourceName) || null;
}

async function loadJson(p, fallback) {
  try { return JSON.parse(await readFile(p, 'utf8')); }
  catch { return fallback; }
}

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function extractFromPage(page, seen) {
  const opList = await page.getOperatorList();
  const names = [];
  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    if (fn === pdfjsLib.OPS.paintImageXObject ||
        fn === pdfjsLib.OPS.paintImageXObjectRepeat) {
      const name = opList.argsArray[i][0];
      if (!seen.has(name)) { seen.add(name); names.push(name); }
    }
  }

  const images = [];
  for (const name of names) {
    const imgObj = await new Promise(resolve => {
      if (page.commonObjs.has(name)) page.commonObjs.get(name, resolve);
      else page.objs.get(name, resolve);
    });
    if (!imgObj?.data) continue;
    if ((imgObj.width || 0) < MIN_W || (imgObj.height || 0) < MIN_H) continue;
    images.push(imgObj);
  }
  return images;
}

async function imgObjToJpeg(imgObj) {
  const { width, height, data, kind } = imgObj;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // kind: 1=GRAY, 2=RGB_24BPP, 3=RGBA_32BPP
  let rgba;
  if (kind === 3) {
    rgba = new Uint8ClampedArray(data);
  } else if (kind === 2) {
    rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      rgba[i*4]   = data[i*3];
      rgba[i*4+1] = data[i*3+1];
      rgba[i*4+2] = data[i*3+2];
      rgba[i*4+3] = 255;
    }
  } else {
    rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      rgba[i*4] = rgba[i*4+1] = rgba[i*4+2] = data[i];
      rgba[i*4+3] = 255;
    }
  }

  ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
  return canvas.encode('jpeg', 88);
}

async function processPdf(pdfPath, posts, manifest, stats) {
  const raw = await readFile(pdfPath);
  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(raw.buffer),
    useSystemFonts: true,
  }).promise;

  for (const post of posts) {
    const { postId, pageRange, counts } = post;
    const postDir = path.join(ROOT, OUT_DIR, postId);

    // 이미 추출 완료된 경우 스킵
    if (manifest[postId]?.done) { stats.skipped++; continue; }

    await mkdir(postDir, { recursive: true });

    const seen = new Set();
    const saved = [];
    let idx = 1;

    for (let pn = pageRange.start; pn <= Math.min(pageRange.end, pdf.numPages); pn++) {
      let page;
      try { page = await pdf.getPage(pn); } catch { continue; }

      const images = await extractFromPage(page, seen);
      for (const imgObj of images) {
        const buf = await imgObjToJpeg(imgObj);
        const fname = `img_${String(idx).padStart(3,'0')}.jpg`;
        await writeFile(path.join(postDir, fname), buf);
        saved.push({ file: fname, width: imgObj.width, height: imgObj.height, size: buf.length });
        idx++;
      }
    }

    manifest[postId] = { done: true, count: saved.length, images: saved };
    stats.processed++;
    stats.images += saved.length;

    const expected = counts?.imageBlocks || 0;
    const mark = saved.length === expected ? '✓' : `(기대:${expected})`;
    process.stdout.write(`  [${postId}] ${saved.length}장 ${mark}\n`);
  }
}

/**
 * 단건 추출: --postId cnt_xxx_post_01
 * 발행 직전에 해당 포스트 이미지만 추출
 */
async function extractSingle(postId) {
  const uniqueData = await loadJson(path.join(ROOT, UNIQUE_PATH), { uniquePosts: [] });
  const manifest   = await loadJson(MANIFEST, {});

  const found = uniqueData.uniquePosts.find(p => p.keep.postId === postId);
  if (!found) { console.error('postId 없음:', postId); process.exit(1); }

  const k = found.keep;
  await buildPdfCache();
  const pdfPath = findPdf(k.sourceName);
  if (!pdfPath) { console.error('PDF 파일 없음:', k.sourceName); process.exit(1); }
  const stats = { processed: 0, skipped: 0, images: 0, failed: 0 };

  console.log(`단건 추출: ${postId}`);
  console.log(`PDF: ${pdfPath}, 페이지: ${k.pageRange.start}-${k.pageRange.end}`);

  await processPdf(pdfPath, [{
    postId:    k.postId,
    pageRange: k.pageRange,
    counts:    k.counts,
  }], manifest, stats);

  await mkdir(path.join(ROOT, OUT_DIR), { recursive: true });
  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2));

  console.log(`완료: ${stats.images}장 → output/images/${postId}/`);
  return stats.images;
}

async function main() {
  // 단건 모드: node content-extract-images.js --postId cnt_xxx_post_01
  const postIdArg = process.argv.find((a, i) => process.argv[i-1] === '--postId');
  if (postIdArg) {
    await extractSingle(postIdArg);
    return;
  }

  // 배치 모드 (LIMIT 건수만 / 기본 비활성화 - 용량 주의)
  if (!LIMIT) {
    console.log('배치 모드: LIMIT 미설정. IMG_LIMIT=N 으로 건수 지정 필요.');
    console.log('단건 모드: node scripts/content-extract-images.js --postId <postId>');
    process.exit(0);
  }

  const uniqueData = await loadJson(path.join(ROOT, UNIQUE_PATH), { uniquePosts: [] });
  const allPosts   = uniqueData.uniquePosts || [];
  const manifest   = await loadJson(MANIFEST, {});

  await mkdir(path.join(ROOT, OUT_DIR), { recursive: true });
  await buildPdfCache();

  const byPdf = {};
  for (const p of allPosts) {
    const k = p.keep;
    if (!byPdf[k.sourceName]) byPdf[k.sourceName] = [];
    byPdf[k.sourceName].push({ postId: k.postId, pageRange: k.pageRange, counts: k.counts });
  }

  const pdfList = Object.keys(byPdf);
  const stats   = { processed: 0, skipped: 0, images: 0, failed: 0 };
  let pdfDone = 0;

  for (const pdfName of pdfList) {
    if (LIMIT && stats.processed >= LIMIT) break;
    const pdfPath = findPdf(pdfName);
    if (!pdfPath) { stats.failed++; continue; }

    pdfDone++;
    console.log(`\n[${pdfDone}/${pdfList.length}] ${pdfName}`);
    try {
      await processPdf(pdfPath, byPdf[pdfName], manifest, stats);
    } catch (err) {
      console.error(`  실패: ${err.message}`);
      stats.failed++;
    }
    await writeFile(MANIFEST, JSON.stringify(manifest, null, 2));
  }

  console.log('\n=== 완료 ===');
  console.log(`처리: ${stats.processed}건, 스킵: ${stats.skipped}건, 총 이미지: ${stats.images}장`);
}

main().catch(err => { console.error(err); process.exit(1); });
