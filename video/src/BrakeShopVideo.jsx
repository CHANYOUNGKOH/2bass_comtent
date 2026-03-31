import {
  AbsoluteFill,
  Img,
  Audio,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";

// ── 브랜드 컬러 ──
const BRAND = {
  bg: "#111111",
  accent: "#E63946",
  text: "#FFFFFF",
  sub: "#AAAAAA",
  font: "Pretendard, 'Noto Sans KR', sans-serif",
};

const FPS = 30;
const COLD_OPEN_FRAMES = Math.round(1.5 * FPS); // 45
const STING_FRAMES = Math.round(1.0 * FPS);     // 30
const CTA_FRAMES = Math.round(2.5 * FPS);       // 75

// ── Ken Burns 슬라이드 ──
function KenBurnsSlide({ src, durationInFrames, direction = "in" }) {
  const frame = useCurrentFrame();
  const progress = frame / durationInFrames;

  const scale = direction === "in"
    ? interpolate(progress, [0, 1], [1.0, 1.15])
    : interpolate(progress, [0, 1], [1.15, 1.0]);

  const opacity = interpolate(frame, [0, 6, durationInFrames - 6, durationInFrames], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: BRAND.bg }}>
      <div style={{ width: "100%", height: "100%", overflow: "hidden", opacity }}>
        <Img
          src={src}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${scale})`,
            transformOrigin: direction === "in" ? "center center" : "top center",
          }}
        />
      </div>
    </AbsoluteFill>
  );
}

// ── 1막: Cold Open (1.5초) — 첫 사진 풀스크린 + 훅 텍스트 ──
function ColdOpen({ image, hookText }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // 빨간 플래시 → 페이드아웃
  const flash = interpolate(frame, [0, 2, 8], [0.5, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // 훅 텍스트 팝인
  const hookScale = spring({ frame: Math.max(0, frame - 4), fps, config: { damping: 8, stiffness: 140 } });
  const hookOpacity = interpolate(frame, [4, 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill>
      {/* 배경 사진 */}
      <Img src={image} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      {/* 어두운 오버레이 */}
      <AbsoluteFill style={{ backgroundColor: "rgba(0,0,0,0.45)" }} />
      {/* 빨간 플래시 */}
      <AbsoluteFill style={{ backgroundColor: BRAND.accent, opacity: flash }} />
      {/* 훅 텍스트 — 화면 중앙 큰 글씨 (\n → 줄바꿈) */}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: 40 }}>
        <div style={{
          fontSize: 96,
          fontWeight: 900,
          color: BRAND.text,
          fontFamily: BRAND.font,
          textAlign: "center",
          lineHeight: 1.3,
          transform: `scale(${hookScale})`,
          opacity: hookOpacity,
          textShadow: "0 6px 30px rgba(0,0,0,0.9)",
          whiteSpace: "pre-line",
        }}>
          {hookText}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

// ── 2막: 브랜드 스팅 (1초) — 검정 배경 + "투베이스" + 빨간 밑줄 슬라이드 ──
function BrandSting() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const textScale = spring({ frame, fps, config: { damping: 10, stiffness: 150 } });
  // 빨간 밑줄 슬라이드 (왼→오)
  const lineWidth = interpolate(frame, [8, 22], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: BRAND.bg, justifyContent: "center", alignItems: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{
          fontSize: 100,
          fontWeight: 900,
          color: BRAND.text,
          fontFamily: BRAND.font,
          letterSpacing: -2,
          transform: `scale(${textScale})`,
        }}>
          투베이스
        </div>
        {/* 빨간 밑줄 애니메이션 */}
        <div style={{
          width: `${lineWidth}%`,
          maxWidth: 300,
          height: 5,
          backgroundColor: BRAND.accent,
          borderRadius: 3,
          marginTop: 8,
        }} />
      </div>
    </AbsoluteFill>
  );
}

// ── 3막: 나레이션 슬라이드 — Ken Burns + 하단 자막 바 ──
function NarrationSlide({ image, overlay, durationInFrames, index }) {
  const frame = useCurrentFrame();

  // 자막 페이드인
  const captionOpacity = interpolate(frame, [0, 8], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // 자막 슬라이드업
  const captionY = interpolate(frame, [0, 8], [20, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill>
      {/* Ken Burns 배경 사진 */}
      <KenBurnsSlide
        src={image}
        durationInFrames={durationInFrames}
        direction={index % 2 === 0 ? "in" : "out"}
      />

      {/* 하단 자막 바 */}
      <div style={{
        position: "absolute",
        bottom: 160,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        opacity: captionOpacity,
        transform: `translateY(${captionY}px)`,
      }}>
        <div style={{
          backgroundColor: "rgba(0,0,0,0.75)",
          borderRadius: 12,
          padding: "20px 44px",
          borderLeft: `5px solid ${BRAND.accent}`,
        }}>
          <div style={{
            fontSize: 54,
            fontWeight: 800,
            color: BRAND.text,
            fontFamily: BRAND.font,
            textAlign: "center",
            textShadow: "0 2px 8px rgba(0,0,0,0.6)",
          }}>
            {overlay}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}

// ── 4막: CTA (2.5초) — 태그라인 + 깜빡이는 프로필 링크 안내 ──
function PunchCTA({ tagline, uspLine }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const tagScale = spring({ frame, fps, config: { damping: 10, stiffness: 120 } });

  // 깜빡이는 CTA
  const blinkOpacity = interpolate(
    frame % 20, [0, 10, 20], [1, 0.2, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill style={{ backgroundColor: BRAND.bg, justifyContent: "center", alignItems: "center", opacity: fadeIn }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24 }}>
        {/* 브랜드명 */}
        <div style={{
          fontSize: 80,
          fontWeight: 900,
          color: BRAND.accent,
          fontFamily: BRAND.font,
          letterSpacing: -2,
          transform: `scale(${tagScale})`,
        }}>
          투베이스
        </div>

        {/* 구분선 */}
        <div style={{ width: 100, height: 4, backgroundColor: BRAND.accent, borderRadius: 2 }} />

        {/* 태그라인 */}
        <div style={{
          fontSize: 44,
          fontWeight: 700,
          color: BRAND.text,
          fontFamily: BRAND.font,
          textAlign: "center",
        }}>
          {tagline}
        </div>

        {/* USP 1줄 */}
        {uspLine && (
          <div style={{
            fontSize: 30,
            fontWeight: 500,
            color: BRAND.sub,
            fontFamily: BRAND.font,
            textAlign: "center",
            marginTop: 4,
          }}>
            {uspLine}
          </div>
        )}

        {/* 깜빡이는 CTA */}
        <div style={{
          marginTop: 16,
          fontSize: 36,
          fontWeight: 700,
          color: BRAND.accent,
          fontFamily: BRAND.font,
          opacity: blinkOpacity,
        }}>
          ▼ 프로필 링크 클릭 ▼
        </div>
      </div>
    </AbsoluteFill>
  );
}

// ── 메인 컴포지션 ──
export function BrakeShopVideo({
  images,
  hookText,
  tagline,
  uspLine,
  narrationSegments,
  bgmAudio,
  sfxIntro,
  sfxSting,
}) {
  const { durationInFrames } = useVideoConfig();

  const segments = narrationSegments || [];
  const safeImages = images || [];

  // Cold Open 이미지 = 첫 번째 사진
  const coldOpenImage = safeImages[0] || "";

  // 각 세그먼트에 할당할 이미지 (cold open 이후부터)
  const segmentImages = segments.map((_, i) => {
    const imgIdx = Math.min(i + 1, safeImages.length - 1);
    return safeImages[imgIdx] || safeImages[0] || "";
  });

  const hasImages = safeImages.length > 0;

  // 타이밍 계산
  let cursor = 0;

  // 1막: Cold Open (이미지 없으면 건너뜀)
  const coldOpenFrom = cursor;
  cursor += hasImages ? COLD_OPEN_FRAMES : 0;

  // 2막: Brand Sting (이미지 없으면 건너뜀)
  const stingFrom = cursor;
  cursor += hasImages ? STING_FRAMES : 0;

  // 3막: 나레이션 세그먼트
  const segmentStarts = [];
  for (const seg of segments) {
    segmentStarts.push(cursor);
    cursor += seg.durationFrames || Math.round(3.5 * FPS);
  }

  // 4막: CTA
  const ctaFrom = cursor;

  return (
    <AbsoluteFill style={{ backgroundColor: BRAND.bg }}>
      {/* ── 오디오 ── */}

      {/* BGM: 전체, 볼륨 12%, 마지막 페이드아웃 */}
      {bgmAudio && (
        <Audio
          src={bgmAudio}
          volume={(f) =>
            interpolate(f, [0, 15, durationInFrames - 45, durationInFrames], [0, 0.12, 0.12, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            })
          }
        />
      )}

      {/* SFX: Cold Open whoosh */}
      {sfxIntro && (
        <Sequence from={coldOpenFrom} durationInFrames={COLD_OPEN_FRAMES}>
          <Audio src={sfxIntro} volume={0.7} />
        </Sequence>
      )}

      {/* SFX: Brand Sting metal hit */}
      {sfxSting && (
        <Sequence from={stingFrom} durationInFrames={STING_FRAMES}>
          <Audio src={sfxSting} volume={0.8} />
        </Sequence>
      )}

      {/* 세그먼트별 나레이션 오디오 */}
      {segments.map((seg, i) =>
        seg.audioDataUri ? (
          <Sequence key={`audio-${i}`} from={segmentStarts[i]} durationInFrames={seg.durationFrames}>
            <Audio src={seg.audioDataUri} volume={0.9} />
          </Sequence>
        ) : null
      )}

      {/* ── 비주얼 ── */}

      {/* 1막: Cold Open (이미지 있을 때만) */}
      {hasImages && (
        <Sequence from={coldOpenFrom} durationInFrames={COLD_OPEN_FRAMES}>
          <ColdOpen image={coldOpenImage} hookText={hookText || ""} />
        </Sequence>
      )}

      {/* 2막: Brand Sting (이미지 있을 때만) */}
      {hasImages && (
        <Sequence from={stingFrom} durationInFrames={STING_FRAMES}>
          <BrandSting />
        </Sequence>
      )}

      {/* 3막: 나레이션 세그먼트 (이미지 있을 때만) */}
      {hasImages && segments.map((seg, i) => (
        <Sequence key={`seg-${i}`} from={segmentStarts[i]} durationInFrames={seg.durationFrames}>
          <NarrationSlide
            image={segmentImages[i]}
            overlay={seg.overlay || ""}
            durationInFrames={seg.durationFrames}
            index={i}
          />
        </Sequence>
      ))}

      {/* 4막: CTA */}
      <Sequence from={ctaFrom} durationInFrames={CTA_FRAMES}>
        <PunchCTA tagline={tagline || "브레이크는 투베이스가 답입니다"} uspLine={uspLine || ""} />
      </Sequence>
    </AbsoluteFill>
  );
}
