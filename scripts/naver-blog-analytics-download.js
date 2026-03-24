import { chromium } from 'playwright';
import { config } from 'dotenv';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

config();

const NAVER_ID = process.env.NAVER_ID || process.env.NAVER_SELLER_ID;
const NAVER_PW = process.env.NAVER_PW || process.env.NAVER_SELLER_PW;
const HEADLESS = String(process.env.HEADLESS || 'false').toLowerCase() === 'true';
const SLOW_MO = Number(process.env.SLOW_MO || 80);
const DOWNLOAD_DIR = process.env.NAVER_BLOG_ANALYTICS_DOWNLOAD_DIR || 'output/naver-blog-analytics';
const PROGRESS_PATH = process.env.NAVER_BLOG_ANALYTICS_PROGRESS_PATH || 'output/naver-blog-analytics-download-progress.json';
const DEBUG_DIR = process.env.NAVER_BLOG_ANALYTICS_DEBUG_DIR || 'output/naver-blog-analytics-debug';
const ANALYTICS_URL = process.env.NAVER_BLOG_ANALYTICS_URL || '';
const BLOG_ID = process.env.NAVER_BLOG_ID || '2basstune';
const MAX_DOWNLOAD_CLICKS = Number(process.env.NAVER_BLOG_ANALYTICS_MAX_CLICKS || 20);
const LIST_TYPES_ONLY = String(process.env.NAVER_BLOG_ANALYTICS_LIST_TYPES_ONLY || 'false').toLowerCase() === 'true';
const DATA_TYPE_LABEL = String(process.env.NAVER_BLOG_ANALYTICS_DATATYPE_LABEL || '').trim();
const PERIODS = String(process.env.NAVER_BLOG_ANALYTICS_PERIODS || 'day,week,month')
  .split(',')
  .map((x) => x.trim().toLowerCase())
  .filter(Boolean);
const MAX_CLICKS_PER_PERIOD = Number(process.env.NAVER_BLOG_ANALYTICS_MAX_CLICKS_PER_PERIOD || 1);

const STATS_HINTS = ['통계', '분석', '유입', '방문', 'Statistics', 'Analytics', 'visitor', 'referer', 'stat'];
const DOWNLOAD_HINTS = ['다운로드', '내려받기', '엑셀', 'Excel', 'CSV', '다운', 'export', '파일'];
const BLOCKED_HINTS = ['seller.blog.naver.com', 'joinGuide', 'market', '마켓', '가입'];
const PERIOD_LABELS = {
  day: [/일간/, /일별/, /daily/i],
  week: [/주간/, /주별/, /weekly/i],
  month: [/월간/, /월별/, /monthly/i],
};
const MAX_RANGE_LABELS = [
  /전체\s*기간/,
  /최대\s*기간/,
  /최대/,
  /전체/,
  /최근\s*1년/,
  /1년/,
  /12개월/,
  /all/i,
  /max/i,
];
const METRIC_LABELS = {
  download: [/다운로드/, /download/i],
  visit_pv: [/조회수/, /방문자수/, /pv/i, /view/i],
  referer: [/유입/, /유입경로/, /referrer/i, /referer/i],
  rank_pv: [/게시글/, /포스트/, /글/, /rank/i, /조회수/i],
  rank_like: [/공감/, /좋아요/, /like/i],
  rank_comment: [/댓글/, /comment/i],
  uv: [/순방문/, /방문자/, /uv/i],
  visit: [/방문/, /visit/i],
};
const METRIC_KEYWORDS = {
  download: ['download', '다운로드'],
  visit_pv: ['visit_pv', 'pv', '조회', 'view'],
  referer: ['referer', 'referrer', '유입'],
  rank_pv: ['rank_pv', '게시글', '포스트', '랭킹'],
  rank_like: ['rank_like', '공감', '좋아요', 'like'],
  rank_comment: ['rank_comment', '댓글', 'comment', 'reply'],
  uv: ['uv', '순방문', '방문자'],
  visit: ['visit', '방문'],
};
const DOWNLOAD_DATATYPE_LABELS = {
  visit_pv: [/조회수/, /pv/i, /view/i],
  referer: [/유입분석/, /유입/, /referer/i, /referrer/i],
  rank_pv: [/조회수\s*순위/, /게시글\s*통계/, /게시글/, /rank/i],
  rank_like: [/공감수\s*순위/, /공감/, /좋아요/, /like/i],
  rank_comment: [/댓글수\s*순위/, /댓글/, /comment/i],
  uv: [/순방문자수/, /순방문/, /uv/i],
  visit: [/방문\s*횟수/, /visit/i],
  download: [/조회수/, /cv/i],
};

function nowIso() {
  return new Date().toISOString();
}

function escapeRegExp(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeFileName(name) {
  return String(name || 'download.bin')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

async function resolveUniquePath(baseDir, fileName) {
  const parsed = path.parse(fileName);
  const ext = parsed.ext || '.bin';
  const base = parsed.name || 'download';
  for (let i = 0; i < 1000; i += 1) {
    const candidate = i === 0 ? `${base}${ext}` : `${base}-${i}${ext}`;
    const abs = path.resolve(baseDir, candidate);
    try {
      await readFile(abs);
    } catch {
      return abs;
    }
  }
  return path.resolve(baseDir, `${base}-${Date.now()}${ext}`);
}

async function loadProgress(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveProgress(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function clickAndResolvePage(sourcePage, clickAction) {
  const popupPromise = sourcePage.waitForEvent('popup', { timeout: 5000 }).catch(() => null);
  await clickAction();
  const popup = await popupPromise;
  const target = popup || sourcePage;
  await target.waitForLoadState('domcontentloaded').catch(() => {});
  return target;
}

async function gotoManagerStats(page) {
  if (ANALYTICS_URL) {
    await page.goto(ANALYTICS_URL, { waitUntil: 'domcontentloaded' });
    return page;
  }

  if (BLOG_ID) {
    const directAdminUrls = [
      `https://admin.blog.naver.com/${BLOG_ID}`,
      `https://blog.naver.com/${BLOG_ID}?Redirect=Admin`,
      `https://blog.naver.com/PostList.naver?blogId=${BLOG_ID}&from=postList&categoryNo=0&parentCategoryNo=0`,
    ];
    for (const url of directAdminUrls) {
      await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
      const current = page.url();
      if (BLOCKED_HINTS.some((x) => current.includes(x))) continue;
      await page.waitForTimeout(800);
      return page;
    }
  }

  const blogPage = await clickAndResolvePage(page, async () => {
    await page.getByRole('link', { name: /블로그|BLOG/i }).first().click();
  });

  const profilePage = await clickAndResolvePage(blogPage, async () => {
    const profile = blogPage.getByRole('link', { name: /프로필|Profile/i }).first();
    if ((await profile.count()) > 0) {
      await profile.click();
      return;
    }
    await blogPage.locator('a[href*="blog.naver.com"]').first().click();
  });

  const mainFrame = profilePage.frame({ name: 'mainFrame' });
  if (mainFrame) {
    const manage = mainFrame.getByRole('link', { name: /관리|Manage/i }).first();
    if ((await manage.count()) > 0) await manage.click({ force: true });
  }

  const manageLink = profilePage.getByRole('link', { name: /메뉴.*관리|관리|Manage/i }).first();
  if ((await manageLink.count()) > 0) {
    await manageLink.click({ force: true }).catch(() => {});
    await profilePage.waitForTimeout(800);
  }

  const candidateFrames = [profilePage.mainFrame(), ...profilePage.frames()];

  for (const frame of candidateFrames) {
    const links = frame.locator('a');
    const cnt = await links.count().catch(() => 0);
    for (let i = 0; i < Math.min(cnt, 250); i += 1) {
      const a = links.nth(i);
      const txt = ((await a.innerText().catch(() => '')) || '').trim();
      const href = ((await a.getAttribute('href').catch(() => '')) || '').trim();
      const sig = `${txt} ${href}`;
      if (BLOCKED_HINTS.some((k) => sig.toLowerCase().includes(k.toLowerCase()))) continue;
      if (!STATS_HINTS.some((k) => sig.toLowerCase().includes(k.toLowerCase()))) continue;
      await a.click({ force: true }).catch(() => {});
      await profilePage.waitForTimeout(1200);
      return profilePage;
    }
  }

  return profilePage;
}

function getCandidateFrames(page) {
  const all = page.frames();
  const scored = all
    .map((f) => {
      const sig = `${f.name()} ${f.url()}`;
      let score = 0;
      if (/statmain/i.test(f.name())) score += 200;
      if (/blog\.stat\.naver\.com/i.test(f.url())) score += 200;
      if (/\/stat\/download/i.test(f.url())) score += 120;
      if (/papermain|main|manage|admin|stat/i.test(sig)) score += 40;
      return { f, score };
    })
    .sort((a, b) => b.score - a.score);
  return scored.map((x) => x.f);
}

async function tryClickFirstMatch(frame, regexList) {
  const nodes = frame.locator('a,button,label,li,option,input[type="button"],input[type="submit"],[role="button"]');
  const n = await nodes.count().catch(() => 0);
  for (let i = 0; i < Math.min(n, 500); i += 1) {
    const node = nodes.nth(i);
    const text = ((await node.innerText().catch(() => '')) || '').trim();
    const title = ((await node.getAttribute('title').catch(() => '')) || '').trim();
    const aria = ((await node.getAttribute('aria-label').catch(() => '')) || '').trim();
    const value = ((await node.getAttribute('value').catch(() => '')) || '').trim();
    const sig = `${text} ${title} ${aria} ${value}`.replace(/\s+/g, ' ').trim();
    if (!sig) continue;
    if (!regexList.some((r) => r.test(sig))) continue;
    await node.click({ force: true }).catch(() => {});
    return sig;
  }
  return '';
}

async function setSelectValueByRegex(frame, regexList) {
  const selects = frame.locator('select');
  const n = await selects.count().catch(() => 0);
  for (let i = 0; i < n; i += 1) {
    const sel = selects.nth(i);
    const options = sel.locator('option');
    const oc = await options.count().catch(() => 0);
    for (let j = 0; j < oc; j += 1) {
      const opt = options.nth(j);
      const txt = ((await opt.innerText().catch(() => '')) || '').trim();
      const val = ((await opt.getAttribute('value').catch(() => '')) || '').trim();
      const sig = `${txt} ${val}`;
      if (!regexList.some((r) => r.test(sig))) continue;
      const targetValue = val || txt;
      if (!targetValue) continue;
      await sel.selectOption({ value: val }).catch(async () => {
        await sel.selectOption({ label: txt }).catch(() => {});
      });
      return sig;
    }
  }
  return '';
}

async function applyPeriodAndMaxRange(page, periodMode) {
  const frames = getCandidateFrames(page);
  const periodRegex = PERIOD_LABELS[periodMode] || [];
  const notes = [];

  for (const frame of frames) {
    if (periodRegex.length > 0) {
      const periodBySelect = await setSelectValueByRegex(frame, periodRegex);
      if (periodBySelect) notes.push(`period_select:${periodBySelect}`);

      const periodByClick = await tryClickFirstMatch(frame, periodRegex);
      if (periodByClick) notes.push(`period_click:${periodByClick}`);
    }

    const maxBySelect = await setSelectValueByRegex(frame, MAX_RANGE_LABELS);
    if (maxBySelect) notes.push(`range_select:${maxBySelect}`);

    const maxByClick = await tryClickFirstMatch(frame, MAX_RANGE_LABELS);
    if (maxByClick) notes.push(`range_click:${maxByClick}`);
  }

  await page.waitForTimeout(800);
  return notes;
}

function parseMetricModeFromUrl(url) {
  const u = String(url || '').toLowerCase();
  const m = u.match(/\/stat\/([a-z_]+)/i);
  return m?.[1] || '';
}

async function applyMetricMode(page) {
  const mode = parseMetricModeFromUrl(ANALYTICS_URL || page.url());
  if (!mode || !METRIC_LABELS[mode]) return [];

  const notes = [`metric_mode:${mode}`];
  const regexes = METRIC_LABELS[mode];
  const frames = getCandidateFrames(page);

  for (const frame of frames) {
    const bySelect = await setSelectValueByRegex(frame, regexes);
    if (bySelect) notes.push(`metric_select:${bySelect}`);

    const byClick = await tryClickFirstMatch(frame, regexes);
    if (byClick) notes.push(`metric_click:${byClick}`);
  }

  await page.waitForTimeout(600);
  return notes;
}

async function applyDataTypeOnDownloadPage(page, mode) {
  const regexes = DOWNLOAD_DATATYPE_LABELS[mode] || [];
  const notes = [`download_mode:${mode}`];
  if (regexes.length === 0) return notes;

  for (const frame of getCandidateFrames(page)) {
    const bySelect = await setSelectValueByRegex(frame, regexes);
    if (bySelect) notes.push(`datatype_select:${bySelect}`);

    const byClick = await tryClickFirstMatch(frame, regexes);
    if (byClick) notes.push(`datatype_click:${byClick}`);
  }
  await page.waitForTimeout(700);
  return notes;
}

async function listDataTypeLabelsOnDownloadPage(page) {
  const include = [/조회수/, /순방문/, /방문/, /유입/, /순위/, /공감/, /댓글/, /재생/, /분포/, /시간/, /이웃/, /국가/];
  const exclude = [
    /권한/,
    /설정/,
    /지표\s*다운로드/,
    /기간\s*전환/,
    /^다운로드$/,
    /내\s*블로그/,
    /서비스/,
    /메뉴/,
    /관리/,
    /BETA/i,
    /홈/,
    /링크/,
    /신청/,
    /글\s*저장/,
  ];
  const results = [];
  const seen = new Set();

  for (const frame of getCandidateFrames(page)) {
    // Open dropdown-like controls first if present.
    await tryClickFirstMatch(frame, [/지표/, /데이터/, /종류/, /조회수/]).catch(() => {});
    await page.waitForTimeout(200);

    const nodes = frame.locator('li,a,button,option,span,div,label');
    const n = await nodes.count().catch(() => 0);
    for (let i = 0; i < Math.min(n, 1600); i += 1) {
      const node = nodes.nth(i);
      const text = ((await node.innerText().catch(() => '')) || '').trim().replace(/\s+/g, ' ');
      const title = ((await node.getAttribute('title').catch(() => '')) || '').trim();
      const aria = ((await node.getAttribute('aria-label').catch(() => '')) || '').trim();
      const dataValue = ((await node.getAttribute('data-value').catch(() => '')) || '').trim();
      const sig = `${text} ${title} ${aria}`.trim();
      if (!text || text.length > 20) continue;
      if (!include.some((r) => r.test(sig))) continue;
      if (exclude.some((r) => r.test(sig))) continue;
      // Skip concatenated menu lines like "순위 조회수 순위 공감수 순위 ..."
      if ((text.match(/순위/g) || []).length >= 2) continue;
      if ((text.match(/방문/g) || []).length >= 2) continue;
      const k = `${text}::${dataValue}`;
      if (seen.has(k)) continue;
      seen.add(k);
      results.push({ label: text, value: dataValue });
    }
  }
  return results;
}

async function applyDataTypeLabelOnDownloadPage(page, label) {
  const notes = [];
  if (!label) return notes;
  const exact = new RegExp(`^\\s*${escapeRegExp(label)}\\s*$`);
  const loose = new RegExp(escapeRegExp(label));
  for (const frame of getCandidateFrames(page)) {
    await tryClickFirstMatch(frame, [/지표/, /데이터/, /종류/, /조회수/]).catch(() => {});
    await page.waitForTimeout(150);
    const s1 = await setSelectValueByRegex(frame, [exact, loose]);
    if (s1) notes.push(`datatype_select:${s1}`);
    const s2 = await tryClickFirstMatch(frame, [exact, loose]);
    if (s2) notes.push(`datatype_click:${s2}`);
  }
  await page.waitForTimeout(700);
  return notes;
}

async function collectFrameActions(frame) {
  const actions = frame.locator('a,button,input[type="button"],input[type="submit"],[role="button"]');
  const n = await actions.count().catch(() => 0);
  const out = [];
  for (let i = 0; i < Math.min(n, 300); i += 1) {
    const node = actions.nth(i);
    const text = ((await node.innerText().catch(() => '')) || '').trim();
    const title = ((await node.getAttribute('title').catch(() => '')) || '').trim();
    const aria = ((await node.getAttribute('aria-label').catch(() => '')) || '').trim();
    const value = ((await node.getAttribute('value').catch(() => '')) || '').trim();
    const href = ((await node.getAttribute('href').catch(() => '')) || '').trim();
    const onclick = ((await node.getAttribute('onclick').catch(() => '')) || '').trim();
    const signature = `${text} ${title} ${aria} ${value} ${href} ${onclick}`.replace(/\s+/g, ' ').trim();
    if (!signature) continue;
    out.push(signature);
  }
  return out;
}

async function dumpDebug(page, reason) {
  const debugAbs = path.resolve(process.cwd(), DEBUG_DIR);
  await mkdir(debugAbs, { recursive: true });

  const stamp = Date.now();
  const shotPath = path.join(debugAbs, `debug-${stamp}.png`);
  await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});

  const frames = [];
  for (const frame of page.frames()) {
    frames.push({
      name: frame.name(),
      url: frame.url(),
      actions: await collectFrameActions(frame),
    });
  }

  const jsonPath = path.join(debugAbs, `debug-${stamp}.json`);
  await writeFile(
    jsonPath,
    `${JSON.stringify(
      {
        at: nowIso(),
        reason,
        pageUrl: page.url(),
        frames,
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  return { debugJson: jsonPath, debugScreenshot: shotPath };
}

async function clickStatsMenuOnce(page) {
  const frames = getCandidateFrames(page);
  for (const frame of frames) {
    const links = frame.locator('a,button,[role="button"]');
    const cnt = await links.count().catch(() => 0);
    for (let i = 0; i < Math.min(cnt, 250); i += 1) {
      const node = links.nth(i);
      const text = ((await node.innerText().catch(() => '')) || '').trim();
      const title = ((await node.getAttribute('title').catch(() => '')) || '').trim();
      const href = ((await node.getAttribute('href').catch(() => '')) || '').trim();
      const sig = `${text} ${title} ${href}`;
      if (BLOCKED_HINTS.some((k) => sig.toLowerCase().includes(k.toLowerCase()))) continue;
      if (!STATS_HINTS.some((k) => sig.toLowerCase().includes(k.toLowerCase()))) continue;
      await node.click({ force: true }).catch(() => {});
      await page.waitForTimeout(1000);
      return true;
    }
  }
  return false;
}

async function collectDownloadCandidates(frame) {
  const nodes = frame.locator('a,button,input[type="button"],input[type="submit"],[role="button"]');
  const out = [];
  const n = await nodes.count().catch(() => 0);

  for (let i = 0; i < Math.min(n, 400); i += 1) {
    const node = nodes.nth(i);
    const text = ((await node.innerText().catch(() => '')) || '').trim();
    const title = ((await node.getAttribute('title').catch(() => '')) || '').trim();
    const aria = ((await node.getAttribute('aria-label').catch(() => '')) || '').trim();
    const value = ((await node.getAttribute('value').catch(() => '')) || '').trim();
    const href = ((await node.getAttribute('href').catch(() => '')) || '').trim();
    const onclick = ((await node.getAttribute('onclick').catch(() => '')) || '').trim();
    const signature = `${text} ${title} ${aria} ${value} ${href} ${onclick}`.replace(/\s+/g, ' ').trim();
    if (!signature) continue;
    if (!DOWNLOAD_HINTS.some((k) => signature.toLowerCase().includes(k.toLowerCase()))) continue;

    out.push({ node, signature, href, onclick, text, title, aria, value });
  }

  const dedup = [];
  const seen = new Set();
  for (const c of out) {
    if (seen.has(c.signature)) continue;
    seen.add(c.signature);
    dedup.push(c);
  }
  return dedup;
}

function scoreCandidateForMode(candidate, mode) {
  const blob = `${candidate.signature || ''} ${candidate.href || ''} ${candidate.onclick || ''}`.toLowerCase();
  const keywords = METRIC_KEYWORDS[mode] || [];
  let score = 0;
  if (mode && blob.includes(`/stat/${mode}`)) score += 120;
  for (const kw of keywords) {
    const k = String(kw || '').toLowerCase();
    if (!k) continue;
    if (blob.includes(k)) score += 30;
  }
  if (/지표\s*다운로드|download\s*#|csv/i.test(blob)) score -= 10;
  return score;
}

function sortCandidatesByMode(candidates, mode) {
  return [...(candidates || [])]
    .map((c) => ({ c, score: scoreCandidateForMode(c, mode) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.c);
}

async function main() {
  if (!NAVER_ID || !NAVER_PW) {
    throw new Error('NAVER_ID/NAVER_PW environment variable is required.');
  }

  const progressAbs = path.resolve(process.cwd(), PROGRESS_PATH);
  const downloadAbs = path.resolve(process.cwd(), DOWNLOAD_DIR);
  await mkdir(downloadAbs, { recursive: true });

  const loaded = (await loadProgress(progressAbs)) || {};
  const progress = {
    generatedAt: nowIso(),
    status: 'running',
    downloadDir: downloadAbs,
    downloadedCount: Number(loaded.downloadedCount || 0),
    files: Array.isArray(loaded.files) ? loaded.files : [],
    note: '',
  };
  await saveProgress(progressAbs, progress);

  const browser = await chromium.launch({ headless: HEADLESS, slowMo: SLOW_MO });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  try {
    await page.goto('https://nid.naver.com/nidlogin.login', { waitUntil: 'domcontentloaded' });
    const idInput = page.locator('#id');
    const pwInput = page.locator('#pw');
    if ((await idInput.count()) === 0 || (await pwInput.count()) === 0) {
      throw new Error('naver_login_form_not_found');
    }
    await idInput.fill(NAVER_ID);
    await pwInput.fill(NAVER_PW);

    const submit = page.locator('#log\\.login, button[type=\"submit\"], input[type=\"submit\"]').first();
    await submit.click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    if (page.url().includes('nidlogin.login')) {
      throw new Error('naver_login_failed_or_additional_auth_required');
    }

    const statsPage = await gotoManagerStats(page);
    await statsPage.waitForTimeout(1200);
    const requestedMetricMode = parseMetricModeFromUrl(ANALYTICS_URL || statsPage.url());
    progress.metricNotes = await applyMetricMode(statsPage);
    if (requestedMetricMode && requestedMetricMode !== 'download') {
      const forcedDownloadUrl = `https://admin.blog.naver.com/${BLOG_ID}/stat/download`;
      await statsPage.goto(forcedDownloadUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await statsPage.waitForTimeout(1000);
      const dtNotes = await applyDataTypeOnDownloadPage(statsPage, requestedMetricMode);
      progress.metricNotes = [...(progress.metricNotes || []), ...dtNotes];
      progress.metricForcedDownloadUrl = forcedDownloadUrl;
    }
    if (DATA_TYPE_LABEL) {
      const notes = await applyDataTypeLabelOnDownloadPage(statsPage, DATA_TYPE_LABEL);
      progress.metricNotes = [...(progress.metricNotes || []), ...notes, `datatype_label:${DATA_TYPE_LABEL}`];
    }
    if (LIST_TYPES_ONLY) {
      const list = await listDataTypeLabelsOnDownloadPage(statsPage);
      progress.status = 'completed';
      progress.note = 'list_types_only';
      progress.dataTypes = list;
      progress.generatedAt = nowIso();
      await saveProgress(progressAbs, progress);
      console.log(JSON.stringify({ ok: true, mode: 'list_types_only', count: list.length, dataTypes: list }, null, 2));
      return;
    }
    await saveProgress(progressAbs, progress);

    let candidates = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const frames = getCandidateFrames(statsPage);
      for (const frame of frames) {
        const found = await collectDownloadCandidates(frame);
        if (found.length > 0) {
          candidates = found;
          break;
        }
      }
      if (candidates.length > 0) break;
      await clickStatsMenuOnce(statsPage);
      await statsPage.waitForTimeout(800);
    }

    if (candidates.length === 0) {
      const dbg = await dumpDebug(statsPage, 'download_candidates_not_found');
      progress.status = 'stopped';
      progress.note = 'download_candidates_not_found';
      progress.debug = dbg;
      await saveProgress(progressAbs, progress);
      console.log(JSON.stringify({ ok: false, reason: progress.note, ...dbg }, null, 2));
      return;
    }

    const metricModeBeforeRedirect = parseMetricModeFromUrl(ANALYTICS_URL || statsPage.url());
    const shouldForceDownloadPage = !metricModeBeforeRedirect || metricModeBeforeRedirect === 'download';
    const statDownloadNav = candidates.find((x) => /\/stat\/download/i.test(String(x.href || '')));
    if (shouldForceDownloadPage && statDownloadNav && /^https?:\/\//i.test(String(statDownloadNav.href || ''))) {
      await statsPage.goto(statDownloadNav.href, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await statsPage.waitForTimeout(1000);
      candidates = [];
      for (const frame of getCandidateFrames(statsPage)) {
        const found = await collectDownloadCandidates(frame);
        if (found.length > 0) {
          candidates = found;
          break;
        }
      }
    }

    progress.candidates = candidates.slice(0, 60).map((x) => x.signature);
    progress.clickResults = [];
    progress.periods = [];
    await saveProgress(progressAbs, progress);

    const periodRuns = PERIODS.length > 0 ? PERIODS : ['day', 'week', 'month'];
    const metricMode = parseMetricModeFromUrl(ANALYTICS_URL || statsPage.url());
    let downloadedThisRun = 0;

    for (const periodMode of periodRuns) {
      const periodNotes = await applyPeriodAndMaxRange(statsPage, periodMode);
      await statsPage.waitForTimeout(500);

      candidates = [];
      for (const frame of getCandidateFrames(statsPage)) {
        const found = await collectDownloadCandidates(frame);
        if (found.length > 0) {
          candidates = found;
          break;
        }
      }
      progress.periods.push({
        at: nowIso(),
        period: periodMode,
        notes: periodNotes,
        candidateCount: candidates.length,
      });

      const rankedCandidates = sortCandidatesByMode(candidates, metricMode);
      const maxClicks = Math.min(MAX_DOWNLOAD_CLICKS, MAX_CLICKS_PER_PERIOD, rankedCandidates.length);
      for (let i = 0; i < maxClicks; i += 1) {
        const c = rankedCandidates[i];
        const responsePromise = statsPage
          .waitForResponse(
            (r) => /download|excel|csv|xls|blog\.stat\.naver\.com\/blog\/download/i.test(r.url()),
            { timeout: 12000 }
          )
          .catch(() => null);
        const dialogPromise = statsPage.waitForEvent('dialog', { timeout: 4000 }).catch(() => null);
        const popupPromise = statsPage.waitForEvent('popup', { timeout: 5000 }).catch(() => null);
        const dlPromise = context.waitForEvent('download', { timeout: 20000 }).catch(() => null);
        await c.node.click({ force: true }).catch(() => {});
        const dialog = await dialogPromise;
        if (dialog) {
          progress.clickResults.push({ period: periodMode, signature: c.signature, result: 'dialog', message: dialog.message() });
          await dialog.accept().catch(() => {});
        }
        const popup = await popupPromise;
        const dl = await dlPromise;
        if (dl) {
          const suggested = sanitizeFileName(dl.suggestedFilename() || `analytics-${periodMode}-${i + 1}.csv`);
          const savePath = await resolveUniquePath(downloadAbs, suggested);
          await dl.saveAs(savePath);

          downloadedThisRun += 1;
          progress.downloadedCount += 1;
          progress.files.push({
            at: nowIso(),
            period: periodMode,
            signature: c.signature,
            savedPath: savePath,
          });
          progress.clickResults.push({ period: periodMode, signature: c.signature, result: 'download_event', savedPath: savePath });
          await saveProgress(progressAbs, progress);
          await statsPage.waitForTimeout(400);
          continue;
        }

        let fallbackSaved = '';
        const resp = await responsePromise;
        if (resp && resp.ok()) {
          const reqMeta = resp.request();
          const reqPostData = reqMeta.postData() || '';
          const headers = resp.headers();
          const contentType = String(headers['content-type'] || '').toLowerCase();
          const contentDisposition = String(headers['content-disposition'] || '').toLowerCase();
          const contentLength = Number(headers['content-length'] || 0);
          const isFileLike =
            /csv|excel|spreadsheet|octet-stream|application\/vnd/i.test(contentType) ||
            /attachment|filename=/i.test(contentDisposition);
          progress.clickResults.push({
            period: periodMode,
            signature: c.signature,
            result: 'response_captured',
            responseUrl: resp.url(),
            status: resp.status(),
            requestMethod: reqMeta.method(),
            requestPostData: reqPostData.slice(0, 2000),
            contentType,
            contentDisposition,
            contentLength,
          });
          if (isFileLike) {
            const body = await resp.body().catch(() => null);
            const bodyLength = body ? body.length : 0;
            progress.clickResults.push({
              period: periodMode,
              signature: c.signature,
              result: 'response_body',
              bodyLength,
            });
            let replayBody = body;
            let replayLength = bodyLength;
            if (!replayBody || replayLength === 0) {
              const req = resp.request();
              const replayResp = await context.request
                .fetch(resp.url(), {
                  method: req.method(),
                  headers: req.headers(),
                  data: req.postData() || undefined,
                  failOnStatusCode: false,
                })
                .catch(() => null);
              if (replayResp && replayResp.ok()) {
                const b = await replayResp.body().catch(() => null);
                replayBody = b;
                replayLength = b ? b.length : 0;
                progress.clickResults.push({
                  period: periodMode,
                  signature: c.signature,
                  result: 'replay_response_body',
                  status: replayResp.status(),
                  bodyLength: replayLength,
                });
              }
            }
            if (replayBody && replayLength > 0) {
              const ext = contentType.includes('csv') ? '.csv' : '.xlsx';
              const savePath = await resolveUniquePath(downloadAbs, `analytics-response-${periodMode}-${i + 1}${ext}`);
              await writeFile(savePath, replayBody);
              fallbackSaved = savePath;
            }
          }
        }

        if (popup) {
          await popup.waitForLoadState('domcontentloaded').catch(() => {});
          const popupUrl = popup.url();
          if (/download|export|csv|xls|xlsx/i.test(popupUrl)) {
            const resp2 = await context.request.get(popupUrl, { failOnStatusCode: false }).catch(() => null);
            if (resp2 && resp2.ok()) {
              const body = await resp2.body();
              const fromUrl = sanitizeFileName(decodeURIComponent((popupUrl.split('/').pop() || '').split('?')[0] || `analytics-${periodMode}-fallback.csv`));
              const savePath = await resolveUniquePath(downloadAbs, fromUrl);
              await writeFile(savePath, body);
              fallbackSaved = savePath;
            }
          }

          if (!fallbackSaved) {
            const popupCandidates = await collectDownloadCandidates(popup.mainFrame()).catch(() => []);
            if (popupCandidates.length > 0) {
              const nestedDlPromise = context.waitForEvent('download', { timeout: 12000 }).catch(() => null);
              await popupCandidates[0].node.click({ force: true }).catch(() => {});
              const nestedDl = await nestedDlPromise;
              if (nestedDl) {
                const suggested = sanitizeFileName(nestedDl.suggestedFilename() || `analytics-popup-${periodMode}-${i + 1}.csv`);
                const savePath = await resolveUniquePath(downloadAbs, suggested);
                await nestedDl.saveAs(savePath);
                fallbackSaved = savePath;
              }
            }
          }
          await popup.close().catch(() => {});
        }

        if (fallbackSaved) {
          downloadedThisRun += 1;
          progress.downloadedCount += 1;
          progress.files.push({
            at: nowIso(),
            period: periodMode,
            signature: c.signature,
            savedPath: fallbackSaved,
          });
          progress.clickResults.push({ period: periodMode, signature: c.signature, result: 'fallback_saved', savedPath: fallbackSaved });
        } else {
          progress.clickResults.push({ period: periodMode, signature: c.signature, result: 'no_download_event' });
        }
        await saveProgress(progressAbs, progress);
        await statsPage.waitForTimeout(400);
      }
    }

    progress.status = 'completed';
    progress.note = downloadedThisRun > 0 ? 'ok' : 'clicked_but_no_download_event';
    if (downloadedThisRun === 0) {
      progress.debug = await dumpDebug(statsPage, progress.note);
    }
    progress.generatedAt = nowIso();
    await saveProgress(progressAbs, progress);

    console.log(
      JSON.stringify(
        {
          ok: downloadedThisRun > 0,
          downloadedThisRun,
          downloadedCount: progress.downloadedCount,
          progressPath: progressAbs,
          downloadDir: downloadAbs,
        },
        null,
        2
      )
    );
  } finally {
    await browser.close();
  }
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
