import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

const ROOT = process.cwd();
const CONTENT_CATALOG_PATH = process.env.CONTENT_CATALOG_PATH || 'data/content/catalog.json';
const CONTENT_PARSED_DIR = process.env.CONTENT_PARSED_DIR || 'data/content/parsed';
const CONTENT_SEGMENTED_DIR = process.env.CONTENT_SEGMENTED_DIR || 'data/content/segmented';
const CONTENT_SEGMENT_LIMIT = Number(process.env.CONTENT_SEGMENT_LIMIT || 0); // 0 = all
const CONTENT_FORCE_SEGMENT = String(process.env.CONTENT_FORCE_SEGMENT || 'false').toLowerCase() === 'true';

const POST_START_RE = /((?:19|20)\d{2}\/\d{2}\/\d{2}\s+\d{2}:\d{2})\s+(https?:\/\/(?:m\.)?blog\.naver\.com\/\S+)/i;
const COMMENT_TIME_RE = /(?:19|20)\d{2}\.\d{2}\.\d{2}\s+\d{2}:\d{2}/;
const FOOTER_RE = /^\d+\s*[·.]\s*.*2BASS/i;

function nowIso() {
  return new Date().toISOString();
}

async function loadJson(filePath) {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function saveJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function ensureCatalogShape(input) {
  return {
    generatedAt: input?.generatedAt || '',
    sourceIndexPath: input?.sourceIndexPath || '',
    itemsByHash: input?.itemsByHash || {},
    orderedHashes: Array.isArray(input?.orderedHashes) ? input.orderedHashes : [],
  };
}

function normalizeSpace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function dedupeMirrorText(value) {
  const s = normalizeSpace(value);
  if (!s) return '';
  const half = Math.floor(s.length / 2);
  if (s.length % 2 === 0) {
    const left = s.slice(0, half).trim();
    const right = s.slice(half).trim();
    if (left && left === right) return left;
  }
  return s;
}

function isFooterText(text) {
  return FOOTER_RE.test(normalizeSpace(text));
}

function parseStartMarkers(blocks) {
  const markers = [];
  for (let i = 0; i < blocks.length; i += 1) {
    const b = blocks[i];
    if (b?.type !== 'text') continue;
    const text = normalizeSpace(b.text);
    const m = text.match(POST_START_RE);
    if (!m) continue;

    markers.push({
      blockIndex: i,
      blockOrder: Number(b.order || 0),
      pageNo: Number(b.pageNo || 0),
      publishedAt: normalizeSpace(m[1]),
      sourceUrl: normalizeSpace(m[2]),
      markerText: text,
    });
  }
  return markers;
}

function pickTitleLines(blocks, markerIndex) {
  const marker = blocks[markerIndex];
  const markerPage = marker?.pageNo;
  const titleLines = [];

  for (let i = markerIndex - 1; i >= 0; i -= 1) {
    const b = blocks[i];
    if (b?.type !== 'text') continue;
    if (b.pageNo !== markerPage) break;

    const t = dedupeMirrorText(b.text);
    if (!t || isFooterText(t)) continue;
    if (POST_START_RE.test(t)) break;

    titleLines.unshift(t);
    if (titleLines.length >= 3) break;
  }

  return titleLines;
}

function getPreludeTrimCount(blocks, nextMarkerIndex, maxTrim = 4) {
  if (!Number.isInteger(nextMarkerIndex) || nextMarkerIndex <= 0) return 0;
  const marker = blocks[nextMarkerIndex];
  if (!marker) return 0;

  const markerPage = marker.pageNo;
  let trim = 0;

  for (let i = nextMarkerIndex - 1; i >= 0; i -= 1) {
    const b = blocks[i];
    if (!b || b.pageNo !== markerPage) break;
    if (b.type !== 'text') continue;

    const t = normalizeSpace(b.text);
    if (!t || isFooterText(t)) break;
    if (POST_START_RE.test(t) || COMMENT_TIME_RE.test(t)) break;

    trim += 1;
    if (trim >= maxTrim) break;
  }

  return trim;
}

function splitBodyAndComments(textBlocks) {
  if (!Array.isArray(textBlocks) || textBlocks.length === 0) {
    return { bodyLines: [], commentLines: [], commentStartAt: null };
  }

  let firstCommentTimeIndex = -1;
  let commentHeaderIndex = -1;

  for (let i = 0; i < textBlocks.length; i += 1) {
    const t = normalizeSpace(textBlocks[i].text);
    if (!t) continue;

    if (commentHeaderIndex === -1 && t === '댓글') {
      commentHeaderIndex = i;
    }
    if (firstCommentTimeIndex === -1 && COMMENT_TIME_RE.test(t)) {
      firstCommentTimeIndex = i;
    }
  }

  let commentStartIndex = -1;
  if (commentHeaderIndex >= 0 && firstCommentTimeIndex >= 0) {
    commentStartIndex = Math.min(commentHeaderIndex + 1, firstCommentTimeIndex);
  } else if (commentHeaderIndex >= 0) {
    commentStartIndex = commentHeaderIndex + 1;
  } else if (firstCommentTimeIndex >= 0) {
    commentStartIndex = firstCommentTimeIndex;
  }

  if (commentStartIndex < 0 || commentStartIndex >= textBlocks.length) {
    return {
      bodyLines: textBlocks.map((x) => normalizeSpace(x.text)).filter(Boolean),
      commentLines: [],
      commentStartAt: null,
    };
  }

  const bodyLines = textBlocks
    .slice(0, commentStartIndex)
    .map((x) => normalizeSpace(x.text))
    .filter(Boolean);
  const commentLines = textBlocks
    .slice(commentStartIndex)
    .map((x) => normalizeSpace(x.text))
    .filter(Boolean);

  return {
    bodyLines,
    commentLines,
    commentStartAt: textBlocks[commentStartIndex]?.pageNo || null,
  };
}

function buildPosts(parsed) {
  const blocks = Array.isArray(parsed?.blocks) ? parsed.blocks : [];
  const markers = parseStartMarkers(blocks);

  if (markers.length === 0) {
    return [];
  }

  const posts = [];

  for (let m = 0; m < markers.length; m += 1) {
    const current = markers[m];
    const next = markers[m + 1];

    const startIdx = current.blockIndex;
    const endIdxExcl = next
      ? Math.max(startIdx + 1, next.blockIndex - getPreludeTrimCount(blocks, next.blockIndex))
      : blocks.length;
    const scopedBlocks = blocks.slice(startIdx, endIdxExcl);

    const textBlocks = scopedBlocks
      .filter((x) => x.type === 'text')
      .filter((x, idx) => idx !== 0)
      .map((x) => ({ ...x, text: dedupeMirrorText(x.text) }))
      .filter((x) => x.text && !isFooterText(x.text));

    const imageBlocks = scopedBlocks.filter((x) => x.type === 'image');
    const titleLines = pickTitleLines(blocks, startIdx);
    const split = splitBodyAndComments(textBlocks);

    const pages = scopedBlocks.map((x) => Number(x.pageNo || 0)).filter((n) => Number.isFinite(n) && n > 0);
    const startPage = pages.length > 0 ? Math.min(...pages) : current.pageNo;
    const endPage = pages.length > 0 ? Math.max(...pages) : current.pageNo;

    // 이미지 블록 위치 정보 보존: 직전 텍스트 블록 참조 포함
    const imagePositions = imageBlocks.map((imgBlock) => {
      let prevTextBlock = null;
      for (let i = scopedBlocks.indexOf(imgBlock) - 1; i >= 0; i -= 1) {
        if (scopedBlocks[i]?.type === 'text') {
          if (isFooterText(scopedBlocks[i].text)) continue; // 페이지 푸터 스킵
          prevTextBlock = scopedBlocks[i];
          break;
        }
      }
      return {
        blockId: imgBlock.blockId,
        pageNo: imgBlock.pageNo,
        order: imgBlock.order,
        prevTextBlockId: prevTextBlock?.blockId || null,
        prevText: prevTextBlock ? normalizeSpace(prevTextBlock.text).slice(0, 80) : null,
      };
    });

    const post = {
      postIndex: m + 1,
      postId: `${parsed.contentId}_post_${String(m + 1).padStart(2, '0')}`,
      title: titleLines.length > 0 ? normalizeSpace(titleLines.join(' ')) : '',
      titleLines,
      publishedAt: current.publishedAt,
      sourceUrl: current.sourceUrl,
      markerText: current.markerText,
      pageRange: {
        start: startPage,
        end: endPage,
      },
      imageBlocks: imagePositions,
      counts: {
        textBlocks: textBlocks.length,
        bodyLines: split.bodyLines.length,
        commentLines: split.commentLines.length,
        imageBlocks: imageBlocks.length,
      },
      bodyLines: split.bodyLines,
      commentLines: split.commentLines,
      bodyPreview: split.bodyLines.slice(0, 3),
      commentStartPage: split.commentStartAt,
    };

    posts.push(post);
  }

  return posts;
}

async function main() {
  const catalogPathAbs = path.resolve(ROOT, CONTENT_CATALOG_PATH);
  const parsedDirAbs = path.resolve(ROOT, CONTENT_PARSED_DIR);
  const segmentedDirAbs = path.resolve(ROOT, CONTENT_SEGMENTED_DIR);

  const catalog = ensureCatalogShape(await loadJson(catalogPathAbs));

  let processed = 0;
  let segmented = 0;
  let failed = 0;

  for (const hash of catalog.orderedHashes) {
    const item = catalog.itemsByHash[hash];
    if (!item) continue;

    if (item.pipeline?.parseState !== 'parsed') continue;

    const segmentState = item.pipeline?.segmentState || 'pending';
    if (!CONTENT_FORCE_SEGMENT && !(segmentState === 'pending' || segmentState === 'failed')) continue;

    if (CONTENT_SEGMENT_LIMIT > 0 && processed >= CONTENT_SEGMENT_LIMIT) break;
    processed += 1;

    const parsedPath = path.join(parsedDirAbs, `${item.contentId}.json`);
    const outPath = path.join(segmentedDirAbs, `${item.contentId}.json`);

    try {
      const parsed = await loadJson(parsedPath);
      const posts = buildPosts(parsed);

      const summary = {
        postCount: posts.length,
        textBlocks: posts.reduce((acc, x) => acc + Number(x.counts?.textBlocks || 0), 0),
        bodyLines: posts.reduce((acc, x) => acc + Number(x.counts?.bodyLines || 0), 0),
        commentLines: posts.reduce((acc, x) => acc + Number(x.counts?.commentLines || 0), 0),
        imageBlocks: posts.reduce((acc, x) => acc + Number(x.counts?.imageBlocks || 0), 0),
      };

      const out = {
        generatedAt: nowIso(),
        contentId: parsed.contentId,
        sha256: parsed.sha256,
        source: parsed.source,
        identity: parsed.identity,
        pageCount: parsed.pageCount,
        postStartRule: 'YYYY/MM/DD HH:MM + blog.naver.com URL',
        posts,
        summary,
      };

      await saveJson(outPath, out);

      item.pipeline.segmentState = 'segmented';
      item.pipeline.lastSegmentedAt = nowIso();
      item.pipeline.segmentError = '';
      item.segmentMeta = {
        outputPath: outPath,
        postCount: summary.postCount,
        bodyLines: summary.bodyLines,
        commentLines: summary.commentLines,
        imageBlocks: summary.imageBlocks,
        segmentedAt: nowIso(),
      };

      segmented += 1;
      console.log(`[segment] ok ${item.contentId} posts=${summary.postCount} body=${summary.bodyLines} comments=${summary.commentLines}`);
    } catch (err) {
      item.pipeline.segmentState = 'failed';
      item.pipeline.lastSegmentedAt = nowIso();
      item.pipeline.segmentError = String(err?.message || err);
      failed += 1;
      console.log(`[segment] fail ${item.contentId} ${item.pipeline.segmentError}`);
    }
  }

  catalog.generatedAt = nowIso();
  await saveJson(catalogPathAbs, catalog);

  console.log(
    JSON.stringify(
      {
        catalogPath: catalogPathAbs,
        segmentedDir: segmentedDirAbs,
        processed,
        segmented,
        failed,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
