#!/usr/bin/env node
/**
 * naver-blog-publish-html.js  (V3)
 * SSOT 중심 콘텐츠 대시보드 + 네이버 발행 HTML 변환
 *
 * 변경 (V3):
 * - 대시보드: SSOT 1912개 전체 스캔, 탭(네이버/메타/당근/영상), 페이지네이션, 검색/필터
 * - 발행 뷰: [제목 복사] [본문 복사] [태그 복사] [발행 완료]
 * - 서체: 나눔고딕
 * - **bold** strip, 줄바꿈 가독성, 이미지 플레이스홀더 간소화
 * - 해시태그: #태그 공백 구분
 *
 * Usage:
 *   node scripts/naver-blog-publish-html.js            # 전체 변환
 *   node scripts/naver-blog-publish-html.js <postId>   # 단일 변환
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const V2_DIR = path.join(ROOT, 'data', 'publish', 'naver-v2');
const HTML_DIR = path.join(ROOT, 'data', 'publish', 'naver-v2-html');
const SSOT_DIR = path.join(ROOT, 'data', 'ssot-posts');
const STATUS_FILE = path.join(ROOT, 'data', 'publish', 'naver-v2-status.json');

// ── 배너 이미지 (CTA 위 고정) ──
import crypto from 'crypto';
const BANNER_FILE = path.join(ROOT, 'assets', 'banner-2bass.jpg');
const BANNER_MD5 = (() => {
  try {
    return crypto.createHash('md5').update(fs.readFileSync(BANNER_FILE)).digest('hex');
  } catch { return null; }
})();

function postHasBanner(post) {
  if (!BANNER_MD5) return false;
  const imgDir = absImgDir(post);
  const files = (post.images && post.images.files) || [];
  if (!imgDir || files.length === 0) return false;
  try {
    const lastFile = path.join(imgDir, files[files.length - 1]);
    const h = crypto.createHash('md5').update(fs.readFileSync(lastFile)).digest('hex');
    return h === BANNER_MD5;
  } catch { return false; }
}

// ── CTA 아이콘 (base64 인라인) ──
const ICON_DIR = path.join(ROOT, 'assets', 'icons');
function loadIconBase64(filename) {
  try {
    const buf = fs.readFileSync(path.join(ICON_DIR, filename));
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch { return null; }
}
const ICON_NAVER_TALK = loadIconBase64('naver-talk.png');
const ICON_KAKAO_CH   = loadIconBase64('kakao-channel.png');

// ── helpers ──

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadStatus() {
  if (fs.existsSync(STATUS_FILE)) return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
  return { lastUpdated: null, stats: { total: 0, generated: 0, published: 0, skipped: 0 }, posts: {} };
}

function saveStatus(status) {
  status.lastUpdated = new Date().toISOString();
  fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2), 'utf8');
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function absImgDir(post) {
  if (!post.images || !post.images.dir) return null;
  return path.resolve(ROOT, post.images.dir);
}

function imgToBase64(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch { return null; }
}

// Strip markdown bold markers
function stripBold(text) {
  return (text || '').replace(/\*\*/g, '');
}

// 긴 문장 줄바꿈: 마침표 뒤 50자+ → <br> 삽입
function breakLongSentences(text) {
  // Split on sentence boundaries (. followed by space and next char)
  const result = [];
  let lineLen = 0;
  for (let i = 0; i < text.length; i++) {
    result.push(text[i]);
    lineLen++;
    // After period+space, if accumulated 50+ chars, insert break
    if (text[i] === '.' && lineLen >= 50 && i + 1 < text.length && text[i + 1] === ' ') {
      result.push('<br>');
      lineLen = 0;
    }
  }
  return result.join('');
}

// ── HTML rendering (발행 뷰) ──

function renderBody(post) {
  let body = stripBold(post.naver.body);
  const lines = body.split('\n');
  const imgFiles = (post.images && post.images.files) || [];
  const imgCount = imgFiles.length;
  const positions = (post.images && post.images.positions) || [];

  // stage 기반 고정 위치 이미지 인덱스 분리
  const topImgIndices = [];
  const bottomImgIndices = [];
  positions.forEach((p, i) => {
    if (i < imgCount) {
      if (p.stage === 'top') topImgIndices.push(i);
      else if (p.stage === 'bottom') bottomImgIndices.push(i);
    }
  });
  const fixedIndices = new Set([...topImgIndices, ...bottomImgIndices]);

  // 마커 기반 배치: Claude가 본문에 [사진N] 마커를 삽입한 경우 우선 사용
  const markerRe = /^\[사진(\d+)\]$/;
  const videoMarkerRe = /^\[영상(\d+)\]$/;
  const videos = (post.images && post.images.videos) || [];
  const markerMap = {};  // lineIndex → imgFileIndex (0-based)
  const markerLines = new Set();
  const videoMarkerLines = new Set();
  lines.forEach((line, i) => {
    const m = line.trim().match(markerRe);
    if (m) {
      const imgIdx = Number(m[1]) - 1; // [사진1] → index 0
      if (imgIdx >= 0) {
        markerMap[i] = imgIdx;
        markerLines.add(i);
      }
    }
    const vm = line.trim().match(videoMarkerRe);
    if (vm) {
      videoMarkerLines.add(i);
    }
  });

  const hasMarkers = Object.keys(markerMap).length > 0;

  // 폴백: 마커 없으면 기존 균등 배치
  let imgMap = {};
  if (hasMarkers) {
    for (const [lineIdx, imgIdx] of Object.entries(markerMap)) {
      if (!imgMap[lineIdx]) imgMap[lineIdx] = [];
      imgMap[lineIdx].push(imgIdx);
    }
  } else if (imgCount > 0) {
    let imgPositions = [];
    const sectionIndices = [];
    lines.forEach((l, i) => {
      if (l.trim().startsWith('■')) sectionIndices.push(i);
    });

    if (sectionIndices.length >= 2 && imgCount >= sectionIndices.length) {
      const perSection = Math.ceil(imgCount / sectionIndices.length);
      let imgIdx = 0;
      sectionIndices.forEach((si) => {
        const insertAt = Math.min(si + 2, lines.length);
        const count = Math.min(perSection, imgCount - imgIdx);
        for (let j = 0; j < count; j++) {
          imgPositions.push({ afterLine: insertAt, imgIndex: imgIdx++ });
        }
      });
    } else {
      const spacing = Math.max(1, Math.floor(lines.length / (imgCount + 1)));
      for (let i = 0; i < imgCount; i++) {
        imgPositions.push({ afterLine: spacing * (i + 1), imgIndex: i });
      }
    }

    imgPositions.forEach(({ afterLine, imgIndex }) => {
      const key = Math.min(afterLine, lines.length - 1);
      if (!imgMap[key]) imgMap[key] = [];
      imgMap[key].push(imgIndex);
    });
  }

  function renderImage(imgIdx) {
    const imgFile = imgFiles[imgIdx];
    const imgDirPath = absImgDir(post);
    const imgPath = imgDirPath && imgFile ? path.join(imgDirPath, imgFile) : null;
    const b64 = imgPath ? imgToBase64(imgPath) : null;
    const relDir = post.images?.dir || `output/images/${post.postId}`;
    const relPath = imgFile ? `../../${relDir}/${imgFile}` : null;
    const altText = (post.images?.imageAlts || [])[imgIdx] || `투베이스 브레이크 작업 사진 ${imgIdx + 1}`;

    let out = '';
    // 이미지: base64 또는 상대경로 있으면 표시
    const imgSrc = b64 || (relPath ? relPath : null);
    if (imgSrc) {
      out += `<div style="text-align:center; margin:8px 0 4px;">\n`;
      out += `  <img src="${imgSrc}" alt="${escapeHtml(altText)}" style="max-width:100%; border-radius:6px; box-shadow:0 1px 6px rgba(0,0,0,.1);" loading="lazy"`;
      if (!b64) out += ` onerror="this.parentElement.style.display='none'"`;
      out += `>\n`;
      out += `</div>\n`;
    } else {
      // 이미지 파일 없음 — 간결한 마커만
      out += `<div style="text-align:center; margin:8px 0 4px; padding:16px; background:#f8f8f8; border:1px dashed #ddd; border-radius:4px;">\n`;
      out += `  <span style="color:#999; font-size:14px;">📷 [사진${imgIdx + 1}]</span>\n`;
      out += `</div>\n`;
    }
    return out;
  }

  let html = '';

  // ── 상단 고정 이미지 ──
  topImgIndices.forEach(idx => { html += renderImage(idx); });

  // 캡션 줄 미리 수집 (마커 바로 다음 줄이 ▲로 시작하면 캡션)
  const captionConsumed = new Set();

  lines.forEach((line, i) => {
    // 이미 캡션으로 소비된 줄은 건너뜀
    if (captionConsumed.has(i)) return;

    // 이미지 마커 줄 → 박스(마커 + 캡션 + 복사버튼)
    if (hasMarkers && markerLines.has(i)) {
      if (imgMap[i]) {
        imgMap[i].filter(idx => !fixedIndices.has(idx)).forEach(imgIdx => {
          // 다음 줄이 ▲ 캡션인지 확인
          const nextLine = (i + 1 < lines.length) ? lines[i + 1].trim() : '';
          const hasCaption = nextLine.startsWith('▲');
          const captionText = hasCaption ? nextLine : '';
          if (hasCaption) captionConsumed.add(i + 1);

          // 하나의 박스로 묶기 (no-copy: 본문 복사 시 제외)
          html += `<div class="no-copy" style="text-align:center; margin:12px 0; padding:12px 16px; background:#f8f8f8; border:1px dashed #ddd; border-radius:6px;">\n`;
          html += renderImage(imgIdx);
          if (captionText) {
            const escaped = escapeHtml(captionText);
            const jsEscaped = captionText.replace(/'/g, "\\'").replace(/"/g, '&quot;');
            html += `  <p class="no-copy" style="font-size:13px; color:#555; margin:4px 0 0; font-style:italic; cursor:pointer;" onclick="copyText('${jsEscaped}', '캡션 복사됨!')" title="클릭하여 캡션 복사">${escaped} <span style="font-size:11px; color:#0068c3;">[복사]</span></p>\n`;
          }
          html += `</div>\n`;
        });
      }
      return;
    }

    // 영상 마커 줄은 영상 플레이스홀더로 대체
    if (videoMarkerLines.has(i)) {
      const vm = line.trim().match(videoMarkerRe);
      if (vm) {
        const vidIdx = Number(vm[1]) - 1;
        const vidInfo = videos[vidIdx];
        const vidLabel = vidInfo ? (typeof vidInfo === 'string' ? path.basename(vidInfo) : (vidInfo.label || path.basename(vidInfo.path || vidInfo.file || ''))) : '';
        html += `<div style="text-align:center; margin:20px 0; padding:20px; background:#f0f0f0; border:2px dashed #ccc; border-radius:8px;">\n`;
        html += `  <p style="font-size:16px; color:#555; margin:0;">🎬 영상 ${vidIdx + 1} 위치</p>\n`;
        if (vidLabel) html += `  <p style="font-size:12px; color:#888; margin:4px 0 0;">${escapeHtml(vidLabel)}</p>\n`;
        html += `</div>\n`;
      }
      return;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      html += '<div style="height:12px;"></div>\n';
    } else if (trimmed.startsWith('■') || trimmed.startsWith('▸')) {
      const color = trimmed.startsWith('▸') ? '#1a73e8' : '#03c75a';
      html += `<div style="border-left:3px solid ${color}; padding-left:12px; font-weight:700; font-size:17px; color:#222; margin:28px 0 14px;">${escapeHtml(trimmed)}</div>\n`;
    } else if (trimmed.startsWith('▲')) {
      // 마커 없이 단독 캡션 — 그대로 표시 (마커 뒤 캡션은 위에서 처리)
      html += `<p style="text-align:center; font-size:13px; color:#888; margin:-4px 0 16px; font-style:italic;">${escapeHtml(trimmed)}</p>\n`;
    } else if (trimmed.startsWith('▷') || trimmed.startsWith('-')) {
      html += `<div style="font-size:15px; line-height:1.8; color:#444; padding-left:8px; margin:2px 0;">${escapeHtml(trimmed)}</div>\n`;
    } else if (trimmed.match(/^(차량명|파워트레인|휠|프론트|리어|옵션)[:：]/)) {
      html += `<div style="font-size:15px; line-height:1.8; color:#444; padding-left:8px; margin:2px 0;">${escapeHtml(trimmed)}</div>\n`;
    } else {
      html += `<p style="font-size:16px; line-height:1.9; color:#333; margin:8px 0;">${escapeHtml(trimmed)}</p>\n`;
    }

    // 폴백 모드: 마커 없을 때 기존 방식으로 이미지 삽입 (고정 위치 제외)
    if (!hasMarkers && imgMap[i]) {
      imgMap[i].filter(idx => !fixedIndices.has(idx)).forEach(imgIdx => { html += renderImage(imgIdx); });
    }
  });

  // ── 하단 고정 이미지 (배너 위) ──
  bottomImgIndices.forEach(idx => { html += renderImage(idx); });

  return html;
}

// ── 고정 CTA 링크 (AI 생성 데이터에 의존하지 않음) ──
const FIXED_CTA = {
  phone: '010-4150-3199',
  talk:  'https://talk.naver.com/ct/w19vvqt?frm=mnmb&frm=nmb_detail#nafullscreen',
  kakao: 'https://pf.kakao.com/_wHxdZX',
  place: 'https://naver.me/GOudi7JY',
  store: 'https://smartstore.naver.com/2bassbrake',
};

function renderCta(post, variant = 'blog1') {
  const cta = post.naver.cta || '';
  // 리드인: URL/이모지가 아닌 첫 텍스트 줄 추출
  const lines = cta.split('\n').filter(l => l.trim());
  const leadIn = lines.find(l => {
    const t = l.trim();
    return t && !/(https?:\/\/|^📞|^💬|^📍|^📅|^🛒|→)/.test(t);
  });

  const hasParts = /smartstore/.test(cta) || (post.work && post.work.parts && post.work.parts.length > 0);

  // 네이버 톡톡/카카오 아이콘: 이모지 텍스트 (복사-붙여넣기 호환)
  const talkIcon = '🟢';
  const kakaoIcon = '💛';

  const MAP_URL = 'https://naver.me/5YFTD6H0';
  const ADDRESS = '경기 고양시 일산동구 문원길170번길 103-21';

  // Blog1: 녹색 계열 / Blog2: 블루 계열
  const isBlog2 = variant === 'blog2';
  const rowBorder = isBlog2 ? 'border-bottom:1px solid #e0e8f3;' : 'border-bottom:1px solid #e8f3e8;';
  const linkStyle = isBlog2
    ? 'color:#1a73e8; text-decoration:none; font-weight:600;'
    : 'color:#03c75a; text-decoration:none; font-weight:600;';
  const cellPad = 'padding:13px 12px; font-size:15px; color:#333; font-weight:600; vertical-align:middle;';
  const mapBg = isBlog2 ? 'background:#f0f4ff;' : 'background:#f0f8f0;';
  const mapBorder = isBlog2 ? 'border:1px solid #dce4f0;' : 'border:1px solid #e0f0e0;';
  const ctaBg = isBlog2 ? 'background:#f8faff;' : 'background:#f9fff9;';
  const ctaBorder = isBlog2 ? 'border:1px solid #dce4f0; border-top:none;' : 'border:1px solid #e0f0e0; border-top:none;';

  let html = '';

  // 배너 이미지 (CTA 위 고정 — 이미 포함된 포스트는 스킵)
  if (!postHasBanner(post)) {
    const bannerB64 = imgToBase64(BANNER_FILE);
    if (bannerB64) {
      html += `<p style="text-align:center; font-size:14px; color:#999; margin:28px 0 4px;">📷 매장 배너 (마지막 이미지로 삽입)</p>\n`;
      html += `<div style="text-align:center; margin:0 0 20px;">\n`;
      html += `  <img src="${bannerB64}" style="max-width:100%; border-radius:6px; box-shadow:0 1px 6px rgba(0,0,0,.1);" loading="lazy">\n`;
      html += `</div>\n`;
    }
  }

  // 리드인
  if (leadIn) {
    html += `<p style="font-size:15px; color:#555; font-weight:600; margin:28px 0 8px;">${escapeHtml(leadIn.trim())}</p>\n`;
  }

  // ── 네이버 지도 블록 ──
  html += `<table style="width:100%; border-collapse:collapse; margin:8px 0 0; ${mapBorder} ${mapBg}">\n`;
  html += `<tbody>\n`;
  html += `<tr>\n`;
  html += `  <td style="padding:16px; text-align:center;">\n`;
  html += `    <p style="font-size:16px; font-weight:700; color:#333; margin:0 0 6px;">📍 투베이스 (2BASS) 오시는 길</p>\n`;
  html += `    <p style="font-size:13px; color:#666; margin:0 0 10px;">${escapeHtml(ADDRESS)}</p>\n`;
  html += `    <a href="${escapeHtml(MAP_URL)}" target="_blank" style="color:#03c75a; font-size:15px; font-weight:700; text-decoration:underline;">네이버 지도에서 보기 →</a>\n`;
  html += `  </td>\n`;
  html += `</tr>\n`;
  html += `</tbody>\n</table>\n`;

  // ── CTA 연락 테이블 ──
  html += `<table style="width:100%; border-collapse:collapse; margin:0 0 16px; ${ctaBorder} ${ctaBg}">\n`;
  html += '<tbody>\n';

  // 📞 전화 — 다른 행과 동일한 2컬럼
  html += `<tr style="${rowBorder}">\n`;
  html += `  <td style="${cellPad}">📞 전화 문의</td>\n`;
  html += `  <td style="padding:13px 12px; text-align:right; vertical-align:middle;"><a href="tel:${FIXED_CTA.phone.replace(/-/g, '')}" style="${linkStyle} font-size:15px;">${FIXED_CTA.phone}</a></td>\n`;
  html += `</tr>\n`;

  // 네이버 톡톡
  html += `<tr style="${rowBorder}">\n`;
  html += `  <td style="${cellPad}">${talkIcon} 네이버 톡톡 문의</td>\n`;
  html += `  <td style="padding:13px 12px; text-align:right; vertical-align:middle;"><a href="${escapeHtml(FIXED_CTA.talk)}" target="_blank" style="${linkStyle}">바로가기 →</a></td>\n`;
  html += `</tr>\n`;

  // 카카오톡
  html += `<tr style="${rowBorder}">\n`;
  html += `  <td style="${cellPad}">${kakaoIcon} 카카오톡 문의</td>\n`;
  html += `  <td style="padding:13px 12px; text-align:right; vertical-align:middle;"><a href="${escapeHtml(FIXED_CTA.kakao)}" target="_blank" style="${linkStyle}">바로가기 →</a></td>\n`;
  html += `</tr>\n`;

  // 📅 네이버 예약
  html += `<tr style="${rowBorder}">\n`;
  html += `  <td style="${cellPad}">📅 네이버 예약</td>\n`;
  html += `  <td style="padding:13px 12px; text-align:right; vertical-align:middle;"><a href="${escapeHtml(FIXED_CTA.place)}" target="_blank" style="${linkStyle}">바로가기 →</a></td>\n`;
  html += `</tr>\n`;

  // 🛒 부품 구매
  if (hasParts) {
    html += `<tr>\n`;
    html += `  <td style="${cellPad}">🛒 부품 구매</td>\n`;
    html += `  <td style="padding:13px 12px; text-align:right; vertical-align:middle;"><a href="${escapeHtml(FIXED_CTA.store)}" target="_blank" style="${linkStyle}">바로가기 →</a></td>\n`;
    html += `</tr>\n`;
  }

  html += '</tbody>\n</table>\n';
  return html;
}

function buildPostHtml(post, allPostIds, postIndex, blog2Post) {
  const prevId = postIndex > 0 ? allPostIds[postIndex - 1] : null;
  const nextId = postIndex < allPostIds.length - 1 ? allPostIds[postIndex + 1] : null;

  // SSOT images.files 우선 참조: published JSON의 files가 비어있으면 SSOT에서 가져옴
  if (post.images && (!post.images.files || post.images.files.length === 0)) {
    const ssotPath = path.join(SSOT_DIR, `${post.postId}.json`);
    if (fs.existsSync(ssotPath)) {
      try {
        const ssot = JSON.parse(fs.readFileSync(ssotPath, 'utf8'));
        if (ssot.images?.files?.length) {
          post.images.files = ssot.images.files;
        }
      } catch (_) { /* ignore parse errors */ }
    }
  }

  const imgAbsDir = absImgDir(post);
  const imgCount = (post.images && post.images.count) || 0;

  const statusLabel = {
    'case_study': '시공 사례',
    'parts_comparison': '부품 비교',
    'maintenance_guide': '정비 가이드',
    'technical_deep_dive': '기술 심화',
    'customer_story': '고객 스토리',
    'skip': '건너뛰기'
  };

  const postType = post.meta ? post.meta.postType : 'case_study';
  const angle = post.meta ? post.meta.angle : '';
  const typeLabel = statusLabel[postType] || postType;

  const hasBlog2 = !!blog2Post;

  // Hashtags in # format
  const hashtagsForCopy = (post.naver.hashtags || [])
    .map(t => t.startsWith('#') ? t : '#' + t)
    .join(' ');
  const blog2HashtagsForCopy = hasBlog2
    ? (blog2Post.naver.hashtags || []).map(t => t.startsWith('#') ? t : '#' + t).join(' ')
    : '';

  const titles = post.naver.titles || (post.naver.title ? [post.naver.title] : []);
  const titleText = titles[0] || '';
  const blog2Titles = hasBlog2
    ? (blog2Post.naver.titles || (blog2Post.naver.title ? [blog2Post.naver.title] : []))
    : [];

  const blog2PostType = hasBlog2 ? (blog2Post.meta ? blog2Post.meta.postType : '') : '';
  const blog2Angle = hasBlog2 ? (blog2Post.meta ? blog2Post.meta.angle : '') : '';

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(titleText)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Nanum+Gothic:wght@400;700&display=swap');
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0; font-family: '나눔고딕', 'NanumGothic', 'Nanum Gothic', 'Malgun Gothic', sans-serif; background: #fafafa; }

  .control-bar {
    position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
    background: #2d2d2d; color: #eee; padding: 8px 16px;
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    font-size: 13px; box-shadow: 0 2px 8px rgba(0,0,0,.3);
    -webkit-user-select: none; user-select: none;
  }
  .control-bar a { color: #7ecfff; text-decoration: none; }
  .control-bar a:hover { text-decoration: underline; }
  .control-bar .meta-item { background: #444; padding: 3px 8px; border-radius: 4px; font-size: 12px; }
  .control-bar .btn {
    background: #03c75a; color: #fff; border: none; padding: 5px 12px;
    border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600;
  }
  .control-bar .btn:hover { background: #02b050; }
  .control-bar .btn-copy { background: #1a73e8; }
  .control-bar .btn-copy:hover { background: #1557b0; }
  .control-bar .btn-nav {
    background: #555; color: #fff; border: none; padding: 5px 10px;
    border-radius: 4px; cursor: pointer; font-size: 12px;
  }
  .control-bar .btn-nav:hover { background: #777; }
  .control-bar .btn-nav:disabled { opacity: .3; cursor: default; }

  .content-wrap {
    max-width: 740px; margin: 100px auto 40px; background: #fff;
    padding: 36px 32px; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.08);
    font-family: '나눔고딕', 'NanumGothic', 'Nanum Gothic', 'Malgun Gothic', sans-serif;
  }

  .ref-section {
    max-width: 740px; margin: 0 auto 40px; background: #f8f8f8;
    padding: 20px 24px; border-radius: 8px; border: 1px solid #e0e0e0;
    font-size: 13px; color: #666;
    -webkit-user-select: none; user-select: none;
  }
  .ref-section h3 { margin: 0 0 12px; font-size: 14px; color: #888; }
  .ref-row { margin: 8px 0; }
  .ref-row .label { font-weight: 600; color: #555; }
  .ref-btn {
    background: #eee; border: 1px solid #ccc; padding: 3px 10px;
    border-radius: 4px; cursor: pointer; font-size: 12px; margin-left: 8px;
  }
  .ref-btn:hover { background: #ddd; }

  .toast {
    position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%);
    background: #333; color: #fff; padding: 10px 24px; border-radius: 8px;
    font-size: 14px; z-index: 99999; opacity: 0; transition: opacity .3s;
    pointer-events: none;
  }
  .toast.show { opacity: 1; }

  @media (max-width: 900px) {
    .content-wrap { flex-direction: column !important; max-width: 740px !important; }
    .content-wrap > div { min-width: 100% !important; }
    .ref-section { max-width: 740px !important; }
  }
</style>
</head>
<body>

<!-- ═══ CONTROL BAR ═══ -->
<div class="control-bar">
  <button class="btn-nav" onclick="location.href='${prevId ? prevId + '.html' : '#'}'" ${!prevId ? 'disabled' : ''}>◀이전</button>
  <a href="_index.html" id="dashListLink">📋목록</a>
  <button class="btn-nav" onclick="location.href='${nextId ? nextId + '.html' : '#'}'" ${!nextId ? 'disabled' : ''}>다음▶</button>

  <span class="meta-item">${escapeHtml(post.vehicle ? post.vehicle.model : '?')}</span>
  <span class="meta-item">${escapeHtml(typeLabel)}</span>
  <span class="meta-item">📷${imgCount}장</span>
  ${post.originalUrl ? `<a href="${escapeHtml(post.originalUrl)}" target="_blank" style="color:#7ecfff; font-size:12px;">📎원본 블로그</a>` : ''}

  ${hasBlog2
    ? `<button class="btn btn-copy" onclick="copyBody(1)">📋1번 본문 복사</button>
  <button class="btn btn-copy" onclick="copyBody(2)">📋2번 본문 복사</button>
  <button class="btn" onclick="copyPublishCmd(1)" style="background:#03c75a;">✅1번 발행</button>
  <button class="btn" onclick="copyPublishCmd(2)" style="background:#1a73e8;">✅2번 발행</button>`
    : `<button class="btn btn-copy" onclick="copyBody(1)">📋본문 복사</button>
  <button class="btn" onclick="copyPublishCmd(1)" style="background:#03c75a;">✅1번 발행</button>
  <button class="btn" onclick="copyPublishCmd(2)" style="background:#1a73e8;">✅2번 발행</button>`}
</div>

<!-- ═══ 참고 영역 (복사 제외) — 제목/태그 먼저 ═══ -->
<div class="ref-section"${hasBlog2 ? ' style="max-width:1400px;"' : ''}>
  <h3>참고 정보 (복사 영역 아님)</h3>

  ${hasBlog2 ? `<div style="display:flex; gap:24px; flex-wrap:wrap;">
  <div style="flex:1; min-width:300px; background:#f0faf0; border-radius:8px; padding:12px;">
    <div style="font-weight:700; color:#03c75a; margin-bottom:8px;">📗 Blog 1 제목 후보 (${escapeHtml(typeLabel)} / ${escapeHtml(angle)})</div>` : `
  <div class="ref-row" style="margin-bottom:8px;">
    <span class="label">제목 후보 (클릭하여 복사):</span>
    ${titles.length < 3 ? '<span style="font-size:11px; color:#cc7700; margin-left:8px;">⚠ 구버전 데이터 — 재생성 시 3개 추천</span>' : ''}
  </div>`}
  ${titles.map((t, idx) => `
  <div class="ref-row" style="display:flex; align-items:center; gap:8px; margin:4px 0; padding:6px 8px; background:${idx === 0 ? '#e8f5e9' : '#fff'}; border-radius:6px; border:1px solid #e0e0e0; cursor:pointer;" onclick="copyText(TITLES[${idx}], '제목 ${idx + 1} 복사됨!')">
    <span style="font-size:12px; color:#888; font-weight:600; min-width:20px;">${idx + 1}.</span>
    <span style="font-size:14px; color:#333; flex:1;">${escapeHtml(t)}</span>
    <button class="ref-btn" onclick="event.stopPropagation(); copyText(TITLES[${idx}], '제목 ${idx + 1} 복사됨!')">복사</button>
  </div>`).join('\n')}
  ${hasBlog2 ? `</div>
  <div style="flex:1; min-width:300px; background:#f0f0fa; border-radius:8px; padding:12px;">
    <div style="font-weight:700; color:#1a73e8; margin-bottom:8px;">📘 Blog 2 제목 후보 (${escapeHtml(statusLabel[blog2PostType] || blog2PostType)} / ${escapeHtml(blog2Angle)})</div>
    ${blog2Titles.map((t, idx) => `
    <div class="ref-row" style="display:flex; align-items:center; gap:8px; margin:4px 0; padding:6px 8px; background:${idx === 0 ? '#e3f2fd' : '#fff'}; border-radius:6px; border:1px solid #e0e0e0; cursor:pointer;" onclick="copyText(BLOG2_TITLES[${idx}], 'Blog2 제목 ${idx + 1} 복사됨!')">
      <span style="font-size:12px; color:#888; font-weight:600; min-width:20px;">${idx + 1}.</span>
      <span style="font-size:14px; color:#333; flex:1;">${escapeHtml(t)}</span>
      <button class="ref-btn" onclick="event.stopPropagation(); copyText(BLOG2_TITLES[${idx}], 'Blog2 제목 ${idx + 1} 복사됨!')">복사</button>
    </div>`).join('\n')}
  </div>
  </div>` : ''}

  ${(() => {
    const imgDir = post.images?.dir || path.join('output', 'images', post.postId);
    const imgFileList = (post.images?.files || []);
    const seoNames = (post.images?.seoFileNames || []);
    const alts = (post.images?.imageAlts || []);
    const posCount = (post.images?.positions || []).length;
    const totalImgs = Math.max(imgFileList.length, posCount);
    if (totalImgs === 0) return '';
    let rows = '';
    for (let i = 0; i < totalImgs; i++) {
      const fileName = imgFileList[i] || seoNames[i] || ('사진' + (i+1) + '.jpg');
      const absPath = path.resolve(ROOT, imgDir, fileName);
      const alt = alts[i] || '';
      rows += '<div class="ref-row" style="display:flex; align-items:center; gap:8px; margin:2px 0; padding:4px 8px; background:#fff; border-radius:4px; border:1px solid #eee; cursor:pointer;" onclick="copyText(IMG_PATHS[' + i + '], \'사진' + (i+1) + ' 절대경로 복사됨!\')">'
        + '<span style="font-size:12px; color:#888; font-weight:600; min-width:30px;">📷' + (i+1) + '.</span>'
        + '<span style="font-size:12px; color:#555; font-family:monospace; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + escapeHtml(absPath) + '</span>'
        + '<button class="ref-btn" onclick="event.stopPropagation(); copyText(IMG_PATHS[' + i + '], \'경로 복사됨!\')">복사</button>'
        + '</div>';
    }
    return '<div class="ref-row" style="margin-top:8px;"><span class="label">📷 이미지 경로 (' + totalImgs + '장) — 클릭하여 전체 경로 복사:</span></div>' + rows;
  })()}

  ${(post.images && post.images.videos || []).length > 0 ? `
  <div class="ref-row" style="margin-top:8px;">
    <span class="label">🎬 영상 (${post.images.videos.length}개) — 클릭하여 경로 복사:</span>
  </div>
  ${post.images.videos.map((v, idx) => {
    const vidPath = typeof v === 'string' ? v : (v.path || v.file || '');
    const vidLabel = typeof v === 'string' ? path.basename(v) : (v.label || path.basename(v.path || v.file || ''));
    return `<div class="ref-row" style="display:flex; align-items:center; gap:8px; margin:2px 0; padding:4px 8px; background:#fff; border-radius:4px; border:1px solid #eee; cursor:pointer;" onclick="copyText(VIDEO_FILES[${idx}], '영상 ${idx + 1} 경로 복사됨!')">
    <span style="font-size:12px; color:#888; font-weight:600; min-width:20px;">🎬${idx + 1}.</span>
    <span style="font-size:12px; color:#555; font-family:monospace; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(vidLabel)}</span>
    <button class="ref-btn" onclick="event.stopPropagation(); copyText(VIDEO_FILES[${idx}], '영상 ${idx + 1} 경로 복사됨!')">복사</button>
  </div>`;
  }).join('\\n')}` : ''}

  ${post.originalUrl ? `
  <div class="ref-row">
    <span class="label">원문:</span>
    <a href="${escapeHtml(post.originalUrl)}" target="_blank" style="color:#1a73e8;">${escapeHtml(post.originalUrl)}</a>
  </div>` : ''}

  <div class="ref-row" style="margin-top:12px;">
    <span class="label">포스트 유형:</span> ${escapeHtml(typeLabel)} / 앵글: ${escapeHtml(angle)}
    &nbsp;&nbsp;| #${postIndex + 1} / ${allPostIds.length}
  </div>
</div>

${hasBlog2 ? `<!-- ═══ COPY AREA (Blog1 + Blog2 side by side) ═══ -->
<div class="content-wrap" style="max-width:1400px; display:flex; gap:24px; flex-wrap:wrap;">
  <div id="blog1Area" style="flex:1; min-width:0; background:#fafffe; border:1px solid #e0f0e0; border-radius:8px; padding:24px;">
    <h3 style="color:#03c75a; margin:0 0 16px; padding-bottom:8px; border-bottom:2px solid #03c75a; position:sticky; top:50px; background:#fafffe; z-index:10;">📗 Blog 1 — ${escapeHtml(typeLabel)}</h3>
    <div id="blog1Copy">
${renderBody(post)}
${renderCta(post)}
<p style="font-size:1px; color:#fff; margin:24px 0 0; line-height:1;">${escapeHtml(hashtagsForCopy)}</p>
    </div>
  </div>
  <div id="blog2Area" style="flex:1; min-width:0; background:#f8faff; border:1px solid #e0e0f0; border-radius:8px; padding:24px; border-left:2px solid #d0d0e8;">
    <h3 style="color:#1a73e8; margin:0 0 16px; padding-bottom:8px; border-bottom:2px solid #1a73e8; position:sticky; top:50px; background:#f8faff; z-index:10;">📘 Blog 2 — ${escapeHtml(statusLabel[blog2PostType] || blog2PostType)}</h3>
    <div id="blog2Copy">
${renderBody(blog2Post)}
${renderCta(blog2Post, 'blog2')}
<p style="font-size:1px; color:#fff; margin:24px 0 0; line-height:1;">${escapeHtml(blog2HashtagsForCopy)}</p>
    </div>
  </div>
</div>` : `<!-- ═══ COPY AREA (본문) ═══ -->
<div class="content-wrap" id="blog1Area">
  <div id="blog1Copy">
${renderBody(post)}
${renderCta(post)}
<p style="font-size:1px; color:#fff; margin:24px 0 0; line-height:1;">${escapeHtml(hashtagsForCopy)}</p>
  </div>
</div>`}

<div class="toast" id="toast"></div>

<script>
const POST_ID = ${JSON.stringify(post.postId)};
const TITLES = ${JSON.stringify(titles)};
const TITLE_TEXT = TITLES[0] || '';
const HASHTAGS = ${JSON.stringify(hashtagsForCopy)};
const HAS_BLOG2 = ${hasBlog2 ? 'true' : 'false'};
const BLOG2_TITLES = ${JSON.stringify(blog2Titles)};
const BLOG2_HASHTAGS = ${JSON.stringify(blog2HashtagsForCopy)};
const IMG_DIR = ${JSON.stringify(imgAbsDir || '')};
const IMG_FILES = ${JSON.stringify((() => {
  const list = (post.images && post.images.files || []).map(f => imgAbsDir ? path.join(imgAbsDir, f) : f);
  if (!postHasBanner(post)) list.push(BANNER_FILE);
  return list;
})())};
const BANNER_LABEL = '매장 배너';
const IMG_PATHS = ${JSON.stringify((() => {
  const imgDir = post.images?.dir || path.join('output', 'images', post.postId);
  const imgFileList = post.images?.files || [];
  const seoNames = post.images?.seoFileNames || [];
  const posCount = (post.images?.positions || []).length;
  const total = Math.max(imgFileList.length, posCount);
  const paths = [];
  for (let i = 0; i < total; i++) {
    const fileName = imgFileList[i] || seoNames[i] || ('사진' + (i+1) + '.jpg');
    paths.push(path.resolve(ROOT, imgDir, fileName));
  }
  return paths;
})())};
const VIDEO_FILES = ${JSON.stringify((post.images && post.images.videos || []).map(v => {
  if (typeof v === 'string') return path.resolve(ROOT, v);
  return path.resolve(ROOT, v.path || v.file || '');
}))};

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}

// 상대 경로 → 현재 HTML 위치 기준 절대 경로 변환
function resolveLocalPath(relPath) {
  try {
    const loc = decodeURIComponent(window.location.pathname);
    // file:///C:/xxx/html/post.html → C:/xxx/html/
    const htmlDir = loc.replace(/\\/[^\\/]*$/, '');
    // ..\\images\\xxx → ../images/xxx
    const normalized = relPath.replace(/\\\\/g, '/');
    // htmlDir + / + normalized → resolve ..
    const parts = (htmlDir + '/' + normalized).split('/');
    const resolved = [];
    for (const p of parts) {
      if (p === '..') resolved.pop();
      else if (p !== '.') resolved.push(p);
    }
    let abs = resolved.join('\\\\');
    // Windows: remove leading \\ if starts with \\C:
    if (abs.startsWith('\\\\')) abs = abs.substring(1);
    return abs;
  } catch { return relPath; }
}

function resolveImgAbsPath(relPath) {
  if (window.__ROOT_DIR__) {
    return window.__ROOT_DIR__ + '\\\\output\\\\' + relPath.replace(/\\//g, '\\\\');
  }
  return resolveLocalPath('../../../output/' + relPath);
}

function copyText(text, msg) {
  navigator.clipboard.writeText(text).then(() => showToast(msg || '복사됨!')).catch(() => prompt('복사:', text));
}

function copyImgPath(idx) {
  const abs = resolveLocalPath(IMG_FILES[idx]);
  copyText(abs, '이미지 ' + (idx+1) + ' 경로 복사됨!');
}

function copyTitle() {
  copyText(TITLE_TEXT, '제목 복사됨!');
}

function copyBody(blogNum) {
  const el = document.getElementById(blogNum === 2 ? 'blog2Copy' : 'blog1Copy');
  if (!el) { showToast('해당 영역이 없습니다'); return; }
  const noCopy = el.querySelectorAll('.no-copy');
  noCopy.forEach(function(e) { e.style.display = 'none'; });
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  document.execCommand('copy');
  sel.removeAllRanges();
  noCopy.forEach(function(e) { e.style.display = ''; });
  const label = HAS_BLOG2 ? (blogNum + '번 ') : '';
  showToast(label + '본문 복사됨!');
}

function copyTags() {
  copyText(HASHTAGS, '태그 복사됨!');
}

function copyPublishCmd(blogNum) {
  const cmd = 'node scripts/naver-blog-mark-published.js ' + POST_ID + ' --blog ' + blogNum;
  copyText(cmd, blogNum + '번 블로그 발행 명령어 복사됨!');
}

// Server mode: fix dashboard link
if (location.protocol === 'http:' || location.protocol === 'https:') {
  const link = document.getElementById('dashListLink');
  if (link) link.href = '/dashboard';
}

</script>
</body>
</html>`;
}

// ── Dashboard (대시보드) ──

function buildIndexHtml(rows, opts) {
  opts = opts || {};  // opts.embeddedData: 오프라인용 데이터 배열
  let embeddedScript = '';
  if (opts.embeddedData) {
    embeddedScript = '<script>window.EMBEDDED_DATA = ' + JSON.stringify(opts.embeddedData) + ';</script>\n';
  }
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>투베이스 콘텐츠 대시보드</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Nanum+Gothic:wght@400;700&display=swap');
  * { box-sizing: border-box; }
  body { margin: 0; padding: 20px; font-family: '나눔고딕', 'NanumGothic', 'Nanum Gothic', 'Malgun Gothic', sans-serif; background: #fafafa; }

  .dashboard { max-width: 1200px; margin: 0 auto; }

  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .header h1 { font-size: 22px; color: #222; margin: 0; }
  .header .total { font-size: 15px; color: #888; }

  .summary-bar {
    display: flex; gap: 16px; padding: 12px 16px; margin-bottom: 12px;
    background: #fff; border: 1px solid #e0e0e0; border-radius: 8px;
    font-size: 13px; color: #555; flex-wrap: wrap; align-items: center;
  }
  .summary-bar .stat { display: flex; align-items: center; gap: 4px; }
  .summary-bar .stat strong { color: #222; }

  .conn-badge {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 600;
  }
  .conn-badge.ok { background: #e8f5e9; color: #2e7d32; }
  .conn-badge.off { background: #ffebee; color: #c62828; }
  .conn-badge.loading { background: #f5f5f5; color: #999; }
  .conn-badge::before {
    content: ''; display: inline-block; width: 6px; height: 6px; border-radius: 50%;
  }
  .conn-badge.ok::before { background: #4caf50; }
  .conn-badge.off::before { background: #ef5350; }
  .conn-badge.loading::before { background: #bbb; }

  .refresh-btn {
    background: none; border: 1px solid #ccc; border-radius: 4px; padding: 3px 10px;
    cursor: pointer; font-size: 14px; color: #555; margin-left: 8px;
    transition: background .15s;
  }
  .refresh-btn:hover { background: #e8f5e9; border-color: #03c75a; }

  /* Filters */
  .filters {
    display: flex; gap: 12px; align-items: center; padding: 14px 16px;
    background: #fff; border: 1px solid #e0e0e0; border-radius: 8px 8px 0 0;
    flex-wrap: wrap;
  }
  .filters input[type="text"] {
    padding: 6px 12px; border: 1px solid #ccc; border-radius: 4px;
    font-size: 13px; width: 220px;
  }
  .filters select {
    padding: 6px 10px; border: 1px solid #ccc; border-radius: 4px;
    font-size: 13px; max-width: 200px;
  }
  .filters .result-count { font-size: 12px; color: #888; margin-left: auto; }

  /* Searchable select */
  .search-select { position: relative; display: inline-block; }
  .search-select input {
    padding: 6px 10px; border: 1px solid #ccc; border-radius: 4px;
    font-size: 13px; width: 180px; background: #fff;
  }
  .search-select input:focus { border-color: #03c75a; outline: none; }
  .search-select .ss-dropdown {
    display: none; position: absolute; top: 100%; left: 0; z-index: 999;
    background: #fff; border: 1px solid #ccc; border-top: none; border-radius: 0 0 4px 4px;
    max-height: 240px; overflow-y: auto; width: 100%; box-shadow: 0 4px 12px rgba(0,0,0,.15);
  }
  .search-select .ss-dropdown.open { display: block; }
  .search-select .ss-item {
    padding: 6px 10px; font-size: 13px; cursor: pointer;
  }
  .search-select .ss-item:hover { background: #e8f5e9; }
  .search-select .ss-item.selected { background: #03c75a; color: #fff; }
  .search-select .ss-clear {
    position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
    cursor: pointer; color: #aaa; font-size: 14px; line-height: 1;
  }
  .search-select .ss-clear:hover { color: #333; }

  .filters input[type="date"] {
    padding: 5px 8px; border: 1px solid #ccc; border-radius: 4px;
    font-size: 12px; width: 130px;
  }
  .filters .date-range { display: flex; align-items: center; gap: 4px; }
  .filters .date-range span { color: #999; font-size: 13px; }

  /* Table */
  .table-wrap { background: #fff; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 8px 8px; overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #2d2d2d; color: #eee; padding: 10px 12px; font-size: 12px; text-align: left; font-weight: 600; position: sticky; top: 0; }
  th.sortable { cursor: pointer; user-select: none; }
  th.sortable:hover { background: #444; }
  th .sort-arrow { font-size: 10px; margin-left: 2px; }
  td { padding: 9px 12px; font-size: 13px; border-bottom: 1px solid #f0f0f0; }
  tr:hover td { background: #f5f9ff; }

  td a { color: #1a73e8; text-decoration: none; font-weight: 500; }
  td a:hover { text-decoration: underline; }

  .status-cell {
    text-align: center; font-size: 16px;
    transition: background .15s;
  }
  .status-cell.st-none { color: #ccc; }
  .status-cell.st-generated { color: #e67700; }
  .status-cell.st-published { color: #03c75a; }

  .spinner {
    display: inline-block; width: 14px; height: 14px;
    border: 2px solid #ddd; border-top-color: #e67700;
    border-radius: 50%; animation: spin .8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Pagination */
  .pagination {
    display: flex; justify-content: center; align-items: center; gap: 4px;
    padding: 16px; flex-wrap: wrap;
  }
  .pagination button {
    padding: 5px 10px; border: 1px solid #ddd; background: #fff;
    border-radius: 4px; cursor: pointer; font-size: 12px; min-width: 32px;
  }
  .pagination button:hover { background: #f0f0f0; }
  .pagination button.active { background: #03c75a; color: #fff; border-color: #03c75a; }
  .pagination button:disabled { opacity: .4; cursor: default; }

  .toast {
    position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%);
    background: #333; color: #fff; padding: 10px 24px; border-radius: 8px;
    font-size: 14px; z-index: 99999; opacity: 0; transition: opacity .3s;
    pointer-events: none;
  }
  .toast.show { opacity: 1; }

  .refresh-note { font-size: 12px; color: #aaa; margin-top: 16px; text-align: center; }

  .loading-overlay {
    text-align: center; padding: 60px 20px; color: #888; font-size: 15px;
  }

  /* Batch bar — sticky header */
  .batch-bar {
    display: none; align-items: center; gap: 12px; padding: 10px 16px;
    background: #fff8e1; border: 1px solid #ffe082;
    font-size: 13px; color: #555;
    border-radius: 0; border-bottom: none;
    position: sticky; top: 0; z-index: 100;
    box-shadow: 0 2px 8px rgba(0,0,0,.15);
  }
  .batch-bar.visible { display: flex; }
  .batch-bar .batch-count { font-weight: 700; color: #e65100; }
  .batch-bar .batch-btn {
    padding: 5px 14px; border: none; border-radius: 4px;
    cursor: pointer; font-size: 12px; font-weight: 600; color: #fff;
  }
  .batch-bar .batch-btn.naver { background: #03c75a; }
  .batch-bar .batch-btn.naver:hover { background: #02b050; }
  .batch-bar .batch-btn:disabled { background: #ccc; cursor: not-allowed; }
  .batch-bar .batch-progress { color: #1a73e8; font-weight: 600; display: none; }
  .batch-bar .batch-progress.active { display: flex; align-items: center; gap: 10px; flex: 1; }
  .batch-progress-wrap {
    width: 180px; height: 14px; background: #e0e0e0; border-radius: 7px; overflow: hidden; flex-shrink: 0;
  }
  .batch-progress-bar {
    height: 100%; width: 0%; background: linear-gradient(90deg, #03c75a, #1a73e8); border-radius: 7px;
    transition: width .4s ease;
  }
  .batch-progress-text { font-size: 12px; white-space: nowrap; }
  .batch-progress-eta { font-size: 11px; color: #888; white-space: nowrap; }
  .batch-progress-stats { font-size: 11px; color: #666; white-space: nowrap; }
  .batch-bar .batch-clear { background: none; border: 1px solid #ccc; border-radius: 4px; padding: 4px 10px; cursor: pointer; font-size: 12px; color: #888; }
  .batch-bar .batch-clear:hover { background: #f5f5f5; }

  /* Checkbox in table */
  .row-checkbox { width: 16px; height: 16px; cursor: pointer; accent-color: #03c75a; }
  th.cb-col, td.cb-col { width: 36px; text-align: center; padding: 6px 4px; }
</style>
${embeddedScript}</head>
<body>
<div class="dashboard">
  <div class="header">
    <h1>투베이스 콘텐츠 대시보드</h1>
    <div class="total" id="headerInfo">로딩 중...</div>
  </div>

  <!-- Summary bar -->
  <div class="summary-bar">
    <span id="connBadge" class="conn-badge loading">연결 중...</span>
    <span style="color:#ccc;">|</span>
    <span id="summaryText" class="stat">로딩 중...</span>
    <span style="color:#ccc;">|</span>
    <span class="stat">메타: 예정</span>
    <span class="stat">당근: 예정</span>
    <span id="authBadge" class="conn-badge" style="display:none; cursor:pointer;" onclick="showAuthModal()" title="클릭하여 인증 관리">인증: 확인 중</span>
    <button class="refresh-btn" id="refreshBtn" style="display:none;" onclick="refreshData()" title="서버에서 최신 데이터 다시 로드">새로고침</button>
    <a href="work-guide.html" id="guideLink" style="display:none; padding:7px 14px; background:#f5f5f5; color:#333; border:1px solid #ccc; border-radius:6px; text-decoration:none; font-size:13px; font-weight:600; margin-left:auto;">작업 가이드</a>
    <a href="new-post-form.html" id="newPostLink" style="display:none; padding:7px 16px; background:#03c75a; color:#fff; border-radius:6px; text-decoration:none; font-size:14px; font-weight:700; margin-left:8px;">+ 새 글 작성</a>
  </div>

  <!-- Pipeline bar -->
  <div class="pipeline-bar" style="display:flex; align-items:center; gap:0; padding:10px 16px; margin-bottom:12px; background:#fff; border:1px solid #e0e0e0; border-radius:8px; font-size:13px; color:#555; flex-wrap:wrap;">
    <span style="background:#e8f5e9; padding:4px 10px; border-radius:4px; font-weight:600;">PDF</span>
    <span style="color:#ccc; margin:0 6px;">→</span>
    <span style="background:#e3f2fd; padding:4px 10px; border-radius:4px;">📷추출 <strong id="pipeImg">0/0</strong></span>
    <span style="color:#ccc; margin:0 6px;">→</span>
    <span style="background:#fff3e0; padding:4px 10px; border-radius:4px;">네이버 생성 <strong id="pipeNaver">0/0</strong></span>
    <span style="color:#ccc; margin:0 6px;">→</span>
    <span style="background:#e8f5e9; padding:4px 10px; border-radius:4px;">네이버 발행 <strong id="pipeNaverPub">0</strong></span>
    <span style="color:#999; margin:0 10px;">|</span>
    <span style="background:#e8eaf6; padding:4px 10px; border-radius:4px;">메타 생성 <strong id="pipeMeta">0/0</strong></span>
    <span style="color:#999; margin:0 10px;">|</span>
    <span style="background:#fce4ec; padding:4px 10px; border-radius:4px;">당근 생성 <strong id="pipeDaangn">0/0</strong></span>
    <span style="color:#999; margin:0 10px;">|</span>
    <span style="padding:4px 10px; border-radius:4px; background:#f3e5f5;">키워드 <strong id="kvCacheText">-</strong></span>
    <button onclick="refreshKeywords()" style="margin-left:6px; padding:4px 10px; border:1px solid #ce93d8; border-radius:4px; background:#fff; cursor:pointer; font-size:12px; color:#7b1fa2;">갱신</button>
  </div>

  <!-- Filters -->
  <div class="filters">
    <span style="font-size:13px;">🔍</span>
    <input type="text" id="searchInput" placeholder="차종, 작업 검색..." oninput="applyFilters()">
    <div class="date-range">
      <input type="date" id="dateFrom" onchange="applyFilters()">
      <span>~</span>
      <input type="date" id="dateTo" onchange="applyFilters()">
    </div>
    <select id="brandFilter" onchange="applyFilters()">
      <option value="">브랜드 전체</option>
    </select>
    <div class="search-select" id="modelSelectWrap">
      <input type="text" id="modelInput" placeholder="차종 검색..." onfocus="ssOpen('model')" oninput="ssFilter('model')">
      <span class="ss-clear" onclick="ssClear('model')">&times;</span>
      <div class="ss-dropdown" id="modelDropdown"></div>
    </div>
    <div class="search-select" id="workSelectWrap">
      <input type="text" id="workInput" placeholder="작업 검색..." onfocus="ssOpen('work')" oninput="ssFilter('work')">
      <span class="ss-clear" onclick="ssClear('work')">&times;</span>
      <div class="ss-dropdown" id="workDropdown"></div>
    </div>
    <select id="statusFilter" onchange="applyFilters()">
      <option value="">상태 전체</option>
      <option value="img_none">📷 미추출</option>
      <option value="img_done">📷 추출완료</option>
      <option value="naver_none">네이버 미생성</option>
      <option value="naver_generated">네이버 생성</option>
      <option value="naver_published">네이버 발행</option>
      <option value="meta_none">메타 미생성</option>
      <option value="meta_generated">메타 생성</option>
      <option value="daangn_none">당근 미생성</option>
      <option value="daangn_generated">당근 생성</option>
    </select>
    <span class="result-count" id="resultCount"></span>
  </div>

  <!-- Batch action bar -->
  <div class="batch-bar" id="batchBar">
    <span class="batch-count" id="batchCount">0개 선택</span>
    <button class="batch-btn naver" onclick="batchGenerate('naver')" id="batchNaverBtn">네이버 생성</button>
    <button class="batch-btn" disabled title="서버 미구현 — 준비중" style="background:#ccc;">메타 (준비중)</button>
    <button class="batch-btn" disabled title="서버 미구현 — 준비중" style="background:#ccc;">당근 (준비중)</button>
    <button class="batch-btn" disabled title="서버 미구현 — 준비중" style="background:#ccc;">영상 (준비중)</button>
    <div class="batch-progress" id="batchProgress">
      <div class="batch-progress-wrap"><div class="batch-progress-bar" id="batchProgressBar"></div></div>
      <span class="batch-progress-text" id="batchProgressText"></span>
      <span class="batch-progress-eta" id="batchProgressEta"></span>
      <span class="batch-progress-stats" id="batchProgressStats"></span>
    </div>
    <button class="batch-clear" onclick="clearSelection()">선택 해제</button>
  </div>

  <!-- Table -->
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th class="cb-col"><input type="checkbox" class="row-checkbox" id="selectAllCb" onchange="toggleSelectAll(this.checked)"></th>
          <th style="width:45px; text-align:center;">#</th>
          <th class="sortable" style="width:55px; text-align:center;" onclick="toggleSort('priority')">우선 <span class="sort-arrow" id="sort_priority"></span></th>
          <th class="sortable" style="width:80px;" onclick="toggleSort('date')">날짜 <span class="sort-arrow" id="sort_date"></span></th>
          <th class="sortable" style="width:90px;" onclick="toggleSort('brand')">브랜드 <span class="sort-arrow" id="sort_brand"></span></th>
          <th class="sortable" onclick="toggleSort('model')">차종 <span class="sort-arrow" id="sort_model"></span></th>
          <th class="sortable" onclick="toggleSort('work')">작업 <span class="sort-arrow" id="sort_work"></span></th>
          <th style="width:60px; text-align:center;">📷추출</th>
          <th style="width:60px; text-align:center;">네이버</th>
          <th style="width:55px; text-align:center;">메타</th>
          <th style="width:55px; text-align:center;">당근</th>
        </tr>
      </thead>
      <tbody id="tableBody">
        <tr><td colspan="11" class="loading-overlay">데이터 로딩 중...</td></tr>
      </tbody>
    </table>
  </div>

  <!-- Pagination -->
  <div class="pagination" id="pagination"></div>

  <div class="refresh-note">
    서버 모드: <code>start-dashboard.bat</code> &nbsp;|&nbsp; HTML 재생성: <code>node scripts/naver-blog-publish-html.js</code>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
var ALL_DATA = [];
var BRANDS = [];
var MODELS = [];
var WORKS = [];
var PAGE_SIZE = 50;
var currentPage = 1;
var filtered = [];
var SERVER_MODE = false;
var currentSort = 'date';
var sortDir = -1;

// ── Server mode detection + data load ──
function initDashboard() {
  var badge = document.getElementById('connBadge');

  // Check server mode
  if (window.__SERVER_MODE__) { SERVER_MODE = true; showServerUI(); }
  else if (location.protocol.startsWith('http')) {
    fetch('/api/server-info').then(function(r) {
      if (r.ok) { SERVER_MODE = true; showServerUI(); }
      else { setConnBadge('off'); }
    }).catch(function() { setConnBadge('off'); });
  } else {
    setConnBadge('off');
  }

  // Load data
  if (location.protocol.startsWith('http')) {
    fetch('/api/dashboard-data')
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(d) {
        ALL_DATA = d.rows;
        initFilters();
        applyFilters();
      })
      .catch(function(e) {
        showToast('데이터 로드 실패: ' + e.message);
        setConnBadge('off');
        document.getElementById('tableBody').innerHTML = '<tr><td colspan="11" class="loading-overlay">데이터 로드 실패 (' + esc(e.message) + ').<br>start-dashboard.bat을 실행한 뒤 브라우저를 새로고침하세요.</td></tr>';
      });
  } else if (window.EMBEDDED_DATA) {
    ALL_DATA = window.EMBEDDED_DATA;
    initFilters();
    applyFilters();
    setConnBadge('off');
  } else {
    showToast('서버 모드에서 접속해주세요 (start-dashboard.bat)');
    document.getElementById('tableBody').innerHTML = '<tr><td colspan="11" class="loading-overlay">오프라인 모드입니다.<br>start-dashboard.bat을 실행한 뒤 <b>http://localhost:3100</b> 으로 접속하세요.<br><small style="color:#999;">Claude Code 구독이 없는 PC에서는 AI 생성 기능을 사용할 수 없습니다.</small></td></tr>';
  }
}

function setConnBadge(state) {
  var badge = document.getElementById('connBadge');
  if (!badge) return;
  badge.className = 'conn-badge ' + state;
  if (state === 'ok') badge.textContent = '서버 연결됨';
  else if (state === 'off') badge.textContent = '오프라인 \u2014 start-dashboard.bat을 실행하세요';
  else badge.textContent = '연결 중...';
}

function showServerUI() {
  setConnBadge('ok');
  var newPostBtn = document.getElementById('newPostLink');
  if (newPostBtn) newPostBtn.style.display = '';
  var guideBtn = document.getElementById('guideLink');
  if (guideBtn) guideBtn.style.display = '';
  var refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) refreshBtn.style.display = '';
  checkAuthStatus();
  loadKvCacheStatus();
}

var _lastAuthData = null;

function checkAuthStatus() {
  var badge = document.getElementById('authBadge');
  if (!badge) return;
  badge.style.display = '';
  fetch('/api/auth-status').then(function(r) { return r.json(); }).then(function(d) {
    _lastAuthData = d;
    if (d.authenticated) {
      var label = d.mode === 'api_key' ? 'API Key' : 'Claude CLI';
      badge.textContent = label + ' (' + d.model + ')';
      badge.style.background = '#e8f5e9'; badge.style.color = '#2e7d32';
    } else {
      badge.textContent = '인증 필요 (클릭)';
      badge.style.background = '#ffebee'; badge.style.color = '#c62828';
    }
  }).catch(function() {
    _lastAuthData = null;
    badge.textContent = '인증 필요 (클릭)';
    badge.style.background = '#ffebee'; badge.style.color = '#c62828';
  });
}

function showAuthModal() {
  var existing = document.getElementById('authModal');
  if (existing) existing.remove();
  var d = _lastAuthData || {};
  var modal = document.createElement('div');
  modal.id = 'authModal';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999;';

  var statusHtml = '<div style="margin-bottom:16px;padding:12px;background:#f5f5f5;border-radius:8px;font-size:13px;">';
  // CLI 상태
  if (d.cliInstalled) {
    if (d.cliDisabled) {
      statusHtml += '<div style="margin-bottom:6px;">Claude CLI: <span style="color:#c62828;">비활성화됨</span> '
        + '<a href="#" onclick="reconnectCli();return false" style="color:#1a73e8;text-decoration:underline;font-size:12px;">재연결</a></div>';
    } else {
      statusHtml += '<div style="margin-bottom:6px;">Claude CLI: <span style="color:#2e7d32;">연결됨</span> '
        + '<a href="#" onclick="disconnectAuth(\\x27cli\\x27);return false" style="color:#c62828;text-decoration:underline;font-size:12px;">연결 끊기</a></div>';
    }
  } else {
    statusHtml += '<div style="margin-bottom:6px;">Claude CLI: <span style="color:#999;">미설치</span></div>';
  }
  // API Key 상태
  if (d.mode === 'api_key' && d.keyPreview) {
    statusHtml += '<div>API Key: <span style="color:#2e7d32;">' + d.keyPreview + '</span> <span style="color:#1a73e8;">(활성)</span> '
      + '<a href="#" onclick="disconnectAuth(\\x27api_key\\x27);return false" style="color:#c62828;text-decoration:underline;font-size:12px;">삭제</a></div>';
  } else {
    statusHtml += '<div>API Key: <span style="color:#999;">미설정</span></div>';
  }
  statusHtml += '</div>';

  modal.innerHTML = '<div style="background:#fff;border-radius:12px;padding:28px;max-width:480px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.2);">'
    + '<h3 style="margin:0 0 16px;font-size:18px;">Claude 인증 관리</h3>'
    + statusHtml
    + '<hr style="border:none;border-top:1px solid #eee;margin:16px 0;">'
    + '<p style="font-size:14px;font-weight:600;margin:0 0 8px;">API Key 설정</p>'
    + '<p style="font-size:12px;color:#888;margin:0 0 12px;">아래 링크에서 API Key를 발급받아 붙여넣으세요.</p>'
    + '<div style="display:flex;gap:8px;margin-bottom:12px;font-size:12px;">'
    + '<a href="https://console.anthropic.com/settings/keys" target="_blank" style="color:#1a73e8;text-decoration:none;background:#e8f0fe;padding:4px 10px;border-radius:4px;">1. API Key 발급</a>'
    + '<a href="https://console.anthropic.com/settings/billing" target="_blank" style="color:#1a73e8;text-decoration:none;background:#e8f0fe;padding:4px 10px;border-radius:4px;">2. 결제 설정</a>'
    + '</div>'
    + '<input id="apiKeyInput" type="password" placeholder="sk-ant-api03-..." style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px;box-sizing:border-box;font-family:monospace;" />'
    + '<div style="display:flex;gap:8px;margin-top:8px;justify-content:flex-end;">'
    + '<button onclick="saveApiKey()" style="padding:8px 16px;border:none;background:#1a73e8;color:#fff;border-radius:6px;cursor:pointer;font-weight:600;">저장</button>'
    + '</div>'
    + '<hr style="border:none;border-top:1px solid #eee;margin:16px 0;">'
    + '<p style="font-size:14px;font-weight:600;margin:0 0 8px;">네이버 API 설정</p>'
    + '<p style="font-size:12px;color:#888;margin:0 0 12px;">검색광고 API (키워드 검색량) + 데이터랩 API (검색어 트렌드)</p>'
    + '<div style="display:grid;grid-template-columns:1fr 2fr;gap:6px;font-size:13px;">'
    + '<label style="align-self:center;">Customer ID</label><input id="naverAdCustId" type="text" placeholder="1418388" style="padding:6px 8px;border:1px solid #ddd;border-radius:4px;font-size:13px;" />'
    + '<label style="align-self:center;">API Key</label><input id="naverAdApiKey" type="text" placeholder="0100000000..." style="padding:6px 8px;border:1px solid #ddd;border-radius:4px;font-size:13px;" />'
    + '<label style="align-self:center;">Secret Key</label><input id="naverAdSecret" type="password" placeholder="AQAAAAC..." style="padding:6px 8px;border:1px solid #ddd;border-radius:4px;font-size:13px;" />'
    + '<label style="align-self:center;">DataLab ID</label><input id="naverDlId" type="text" placeholder="S52Jn..." style="padding:6px 8px;border:1px solid #ddd;border-radius:4px;font-size:13px;" />'
    + '<label style="align-self:center;">DataLab Secret</label><input id="naverDlSecret" type="password" placeholder="oQAPfj..." style="padding:6px 8px;border:1px solid #ddd;border-radius:4px;font-size:13px;" />'
    + '</div>'
    + '<div style="display:flex;gap:8px;margin-top:8px;justify-content:flex-end;">'
    + '<button onclick="saveNaverKeys()" style="padding:8px 16px;border:none;background:#03c75a;color:#fff;border-radius:6px;cursor:pointer;font-weight:600;">네이버 키 저장</button>'
    + '</div>'
    + '<div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end;">'
    + '<button onclick="closeAuthModal()" style="padding:8px 16px;border:1px solid #ddd;background:#fff;border-radius:6px;cursor:pointer;">닫기</button>'
    + '</div></div>';
  document.body.appendChild(modal);
}

function closeAuthModal() {
  var m = document.getElementById('authModal');
  if (m) m.remove();
}

function disconnectAuth(target) {
  if (!confirm(target === 'cli' ? 'Claude CLI 인증을 비활성화할까요?' : 'API Key를 삭제할까요?')) return;
  fetch('/api/disconnect-auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target: target })
  }).then(function(r) { return r.json(); }).then(function(d) {
    if (d.ok) {
      showToast(d.message);
      checkAuthStatus();
      setTimeout(function() { closeAuthModal(); showAuthModal(); }, 500);
    } else { alert(d.error || '실패'); }
  }).catch(function(e) { alert('오류: ' + e.message); });
}

function reconnectCli() {
  fetch('/api/reconnect-cli', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  }).then(function(r) { return r.json(); }).then(function(d) {
    if (d.ok) {
      showToast(d.message);
      checkAuthStatus();
      setTimeout(function() { closeAuthModal(); showAuthModal(); }, 500);
    } else { alert(d.error || '실패'); }
  }).catch(function(e) { alert('오류: ' + e.message); });
}

function saveApiKey() {
  var input = document.getElementById('apiKeyInput');
  var key = (input && input.value || '').trim();
  if (!key) return;
  fetch('/api/set-api-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: key })
  }).then(function(r) { return r.json(); }).then(function(d) {
    if (d.ok) {
      showToast('API Key 저장 완료 (' + d.keyPreview + ')');
      checkAuthStatus();
      setTimeout(function() { closeAuthModal(); showAuthModal(); }, 500);
    } else {
      alert(d.error || '저장 실패');
    }
  }).catch(function(e) { alert('오류: ' + e.message); });
}

function saveNaverKeys() {
  var data = {
    customerId: (document.getElementById('naverAdCustId').value || '').trim(),
    apiKey: (document.getElementById('naverAdApiKey').value || '').trim(),
    secretKey: (document.getElementById('naverAdSecret').value || '').trim(),
    datalabClientId: (document.getElementById('naverDlId').value || '').trim(),
    datalabClientSecret: (document.getElementById('naverDlSecret').value || '').trim(),
  };
  // 최소 하나는 입력해야 함
  if (!data.customerId && !data.apiKey && !data.datalabClientId) {
    alert('최소 하나의 값을 입력하세요.');
    return;
  }
  // 빈 값 제거 (기존 값 유지)
  for (var k in data) { if (!data[k]) delete data[k]; }
  fetch('/api/set-naver-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }).then(function(r) { return r.json(); }).then(function(d) {
    if (d.ok) {
      showToast(d.message);
      closeAuthModal();
    } else {
      alert(d.error || '저장 실패');
    }
  }).catch(function(e) { alert('오류: ' + e.message); });
}

function initFilters() {
  BRANDS = []; MODELS = []; WORKS = [];
  var brandSet = {}, modelSet = {}, workSet = {};
  ALL_DATA.forEach(function(r) {
    if (r.brand) brandSet[r.brand] = 1;
    if (r.model) modelSet[r.model] = 1;
    if (r.work) workSet[r.work] = 1;
  });
  BRANDS = Object.keys(brandSet).sort();
  MODELS = Object.keys(modelSet).sort();
  WORKS = Object.keys(workSet).sort();

  // Populate brand select
  var sel = document.getElementById('brandFilter');
  sel.innerHTML = '<option value="">브랜드 전체</option>';
  BRANDS.forEach(function(b) {
    var o = document.createElement('option');
    o.value = b; o.textContent = b;
    sel.appendChild(o);
  });

  // Update searchable select items
  ssState.model.items = MODELS;
  ssState.work.items = WORKS;

  updateSummary();
}

function updateSummary() {
  var total = ALL_DATA.length;
  var imgDone = 0, naverGen = 0, naverPub = 0, metaGen = 0, metaPub = 0, daangnGen = 0, daangnPub = 0;
  ALL_DATA.forEach(function(r) {
    if (r.imgExtracted > 0) imgDone++;
    var eb1 = getEffective(r, 'b1');
    var eb2 = getEffective(r, 'b2');
    // 네이버: b1 또는 b2 중 하나라도 generated/published면 카운트
    if (eb1 === 'published' || eb2 === 'published') naverPub++;
    else if (eb1 === 'generated' || eb2 === 'generated') naverGen++;
    var eMeta = getEffective(r, 'meta');
    if (eMeta === 'published') metaPub++;
    else if (eMeta === 'generated') metaGen++;
    var eDaangn = getEffective(r, 'daangn');
    if (eDaangn === 'published') daangnPub++;
    else if (eDaangn === 'generated') daangnGen++;
  });

  document.getElementById('headerInfo').innerHTML =
    'SSOT: <strong>' + total.toLocaleString() + '</strong>개 &nbsp;|&nbsp; 업데이트: ' + new Date().toLocaleString('ko-KR');
  document.getElementById('summaryText').innerHTML =
    '📷추출: <strong>' + imgDone + '</strong>/' + total
    + ' &nbsp;<span style="color:#ccc;">|</span>&nbsp; '
    + '네이버: <strong>' + (naverGen + naverPub) + '</strong> 생성 / <strong>' + naverPub + '</strong> 발행'
    + ' &nbsp;<span style="color:#ccc;">|</span>&nbsp; '
    + '메타: <strong>' + (metaGen + metaPub) + '</strong>'
    + ' &nbsp;<span style="color:#ccc;">|</span>&nbsp; '
    + '당근: <strong>' + (daangnGen + daangnPub) + '</strong>';

  // Pipeline bar
  var el;
  el = document.getElementById('pipeImg');    if (el) el.textContent = imgDone + '/' + total;
  el = document.getElementById('pipeNaver');   if (el) el.textContent = (naverGen + naverPub) + '/' + total;
  el = document.getElementById('pipeNaverPub');if (el) el.textContent = naverPub;
  el = document.getElementById('pipeMeta');    if (el) el.textContent = (metaGen + metaPub) + '/' + total;
  el = document.getElementById('pipeDaangn');  if (el) el.textContent = (daangnGen + daangnPub) + '/' + total;
}

function refreshData() {
  showToast('데이터 새로고침 중...');
  fetch('/api/dashboard-data')
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function(d) {
      ALL_DATA = d.rows;
      initFilters();
      applyFilters();
      showToast('데이터 갱신 완료 (' + ALL_DATA.length + '개)');
    })
    .catch(function(e) {
      showToast('새로고침 실패: ' + e.message);
    });
}

// keyword cache status
function loadKvCacheStatus() {
  fetch('/api/keyword-cache-status')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      // Update pipeline bar if kvCacheText element exists
      var el = document.getElementById('kvCacheText');
      if (!el) return;
      if (!d.exists) {
        el.textContent = '없음';
      } else if (d.stale) {
        el.textContent = d.ageDays + '일 전 (갱신필요)';
      } else {
        el.textContent = d.ageDays + '일 전 (' + d.count + '개)';
      }
    })
    .catch(function() {});
}

function refreshKeywords() {
  if (!confirm('네이버 API로 키워드 검색량을 갱신하시겠습니까?\\n(약 30초 소요)')) return;
  showToast('키워드 갱신 시작...');
  fetch('/api/refresh-keywords', { method: 'POST' })
    .then(function(r) {
      if (!r.ok) return r.json().then(function(d) { throw new Error(d.error); });
      var reader = r.body.getReader();
      var decoder = new TextDecoder();
      function read() {
        return reader.read().then(function(result) {
          if (result.done) { loadKvCacheStatus(); showToast('키워드 갱신 완료'); return; }
          return read();
        });
      }
      return read();
    })
    .catch(function(e) { showToast('갱신 실패: ' + e.message); });
}

// ── Toast ──
function showToast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(function() { t.classList.remove('show'); }, 2500);
}

// ── localStorage publish status (hybrid) ──
var STORAGE_KEY = '2bass_publish_status';
function loadLocalStatus() {
  try {
    var raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    var migrated = {};
    for (var k in raw) {
      if (typeof raw[k] === 'string') {
        migrated[k] = { b1: raw[k] === 'done' ? 'published' : raw[k] };
      } else {
        migrated[k] = raw[k];
      }
    }
    return migrated;
  } catch(e) { return {}; }
}
function saveLocalStatus(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
var localStatus = loadLocalStatus();

function getEffective(row, field) {
  var ls = localStatus[row.id];
  if (ls && ls[field]) return ls[field];
  return row[field] || 'none';
}

// When brand changes, reset model search
document.getElementById('brandFilter').addEventListener('change', function() {
  ssClear('model');
  applyFilters();
});

// ── Searchable Select Component ──
var ssState = {
  model: { value: '', items: [] },
  work:  { value: '', items: [] },
};

function getFilteredModels() {
  var brand = document.getElementById('brandFilter').value;
  return brand
    ? MODELS.filter(function(m) { return ALL_DATA.some(function(r) { return r.brand === brand && r.model === m; }); })
    : MODELS;
}

function ssOpen(key) {
  var items = key === 'model' ? getFilteredModels() : WORKS;
  ssState[key].items = items;
  ssRender(key, '');
  document.getElementById(key + 'Dropdown').classList.add('open');
}

function ssFilter(key) {
  var q = document.getElementById(key + 'Input').value.toLowerCase().trim();
  ssRender(key, q);
  document.getElementById(key + 'Dropdown').classList.add('open');
}

function ssRender(key, query) {
  var dd = document.getElementById(key + 'Dropdown');
  var items = ssState[key].items;
  var matched = query ? items.filter(function(i) { return i && i.toLowerCase().includes(query); }) : items.filter(Boolean);
  var show = matched.slice(0, 50);

  dd.innerHTML = '';
  var allDiv = document.createElement('div');
  allDiv.className = 'ss-item';
  allDiv.style.cssText = 'color:#888; font-style:italic;';
  allDiv.textContent = '전체';
  allDiv.onclick = function() { ssSelect(key, ''); };
  dd.appendChild(allDiv);

  show.forEach(function(item) {
    var d = document.createElement('div');
    d.className = 'ss-item' + (ssState[key].value === item ? ' selected' : '');
    d.textContent = item;
    d.onclick = function() { ssSelect(key, item); };
    dd.appendChild(d);
  });

  if (matched.length > 50) {
    var more = document.createElement('div');
    more.className = 'ss-item';
    more.style.cssText = 'color:#aaa; font-size:11px; cursor:default;';
    more.textContent = '...외 ' + (matched.length - 50) + '개';
    dd.appendChild(more);
  }
}

function ssSelect(key, value) {
  ssState[key].value = value;
  document.getElementById(key + 'Input').value = value;
  document.getElementById(key + 'Dropdown').classList.remove('open');
  applyFilters();
}

function ssClear(key) {
  ssState[key].value = '';
  document.getElementById(key + 'Input').value = '';
  document.getElementById(key + 'Dropdown').classList.remove('open');
  applyFilters();
}

// Close dropdowns on outside click
document.addEventListener('click', function(e) {
  ['model', 'work'].forEach(function(key) {
    var wrap = document.getElementById(key + 'SelectWrap');
    if (!wrap.contains(e.target)) {
      document.getElementById(key + 'Dropdown').classList.remove('open');
    }
  });
});

function toggleSort(field) {
  if (currentSort === field) { sortDir *= -1; }
  else { currentSort = field; sortDir = (field === 'date' || field === 'priority') ? -1 : 1; }
  applyFilters();
}

function updateSortArrows() {
  ['priority', 'date', 'brand', 'model', 'work'].forEach(function(f) {
    var el = document.getElementById('sort_' + f);
    if (el) el.textContent = currentSort === f ? (sortDir > 0 ? '▲' : '▼') : '';
  });
}

function applyFilters() {
  var q = document.getElementById('searchInput').value.toLowerCase().trim();
  var brand = document.getElementById('brandFilter').value;
  var model = ssState.model.value;
  var work = ssState.work.value;
  var statusVal = document.getElementById('statusFilter').value;
  var dateFrom = document.getElementById('dateFrom').value;
  var dateTo = document.getElementById('dateTo').value;

  filtered = ALL_DATA.filter(function(r) {
    if (q && !(r.model||'').toLowerCase().includes(q) && !(r.work||'').toLowerCase().includes(q) && !(r.brand||'').toLowerCase().includes(q) && !(r.id||'').toLowerCase().includes(q)) return false;
    if (brand && r.brand !== brand) return false;
    if (model && r.model !== model) return false;
    if (work && r.work !== work) return false;
    if (dateFrom && (r.date || '') < dateFrom) return false;
    if (dateTo && (r.date || '') > dateTo) return false;
    if (statusVal) {
      if (statusVal === 'img_none' && r.imgExtracted > 0) return false;
      else if (statusVal === 'img_done' && (r.imgExtracted || 0) === 0) return false;
      else if (statusVal === 'naver_none') { if (!(getEffective(r, 'b1') === 'none' && getEffective(r, 'b2') === 'none')) return false; }
      else if (statusVal === 'naver_generated') { if (!((getEffective(r, 'b1') === 'generated' || getEffective(r, 'b2') === 'generated') && getEffective(r, 'b1') !== 'published' && getEffective(r, 'b2') !== 'published')) return false; }
      else if (statusVal === 'naver_published') { if (!(getEffective(r, 'b1') === 'published' || getEffective(r, 'b2') === 'published')) return false; }
      else if (statusVal !== 'img_none' && statusVal !== 'img_done') {
        var parts = statusVal.split('_');
        var platform = parts[0];
        var target = parts.slice(1).join('_');
        if (getEffective(r, platform) !== target) return false;
      }
    }
    return true;
  });

  filtered.sort(function(a, b) {
    var va = a[currentSort] || '', vb = b[currentSort] || '';
    return (va < vb ? -1 : va > vb ? 1 : 0) * sortDir;
  });

  updateSortArrows();
  currentPage = 1;
  render();
}

// ── Status cell click handler (SSE streaming) ──
function updateProgress(postId, platform, message) {
  var cell = document.querySelector('[data-id="' + postId + '"][data-platform="' + platform + '"]');
  if (cell) {
    cell.innerHTML = '<span class="spinner"></span>';
    cell.title = message;
  }
}

var PLATFORM_LABEL = { b1: '블로그①', b2: '블로그②', meta: '메타', daangn: '당근' };

function onGenerateDone(postId, platform) {
  var row = ALL_DATA.find(function(r) { return r.id === postId; });
  if (!row) return;
  var t = platform;
  if (!localStatus[postId]) localStatus[postId] = {};
  localStatus[postId][t] = 'generated';
  row[t] = 'generated';
  saveLocalStatus(localStatus);
  render();
  showToast((PLATFORM_LABEL[t] || t) + ' 생성 완료!');
}

// meta/daangn 전용 클릭 핸들러
function onStatusClick(postId, platform) {
  var row = ALL_DATA.find(function(r) { return r.id === postId; });
  if (!row) return;

  var st = getEffective(row, platform);
  var label = PLATFORM_LABEL[platform] || platform;

  if (st === 'none') {
    if (platform === 'meta' || platform === 'daangn') {
      showToast(label + ' 생성은 아직 준비중입니다.');
      return;
    }
    if (!SERVER_MODE) {
      showToast('서버 모드에서만 생성 가능합니다. start-dashboard.bat 실행 후 접속하세요.');
      return;
    }
    showToast(label + ' 생성 시작...');
    updateProgress(postId, platform, '생성 준비 중...');

    fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId: postId, platform: platform, target: platform })
    }).then(function(response) {
      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      function read() {
        reader.read().then(function(result) {
          if (result.done) return;
          buffer += decoder.decode(result.value, { stream: true });
          var lines = buffer.split('\\n');
          buffer = lines.pop();
          lines.forEach(function(line) {
            if (!line.startsWith('data: ')) return;
            try {
              var evt = JSON.parse(line.slice(6));
              if (evt.type === 'progress') updateProgress(postId, platform, evt.message);
              if (evt.type === 'done') onGenerateDone(postId, platform);
              if (evt.type === 'error') {
                showToast('생성 실패: ' + evt.message);
                render();
              }
            } catch(e) {}
          });
          read();
        }).catch(function(e) {
          showToast('스트림 오류: ' + e.message);
          render();
        });
      }
      read();
    }).catch(function(e) {
      showToast('생성 실패: ' + e.message);
      render();
    });
  } else {
    if (batchRunning) { window.open(postId + '.html', '_blank'); return; }
    window.open(postId + '.html', '_blank');
  }
}

function markPublished(postId, field) {
  if (!localStatus[postId]) localStatus[postId] = {};
  localStatus[postId][field] = 'published';
  saveLocalStatus(localStatus);
  var row = ALL_DATA.find(function(r) { return r.id === postId; });
  if (row) row[field] = 'published';
  render();
  showToast(postId + ' ' + (PLATFORM_LABEL[field] || field) + ' 발행 마킹 완료');
}

function statusIcon(st) {
  if (st === 'published') return '✅';
  if (st === 'generated') return '📝';
  return '⬚';
}

function statusClass(st) {
  if (st === 'published') return 'st-published';
  if (st === 'generated') return 'st-generated';
  return 'st-none';
}

function naverIcon(eB1, eB2) {
  if (eB1 === 'published' || eB2 === 'published') return '✅';
  if (eB1 === 'generated' && eB2 === 'generated') return '📝📝';
  if (eB1 === 'generated') return '📝';
  return '⬚';
}

function naverClass(eB1, eB2) {
  if (eB1 === 'published' || eB2 === 'published') return 'st-published';
  if (eB1 === 'generated') return 'st-generated';
  return 'st-none';
}

function triggerGenerate(postId, target) {
  if (!SERVER_MODE) {
    showToast('서버 모드에서만 생성 가능합니다. start-dashboard.bat 실행 후 접속하세요.');
    return;
  }
  var label = target ? (PLATFORM_LABEL[target] || target) : '블로그①②';
  showToast(label + ' 생성 시작...');

  var cell = document.querySelector('[data-id="' + postId + '"][data-platform="naver"]');
  if (cell) { cell.innerHTML = '<span class="spinner"></span>'; cell.title = '생성 준비 중...'; }

  fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postId: postId, platform: 'naver', target: target })
  }).then(function(response) {
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    function read() {
      reader.read().then(function(result) {
        if (result.done) return;
        buffer += decoder.decode(result.value, { stream: true });
        var lines = buffer.split('\\n');
        buffer = lines.pop();
        lines.forEach(function(line) {
          if (!line.startsWith('data: ')) return;
          try {
            var evt = JSON.parse(line.slice(6));
            if (evt.type === 'progress' && cell) {
              var msg = evt.message || '';
              var shortMsg = msg.replace('생성 시작...', '').replace('생성 중...', '');
              if (msg.includes('Blog1')) shortMsg = 'B1...';
              else if (msg.includes('Blog2')) shortMsg = 'B2...';
              else if (msg.includes('HTML')) shortMsg = 'HTML...';
              cell.innerHTML = '<span class="spinner"></span><span style="font-size:10px;margin-left:2px;">' + shortMsg + '</span>';
              cell.title = msg;
            }
            if (evt.type === 'done') {
              onGenerateDone(postId, 'b1');
              onGenerateDone(postId, 'b2');
            }
            if (evt.type === 'error') {
              showToast('생성 실패: ' + evt.message);
              render();
            }
          } catch(e) {}
        });
        read();
      }).catch(function(e) {
        showToast('스트림 오류: ' + e.message);
        render();
      });
    }
    read();
  }).catch(function(e) {
    showToast('생성 실패: ' + e.message);
    render();
  });
}

// 네이버 셀 클릭 — 뷰 전용 (생성된 건만 이동)
function onNaverView(postId) {
  var row = ALL_DATA.find(function(r) { return r.id === postId; });
  if (!row) return;
  var eB1 = getEffective(row, 'b1');
  var eB2 = getEffective(row, 'b2');
  if (eB1 !== 'none' || eB2 !== 'none') {
    window.open(postId + '.html', '_blank');
  }
}

function onNaverClick(postId) {
  var row = ALL_DATA.find(function(r) { return r.id === postId; });
  if (!row) return;
  var eB1 = getEffective(row, 'b1');
  var eB2 = getEffective(row, 'b2');

  // 이미 완료 → HTML 뷰
  if (eB1 === 'published' || eB2 === 'published' || (eB1 === 'generated' && eB2 === 'generated')) {
    window.open(postId + '.html', '_blank');
    return;
  }

  if (!SERVER_MODE) {
    showToast('서버 모드에서만 생성 가능합니다.');
    return;
  }

  var target = (eB1 === 'none') ? null : 'b2';
  var needExtract = row.img > 0 && (row.imgExtracted || 0) === 0;

  if (needExtract) {
    extractThenGenerate(postId, target);
  } else {
    triggerGenerate(postId, target);
  }
}

// 📷추출 → 블로그 생성 순차 파이프라인
function extractThenGenerate(postId, target) {
  var cell = document.querySelector('[data-id="' + postId + '"][data-platform="naver"]');
  if (cell) { cell.innerHTML = '<span class="spinner"></span>'; cell.title = '📷 이미지 추출 중...'; }
  showToast('📷 이미지 추출 → 블로그 생성 시작...');

  fetch('/api/extract-images', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postId: postId })
  }).then(function(response) {
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    function read() {
      reader.read().then(function(result) {
        if (result.done) return;
        buffer += decoder.decode(result.value, { stream: true });
        var lines = buffer.split('\\n');
        buffer = lines.pop();
        lines.forEach(function(line) {
          if (!line.startsWith('data: ')) return;
          try {
            var evt = JSON.parse(line.slice(6));
            if (evt.type === 'progress' && cell) {
              cell.title = evt.message;
            }
            if (evt.type === 'done') {
              var row = ALL_DATA.find(function(r) { return r.id === postId; });
              if (row) row.imgExtracted = evt.count || 0;
              if (evt.warning) {
                showToast('⚠ ' + evt.warning);
              } else {
                showToast('📷 추출 완료 (' + (evt.count || 0) + '장) → 블로그 생성...');
              }
              triggerGenerate(postId, target);
            }
            if (evt.type === 'error') {
              showToast('추출 실패: ' + evt.message);
              render();
            }
          } catch(e) {}
        });
        read();
      }).catch(function(e) {
        showToast('스트림 오류: ' + e.message);
        render();
      });
    }
    read();
  }).catch(function(e) {
    showToast('추출 실패: ' + e.message);
    render();
  });
}

function render() {
  var start = (currentPage - 1) * PAGE_SIZE;
  var page = filtered.slice(start, start + PAGE_SIZE);

  document.getElementById('resultCount').textContent = filtered.length.toLocaleString() + '개';

  var tbody = document.getElementById('tableBody');
  var html = '';
  page.forEach(function(r, i) {
    var eB1 = getEffective(r, 'b1');
    var eB2 = getEffective(r, 'b2');
    var eMeta = getEffective(r, 'meta');
    var eDaangn = getEffective(r, 'daangn');

    // 📷추출 셀: 미추출=⬚(예상수) (클릭 가능), 추출완료=📷N, 이미지없음=—
    var imgCellContent, imgCellClass, imgCellClick;
    if (r.img === 0 && r.imgExtracted === 0) {
      imgCellContent = '—';
      imgCellClass = '';
      imgCellClick = '';
    } else if (r.imgExtracted > 0 && r.img > 0 && r.imgExtracted < r.img) {
      // 불완전 추출: 클릭 시 재추출 가능
      imgCellContent = '⚠' + r.imgExtracted + '/' + r.img;
      imgCellClass = ' style="text-align:center; color:#e67700; font-size:12px; font-weight:600; cursor:pointer;" title="' + r.img + '장 중 ' + r.imgExtracted + '장만 추출됨 — 클릭하여 재추출"';
      imgCellClick = ' data-id="' + r.id + '" data-platform="img" onclick="onExtractImages(&quot;' + r.id + '&quot;, true)"';
    } else if (r.imgExtracted > 0) {
      imgCellContent = '📷' + r.imgExtracted;
      imgCellClass = ' style="text-align:center; color:#03c75a; font-size:12px; font-weight:600; cursor:pointer;" title="클릭하여 재추출"';
      imgCellClick = ' data-id="' + r.id + '" data-platform="img" onclick="onExtractImages(&quot;' + r.id + '&quot;, true)"';
    } else {
      imgCellContent = r.img > 0 ? '⬚(' + r.img + ')' : '⬚';
      imgCellClass = ' class="status-cell st-none" style="cursor:pointer;"';
      imgCellClick = ' data-id="' + r.id + '" data-platform="img" onclick="onExtractImages(&quot;' + r.id + '&quot;)"';
    }

    // 네이버 통합 셀
    var nIcon = naverIcon(eB1, eB2);
    var nClass = naverClass(eB1, eB2);
    var nTitle = '블로그①: ' + eB1 + ' / 블로그②: ' + eB2;

    var isChecked = selectedIds.has(r.id);
    html += '<tr>'
      + '<td class="cb-col"><input type="checkbox" class="row-checkbox" ' + (isChecked ? 'checked' : '') + ' onchange="toggleSelect(&quot;' + r.id + '&quot;, this.checked)"></td>'
      + '<td style="text-align:center; color:#888;">' + (start + i + 1) + '</td>'
      + '<td style="text-align:center; font-size:12px; font-weight:' + (r.priority >= 1000 ? '700' : '400') + '; color:' + (r.priority >= 2000 ? '#c62828' : r.priority >= 1000 ? '#e65100' : r.priority >= 500 ? '#ef6c00' : r.priority > 0 ? '#888' : '#ddd') + ';" title="검색량 기반 우선순위">' + (r.priority > 0 ? r.priority : '—') + '</td>'
      + '<td style="font-size:11px; color:#888; white-space:nowrap;">' + esc(r.date || '') + '</td>'
      + '<td style="font-size:12px; color:#666;">' + esc(r.brand) + '</td>'
      + '<td>' + esc(r.model) + '</td>'
      + '<td style="color:#555; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="' + esc(r.work) + '">' + esc(r.work) + '</td>'
      + '<td' + imgCellClass + imgCellClick + '>' + imgCellContent + '</td>'
      + '<td class="status-cell ' + nClass + '" data-id="' + r.id + '" data-platform="naver" onclick="onNaverView(&quot;' + r.id + '&quot;)" title="' + nTitle + '" style="' + ((eB1 !== 'none' || eB2 !== 'none') ? 'cursor:pointer;' : '') + '">' + nIcon + '</td>'
      + '<td class="status-cell ' + statusClass(eMeta) + '" title="' + eMeta + ' (준비중)">' + statusIcon(eMeta) + '</td>'
      + '<td class="status-cell ' + statusClass(eDaangn) + '" title="' + eDaangn + ' (준비중)">' + statusIcon(eDaangn) + '</td>'
      + '</tr>';
  });
  tbody.innerHTML = html;

  updateSummary();

  // Pagination
  var totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  var pagDiv = document.getElementById('pagination');
  if (totalPages <= 1) { pagDiv.innerHTML = ''; return; }

  var pagHtml = '<button ' + (currentPage <= 1 ? 'disabled' : 'onclick="goPage(' + (currentPage - 1) + ')"') + '>◀</button>';

  var pStart = Math.max(1, currentPage - 4);
  var pEnd = Math.min(totalPages, pStart + 8);
  if (pEnd - pStart < 8) pStart = Math.max(1, pEnd - 8);

  if (pStart > 1) pagHtml += '<button onclick="goPage(1)">1</button><span style="padding:0 4px;">…</span>';
  for (var p = pStart; p <= pEnd; p++) {
    pagHtml += '<button' + (p === currentPage ? ' class="active"' : '') + ' onclick="goPage(' + p + ')">' + p + '</button>';
  }
  if (pEnd < totalPages) pagHtml += '<span style="padding:0 4px;">…</span><button onclick="goPage(' + totalPages + ')">' + totalPages + '</button>';

  pagHtml += '<button ' + (currentPage >= totalPages ? 'disabled' : 'onclick="goPage(' + (currentPage + 1) + ')"') + '>▶</button>';
  pagDiv.innerHTML = pagHtml;
}

function goPage(p) { currentPage = p; render(); window.scrollTo(0, 0); }

function esc(s) {
  if (!s) return '';
  var d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ── Image extraction click handler ──
function onExtractImages(postId, force) {
  if (!SERVER_MODE) {
    showToast('서버 모드에서만 추출 가능합니다. start-dashboard.bat 실행 후 접속하세요.');
    return;
  }

  var cell = document.querySelector('[data-id="' + postId + '"][data-platform="img"]');
  if (cell) cell.innerHTML = '<span class="spinner"></span>';

  showToast(force ? '📷 이미지 재추출 시작...' : '📷 이미지 추출 시작...');

  fetch('/api/extract-images', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postId: postId, force: !!force })
  }).then(function(response) {
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    function read() {
      reader.read().then(function(result) {
        if (result.done) return;
        buffer += decoder.decode(result.value, { stream: true });
        var lines = buffer.split('\\n');
        buffer = lines.pop();
        lines.forEach(function(line) {
          if (!line.startsWith('data: ')) return;
          try {
            var evt = JSON.parse(line.slice(6));
            if (evt.type === 'progress' && cell) {
              cell.innerHTML = '<span class="spinner"></span>';
              cell.title = evt.message;
            }
            if (evt.type === 'done') {
              var row = ALL_DATA.find(function(r) { return r.id === postId; });
              if (row) row.imgExtracted = evt.count || 0;
              render();
              if (evt.warning) {
                showToast('⚠ ' + evt.warning);
              } else {
                showToast('📷 추출 완료: ' + (evt.count || 0) + '장');
              }
            }
            if (evt.type === 'error') {
              showToast('추출 실패: ' + evt.message);
              render();
            }
          } catch(e) {}
        });
        read();
      }).catch(function(e) {
        showToast('스트림 오류: ' + e.message);
        render();
      });
    }
    read();
  }).catch(function(e) {
    showToast('추출 실패: ' + e.message);
    render();
  });
}

// ── Checkbox selection ──
var selectedIds = new Set();

function toggleSelect(id, checked) {
  if (checked) selectedIds.add(id);
  else selectedIds.delete(id);
  updateBatchBar();
}

function toggleSelectAll(checked) {
  var start = (currentPage - 1) * PAGE_SIZE;
  var page = filtered.slice(start, start + PAGE_SIZE);
  page.forEach(function(r) {
    if (checked) selectedIds.add(r.id);
    else selectedIds.delete(r.id);
  });
  render();
  updateBatchBar();
}

function clearSelection() {
  selectedIds.clear();
  var cb = document.getElementById('selectAllCb');
  if (cb) cb.checked = false;
  render();
  updateBatchBar();
}

function estimateBatchTime() {
  var ids = Array.from(selectedIds);
  var genCount = 0;
  ids.forEach(function(id) {
    var row = ALL_DATA.find(function(r) { return r.id === id; });
    if (!row) return;
    var eB1 = getEffective(row, 'b1');
    var eB2 = getEffective(row, 'b2');
    if ((eB1 === 'generated' || eB1 === 'published') && (eB2 === 'generated' || eB2 === 'published')) return;
    genCount++;
  });
  if (genCount === 0) return null;
  var perItem = getStepExpect('extract') + getStepExpect('b1') + getStepExpect('b2') + getStepExpect('html');
  return { genCount: genCount, skipCount: ids.length - genCount, totalSec: genCount * perItem };
}

function updateBatchBar() {
  var bar = document.getElementById('batchBar');
  var naverBtn = document.getElementById('batchNaverBtn');
  if (naverBtn && !SERVER_MODE) naverBtn.style.display = 'none';
  var count = selectedIds.size;
  if (count > 0 || batchRunning) {
    bar.classList.add('visible');
    var label;
    if (batchRunning) {
      label = count + '개 처리 중';
    } else {
      var est = estimateBatchTime();
      if (!est) {
        label = count + '개 선택 (전부 생성 완료)';
      } else {
        label = count + '개 선택 (생성 ' + est.genCount + '건, 약 ' + formatEta(est.totalSec) + ')';
      }
    }
    document.getElementById('batchCount').textContent = label;
  } else {
    bar.classList.remove('visible');
  }
  // Update select-all checkbox state
  var cb = document.getElementById('selectAllCb');
  if (cb) {
    var start = (currentPage - 1) * PAGE_SIZE;
    var page = filtered.slice(start, start + PAGE_SIZE);
    var allChecked = page.length > 0 && page.every(function(r) { return selectedIds.has(r.id); });
    cb.checked = allChecked;
  }
}

// ── SSE 스트림을 읽어서 이벤트 배열로 반환 (공통 헬퍼) ──
function readSSE(response, onEvent, label) {
  label = label || 'SSE';
  return new Promise(function(resolve) {
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    var resolved = false;
    var eventCount = 0;

    function done(result) {
      if (resolved) return;
      resolved = true;
      reader.cancel();
      resolve(result);
    }

    function processBuffer() {
      var NL = String.fromCharCode(10);
      var lines = buffer.split(NL);
      buffer = lines.pop();
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].replace(/\\r$/, '');
        if (!line.startsWith('data: ')) continue;
        try {
          var evt = JSON.parse(line.slice(6));
          eventCount++;
          onEvent(evt, done);
          if (resolved) return;
        } catch(e) {
          console.warn('[' + label + '] JSON parse error:', e.message, 'line:', line.slice(0, 100));
        }
      }
    }

    function read() {
      reader.read().then(function(result) {
        if (result.value) {
          var chunk = decoder.decode(result.value, { stream: !result.done });
          buffer += chunk;
          processBuffer();
        }
        if (resolved) return;
        if (result.done) {
          done({ ok: false, error: 'stream ended without done/error event (events:' + eventCount + ')' });
          return;
        }
        read();
      }).catch(function(e) {
        console.error('[' + label + '] read error:', e.message);
        done({ ok: false, error: e.message });
      });
    }
    read();

    // 5분 타임아웃
    setTimeout(function() {
      if (!resolved) {
        console.warn('[' + label + '] TIMEOUT 5분');
        done({ ok: false, error: 'timeout (5분)' });
      }
    }, 300000);
  });
}

// ── Batch generate ──
var batchRunning = false;
window.addEventListener('beforeunload', function(e) {
  if (batchRunning) {
    e.preventDefault();
    e.returnValue = '';
  }
});
// 단계별 예상 비중: 추출 13%, B1 40%, B2 40%, HTML 7% (총 100%)
var STEP_WEIGHT = { extract: 0.13, b1: 0.40, b2: 0.40, html: 0.07 };
var STEP_EXPECT_SEC = { extract: 8, b1: 100, b2: 100, html: 5 }; // 실제 CLI 소요시간 기준
var ITEM_EXPECT_SEC = 213; // extract+b1+b2+html 총 예상
var batchState = { current: 0, total: 0, success: 0, skipped: 0, failed: 0, step: '', stepStart: 0, stepBase: 0, startTime: 0, lastEta: Infinity, stepTimes: {} };

// 현재 단계 시작 등록
function setBatchStep(stepName) {
  // 이전 단계 종료 → 실측 소요시간 기록
  if (batchState.step) {
    var elapsed = (Date.now() - batchState.stepStart) / 1000;
    if (!batchState.stepTimes[batchState.step]) batchState.stepTimes[batchState.step] = [];
    batchState.stepTimes[batchState.step].push(elapsed);
    console.log('[batch-timing] ' + batchState.step + ' 완료: ' + elapsed.toFixed(1) + 's (평균 ' + (batchState.stepTimes[batchState.step].reduce(function(a,b){return a+b},0) / batchState.stepTimes[batchState.step].length).toFixed(1) + 's)');
  }
  // stepBase = 이전 단계까지 누적 비중
  var order = ['extract', 'b1', 'b2', 'html'];
  var base = 0;
  for (var k = 0; k < order.length; k++) {
    if (order[k] === stepName) break;
    base += STEP_WEIGHT[order[k]] || 0;
  }
  batchState.step = stepName;
  batchState.stepStart = Date.now();
  batchState.stepBase = base;
}

// 실측 평균 기반 단계별 예상 시간 (실측 없으면 하드코딩 폴백)
function getStepExpect(stepName) {
  var times = batchState.stepTimes[stepName];
  if (times && times.length > 0) {
    return times.reduce(function(a, b) { return a + b; }, 0) / times.length;
  }
  return STEP_EXPECT_SEC[stepName] || 100;
}

// 1초 타이머: 바 너비 + 텍스트 + ETA + 통계 전부 갱신
function tickBatchBar() {
  if (!batchRunning || !batchState.step) return;
  var stepElapsed = (Date.now() - batchState.stepStart) / 1000;
  var expect = getStepExpect(batchState.step);
  var stepPct = Math.min(stepElapsed / expect, 0.95);
  var stepWeight = STEP_WEIGHT[batchState.step] || 0.25;
  var itemProgress = batchState.stepBase + stepWeight * stepPct;
  var totalFrac = batchState.current + itemProgress;
  var pct = batchState.total > 0 ? Math.round((totalFrac / batchState.total) * 100) : 0;
  pct = Math.min(pct, 99);

  var bar = document.getElementById('batchProgressBar');
  var text = document.getElementById('batchProgressText');
  var etaEl = document.getElementById('batchProgressEta');
  var statsEl = document.getElementById('batchProgressStats');

  if (bar) bar.style.width = pct + '%';
  if (text) text.textContent = (batchState.current + 1) + '/' + batchState.total + ' (' + pct + '%)';

  // ETA: 완료 건수 기반 실측 or 예상치, clamp로 증가 방지
  var totalElapsed = (Date.now() - batchState.startTime) / 1000;
  var done = batchState.current;
  var eta;
  if (done > 0) {
    // 실측 평균 기반: 남은 건수 × 평균 - 현재 건 경과시간
    var avg = totalElapsed / done;
    eta = Math.max(0, (batchState.total - done) * avg - stepElapsed);
  } else {
    eta = Math.max(0, batchState.total * ITEM_EXPECT_SEC - totalElapsed);
  }
  // clamp: ETA는 절대 이전 값보다 커지지 않음
  if (eta > batchState.lastEta) eta = batchState.lastEta;
  batchState.lastEta = eta;
  if (etaEl) etaEl.textContent = formatEta(eta);

  if (statsEl) {
    statsEl.textContent = '성공 ' + batchState.success + ' | 스킵 ' + batchState.skipped + ' | 실패 ' + batchState.failed;
  }
}

function batchGenerateOne(postId) {
  var row = ALL_DATA.find(function(r) { return r.id === postId; });
  if (!row) { return Promise.resolve({ id: postId, ok: false, error: 'row not found' }); }

  var eB1 = getEffective(row, 'b1');
  var eB2 = getEffective(row, 'b2');

  if ((eB1 === 'generated' || eB1 === 'published') && (eB2 === 'generated' || eB2 === 'published')) {
    return Promise.resolve({ id: postId, ok: true, skipped: true });
  }
  var target = (eB1 === 'none') ? null : 'b2';
  var needExtract = row.img > 0 && (row.imgExtracted || 0) === 0;

  var cell = document.querySelector('[data-id="' + postId + '"][data-platform="naver"]');
  if (cell) { cell.innerHTML = '<span class="spinner"></span>'; cell.title = '배치 생성 중...'; }
  if (batchRunning && needExtract) setBatchStep('extract');
  else if (batchRunning) setBatchStep('b1');

  function doGenerate(tgt) {
    return fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId: postId, platform: 'naver', target: tgt })
    }).then(function(response) {
      return readSSE(response, function(evt, done) {
        if (evt.type === 'progress') {
              var stepMsg = evt.message || '';
              var stepLabel = '';
              if (stepMsg.includes('Blog1')) { stepLabel = 'B1...'; if (batchRunning) setBatchStep('b1'); }
              else if (stepMsg.includes('Blog2')) { stepLabel = 'B2...'; if (batchRunning) setBatchStep('b2'); }
              else if (stepMsg.includes('HTML')) { stepLabel = 'HTML...'; if (batchRunning) setBatchStep('html'); }
              if (cell) {
                cell.innerHTML = '<span class="spinner"></span>' + (stepLabel ? '<span style="font-size:10px;margin-left:2px;">' + stepLabel + '</span>' : '');
                cell.title = stepMsg;
              }
            }
        if (evt.type === 'done') {
          if (evt.generated && evt.generated.length) {
            evt.generated.forEach(function(p) { onGenerateDone(postId, p); });
          } else if (!tgt) {
            onGenerateDone(postId, 'b1');
            onGenerateDone(postId, 'b2');
          } else {
            onGenerateDone(postId, tgt);
          }
          done({ id: postId, ok: true });
        }
        if (evt.type === 'error') {
          done({ id: postId, ok: false, error: evt.message });
        }
      }, 'gen:' + postId);
    }).then(function(result) {
      return result.id ? result : { id: postId, ok: result.ok, error: result.error };
    }).catch(function(e) {
      console.error('[batch] doGenerate catch:', e.message);
      return { id: postId, ok: false, error: e.message };
    });
  }

  if (needExtract) {
    return fetch('/api/extract-images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId: postId })
    }).then(function(response) {
      if (!response.ok) {
        console.warn('[batch] extract HTTP 실패 (' + response.status + '), 추출 건너뛰고 생성 시도');
        return { ok: false, error: 'extract HTTP ' + response.status };
      }
      return readSSE(response, function(evt, done) {
        if (evt.type === 'progress' && cell) { cell.title = '📷 ' + evt.message; }
        if (evt.type === 'done') {
          row.imgExtracted = evt.count || 0;
          done({ ok: true, count: evt.count || 0 });
        }
        if (evt.type === 'error') {
          done({ ok: false, error: '추출실패: ' + evt.message });
        }
      }, 'extract:' + postId);
    }).then(function(extractResult) {
      // 추출 실패해도 생성은 시도 (이미지 없이 텍스트만 생성)
      if (!extractResult.ok) console.warn('[batch] extract 실패, 생성은 시도:', extractResult.error);
      return doGenerate(target);
    }).catch(function(e) {
      console.error('[batch] extract catch:', e.message);
      // 추출 실패해도 생성 시도
      return doGenerate(target);
    });
  } else {
    return doGenerate(target);
  }
}

function formatEta(seconds) {
  if (!seconds || seconds < 0) return '';
  if (seconds < 60) return '약 ' + Math.ceil(seconds) + '초 남음';
  var m = Math.floor(seconds / 60);
  var s = Math.ceil(seconds % 60);
  return '약 ' + m + '분 ' + (s > 0 ? s + '초' : '') + ' 남음';
}

// updateBatchProgress 제거됨 — tickBatchBar()가 매초 모든 UI 갱신을 통합 처리

async function batchGenerate(platform) {
  if (batchRunning) { showToast('배치가 이미 실행 중입니다'); return; }
  if (!SERVER_MODE) { showToast('서버 모드에서만 생성 가능합니다.'); return; }
  if (platform !== 'naver') { showToast(platform + ' 생성은 아직 준비중입니다.'); return; }

  var ids = Array.from(selectedIds);
  if (ids.length === 0) { showToast('선택된 항목이 없습니다'); return; }

  batchRunning = true;
  // 배치 시작 시 Notification 권한 요청 (사용자 제스처 컨텍스트)
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    Notification.requestPermission();
  }
  var btn = document.getElementById('batchNaverBtn');
  if (btn) btn.disabled = true;
  var failures = [];
  var skipped = 0;
  var success = 0;
  var startTime = Date.now();

  batchState = { current: 0, total: ids.length, success: 0, skipped: 0, failed: 0, step: '', stepStart: 0, stepBase: 0, startTime: startTime, lastEta: Infinity, stepTimes: {} };
  // 프로그레스 바 활성화
  var wrap = document.getElementById('batchProgress');
  if (wrap) wrap.classList.add('active');

  // 1초마다: tickBatchBar가 바+텍스트+ETA+통계 전부 갱신
  var elapsedTimer = setInterval(function() {
    tickBatchBar();
  }, 1000);

  for (var i = 0; i < ids.length; i++) {
    batchState.current = i;

    // 브라우저 리페인트 기회 제공
    await new Promise(function(r) { setTimeout(r, 50); });

    console.log('[batch] #' + (i+1) + '/' + ids.length + ' ' + ids[i] + ' 시작');
    try {
      var result = await batchGenerateOne(ids[i]);
      if (result.skipped) {
        skipped++; batchState.skipped = skipped;
        console.log('[batch] #' + (i+1) + '/' + ids.length + ' ' + ids[i] + ' 결과: 스킵');
      } else if (!result.ok) {
        failures.push({ id: result.id, error: result.error }); batchState.failed = failures.length;
        console.log('[batch] #' + (i+1) + '/' + ids.length + ' ' + ids[i] + ' 결과: 실패 — ' + result.error);
      } else {
        success++; batchState.success = success;
        console.log('[batch] #' + (i+1) + '/' + ids.length + ' ' + ids[i] + ' 결과: 성공');
      }
    } catch(e) {
      console.error('[batchGenerate] exception:', e);
      failures.push({ id: ids[i], error: e.message }); batchState.failed = failures.length;
    }
    render();
    updateBatchBar();
  }

  // 마지막 단계 실측 기록
  if (batchState.step) {
    var lastElapsed = (Date.now() - batchState.stepStart) / 1000;
    if (!batchState.stepTimes[batchState.step]) batchState.stepTimes[batchState.step] = [];
    batchState.stepTimes[batchState.step].push(lastElapsed);
    console.log('[batch-timing] ' + batchState.step + ' 완료: ' + lastElapsed.toFixed(1) + 's');
  }
  // 단계별 평균 요약
  var timingSummary = Object.keys(batchState.stepTimes).map(function(k) {
    var t = batchState.stepTimes[k];
    var avg = t.reduce(function(a,b){return a+b},0) / t.length;
    return k + ': 평균 ' + avg.toFixed(1) + 's (' + t.length + '건)';
  }).join(' | ');
  console.log('[batch-timing] 전체 요약 — ' + timingSummary + ' | 총 ' + ((Date.now() - startTime) / 1000).toFixed(1) + 's');

  // 타이머 정리 + 완료 상태 표시
  clearInterval(elapsedTimer);
  batchState.current = ids.length;
  var bar = document.getElementById('batchProgressBar');
  var text = document.getElementById('batchProgressText');
  var etaEl = document.getElementById('batchProgressEta');
  var statsEl = document.getElementById('batchProgressStats');
  if (bar) bar.style.width = '100%';
  if (text) text.textContent = ids.length + '/' + ids.length + ' (100%)';
  if (etaEl) etaEl.textContent = '완료!';
  if (statsEl) statsEl.textContent = '성공 ' + success + ' | 스킵 ' + skipped + ' | 실패 ' + failures.length;

  // 브라우저 Notification (다른 탭에서도 확인 가능)
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification('배치 생성 완료', {
      body: success + '건 성공' + (failures.length ? ', ' + failures.length + '건 실패' : '')
    });
  }

  batchRunning = false;
  if (btn) btn.disabled = false;

  var msg = '배치 완료: ' + ids.length + '건';
  if (skipped > 0) msg += ' (스킵 ' + skipped + '건)';
  if (failures.length > 0) {
    msg += ' / 실패 ' + failures.length + '건';
    console.warn('배치 실패 목록:', failures);
    var failIds = failures.map(function(f) { return f.id + ': ' + f.error; }).join(', ');
    showToast(msg + ' — ' + failIds);
  } else {
    showToast(msg);
  }

  // 3초 후 프로그레스 바 숨김 + 선택 해제
  setTimeout(function() {
    if (!batchRunning) {
      var wrap = document.getElementById('batchProgress');
      if (wrap) wrap.classList.remove('active');
      clearSelection();
    }
  }, 3000);

  render();
  updateBatchBar();
}

// ── Init ──
initDashboard();

</script>
</body>
</html>`;
}

// ── scanPosts: SSOT 디렉토리에서 posts + blog2Map 로드 ──

function scanPosts() {
  const jsonFiles = fs.readdirSync(V2_DIR)
    .filter(f => f.endsWith('.json') && !f.startsWith('_') && !f.endsWith('_blog2.json'))
    .sort();

  const posts = jsonFiles.map(f => {
    return JSON.parse(fs.readFileSync(path.join(V2_DIR, f), 'utf8'));
  });

  const blog2Map = {};
  const blog2Files = fs.readdirSync(V2_DIR)
    .filter(f => f.endsWith('_blog2.json') && !f.startsWith('_'));
  for (const f of blog2Files) {
    try {
      const b2 = JSON.parse(fs.readFileSync(path.join(V2_DIR, f), 'utf8'));
      if (b2.postId) blog2Map[b2.postId] = b2;
    } catch { /* skip invalid */ }
  }

  return { posts, blog2Map };
}

// ── Main ──

function main() {
  ensureDir(HTML_DIR);

  const targetPostId = process.argv[2] || null;

  const { posts, blog2Map } = scanPosts();
  const allPostIds = posts.map(p => p.postId);

  // Load/init status
  const status = loadStatus();
  let generated = 0;

  posts.forEach((post, i) => {
    if (targetPostId && post.postId !== targetPostId) return;

    const blog2Post = blog2Map[post.postId] || null;
    const htmlPath = path.join(HTML_DIR, `${post.postId}.html`);
    const html = buildPostHtml(post, allPostIds, i, blog2Post);
    fs.writeFileSync(htmlPath, html, 'utf8');
    generated++;

    // Init status entry if not exists
    if (!status.posts[post.postId]) {
      status.posts[post.postId] = {
        status: 'generated',
        publishedAt: null,
        naverUrl: null,
        notes: ''
      };
    }
  });

  // Build dashboard HTML (data loaded via API at runtime)
  console.log('대시보드 HTML 생성 중...');
  const indexHtml = buildIndexHtml();
  fs.writeFileSync(path.join(HTML_DIR, '_index.html'), indexHtml, 'utf8');
  console.log(`📊 대시보드 HTML 생성 완료 (데이터는 서버 API에서 로드)`);

  // Update stats (2블로그)
  const allStatuses = Object.values(status.posts);
  status.stats = {
    total: posts.length,
    generated: allStatuses.length,
    blog1Published: allStatuses.filter(s => s.blog1?.status === 'published').length,
    blog2Published: allStatuses.filter(s => s.blog2?.status === 'published').length,
    skipped: allStatuses.filter(s => s.blog1?.status === 'skipped').length,
  };
  saveStatus(status);

  console.log(`✅ HTML 생성 완료: ${generated}개`);
  console.log(`📋 대시보드: ${path.join(HTML_DIR, '_index.html')}`);
  console.log(`📊 상태: 생성 ${status.stats.generated} / 1번발행 ${status.stats.blog1Published} / 2번발행 ${status.stats.blog2Published} / 건너뛰기 ${status.stats.skipped}`);
}

// ── Exports (빌드 스크립트에서 import) ──
export { buildIndexHtml, buildPostHtml, scanPosts, absImgDir, ROOT, V2_DIR, HTML_DIR, SSOT_DIR };

// ── 직접 실행 시에만 main() 호출 ──
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMain) { main(); }
