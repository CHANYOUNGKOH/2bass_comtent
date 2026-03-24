#!/usr/bin/env node
/**
 * build-process-guide.js
 * SSOT → 네이버 블로그 변환 과정 설명 문서 (HTML)
 * 실제 데이터 기반 before/after 비교 포함
 *
 * 출력: data/publish/naver-v2-html/process-guide.html
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SSOT_DIR = path.join(ROOT, 'data', 'ssot-posts');
const V2_DIR = path.join(ROOT, 'data', 'publish', 'naver-v2');
const OUT = path.join(ROOT, 'data', 'publish', 'naver-v2-html', 'process-guide.html');

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function imgB64(filePath) {
  try { return 'data:image/jpeg;base64,' + fs.readFileSync(filePath).toString('base64'); }
  catch { return null; }
}

// ── Load samples ──
function loadPair(postId) {
  const ssot = JSON.parse(fs.readFileSync(path.join(SSOT_DIR, postId + '.json'), 'utf8'));
  const v2 = JSON.parse(fs.readFileSync(path.join(V2_DIR, postId + '.json'), 'utf8'));
  // load first image if exists
  let thumbB64 = null;
  if (ssot.images?.dir && ssot.images?.files?.length) {
    const imgPath = path.resolve(ROOT, ssot.images.dir, ssot.images.files[0]);
    thumbB64 = imgB64(imgPath);
  }
  return { ssot, v2, thumbB64 };
}

const sample1 = loadPair('cnt_4a409efa1b9d_post_01'); // 이미지O, 커스텀 작업
const sample2 = loadPair('cnt_01624ba2f1d2_post_01'); // 이미지X, 풀셋

// ── Stats ──
const v2Files = fs.readdirSync(V2_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
const ssotFiles = fs.readdirSync(SSOT_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));

let totalOrigLen = 0, totalGenLen = 0, withImgCount = 0;
for (const f of v2Files) {
  const v2 = JSON.parse(fs.readFileSync(path.join(V2_DIR, f), 'utf8'));
  const ssotPath = path.join(SSOT_DIR, f);
  if (fs.existsSync(ssotPath)) {
    const ssot = JSON.parse(fs.readFileSync(ssotPath, 'utf8'));
    totalOrigLen += (ssot.originalText || '').length;
  }
  totalGenLen += (v2.naver?.body || '').length;
  if (v2.images?.count > 0) withImgCount++;
}
const avgOrig = Math.round(totalOrigLen / v2Files.length);
const avgGen = Math.round(totalGenLen / v2Files.length);

function renderComparison(pair, label) {
  const { ssot, v2, thumbB64 } = pair;
  const origText = ssot.originalText || '';
  const genBody = v2.naver?.body || '';
  const origTitle = ssot.title?.original || '';
  const genTitle = v2.naver?.title || '';
  const car = `${ssot.vehicle?.brand || ''} ${ssot.vehicle?.model || ''}`.trim();
  const hashtags = (v2.naver?.hashtags || []).map(t => t.startsWith('#') ? t : '#' + t).join(' ');
  const cta = v2.naver?.cta || '';

  return `
    <div class="compare-card">
      <div class="compare-header">
        <h3>${label}: ${esc(car)}</h3>
        <span class="compare-badge">${ssot.images?.count > 0 ? '📷 이미지 ' + ssot.images.count + '장' : '이미지 없음'}</span>
      </div>

      ${thumbB64 ? `<div style="text-align:center; padding:16px; background:#f5f5f5;"><img src="${thumbB64}" style="max-height:200px; border-radius:6px; box-shadow:0 2px 8px rgba(0,0,0,.1);"></div>` : ''}

      <!-- 제목 비교 -->
      <div class="compare-row">
        <div class="compare-col before">
          <div class="col-label">원문 제목</div>
          <div class="col-content">${esc(origTitle.substring(0, 80))}${origTitle.length > 80 ? '...' : ''}</div>
        </div>
        <div class="compare-arrow">→</div>
        <div class="compare-col after">
          <div class="col-label">생성 제목 (SEO 최적화)</div>
          <div class="col-content">${esc(genTitle)}</div>
        </div>
      </div>

      <!-- 본문 비교 -->
      <div class="compare-row">
        <div class="compare-col before">
          <div class="col-label">원문 본문 (${origText.length}자)</div>
          <div class="col-content body-preview">${esc(origText.substring(0, 250))}...</div>
        </div>
        <div class="compare-arrow">→</div>
        <div class="compare-col after">
          <div class="col-label">생성 본문 (${genBody.length}자)</div>
          <div class="col-content body-preview">${esc(genBody.substring(0, 350))}...</div>
        </div>
      </div>

      <!-- 추가된 요소 -->
      <div class="added-elements">
        <div class="added-item"><span class="added-tag">+ 해시태그</span> ${esc(hashtags.substring(0, 120))}...</div>
        <div class="added-item"><span class="added-tag">+ CTA</span> ${esc(cta.split('\n')[0])}</div>
        ${ssot.originalUrl ? `<div class="added-item"><span class="added-tag">원본</span> <a href="${esc(ssot.originalUrl)}" target="_blank" style="color:#1a73e8;">${esc(ssot.originalUrl)}</a></div>` : ''}
      </div>
    </div>`;
}

const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>투베이스 콘텐츠 변환 프로세스 가이드</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Nanum+Gothic:wght@400;700&display=swap');
  * { box-sizing: border-box; }
  body { margin: 0; padding: 20px; font-family: '나눔고딕','NanumGothic','Nanum Gothic','Malgun Gothic',sans-serif; background: #fafafa; color: #333; }
  .guide { max-width: 1000px; margin: 0 auto; }

  .guide-header { text-align: center; padding: 40px 20px 30px; }
  .guide-header h1 { font-size: 26px; color: #222; margin: 0 0 8px; }
  .guide-header p { font-size: 15px; color: #888; margin: 0; }

  /* 섹션 */
  .section { background: #fff; border-radius: 10px; box-shadow: 0 1px 6px rgba(0,0,0,.06); margin-bottom: 28px; overflow: hidden; }
  .section-title {
    padding: 18px 24px; font-size: 18px; font-weight: 700; color: #fff;
    background: #2d2d2d;
  }
  .section-title .num { background: #03c75a; padding: 2px 10px; border-radius: 12px; font-size: 14px; margin-right: 8px; }
  .section-body { padding: 24px; }

  /* 파이프라인 다이어그램 */
  .pipeline { display: flex; align-items: stretch; gap: 0; flex-wrap: wrap; justify-content: center; }
  .pipe-step {
    background: #fff; border: 2px solid #e0e0e0; border-radius: 10px; padding: 16px 18px;
    width: 160px; text-align: center; position: relative;
  }
  .pipe-step .step-icon { font-size: 28px; margin-bottom: 6px; }
  .pipe-step .step-title { font-size: 13px; font-weight: 700; color: #222; margin-bottom: 4px; }
  .pipe-step .step-desc { font-size: 11px; color: #888; line-height: 1.4; }
  .pipe-step.active { border-color: #03c75a; background: #f0fff5; }
  .pipe-arrow { display: flex; align-items: center; font-size: 24px; color: #03c75a; padding: 0 6px; font-weight: 700; }

  /* 변경 요약 테이블 */
  table.change-table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  table.change-table th { background: #f5f5f5; padding: 10px 14px; text-align: left; font-size: 13px; font-weight: 600; border-bottom: 2px solid #e0e0e0; }
  table.change-table td { padding: 10px 14px; font-size: 13px; border-bottom: 1px solid #f0f0f0; }
  table.change-table tr:hover td { background: #f9f9f9; }
  .tag-before { background: #fff3e0; color: #e67700; padding: 2px 8px; border-radius: 4px; font-size: 12px; }
  .tag-after { background: #e6f9ed; color: #03c75a; padding: 2px 8px; border-radius: 4px; font-size: 12px; }
  .tag-new { background: #e8f0fe; color: #1a73e8; padding: 2px 8px; border-radius: 4px; font-size: 12px; }

  /* 비교 카드 */
  .compare-card { border: 1px solid #e0e0e0; border-radius: 8px; margin-bottom: 20px; overflow: hidden; }
  .compare-header {
    padding: 14px 20px; background: #03c75a; color: #fff;
    display: flex; justify-content: space-between; align-items: center;
  }
  .compare-header h3 { margin: 0; font-size: 16px; }
  .compare-badge { background: rgba(255,255,255,.2); padding: 3px 10px; border-radius: 10px; font-size: 12px; }
  .compare-row { display: flex; align-items: stretch; border-bottom: 1px solid #f0f0f0; }
  .compare-col { flex: 1; padding: 14px 18px; }
  .compare-col.before { background: #fffbf5; }
  .compare-col.after { background: #f5fff8; }
  .compare-arrow { display: flex; align-items: center; font-size: 20px; color: #03c75a; font-weight: 700; padding: 0 8px; background: #fafafa; }
  .col-label { font-size: 12px; font-weight: 600; color: #888; margin-bottom: 6px; }
  .col-content { font-size: 13px; line-height: 1.6; }
  .body-preview { max-height: 150px; overflow: hidden; color: #555; }
  .added-elements { padding: 12px 18px; background: #f8f8ff; }
  .added-item { font-size: 13px; margin: 4px 0; }
  .added-tag { background: #1a73e8; color: #fff; padding: 1px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; margin-right: 6px; }

  /* 플랫폼 로드맵 */
  .platform-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
  .platform-card { border: 2px solid #e0e0e0; border-radius: 10px; padding: 20px; text-align: center; }
  .platform-card.done { border-color: #03c75a; background: #f0fff5; }
  .platform-card.next { border-color: #1a73e8; background: #f5f8ff; }
  .platform-card.planned { border-color: #ddd; background: #fafafa; }
  .platform-card .p-icon { font-size: 32px; margin-bottom: 8px; }
  .platform-card .p-name { font-size: 15px; font-weight: 700; margin-bottom: 4px; }
  .platform-card .p-status { font-size: 12px; }
  .platform-card .p-desc { font-size: 12px; color: #888; margin-top: 8px; line-height: 1.4; }

  /* 숫자 하이라이트 */
  .stat-row { display: flex; gap: 16px; flex-wrap: wrap; margin: 16px 0; }
  .stat-box { flex: 1; min-width: 140px; background: #f9f9f9; border-radius: 8px; padding: 16px; text-align: center; }
  .stat-num { font-size: 28px; font-weight: 700; color: #03c75a; }
  .stat-label { font-size: 12px; color: #888; margin-top: 4px; }

  .note { font-size: 13px; color: #888; background: #f9f9f9; padding: 14px 18px; border-radius: 8px; border-left: 3px solid #03c75a; margin: 16px 0; line-height: 1.6; }
  a { color: #1a73e8; }
  .footer { text-align: center; padding: 24px; font-size: 12px; color: #aaa; }
</style>
</head>
<body>
<div class="guide">

  <div class="guide-header">
    <h1>투베이스 콘텐츠 변환 프로세스</h1>
    <p>기존 블로그 원문 → SSOT(통합 데이터) → 네이버 블로그 새 글 생성 과정</p>
    <p style="margin-top:6px;">생성일: ${new Date().toLocaleDateString('ko-KR')}</p>
  </div>

  <!-- ═══ 1. 전체 파이프라인 ═══ -->
  <div class="section">
    <div class="section-title"><span class="num">1</span> 전체 변환 파이프라인</div>
    <div class="section-body">
      <div class="pipeline">
        <div class="pipe-step">
          <div class="step-icon">📄</div>
          <div class="step-title">기존 블로그</div>
          <div class="step-desc">네이버 블로그 원문<br>1,912개 포스트</div>
        </div>
        <div class="pipe-arrow">→</div>
        <div class="pipe-step">
          <div class="step-icon">📑</div>
          <div class="step-title">PDF 변환</div>
          <div class="step-desc">블로그 → PDF<br>텍스트+이미지 보존</div>
        </div>
        <div class="pipe-arrow">→</div>
        <div class="pipe-step active">
          <div class="step-icon">🗄️</div>
          <div class="step-title">SSOT 구축</div>
          <div class="step-desc">AI 분석으로<br>구조화된 데이터 추출</div>
        </div>
        <div class="pipe-arrow">→</div>
        <div class="pipe-step active">
          <div class="step-icon">✍️</div>
          <div class="step-title">콘텐츠 생성</div>
          <div class="step-desc">AI가 팩트 기반으로<br>새 글 작성</div>
        </div>
        <div class="pipe-arrow">→</div>
        <div class="pipe-step">
          <div class="step-icon">🔍</div>
          <div class="step-title">톤 후처리</div>
          <div class="step-desc">과장 제거, 톤 자연화<br>안녕하세요 도입부</div>
        </div>
        <div class="pipe-arrow">→</div>
        <div class="pipe-step">
          <div class="step-icon">📢</div>
          <div class="step-title">발행</div>
          <div class="step-desc">네이버 블로그<br>+ 인스타/당근 예정</div>
        </div>
      </div>

      <div class="stat-row">
        <div class="stat-box"><div class="stat-num">${ssotFiles.length.toLocaleString()}</div><div class="stat-label">SSOT 전체</div></div>
        <div class="stat-box"><div class="stat-num">${v2Files.length}</div><div class="stat-label">네이버 블로그 생성 완료</div></div>
        <div class="stat-box"><div class="stat-num">${withImgCount}</div><div class="stat-label">이미지 포함</div></div>
        <div class="stat-box"><div class="stat-num">${avgOrig}자→${avgGen}자</div><div class="stat-label">평균 본문 길이 변화</div></div>
      </div>
    </div>
  </div>

  <!-- ═══ 2. 무엇이 바뀌는가 ═══ -->
  <div class="section">
    <div class="section-title"><span class="num">2</span> 원문 → 새 글: 무엇이 바뀌는가</div>
    <div class="section-body">
      <table class="change-table">
        <thead>
          <tr><th style="width:140px;">항목</th><th>원문 (기존 블로그)</th><th>새 글 (생성)</th><th style="width:100px;">변경</th></tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>제목</strong></td>
            <td>중복 텍스트, 태그 혼재<br><span style="font-size:11px; color:#999;">예: "그랜저TG 브램보4P+EQ900 리어2P 풀셋 인스톨![일산 파주 브레이크..."</span></td>
            <td>SEO 최적화, 60자 이내<br><span style="font-size:11px; color:#999;">예: "[그랜저 TG] 브렘보 4P 풀셋 브레이크 업그레이드 | 투베이스"</span></td>
            <td><span class="tag-after">개선</span></td>
          </tr>
          <tr>
            <td><strong>본문 길이</strong></td>
            <td>평균 ${avgOrig}자 (불규칙, 짧은 글 많음)</td>
            <td>평균 ${avgGen}자 (800~1,500자 균일)</td>
            <td><span class="tag-after">표준화</span></td>
          </tr>
          <tr>
            <td><strong>본문 구조</strong></td>
            <td>단락 구분 없음, 나열식</td>
            <td>■ 섹션 헤더 + 단락 구분<br>(도입→과정→결과→마무리)</td>
            <td><span class="tag-after">구조화</span></td>
          </tr>
          <tr>
            <td><strong>도입부</strong></td>
            <td>다양 (없거나 "안녕하세요 투베이스입니다")</td>
            <td>"안녕하세요, 브레이크 전문 튜닝샵 투베이스 (2BASS)입니다."<br>+ 상황/증상 공감 도입</td>
            <td><span class="tag-after">통일</span></td>
          </tr>
          <tr>
            <td><strong>톤</strong></td>
            <td>작업자 메모 스타일 (비격식)</td>
            <td>전문적 + 친근 혼합<br>(~입니다/~요/~죠 자연 혼합)</td>
            <td><span class="tag-after">개선</span></td>
          </tr>
          <tr>
            <td><strong>CTA</strong></td>
            <td>없음 또는 "투베이스에 연락주세요~"</td>
            <td>네이버 예약 / 톡톡 / 스마트스토어 링크 포함</td>
            <td><span class="tag-new">신규 추가</span></td>
          </tr>
          <tr>
            <td><strong>해시태그</strong></td>
            <td>없음</td>
            <td>10~15개 (필수 5개 + 차종/작업 관련)</td>
            <td><span class="tag-new">신규 추가</span></td>
          </tr>
          <tr>
            <td><strong>SEO 키워드</strong></td>
            <td>의도 없음</td>
            <td>소비자 검색 키워드 기반 배치</td>
            <td><span class="tag-new">신규 추가</span></td>
          </tr>
          <tr>
            <td><strong>이미지</strong></td>
            <td>원본 블로그 내 이미지</td>
            <td>동일 이미지 사용 (PDF에서 추출, 본문 중간 배치)</td>
            <td><span class="tag-before">동일</span></td>
          </tr>
          <tr>
            <td><strong>팩트 검증</strong></td>
            <td>없음</td>
            <td>원문에 없는 내용 자동 차단 (forbidden 리스트)</td>
            <td><span class="tag-new">신규 추가</span></td>
          </tr>
        </tbody>
      </table>

      <div class="note">
        <strong>핵심 원칙:</strong> 원문의 팩트(차종, 부품, 작업 내용)는 100% 보존합니다. 원문에 없는 고객 감정, 스펙 수치, 보증 조건 등은 절대 창작하지 않습니다. AI가 바꾸는 것은 <strong>글의 구조, 톤, SEO, CTA</strong>입니다.
      </div>
    </div>
  </div>

  <!-- ═══ 3. 실제 비교 ═══ -->
  <div class="section">
    <div class="section-title"><span class="num">3</span> 실제 변환 비교 (Before → After)</div>
    <div class="section-body">
      ${renderComparison(sample1, '사례 1')}
      ${renderComparison(sample2, '사례 2')}
    </div>
  </div>

  <!-- ═══ 4. AI 안전장치 ═══ -->
  <div class="section">
    <div class="section-title"><span class="num">4</span> AI 안전장치 (날조 방지)</div>
    <div class="section-body">
      <table class="change-table">
        <thead>
          <tr><th style="width:180px;">안전장치</th><th>설명</th></tr>
        </thead>
        <tbody>
          <tr><td><strong>팩트시트 기반 생성</strong></td><td>원문에서 확인된 팩트만 사용 가능 목록으로 제공 → AI가 이 범위 내에서만 글 작성</td></tr>
          <tr><td><strong>Forbidden 리스트</strong></td><td>원문에 근거 없는 항목(보증 조건, 고객 출발지, 가격 등)을 명시적으로 금지</td></tr>
          <tr><td><strong>감정 창작 감지</strong></td><td>생성 후 "감동", "인생샵", "대만족" 등 원문에 없는 감정 표현 자동 감지 → 경고</td></tr>
          <tr><td><strong>톤 후처리</strong></td><td>"완벽한", "탁월한", "놀라운" 등 과장 형용사 자동 완화, 수사적 질문 도입 제거</td></tr>
          <tr><td><strong>브랜드 표기 통일</strong></td><td>AUDI→아우디, BMW→비엠더블유 등 올바른 한글 표기 강제</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- ═══ 5. 멀티 플랫폼 로드맵 ═══ -->
  <div class="section">
    <div class="section-title"><span class="num">5</span> 멀티 플랫폼 발행 로드맵</div>
    <div class="section-body">
      <p style="font-size:14px; color:#666; margin-bottom:16px;">동일한 SSOT 데이터에서 플랫폼별 맞춤 콘텐츠를 자동 생성합니다.</p>
      <div class="platform-grid">
        <div class="platform-card done">
          <div class="p-icon">📝</div>
          <div class="p-name">네이버 블로그</div>
          <div class="p-status"><span class="tag-after">생성 완료 ${v2Files.length}건</span></div>
          <div class="p-desc">800~1,500자<br>전문적 톤<br>SEO + 해시태그 + CTA</div>
        </div>
        <div class="platform-card next">
          <div class="p-icon">📸</div>
          <div class="p-name">인스타그램</div>
          <div class="p-status"><span class="tag-new">생성기 준비 완료</span></div>
          <div class="p-desc">200~400자 캡션<br>해시태그 20~25개<br>프로필 링크/DM CTA</div>
        </div>
        <div class="platform-card next">
          <div class="p-icon">🥕</div>
          <div class="p-name">당근마켓</div>
          <div class="p-status"><span class="tag-new">생성기 준비 완료</span></div>
          <div class="p-desc">200~400자 동네소식<br>전문+친근 톤<br>채팅 문의 CTA</div>
        </div>
        <div class="platform-card planned">
          <div class="p-icon">🛒</div>
          <div class="p-name">스마트스토어</div>
          <div class="p-status" style="color:#aaa;">상품 카탈로그 생성됨</div>
          <div class="p-desc">33개 상품 자동 분류<br>브랜드×작업 조합</div>
        </div>
      </div>

      <div class="note" style="margin-top:20px;">
        <strong>공통 원칙:</strong> 모든 플랫폼에서 동일한 SSOT 팩트를 사용하므로 정보 불일치가 발생하지 않습니다. 이미지도 동일 원본을 공유합니다. 바뀌는 것은 글 길이, 톤, CTA뿐입니다.
      </div>
    </div>
  </div>

  <!-- ═══ 6. 확인 요청 ═══ -->
  <div class="section">
    <div class="section-title" style="background:#03c75a;"><span class="num" style="background:#fff; color:#03c75a;">✓</span> 확인 요청사항</div>
    <div class="section-body">
      <table class="change-table">
        <thead><tr><th style="width:40px;">#</th><th>확인 항목</th><th style="width:120px;">확인</th></tr></thead>
        <tbody>
          <tr><td>1</td><td><strong>글 톤/말투</strong> — 전문적이되 친근한 혼합 톤이 적절한지 (대시보드에서 실제 글 확인)</td><td style="text-align:center;">☐</td></tr>
          <tr><td>2</td><td><strong>제목 스타일</strong> — SEO 최적화 제목 형식 ([차종] 작업 | 투베이스) 이 괜찮은지</td><td style="text-align:center;">☐</td></tr>
          <tr><td>3</td><td><strong>도입부</strong> — "안녕하세요, 브레이크 전문 튜닝샵 투베이스 (2BASS)입니다." 통일 유지할지</td><td style="text-align:center;">☐</td></tr>
          <tr><td>4</td><td><strong>CTA 링크</strong> — 네이버 예약 / 톡톡 / 스마트스토어 링크가 정확한지</td><td style="text-align:center;">☐</td></tr>
          <tr><td>5</td><td><strong>이미지 배치</strong> — 이미지 있는 9건의 이미지 품질/위치가 적절한지</td><td style="text-align:center;">☐</td></tr>
          <tr><td>6</td><td><strong>수정 요청</strong> — 톤, 구조, 표현 등 수정이 필요한 부분이 있는지</td><td style="text-align:center;">☐</td></tr>
        </tbody>
      </table>
      <div class="note">
        확인 완료되면 네이버 블로그 발행을 시작하고, 이후 인스타그램/당근마켓 콘텐츠 생성으로 넘어갑니다.
      </div>
    </div>
  </div>

  <div class="footer">
    투베이스 (2BASS) 콘텐츠 자동화 시스템 | <a href="_index.html">대시보드로 이동</a>
  </div>

</div>
</body>
</html>`;

fs.writeFileSync(OUT, html, 'utf8');
const mb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`\n✅ 프로세스 가이드 생성: ${OUT}`);
console.log(`📦 ${mb}KB`);
