import { mkdir, readFile, readdir, writeFile } from 'fs/promises';
import path from 'path';

const ROOT = process.cwd();
const UNIQUE_PATH = process.env.CONTENT_UNIQUE_POSTS_PATH || 'data/content/dedup/posts-unique.json';
const SEGMENTED_DIR = process.env.CONTENT_SEGMENTED_DIR || 'data/content/segmented';
const CLASSIFIED_DIR = process.env.CONTENT_CLASSIFIED_DIR || 'data/content/classified';
const OUT_JSON = process.env.CONTENT_ANALYSIS_OUT_JSON || 'data/content/analysis/conversion-patterns.json';
const OUT_MD = process.env.CONTENT_ANALYSIS_OUT_MD || 'docs/content-conversion-analysis.md';

const CTA_KEYWORDS = ['문의', '상담', '예약', '방문', '연락', '전화', '톡', '오시는길', '위치', '주소', '견적', '가격', '비용', '이벤트'];
const LOCAL_KEYWORDS = ['파주', '일산', '서울', '경기', '전국'];
const TRUST_KEYWORDS = ['전문', '정품', '인증', '보증', '노하우', '경험', '시공사례', '검증', '안전'];
const READABILITY_BAD = ['ㅋㅋㅋㅋ', 'ㅎㅎㅎㅎ', '!!!!', '????'];

async function loadJson(filePath) {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function saveText(filePath, text) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, text, 'utf8');
}

function mean(nums) {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function percentile(nums, p) {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[i];
}

function countHits(text, words) {
  const s = String(text || '');
  let c = 0;
  for (const w of words) if (s.includes(w)) c += 1;
  return c;
}

function readabilityRisk(lines) {
  const arr = Array.isArray(lines) ? lines : [];
  if (!arr.length) return { score: 0, longLineRate: 0, noisyLineRate: 0 };
  let longLines = 0;
  let noisy = 0;
  for (const line of arr) {
    const t = String(line || '').trim();
    if (t.length >= 85) longLines += 1;
    if (READABILITY_BAD.some((w) => t.includes(w))) noisy += 1;
  }
  const longRate = longLines / arr.length;
  const noisyRate = noisy / arr.length;
  const score = Number((longRate * 0.7 + noisyRate * 0.3).toFixed(4));
  return { score, longLineRate: Number(longRate.toFixed(4)), noisyLineRate: Number(noisyRate.toFixed(4)) };
}

async function main() {
  const uniqueAbs = path.resolve(ROOT, UNIQUE_PATH);
  const segmentedDirAbs = path.resolve(ROOT, SEGMENTED_DIR);
  const classifiedDirAbs = path.resolve(ROOT, CLASSIFIED_DIR);
  const outJsonAbs = path.resolve(ROOT, OUT_JSON);
  const outMdAbs = path.resolve(ROOT, OUT_MD);

  const unique = await loadJson(uniqueAbs);
  const uniquePosts = Array.isArray(unique.uniquePosts) ? unique.uniquePosts : [];

  const segmentedFiles = (await readdir(segmentedDirAbs)).filter((f) => f.endsWith('.json'));
  const segmentedMap = new Map();
  for (const f of segmentedFiles) {
    const j = await loadJson(path.join(segmentedDirAbs, f)).catch(() => null);
    if (!j?.contentId || !Array.isArray(j.posts)) continue;
    for (const p of j.posts) {
      segmentedMap.set(`${j.contentId}#${p.postIndex}`, p);
    }
  }

  const classifiedFiles = (await readdir(classifiedDirAbs)).filter((f) => f.endsWith('.json'));
  const classifiedMap = new Map();
  for (const f of classifiedFiles) {
    const j = await loadJson(path.join(classifiedDirAbs, f)).catch(() => null);
    if (j?.contentId) classifiedMap.set(j.contentId, j);
  }

  const rows = [];
  for (const u of uniquePosts) {
    const keep = u.keep || {};
    const contentId = keep.contentId;
    const postIndex = keep.postIndex;
    const seg = segmentedMap.get(`${contentId}#${postIndex}`);
    if (!seg) continue;

    const title = String(seg.title || keep.title || '');
    const bodyLines = Array.isArray(seg.bodyLines) ? seg.bodyLines : [];
    const allText = `${title}\n${bodyLines.join('\n')}`;
    const cls = classifiedMap.get(contentId);

    const ctaHits = countHits(allText, CTA_KEYWORDS);
    const localHits = countHits(allText, LOCAL_KEYWORDS);
    const trustHits = countHits(allText, TRUST_KEYWORDS);
    const comments = Number(seg.counts?.commentLines || 0);
    const images = Number(seg.counts?.imageBlocks || 0);
    const bodyCount = Number(seg.counts?.bodyLines || 0);
    const titleLen = title.length;
    const read = readabilityRisk(bodyLines);

    const conversionProxy = Number((comments * 0.45 + ctaHits * 1.8 + localHits * 1.4 + trustHits * 1.2 + images * 0.08 - read.score * 4).toFixed(4));

    rows.push({
      contentId,
      postIndex,
      url: keep.url || '',
      title,
      titleLen,
      bodyCount,
      comments,
      images,
      ctaHits,
      localHits,
      trustHits,
      readRisk: read.score,
      conversionProxy,
      categories: cls?.categories || {},
    });
  }

  const scores = rows.map((r) => r.conversionProxy);
  const q75 = percentile(scores, 0.75);
  const high = rows.filter((r) => r.conversionProxy >= q75);
  const normal = rows.filter((r) => r.conversionProxy < q75);

  function summarize(set) {
    return {
      count: set.length,
      avgTitleLen: Number(mean(set.map((x) => x.titleLen)).toFixed(2)),
      avgBodyLines: Number(mean(set.map((x) => x.bodyCount)).toFixed(2)),
      avgComments: Number(mean(set.map((x) => x.comments)).toFixed(2)),
      avgImages: Number(mean(set.map((x) => x.images)).toFixed(2)),
      avgCtaHits: Number(mean(set.map((x) => x.ctaHits)).toFixed(2)),
      avgLocalHits: Number(mean(set.map((x) => x.localHits)).toFixed(2)),
      avgTrustHits: Number(mean(set.map((x) => x.trustHits)).toFixed(2)),
      avgReadRisk: Number(mean(set.map((x) => x.readRisk)).toFixed(4)),
      avgProxy: Number(mean(set.map((x) => x.conversionProxy)).toFixed(4)),
    };
  }

  const catBuckets = {
    brand: new Map(),
    workType: new Map(),
    contentType: new Map(),
    targetRegion: new Map(),
  };

  for (const r of rows) {
    for (const group of ['brand', 'workType', 'contentType', 'targetRegion']) {
      const arr = Array.isArray(r.categories?.[group]) ? r.categories[group] : [];
      for (const key of arr) {
        const bucket = catBuckets[group].get(key) || [];
        bucket.push(r);
        catBuckets[group].set(key, bucket);
      }
    }
  }

  function topCat(group, limit = 8) {
    return [...catBuckets[group].entries()]
      .map(([key, arr]) => ({
        key,
        count: arr.length,
        avgProxy: Number(mean(arr.map((x) => x.conversionProxy)).toFixed(4)),
        avgComments: Number(mean(arr.map((x) => x.comments)).toFixed(2)),
        avgCtaHits: Number(mean(arr.map((x) => x.ctaHits)).toFixed(2)),
        avgReadRisk: Number(mean(arr.map((x) => x.readRisk)).toFixed(4)),
      }))
      .sort((a, b) => b.avgProxy - a.avgProxy || b.count - a.count)
      .slice(0, limit);
  }

  const lowReadability = rows
    .filter((r) => r.readRisk >= 0.2)
    .sort((a, b) => b.readRisk - a.readRisk)
    .slice(0, 30)
    .map((x) => ({
      contentId: x.contentId,
      postIndex: x.postIndex,
      url: x.url,
      readRisk: x.readRisk,
      title: x.title,
    }));

  const lowCta = rows
    .filter((r) => r.ctaHits === 0)
    .slice(0, 80)
    .map((x) => ({
      contentId: x.contentId,
      postIndex: x.postIndex,
      url: x.url,
      title: x.title,
    }));

  const analysis = {
    generatedAt: new Date().toISOString(),
    source: {
      uniquePostCount: uniquePosts.length,
      analyzedPostCount: rows.length,
      duplicateUrlCount: Number(unique.duplicateUrlCount || 0),
    },
    summary: {
      overall: summarize(rows),
      highConversionLike: summarize(high),
      baseline: summarize(normal),
      q75ConversionProxy: q75,
    },
    categoryPatterns: {
      brand: topCat('brand'),
      workType: topCat('workType'),
      contentType: topCat('contentType'),
      targetRegion: topCat('targetRegion'),
    },
    gaps: {
      lowReadabilityCount: lowReadability.length,
      noCtaCount: rows.filter((r) => r.ctaHits === 0).length,
      noLocalKeywordCount: rows.filter((r) => r.localHits === 0).length,
      lowReadabilitySamples: lowReadability,
      noCtaSamples: lowCta,
    },
    recommendations: [
      '제목 45~70자 범위, 차량/작업/지역/핵심효과(예: 제동력 개선) 4요소를 고정 템플릿으로 적용',
      '본문 초반 5줄 안에 문제상황-원인-해결-결과를 순서화하고, 1단락 2~3문장으로 분리',
      '중후반에 지역+문의 CTA를 1회, 하단에 예약/전화/방문 CTA를 1회 고정 삽입',
      '이미지 중심 글은 최소 설명문 6~10줄 보강(작업 전/중/후, 부품 스펙, 주의사항)',
      '댓글 반응이 높은 패턴(작업 사례+비용/상담 유도 문구)을 재업로드 템플릿으로 재사용',
    ],
  };

  await saveText(outJsonAbs, `${JSON.stringify(analysis, null, 2)}\n`);

  const md = [
    '# 블로그 전환 패턴 분석',
    '',
    `- 생성시각: ${analysis.generatedAt}`,
    `- 분석대상 유니크 글: ${analysis.source.analyzedPostCount}건`,
    `- 중복 URL: ${analysis.source.duplicateUrlCount}건`,
    '',
    '## 핵심 수치',
    `- 상위 전환유사군 기준점(q75): ${analysis.summary.q75ConversionProxy.toFixed(4)}`,
    `- 전체 평균 댓글라인: ${analysis.summary.overall.avgComments}`,
    `- 전체 평균 CTA 키워드: ${analysis.summary.overall.avgCtaHits}`,
    `- 전체 평균 지역 키워드: ${analysis.summary.overall.avgLocalHits}`,
    '',
    '## 상위 전환유사군 패턴',
    `- 제목 길이 평균: ${analysis.summary.highConversionLike.avgTitleLen}`,
    `- 본문 라인 평균: ${analysis.summary.highConversionLike.avgBodyLines}`,
    `- 댓글 라인 평균: ${analysis.summary.highConversionLike.avgComments}`,
    `- CTA 키워드 평균: ${analysis.summary.highConversionLike.avgCtaHits}`,
    `- 지역 키워드 평균: ${analysis.summary.highConversionLike.avgLocalHits}`,
    '',
    '## 보완 필요',
    `- CTA 키워드 0건 글: ${analysis.gaps.noCtaCount}`,
    `- 지역 키워드 0건 글: ${analysis.gaps.noLocalKeywordCount}`,
    `- 가독성 위험 글(샘플): ${analysis.gaps.lowReadabilityCount}`,
    '',
    '## 권장 액션',
    ...analysis.recommendations.map((x) => `- ${x}`),
    '',
  ].join('\n');

  await saveText(outMdAbs, md);

  console.log(
    JSON.stringify(
      {
        outJson: outJsonAbs,
        outMarkdown: outMdAbs,
        analyzedPostCount: rows.length,
        q75ConversionProxy: q75,
        noCtaCount: analysis.gaps.noCtaCount,
        noLocalKeywordCount: analysis.gaps.noLocalKeywordCount,
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
