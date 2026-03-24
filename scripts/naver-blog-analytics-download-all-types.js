import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';

const ROOT = process.cwd();
const BLOG_ID = process.env.NAVER_BLOG_ID || '2basstune';
const PERIODS = process.env.NAVER_BLOG_ANALYTICS_PERIODS || 'day,week,month';
const OUT_PATH =
  process.env.NAVER_BLOG_ANALYTICS_ALL_TYPES_PROGRESS || 'output/naver-blog-analytics-download-all-types-progress.json';
const SINGLE_PROGRESS = path.resolve(ROOT, 'output/naver-blog-analytics-download-progress.json');

function nowIso() {
  return new Date().toISOString();
}

function normalizeLabel(s) {
  return String(s || '').replace(/[,\s·]+/g, '').trim();
}

function filterDataTypes(list) {
  const exclude = [/이웃블로그/, /추가한이웃/, /글댓글스타일/, /^댓글$/, /재생수분석/, /재생시간분석/];
  const out = [];
  const seen = new Set();
  for (const item of list || []) {
    const label = String(item?.label || '').trim();
    if (!label) continue;
    if (exclude.some((r) => r.test(label))) continue;
    const key = normalizeLabel(label);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, value: String(item?.value || '') });
  }
  return out;
}

function runSingle(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/naver-blog-analytics-download.js'], {
      cwd: ROOT,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => resolve({ code: Number(code || 0), stdout, stderr }));
  });
}

async function readJsonOrNull(p) {
  try {
    const raw = await readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveJson(p, v) {
  const abs = path.resolve(ROOT, p);
  await writeFile(abs, `${JSON.stringify(v, null, 2)}\n`, 'utf8');
}

async function main() {
  const progress = {
    generatedAt: nowIso(),
    status: 'running',
    blogId: BLOG_ID,
    periods: PERIODS,
    runs: [],
  };
  await saveJson(OUT_PATH, progress);

  // 1) List all data types from stat/download UI.
  const listRun = await runSingle({
    ...process.env,
    NAVER_BLOG_ANALYTICS_URL: `https://admin.blog.naver.com/${BLOG_ID}/stat/download`,
    NAVER_BLOG_ANALYTICS_LIST_TYPES_ONLY: 'true',
  });
  const singleList = await readJsonOrNull(SINGLE_PROGRESS);
  const rawDataTypes = Array.isArray(singleList?.dataTypes) ? singleList.dataTypes : [];
  const dataTypes = filterDataTypes(rawDataTypes);

  progress.listRun = {
    at: nowIso(),
    exitCode: listRun.code,
    rawDataTypeCount: rawDataTypes.length,
    dataTypeCount: dataTypes.length,
    stdoutTail: String(listRun.stdout || '').split('\n').slice(-20),
    stderrTail: String(listRun.stderr || '').split('\n').slice(-20),
  };
  progress.rawDataTypes = rawDataTypes;
  progress.dataTypes = dataTypes;
  await saveJson(OUT_PATH, progress);

  for (const item of dataTypes) {
    const label = String(item?.label || '').trim();
    if (!label) continue;

    const run = await runSingle({
      ...process.env,
      NAVER_BLOG_ANALYTICS_URL: `https://admin.blog.naver.com/${BLOG_ID}/stat/download`,
      NAVER_BLOG_ANALYTICS_DATATYPE_LABEL: label,
      NAVER_BLOG_ANALYTICS_PERIODS: PERIODS,
      NAVER_BLOG_ANALYTICS_MAX_CLICKS_PER_PERIOD: '1',
    });
    const single = await readJsonOrNull(SINGLE_PROGRESS);
    progress.runs.push({
      at: nowIso(),
      label,
      value: item?.value || '',
      exitCode: run.code,
      note: single?.note || '',
      downloadedCount: Number(single?.downloadedCount || 0),
      recentFiles: Array.isArray(single?.files) ? single.files.slice(-3).map((x) => x.savedPath) : [],
      stdoutTail: String(run.stdout || '').split('\n').slice(-20),
      stderrTail: String(run.stderr || '').split('\n').slice(-20),
    });
    await saveJson(OUT_PATH, progress);
  }

  progress.status = 'completed';
  progress.generatedAt = nowIso();
  await saveJson(OUT_PATH, progress);

  console.log(
    JSON.stringify(
      {
        outPath: path.resolve(ROOT, OUT_PATH),
        dataTypeCount: dataTypes.length,
        runCount: progress.runs.length,
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
