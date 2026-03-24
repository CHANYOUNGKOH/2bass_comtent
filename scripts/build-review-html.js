#!/usr/bin/env node
/**
 * build-review-html.js
 * 대시보드 디자인 기반 리뷰 패키지 (단일 HTML)
 * - 이미지 9건 상단 카드 → 클릭하면 상세 (이미지 인라인)
 * - 전체 목록은 하단에 접혀있음 (details/summary)
 * - 원본 네이버 블로그 URL 링크 포함
 *
 * 출력: data/publish/review-package.html
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const V2_DIR = path.join(ROOT, 'data', 'publish', 'naver-v2');
const OUT_FILE = path.join(ROOT, 'data', 'publish', 'review-package.html');

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function imgToBase64(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    return 'data:image/jpeg;base64,' + buf.toString('base64');
  } catch { return null; }
}

// ── Load data ──
const allFiles = fs.readdirSync(V2_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_')).sort();
const allPosts = allFiles.map(f => JSON.parse(fs.readFileSync(path.join(V2_DIR, f), 'utf8')));
const imgPosts = allPosts.filter(p => p.images && p.images.count > 0 && p.images.dir);

console.log(`전체 V2: ${allPosts.length}개 | 이미지: ${imgPosts.length}개`);

// ── Load images as base64 ──
let totalBytes = 0;
const cards = [];
for (const post of imgPosts) {
  const imgDir = path.resolve(ROOT, post.images.dir);
  const files = (post.images.files || []).filter(f => /\.(jpg|png)$/i.test(f));
  const images = [];
  for (const f of files) {
    const fp = path.join(imgDir, f);
    const b64 = imgToBase64(fp);
    if (b64) {
      const sz = fs.statSync(fp).size;
      totalBytes += sz;
      images.push({ name: f, data: b64, kb: Math.round(sz / 1024) });
    }
  }
  const v = post.vehicle || {};
  const car = `${v.brand || ''} ${v.model || ''}`.trim();
  cards.push({ post, car, images });
  console.log(`  ${car}: ${images.length}장`);
}
console.log(`총 이미지: ${(totalBytes / 1024 / 1024).toFixed(1)}MB`);

// ── Collect stats ──
const brands = [...new Set(allPosts.map(p => (p.vehicle || {}).brand).filter(Boolean))].sort();
const total = allPosts.length;
const withImg = imgPosts.length;
const dateStr = new Date().toLocaleDateString('ko-KR');

// ── Build HTML ──
const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>투베이스 콘텐츠 리뷰</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Nanum+Gothic:wght@400;700&display=swap');
  * { box-sizing: border-box; }
  body { margin: 0; padding: 20px; font-family: '나눔고딕','NanumGothic','Nanum Gothic','Malgun Gothic',sans-serif; background: #fafafa; }
  .dashboard { max-width: 1100px; margin: 0 auto; }
  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
  .header h1 { font-size: 22px; color: #222; margin: 0; }
  .header .total { font-size: 14px; color: #888; }

  /* ── 이미지 카드 그리드 ── */
  .img-section { margin-bottom: 32px; }
  .img-section h2 { font-size: 17px; color: #222; margin: 0 0 14px; padding-bottom: 10px; border-bottom: 2px solid #03c75a; }
  .img-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }

  .img-card {
    background: #fff; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.08);
    overflow: hidden; cursor: pointer; transition: box-shadow .2s;
  }
  .img-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,.15); }
  .img-card .thumb {
    width: 100%; height: 200px; object-fit: cover; display: block;
  }
  .img-card .info { padding: 12px 16px; }
  .img-card .car { font-size: 15px; font-weight: 700; color: #222; margin-bottom: 4px; }
  .img-card .work { font-size: 13px; color: #666; margin-bottom: 6px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .img-card .badges { display: flex; gap: 6px; align-items: center; }
  .img-card .badge {
    display: inline-block; padding: 2px 8px; border-radius: 10px;
    font-size: 11px; font-weight: 600;
  }
  .badge-img { background: #e6f9ed; color: #03c75a; }
  .badge-blog { background: #e8f0fe; color: #1a73e8; }

  /* ── 상세 모달 ── */
  .modal-overlay {
    display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,.6); z-index: 999; overflow-y: auto;
  }
  .modal-overlay.open { display: block; }
  .modal {
    max-width: 800px; margin: 40px auto; background: #fff; border-radius: 10px;
    overflow: hidden; box-shadow: 0 8px 40px rgba(0,0,0,.3);
  }
  .modal-header {
    background: #03c75a; color: #fff; padding: 16px 24px;
    display: flex; justify-content: space-between; align-items: center;
  }
  .modal-header h2 { margin: 0; font-size: 17px; }
  .modal-close {
    background: none; border: none; color: #fff; font-size: 24px;
    cursor: pointer; line-height: 1; padding: 0 4px;
  }
  .modal-links {
    padding: 12px 24px; background: #f9f9f9; border-bottom: 1px solid #eee;
    display: flex; gap: 16px; flex-wrap: wrap; font-size: 13px;
  }
  .modal-links a { color: #1a73e8; text-decoration: none; font-weight: 500; }
  .modal-links a:hover { text-decoration: underline; }
  .modal-links span { color: #888; }
  .modal-title { padding: 20px 24px 12px; font-size: 18px; font-weight: 700; color: #222; }
  .modal-body { padding: 4px 24px 20px; font-size: 15px; line-height: 1.8; color: #333; }
  .modal-body p { margin: 6px 0; }
  .modal-body .section-head {
    border-left: 3px solid #03c75a; padding-left: 10px; font-weight: 700;
    font-size: 16px; color: #222; margin: 20px 0 10px;
  }
  .modal-images { padding: 16px 24px; background: #fafafa; border-top: 1px solid #eee; }
  .modal-images h3 { margin: 0 0 12px; font-size: 14px; color: #888; }
  .modal-images img {
    max-width: 100%; border-radius: 6px; box-shadow: 0 1px 4px rgba(0,0,0,.1);
    margin-bottom: 12px; display: block;
  }
  .modal-images .img-label { font-size: 11px; color: #aaa; margin: -8px 0 16px; text-align: center; }
  .modal-cta { padding: 16px 24px; border-top: 1px solid #eee; background: #f9fff9; font-size: 14px; }
  .modal-cta a { color: #03c75a; }
  .modal-tags { padding: 12px 24px; border-top: 1px solid #eee; font-size: 13px; color: #03c75a; }

  /* ── 전체 목록 (접힘) ── */
  .full-list { margin-top: 32px; }
  .full-list details { background: #fff; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
  .full-list summary {
    padding: 14px 20px; font-size: 15px; font-weight: 600; cursor: pointer;
    color: #555; list-style: none;
  }
  .full-list summary::-webkit-details-marker { display: none; }
  .full-list summary::before { content: '▶ '; font-size: 12px; }
  .full-list details[open] summary::before { content: '▼ '; }

  .full-list table { width: 100%; border-collapse: collapse; }
  .full-list th { background: #2d2d2d; color: #eee; padding: 8px 12px; font-size: 12px; text-align: left; font-weight: 600; position: sticky; top: 0; }
  .full-list td { padding: 7px 12px; font-size: 13px; border-bottom: 1px solid #f0f0f0; }
  .full-list tr:hover td { background: #f5f9ff; }
  .full-list .filter-bar {
    padding: 12px 20px; border-bottom: 1px solid #eee;
    display: flex; gap: 12px; align-items: center;
  }
  .full-list .filter-bar input {
    padding: 6px 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 13px; width: 240px;
  }
  .full-list .filter-count { font-size: 12px; color: #888; margin-left: auto; }

  .status-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
  .st-generated { background: #fff3e0; color: #e67700; }
  .st-none { background: #f0f0f0; color: #aaa; }
</style>
</head>
<body>
<div class="dashboard">

  <div class="header">
    <h1>투베이스 콘텐츠 리뷰</h1>
    <div class="total">전체 <strong>${total}</strong>건 | 이미지 <strong>${withImg}</strong>건 | ${dateStr}</div>
  </div>

  <!-- ═══ 이미지 카드 그리드 ═══ -->
  <div class="img-section">
    <h2>이미지 포함 콘텐츠 (${withImg}건) — 클릭하면 상세 보기</h2>
    <div class="img-grid">
${cards.map(({ post, car, images }, idx) => {
  const w = post.work || {};
  const thumb = images.length > 0 ? images[0].data : '';
  const hasUrl = !!post.originalUrl;
  return `      <div class="img-card" onclick="openModal(${idx})">
        ${thumb ? `<img class="thumb" src="${thumb}" loading="lazy">` : ''}
        <div class="info">
          <div class="car">${esc(car)}</div>
          <div class="work">${esc(String(w.type || ''))}</div>
          <div class="badges">
            <span class="badge badge-img">📷 ${images.length}장</span>
            ${hasUrl ? '<span class="badge badge-blog">원본 블로그</span>' : ''}
          </div>
        </div>
      </div>`;
}).join('\n')}
    </div>
  </div>

  <!-- ═══ 전체 목록 (접힘) ═══ -->
  <div class="full-list">
    <details>
      <summary>전체 콘텐츠 목록 (${total}건) 펼치기</summary>
      <div class="filter-bar">
        <span>🔍</span>
        <input type="text" id="listSearch" placeholder="브랜드, 차종, 작업 검색..." oninput="filterList()">
        <span class="filter-count" id="listCount">${total}건</span>
      </div>
      <table>
        <thead><tr>
          <th style="width:40px; text-align:center;">#</th>
          <th style="width:90px;">브랜드</th>
          <th>차종</th>
          <th>작업</th>
          <th style="width:55px; text-align:center;">📷</th>
          <th style="width:90px; text-align:center;">원본</th>
        </tr></thead>
        <tbody id="listBody">
${allPosts.map((p, i) => {
  const v = p.vehicle || {};
  const w = p.work || {};
  const car = `${v.brand || ''} ${v.model || ''}`.trim();
  const hasImg = p.images && p.images.count > 0;
  const imgBadge = hasImg ? `<span style="color:#03c75a; font-weight:600;">📷${p.images.count}</span>` : '<span style="color:#ccc;">—</span>';
  const blogLink = p.originalUrl ? `<a href="${esc(p.originalUrl)}" target="_blank" style="color:#1a73e8; text-decoration:none; font-size:12px;">블로그 →</a>` : '<span style="color:#ccc;">—</span>';
  return `          <tr>
            <td style="text-align:center; color:#aaa; font-size:12px;">${i + 1}</td>
            <td style="font-size:12px; color:#666;">${esc(v.brand || '')}</td>
            <td style="font-size:13px;">${esc(car)}</td>
            <td style="color:#555; font-size:13px; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(String(w.type || ''))}</td>
            <td style="text-align:center;">${imgBadge}</td>
            <td style="text-align:center;">${blogLink}</td>
          </tr>`;
}).join('\n')}
        </tbody>
      </table>
    </details>
  </div>

</div>

<!-- ═══ 모달 ═══ -->
<div class="modal-overlay" id="modalOverlay" onclick="if(event.target===this)closeModal()">
  <div class="modal" id="modalContent"></div>
</div>

<script>
const CARDS = ${JSON.stringify(cards.map(({ post, car, images }) => ({
  car,
  title: post.naver?.title || '',
  body: post.naver?.body || '',
  cta: post.naver?.cta || '',
  hashtags: (post.naver?.hashtags || []).map(t => t.startsWith('#') ? t : '#' + t).join(' '),
  originalUrl: post.originalUrl || '',
  postId: post.postId,
  workType: String((post.work || {}).type || ''),
  duration: String((post.work || {}).duration || ''),
  postType: (post.meta || {}).postType || '',
  imgCount: images.length,
  images: images.map(img => ({ name: img.name, data: img.data, kb: img.kb })),
})))};

function openModal(idx) {
  const c = CARDS[idx];
  const bodyHtml = c.body.split('\\n').map(line => {
    const t = line.trim();
    if (!t) return '<div style="height:10px;"></div>';
    if (t.startsWith('■')) return '<div class="section-head">' + esc(t) + '</div>';
    return '<p>' + esc(t) + '</p>';
  }).join('');

  const ctaHtml = c.cta.split('\\n').filter(l => l.trim()).map(line => {
    const m = line.match(/(https?:\\/\\/[^\\s]+)/);
    if (m) {
      const label = line.replace(m[1], '').replace('→', '').trim();
      return '<div style="padding:4px 0;">' + esc(label) + ' <a href="' + esc(m[1]) + '" target="_blank">' + esc(m[1]) + '</a></div>';
    }
    return '<div style="padding:6px 0; font-weight:600;">' + esc(line.trim()) + '</div>';
  }).join('');

  const imgsHtml = c.images.map((img, i) =>
    '<img src="' + img.data + '" loading="lazy"><div class="img-label">' + img.name + ' (' + img.kb + 'KB)</div>'
  ).join('');

  document.getElementById('modalContent').innerHTML = ''
    + '<div class="modal-header">'
    + '  <h2>' + esc(c.car) + ' — 📷 ' + c.imgCount + '장</h2>'
    + '  <button class="modal-close" onclick="closeModal()">&times;</button>'
    + '</div>'
    + '<div class="modal-links">'
    + (c.originalUrl ? '  <a href="' + esc(c.originalUrl) + '" target="_blank">📎 원본 네이버 블로그 열기</a>' : '')
    + '  <span>🔧 ' + esc(c.workType) + '</span>'
    + '  <span>⏱ ' + esc(c.duration) + '</span>'
    + '  <span>📊 ' + esc(c.postType) + '</span>'
    + '</div>'
    + '<div class="modal-title">' + esc(c.title) + '</div>'
    + '<div class="modal-body">' + bodyHtml + '</div>'
    + '<div class="modal-images"><h3>첨부 이미지 (' + c.imgCount + '장)</h3>' + imgsHtml + '</div>'
    + '<div class="modal-cta">' + ctaHtml + '</div>'
    + '<div class="modal-tags">' + esc(c.hashtags) + '</div>';

  document.getElementById('modalOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function filterList() {
  const q = document.getElementById('listSearch').value.toLowerCase().trim();
  const rows = document.querySelectorAll('#listBody tr');
  let n = 0;
  rows.forEach(tr => {
    const show = !q || tr.textContent.toLowerCase().includes(q);
    tr.style.display = show ? '' : 'none';
    if (show) n++;
  });
  document.getElementById('listCount').textContent = n + '건';
}
</script>
</body>
</html>`;

fs.writeFileSync(OUT_FILE, html, 'utf8');
const mb = (fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(1);
console.log(`\n✅ 리뷰 패키지: ${OUT_FILE}`);
console.log(`📦 ${mb}MB — 이 파일 하나만 전달하면 됩니다`);
