import { mkdir, readdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';

const ROOT = process.cwd();
const DOWNLOAD_DIR = process.env.NAVER_BLOG_ANALYTICS_DOWNLOAD_DIR || 'output/naver-blog-analytics';
const OUT_PROGRESS = process.env.NAVER_BLOG_ANALYTICS_MULTI_PROGRESS_PATH || 'output/naver-blog-analytics-download-multi-progress.json';
const BLOG_ID = process.env.NAVER_BLOG_ID || '2basstune';

const DEFAULT_PATHS = [
  '/stat/download',
  '/stat/visit_pv',
  '/stat/referer',
  '/stat/rank_pv',
  '/stat/rank_like',
  '/stat/rank_comment',
  '/stat/uv',
  '/stat/visit',
];

const PATHS = String(process.env.NAVER_BLOG_ANALYTICS_PATHS || '')
  .split(',')
  .map((x) => x.trim())
  .filter(Boolean);

const TARGET_PATHS = PATHS.length > 0 ? PATHS : DEFAULT_PATHS;

function nowIso() {
  return new Date().toISOString();
}

async function listFiles(absDir) {
  const list = await readdir(absDir).catch(() => []);
  const out = [];
  for (const name of list) {
    const full = path.join(absDir, name);
    const stat = await (await import('fs/promises')).stat(full).catch(() => null);
    if (!stat || !stat.isFile()) continue;
    out.push({ name, full, size: stat.size, mtimeMs: stat.mtimeMs });
  }
  return out;
}

function diffNewFiles(before, after) {
  const beforeSet = new Set(before.map((x) => `${x.name}:${x.size}:${x.mtimeMs}`));
  return after.filter((x) => !beforeSet.has(`${x.name}:${x.size}:${x.mtimeMs}`));
}

function runSingleDownload(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/naver-blog-analytics-download.js'], {
      cwd: ROOT,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('close', (code) => {
      resolve({ code: Number(code || 0), stdout, stderr });
    });
  });
}

async function loadJsonOrNull(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function main() {
  const downloadAbs = path.resolve(ROOT, DOWNLOAD_DIR);
  const progressAbs = path.resolve(ROOT, OUT_PROGRESS);
  const singleProgressAbs = path.resolve(ROOT, 'output/naver-blog-analytics-download-progress.json');
  await mkdir(downloadAbs, { recursive: true });

  const progress = {
    generatedAt: nowIso(),
    status: 'running',
    blogId: BLOG_ID,
    downloadDir: downloadAbs,
    targets: TARGET_PATHS,
    runs: [],
  };

  for (const p of TARGET_PATHS) {
    const pathPart = p.startsWith('/') ? p : `/${p}`;
    const url = `https://admin.blog.naver.com/${BLOG_ID}${pathPart}`;

    const before = await listFiles(downloadAbs);
    const env = {
      ...process.env,
      NAVER_BLOG_ANALYTICS_URL: url,
    };

    const run = await runSingleDownload(env);
    const after = await listFiles(downloadAbs);
    const newFiles = diffNewFiles(before, after);
    const single = await loadJsonOrNull(singleProgressAbs);

    progress.runs.push({
      at: nowIso(),
      path: pathPart,
      url,
      exitCode: run.code,
      ok: run.code === 0 && newFiles.length > 0,
      newFiles: newFiles.map((f) => ({ name: f.name, size: f.size })),
      singleNote: single?.note || '',
      singleCandidates: single?.candidates || [],
      stdoutTail: String(run.stdout || '').split('\n').slice(-20),
      stderrTail: String(run.stderr || '').split('\n').slice(-20),
    });

    await writeFile(progressAbs, `${JSON.stringify(progress, null, 2)}\n`, 'utf8');
  }

  const totalNew = progress.runs.reduce((a, b) => a + (b.newFiles?.length || 0), 0);
  progress.status = 'completed';
  progress.generatedAt = nowIso();
  progress.totalNewFiles = totalNew;
  progress.successRuns = progress.runs.filter((x) => x.ok).length;

  await writeFile(progressAbs, `${JSON.stringify(progress, null, 2)}\n`, 'utf8');

  console.log(
    JSON.stringify(
      {
        progressPath: progressAbs,
        targets: TARGET_PATHS.length,
        successRuns: progress.successRuns,
        totalNewFiles: progress.totalNewFiles,
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
