import { Composition } from "remotion";
import { BrakeShopVideo } from "./BrakeShopVideo.jsx";

export const RemotionRoot = () => {
  return (
    <Composition
      id="BrakeShopVideo"
      component={BrakeShopVideo}
      durationInFrames={1800} // 60초 최대 (실제는 20~25초, 콘텐츠 끝에서 자연 종료)
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{
        images: [],
        hookText: "",
        tagline: "브레이크는 투베이스",
        narrationSegments: [], // { audioDataUri, durationFrames, overlay }
        bgmAudio: null,
        sfxIntro: null,
        sfxSting: null,
      }}
    />
  );
};
