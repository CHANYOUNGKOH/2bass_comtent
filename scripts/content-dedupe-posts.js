import { mkdir, readdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

const ROOT = process.cwd();
const SEGMENTED_DIR = process.env.CONTENT_SEGMENTED_DIR || 'data/content/segmented';
const OUT_UNIQUE_PATH = process.env.CONTENT_UNIQUE_POSTS_PATH || 'data/content/dedup/posts-unique.json';
const OUT_DUP_PATH = process.env.CONTENT_DUPLICATE_POSTS_PATH || 'data/content/dedup/posts-duplicates.json';

async function loadJson(filePath) {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function saveJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function toNum(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function scorePost(post, sourcePageNo) {
  const body = toNum(post?.counts?.bodyLines);
  const comments = toNum(post?.counts?.commentLines);
  const images = toNum(post?.counts?.imageBlocks);
  const textBlocks = toNum(post?.counts?.textBlocks);
  const pageStart = toNum(post?.pageRange?.start);
  const pageEnd = toNum(post?.pageRange?.end);
  const pageSpan = pageStart > 0 && pageEnd >= pageStart ? pageEnd - pageStart + 1 : 0;
  const sourceScore = Number.isFinite(sourcePageNo) ? 1 : 0;

  return body * 5 + comments * 2 + images + textBlocks + pageSpan + sourceScore;
}

function normalizeUrl(url) {
  return String(url || '').trim();
}

async function main() {
  const segmentedDirAbs = path.resolve(ROOT, SEGMENTED_DIR);
  const outUniqueAbs = path.resolve(ROOT, OUT_UNIQUE_PATH);
  const outDupAbs = path.resolve(ROOT, OUT_DUP_PATH);

  const files = (await readdir(segmentedDirAbs).catch(() => [])).filter((x) => x.toLowerCase().endsWith('.json'));

  const byUrl = new Map();
  const noUrl = [];

  for (const fileName of files) {
    const filePath = path.join(segmentedDirAbs, fileName);
    const json = await loadJson(filePath).catch(() => null);
    if (!json) continue;

    const contentId = json.contentId;
    const sourceName = json?.source?.latestSourceName || '';
    const sourcePageNo = Number.isFinite(json?.identity?.pageNo) ? Number(json.identity.pageNo) : null;

    for (const post of json.posts || []) {
      const entry = {
        contentId,
        sourceName,
        sourcePageNo,
        postIndex: post.postIndex,
        postId: post.postId,
        publishedAt: post.publishedAt || '',
        sourceUrl: post.sourceUrl || '',
        title: post.title || '',
        pageRange: post.pageRange || { start: '', end: '' },
        counts: post.counts || { textBlocks: 0, bodyLines: 0, commentLines: 0, imageBlocks: 0 },
        bodyPreview: Array.isArray(post.bodyPreview) ? post.bodyPreview : [],
      };

      const url = normalizeUrl(post.sourceUrl);
      if (!url) {
        noUrl.push(entry);
        continue;
      }

      const list = byUrl.get(url) || [];
      list.push(entry);
      byUrl.set(url, list);
    }
  }

  const uniquePosts = [];
  const duplicateGroups = [];

  for (const [url, entries] of byUrl.entries()) {
    const ranked = entries
      .map((x) => ({
        ...x,
        _score: scorePost(x, x.sourcePageNo),
      }))
      .sort((a, b) => {
        if (b._score !== a._score) return b._score - a._score;
        const ap = Number.isFinite(a.sourcePageNo) ? a.sourcePageNo : Number.MAX_SAFE_INTEGER;
        const bp = Number.isFinite(b.sourcePageNo) ? b.sourcePageNo : Number.MAX_SAFE_INTEGER;
        if (ap !== bp) return ap - bp;
        return String(a.contentId).localeCompare(String(b.contentId));
      });

    const best = ranked[0];
    uniquePosts.push({
      url,
      keep: {
        contentId: best.contentId,
        sourceName: best.sourceName,
        sourcePageNo: best.sourcePageNo,
        postIndex: best.postIndex,
        postId: best.postId,
        publishedAt: best.publishedAt,
        title: best.title,
        pageRange: best.pageRange,
        counts: best.counts,
        bodyPreview: best.bodyPreview,
      },
      duplicateCount: ranked.length - 1,
    });

    if (ranked.length > 1) {
      duplicateGroups.push({
        url,
        count: ranked.length,
        keep: {
          contentId: best.contentId,
          sourceName: best.sourceName,
          postIndex: best.postIndex,
          score: best._score,
        },
        drop: ranked.slice(1).map((x) => ({
          contentId: x.contentId,
          sourceName: x.sourceName,
          postIndex: x.postIndex,
          score: x._score,
        })),
      });
    }
  }

  uniquePosts.sort((a, b) => {
    const ad = String(a.keep.publishedAt || '');
    const bd = String(b.keep.publishedAt || '');
    if (ad !== bd) return bd.localeCompare(ad);
    return String(a.url).localeCompare(String(b.url));
  });

  duplicateGroups.sort((a, b) => b.count - a.count || a.url.localeCompare(b.url));

  const uniqueOut = {
    generatedAt: new Date().toISOString(),
    sourceDir: segmentedDirAbs,
    totalSegmentedFiles: files.length,
    totalUrls: byUrl.size,
    uniquePostCount: uniquePosts.length,
    duplicateUrlCount: duplicateGroups.length,
    noUrlPostCount: noUrl.length,
    uniquePosts,
    noUrlPosts: noUrl,
  };

  const dupOut = {
    generatedAt: new Date().toISOString(),
    duplicateUrlCount: duplicateGroups.length,
    duplicateGroups,
  };

  await saveJson(outUniqueAbs, uniqueOut);
  await saveJson(outDupAbs, dupOut);

  console.log(
    JSON.stringify(
      {
        outUnique: outUniqueAbs,
        outDuplicates: outDupAbs,
        totalSegmentedFiles: files.length,
        uniquePostCount: uniquePosts.length,
        duplicateUrlCount: duplicateGroups.length,
        noUrlPostCount: noUrl.length,
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
