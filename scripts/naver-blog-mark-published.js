#!/usr/bin/env node
/**
 * naver-blog-mark-published.js
 * CLI로 발행 상태 업데이트 (2블로그 지원)
 *
 * Usage:
 *   node scripts/naver-blog-mark-published.js <postId> --blog 1              # 1번 블로그 발행 완료
 *   node scripts/naver-blog-mark-published.js <postId> --blog 2              # 2번 블로그 발행 완료
 *   node scripts/naver-blog-mark-published.js <postId> --blog 1 --url <url>  # URL 포함
 *   node scripts/naver-blog-mark-published.js <postId> --skip                # 건너뛰기
 *   node scripts/naver-blog-mark-published.js <postId> --undo --blog 1       # 되돌리기
 *   node scripts/naver-blog-mark-published.js --status                       # 전체 현황
 *
 * --blog 생략 시 기본값 1
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const STATUS_FILE = path.join(ROOT, 'data', 'publish', 'naver-v2-status.json');

const BLOG_NAMES = { 1: '1번 블로그', 2: '2번 블로그' };

function loadStatus() {
  if (fs.existsSync(STATUS_FILE)) {
    const status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
    // 기존 단일 status → blog1/blog2 마이그레이션
    for (const [id, entry] of Object.entries(status.posts || {})) {
      if (entry.status && !entry.blog1) {
        entry.blog1 = {
          status: entry.status,
          publishedAt: entry.publishedAt || null,
          naverUrl: entry.naverUrl || null,
        };
        entry.blog2 = { status: 'none', publishedAt: null, naverUrl: null };
        delete entry.status;
        delete entry.publishedAt;
        delete entry.naverUrl;
      }
    }
    return status;
  }
  return { lastUpdated: null, stats: {}, posts: {} };
}

function saveStatus(status) {
  status.lastUpdated = new Date().toISOString();
  // Recalculate stats
  const all = Object.values(status.posts);
  status.stats = {
    total: all.length,
    blog1Published: all.filter(s => s.blog1?.status === 'published').length,
    blog2Published: all.filter(s => s.blog2?.status === 'published').length,
    generated: all.filter(s => s.blog1?.status !== 'skipped').length,
    skipped: all.filter(s => s.blog1?.status === 'skipped').length,
  };
  fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2), 'utf8');
}

function initEntry() {
  return {
    blog1: { status: 'generated', publishedAt: null, naverUrl: null },
    blog2: { status: 'none', publishedAt: null, naverUrl: null },
    notes: '',
  };
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--status') || args.length === 0) {
    const status = loadStatus();
    console.log('\n📊 발행 현황');
    console.log(`   전체: ${status.stats.total || 0}`);
    console.log(`   1번 블로그 발행: ${status.stats.blog1Published || 0}`);
    console.log(`   2번 블로그 발행: ${status.stats.blog2Published || 0}`);
    console.log(`   건너뛰기: ${status.stats.skipped || 0}`);

    for (const blogNum of [1, 2]) {
      const key = `blog${blogNum}`;
      const published = Object.entries(status.posts)
        .filter(([, v]) => v[key]?.status === 'published')
        .map(([k, v]) => `   ✅ ${k}  (${v[key].publishedAt || '?'})`);
      if (published.length > 0) {
        console.log(`\n${BLOG_NAMES[blogNum]} 발행 목록:`);
        published.forEach(l => console.log(l));
      }
    }
    return;
  }

  const postId = args[0];
  if (!postId || postId.startsWith('--')) {
    console.error('Usage: node scripts/naver-blog-mark-published.js <postId> --blog <1|2> [--url <url>] [--skip] [--undo]');
    process.exit(1);
  }

  const blogIdx = args.indexOf('--blog');
  const blogNum = blogIdx !== -1 && args[blogIdx + 1] ? Number(args[blogIdx + 1]) : 1;
  if (blogNum !== 1 && blogNum !== 2) {
    console.error('--blog 값은 1 또는 2만 가능합니다.');
    process.exit(1);
  }
  const blogKey = `blog${blogNum}`;

  const status = loadStatus();

  if (!status.posts[postId]) {
    status.posts[postId] = initEntry();
  }

  const entry = status.posts[postId];
  // Ensure blog fields exist (마이그레이션 안 된 경우)
  if (!entry.blog1) entry.blog1 = { status: 'generated', publishedAt: null, naverUrl: null };
  if (!entry.blog2) entry.blog2 = { status: 'none', publishedAt: null, naverUrl: null };

  if (args.includes('--undo')) {
    entry[blogKey].status = blogNum === 1 ? 'generated' : 'none';
    entry[blogKey].publishedAt = null;
    saveStatus(status);
    console.log(`↩️  ${postId} → ${BLOG_NAMES[blogNum]} 되돌림`);
    return;
  }

  if (args.includes('--skip')) {
    entry.blog1.status = 'skipped';
    entry.blog2.status = 'skipped';
    saveStatus(status);
    console.log(`⏭️  ${postId} → skipped (양쪽 블로그)`);
    return;
  }

  // Mark published
  entry[blogKey].status = 'published';
  entry[blogKey].publishedAt = new Date().toISOString().slice(0, 10);

  const urlIdx = args.indexOf('--url');
  if (urlIdx !== -1 && args[urlIdx + 1]) {
    entry[blogKey].naverUrl = args[urlIdx + 1];
  }

  const noteIdx = args.indexOf('--note');
  if (noteIdx !== -1 && args[noteIdx + 1]) {
    entry.notes = args[noteIdx + 1];
  }

  saveStatus(status);
  const otherKey = blogNum === 1 ? 'blog2' : 'blog1';
  const otherStatus = entry[otherKey].status;
  console.log(`✅ ${postId} → ${BLOG_NAMES[blogNum]} 발행 (${entry[blogKey].publishedAt})`);
  console.log(`   ${BLOG_NAMES[blogNum === 1 ? 2 : 1]}: ${otherStatus}`);
  if (entry[blogKey].naverUrl) console.log(`   URL: ${entry[blogKey].naverUrl}`);
}

main();
