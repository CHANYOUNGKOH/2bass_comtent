import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

const DAILY_LIMIT_MB = Number(process.env.NAVER_BLOG_DAILY_LIMIT_MB || 3072);
const FROM_PAGE = Number(process.env.NAVER_BLOG_FROM_PAGE || 43);
const TO_PAGE = Number(process.env.NAVER_BLOG_TO_PAGE || 206);
const OBSERVED_PAGES_PER_DAY = Number(process.env.NAVER_BLOG_OBS_PAGES_PER_DAY || 24);
const PROGRESS_PATH = process.env.NAVER_BLOG_PROGRESS_PATH || 'output/naver-blog-pdf-progress.json';
const OUT_PATH = process.env.NAVER_BLOG_ESTIMATE_PATH || `output/naver-blog-quota-estimate-${FROM_PAGE}-${TO_PAGE}.json`;

function buildEstimate() {
  if (!Number.isFinite(OBSERVED_PAGES_PER_DAY) || OBSERVED_PAGES_PER_DAY <= 0) {
    throw new Error('NAVER_BLOG_OBS_PAGES_PER_DAY must be > 0');
  }
  if (!Number.isFinite(FROM_PAGE) || !Number.isFinite(TO_PAGE) || TO_PAGE < FROM_PAGE) {
    throw new Error('Invalid FROM/TO range');
  }

  const estPerPageMB = DAILY_LIMIT_MB / OBSERVED_PAGES_PER_DAY;
  const pages = [];
  for (let page = FROM_PAGE; page <= TO_PAGE; page += 1) {
    const index = page - FROM_PAGE;
    const day = Math.floor(index / OBSERVED_PAGES_PER_DAY) + 1;
    const daySlot = (index % OBSERVED_PAGES_PER_DAY) + 1;
    pages.push({
      page,
      estimatedQuotaMB: Number(estPerPageMB.toFixed(2)),
      day,
      daySlot,
    });
  }

  const totalPages = TO_PAGE - FROM_PAGE + 1;
  const estimatedDays = Math.ceil(totalPages / OBSERVED_PAGES_PER_DAY);
  return {
    generatedAt: new Date().toISOString(),
    assumptions: {
      dailyLimitMB: DAILY_LIMIT_MB,
      observedPagesPerDay: OBSERVED_PAGES_PER_DAY,
      estimatedQuotaMBPerPage: Number(estPerPageMB.toFixed(2)),
    },
    range: { fromPage: FROM_PAGE, toPage: TO_PAGE, totalPages },
    result: {
      estimatedDays,
      estimatedCompletionPagePerDay: OBSERVED_PAGES_PER_DAY,
      pages,
    },
  };
}

async function loadProgress() {
  try {
    const raw = await readFile(path.resolve(process.cwd(), PROGRESS_PATH), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function main() {
  const estimate = buildEstimate();
  const progress = await loadProgress();
  if (progress) {
    estimate.currentProgress = {
      nextPage: progress.nextPage,
      collectedPage: progress.collectedPage,
      stopReason: progress.stopReason,
      updatedAt: progress.updatedAt,
    };
  }

  const outFile = path.resolve(process.cwd(), OUT_PATH);
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, `${JSON.stringify(estimate, null, 2)}\n`, 'utf8');

  console.log(
    JSON.stringify(
      {
        outFile,
        estimatedDays: estimate.result.estimatedDays,
        fromPage: FROM_PAGE,
        toPage: TO_PAGE,
        observedPagesPerDay: OBSERVED_PAGES_PER_DAY,
        estimatedQuotaMBPerPage: estimate.assumptions.estimatedQuotaMBPerPage,
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
