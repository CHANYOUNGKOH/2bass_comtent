/**
 * PDF 이미지 추출 테스트 - pdfjs-dist + @napi-rs/canvas
 * 각 포스트의 pageRange 기준으로 실제 사진 이미지만 추출
 */
import { mkdir, writeFile, readFile } from 'fs/promises';
import path from 'path';
import { createCanvas, ImageData } from '@napi-rs/canvas';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const ROOT = process.cwd();
const TEST_PDF = path.join(ROOT, 'output/naver-blog-pdfs/투베이스_블로그_001.pdf');
const OUT_DIR  = path.join(ROOT, 'output/images-test');

// 포스트 1: 페이지 1-13
const PAGE_RANGE = { start: 1, end: 13 };
const MIN_WIDTH  = 200;  // 작은 아이콘 제외
const MIN_HEIGHT = 150;

async function extractImagesFromPages(pdfPath, pageRange, outDir) {
  await mkdir(outDir, { recursive: true });

  const raw = await readFile(pdfPath);
  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(raw.buffer),
    useSystemFonts: true,
  }).promise;

  console.log(`PDF: ${path.basename(pdfPath)}, 총 ${pdf.numPages}페이지`);
  console.log(`추출 범위: p${pageRange.start} ~ p${pageRange.end}`);

  let imgCount = 0;
  const seen = new Set(); // 동일 이미지 중복 방지

  for (let pn = pageRange.start; pn <= Math.min(pageRange.end, pdf.numPages); pn++) {
    const page = await pdf.getPage(pn);
    const opList = await page.getOperatorList();

    const imgNames = [];
    for (let i = 0; i < opList.fnArray.length; i++) {
      if (opList.fnArray[i] === pdfjsLib.OPS.paintImageXObject ||
          opList.fnArray[i] === pdfjsLib.OPS.paintImageXObjectRepeat) {
        const name = opList.argsArray[i][0];
        if (!seen.has(name)) { seen.add(name); imgNames.push(name); }
      }
    }

    for (const name of imgNames) {
      const imgObj = await new Promise(resolve => {
        if (page.commonObjs.has(name)) page.commonObjs.get(name, resolve);
        else page.objs.get(name, resolve);
      });

      if (!imgObj || !imgObj.data) continue;
      if ((imgObj.width || 0) < MIN_WIDTH || (imgObj.height || 0) < MIN_HEIGHT) continue;

      const { width, height, data, kind } = imgObj;

      // kind: 1=GRAYSCALE, 2=RGB_24BPP, 3=RGBA_32BPP
      const channels = kind === 3 ? 4 : kind === 1 ? 1 : 3;
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext('2d');

      // ImageData는 반드시 RGBA (4채널)
      let rgbaData;
      if (channels === 4) {
        rgbaData = new Uint8ClampedArray(data);
      } else if (channels === 3) {
        rgbaData = new Uint8ClampedArray(width * height * 4);
        for (let i = 0, j = 0; i < width * height; i++, j += 3) {
          rgbaData[i * 4]     = data[j];
          rgbaData[i * 4 + 1] = data[j + 1];
          rgbaData[i * 4 + 2] = data[j + 2];
          rgbaData[i * 4 + 3] = 255;
        }
      } else {
        rgbaData = new Uint8ClampedArray(width * height * 4);
        for (let i = 0; i < width * height; i++) {
          rgbaData[i*4] = rgbaData[i*4+1] = rgbaData[i*4+2] = data[i];
          rgbaData[i*4+3] = 255;
        }
      }

      const imageData = new ImageData(rgbaData, width, height);
      ctx.putImageData(imageData, 0, 0);

      imgCount++;
      const fname = `p${String(pn).padStart(3,'0')}_img${String(imgCount).padStart(3,'0')}.jpg`;
      const buf = await canvas.encode('jpeg', 88);
      await writeFile(path.join(outDir, fname), buf);
      console.log(`  [p${pn}] ${fname} (${width}×${height})`);
    }
  }

  return imgCount;
}

extractImagesFromPages(TEST_PDF, PAGE_RANGE, OUT_DIR)
  .then(n => {
    console.log(`\n완료: ${n}개 이미지 추출`);
    console.log('저장 위치:', OUT_DIR);
  })
  .catch(err => console.error('실패:', err.message, err.stack));
