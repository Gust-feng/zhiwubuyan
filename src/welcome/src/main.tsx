import "@fontsource-variable/noto-sans-sc";
import "@fontsource-variable/noto-serif-sc";
import { ArrowRight, Check, LoaderCircle } from "lucide-react";
import { StrictMode, useEffect, useId, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import sceneArtwork from "../assets/scene.png";
import "./styles.css";

type ContinueState = "idle" | "connecting" | "ready";

type TitleMotionState = {
  active: boolean;
  autoDemo: boolean;
  autoDemoStart: number;
  lastTime: number;
  phase: number;
  intensity: number;
  targetIntensity: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  lastX: number;
  lastY: number;
  velocityX: number;
  velocityY: number;
  frame: number | null;
};

type AutoSweepPoint = {
  x: number;
  y: number;
  intensity: number;
};

const TITLE_CENTER_X = 143;
const TITLE_CENTER_Y = 36;
const TITLE_BASE_RADIUS = 54;

/** 加载完成到开始示范动画之间的等待时间。 */
const AUTO_SWEEP_DELAY = 600;
/** 一次示范扫过的总时长。 */
const AUTO_SWEEP_DURATION = 2100;
/**
 * 示范路径：从左外侧进入，横向掠过四个字并带轻微起伏，最后从右侧淡出。
 * 坐标与 SVG 视图框一致，intensity 为 0 的端点负责淡入淡出。
 */
const AUTO_SWEEP_PATH: AutoSweepPoint[] = [
  { x: -16, y: 30, intensity: 0 },
  { x: 22, y: 34, intensity: 1 },
  { x: 74, y: 27, intensity: 1 },
  { x: 126, y: 38, intensity: 1 },
  { x: 178, y: 28, intensity: 1 },
  { x: 230, y: 37, intensity: 1 },
  { x: 274, y: 30, intensity: 1 },
  { x: 302, y: 33, intensity: 0 },
];

/**
 * 按总进度采样示范路径。缓入缓出只作用在整段首尾，段内保持匀速，
 * 否则透镜会在每个路径点减速停顿，回声也就聚不起来。
 */
function sampleAutoSweep(progress: number): AutoSweepPoint {
  const clamped = Math.max(0, Math.min(1, progress));
  const eased = clamped * clamped * (3 - 2 * clamped);
  const scaled = eased * (AUTO_SWEEP_PATH.length - 1);
  const index = Math.min(AUTO_SWEEP_PATH.length - 2, Math.floor(scaled));
  const local = scaled - index;
  const from = AUTO_SWEEP_PATH[index];
  const to = AUTO_SWEEP_PATH[index + 1];
  if (from === undefined || to === undefined) {
    return AUTO_SWEEP_PATH[0] ?? { x: 0, y: 0, intensity: 1 };
  }
  return {
    x: from.x + (to.x - from.x) * local,
    y: from.y + (to.y - from.y) * local,
    intensity: from.intensity + (to.intensity - from.intensity) * local,
  };
}

function WelcomeTitleMotion(): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const lensRef = useRef<SVGRadialGradientElement>(null);
  const displacementRef = useRef<SVGFEDisplacementMapElement>(null);
  const noiseRef = useRef<SVGFETurbulenceElement>(null);
  const flowGradientRef = useRef<SVGLinearGradientElement>(null);
  const refractedRef = useRef<SVGTextElement>(null);
  const echoARef = useRef<SVGTextElement>(null);
  const echoBRef = useRef<SVGTextElement>(null);
  const stateRef = useRef<TitleMotionState>({
    active: false,
    autoDemo: false,
    autoDemoStart: 0,
    lastTime: 0,
    phase: 0,
    intensity: 0,
    targetIntensity: 0,
    x: TITLE_CENTER_X,
    y: TITLE_CENTER_Y,
    targetX: TITLE_CENTER_X,
    targetY: TITLE_CENTER_Y,
    lastX: TITLE_CENTER_X,
    lastY: TITLE_CENTER_Y,
    velocityX: 0,
    velocityY: 0,
    frame: null,
  });
  const userInteractedRef = useRef(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const flowGradientId = `welcomeTitleFlow-${id}`;
  const lensGradientId = `welcomeTitleLens-${id}`;
  const lensMaskId = `welcomeTitleMask-${id}`;
  const refractionFilterId = `welcomeTitleRefraction-${id}`;
  const noiseId = `welcomeTitleNoise-${id}`;
  const displacementId = `welcomeTitleDisplacement-${id}`;

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateReducedMotion = (): void => setReducedMotion(mediaQuery.matches);
    updateReducedMotion();
    mediaQuery.addEventListener("change", updateReducedMotion);
    return () => mediaQuery.removeEventListener("change", updateReducedMotion);
  }, []);

  useEffect(() => {
    const state = stateRef.current;
    state.active = false;
    state.targetIntensity = 0;
    state.intensity = 0;
    if (state.frame !== null) {
      window.cancelAnimationFrame(state.frame);
      state.frame = null;
    }
  }, [reducedMotion]);

  useEffect(() => {
    return () => {
      const frame = stateRef.current.frame;
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, []);

  const updateMotion = (time: number): void => {
    const root = rootRef.current;
    const state = stateRef.current;
    if (!root) {
      state.frame = null;
      return;
    }

    const svg = svgRef.current;
    const lens = lensRef.current;
    const displacement = displacementRef.current;
    const noise = noiseRef.current;
    const flowGradient = flowGradientRef.current;
    const refracted = refractedRef.current;
    const echoA = echoARef.current;
    const echoB = echoBRef.current;
    if (!svg || !lens || !displacement || !noise || !flowGradient || !refracted || !echoA || !echoB) {
      state.frame = null;
      return;
    }

    if (state.autoDemo) {
      // 以第一帧的绘制时刻为起点，避免从调度时刻起算导致前几帧被跳过。
      if (state.autoDemoStart === 0) state.autoDemoStart = time;
      const progress = (time - state.autoDemoStart) / AUTO_SWEEP_DURATION;
      if (progress >= 1) {
        state.autoDemo = false;
        state.targetIntensity = 0;
      } else {
        const point = sampleAutoSweep(progress);
        state.targetX = point.x;
        state.targetY = point.y;
        state.targetIntensity = point.intensity;
      }
    }

    const elapsed = state.lastTime === 0 ? 16 : Math.min(34, time - state.lastTime);
    state.lastTime = time;
    const frameScale = elapsed / 16.67;
    const follow = (1 - Math.pow(1 - (reducedMotion ? 0.34 : 0.16), frameScale));
    const intensityFollow = (1 - Math.pow(1 - (reducedMotion ? 0.34 : 0.14), frameScale));
    state.x += (state.targetX - state.x) * follow;
    state.y += (state.targetY - state.y) * follow;
    state.intensity += (state.targetIntensity - state.intensity) * intensityFollow;

    state.velocityX = state.velocityX * 0.76 + (state.x - state.lastX) * 0.24;
    state.velocityY = state.velocityY * 0.76 + (state.y - state.lastY) * 0.24;
    state.lastX = state.x;
    state.lastY = state.y;
    state.phase += 0.012 * frameScale;

    const speed = Math.min(12, Math.hypot(state.velocityX, state.velocityY));
    const visibility = Math.min(1, state.intensity);
    const radius = TITLE_BASE_RADIUS + Math.min(18, speed * 2.4);
    const echoOpacity = reducedMotion
      ? 0
      : Math.min(0.2, 0.035 + speed * 0.014) * visibility;

    lens.setAttribute("cx", state.x.toFixed(2));
    lens.setAttribute("cy", state.y.toFixed(2));
    lens.setAttribute("r", radius.toFixed(2));
    displacement.setAttribute("scale", reducedMotion ? "0" : (3.2 + speed * 0.86).toFixed(2));
    noise.setAttribute("baseFrequency", `${(0.017 + Math.sin(state.phase) * 0.002).toFixed(4)} 0.11`);
    flowGradient.setAttribute(
      "gradientTransform",
      `rotate(${(Math.sin(state.phase * 0.75) * 5 + state.velocityX * 0.8).toFixed(2)} 143 36)`,
    );

    refracted.style.opacity = (0.9 * visibility).toFixed(3);
    echoA.style.opacity = echoOpacity.toFixed(3);
    echoB.style.opacity = (echoOpacity * 0.6).toFixed(3);
    echoA.setAttribute(
      "transform",
      `translate(${(-state.velocityX * 0.7).toFixed(2)} ${(-state.velocityY * 0.24 - 0.5).toFixed(2)})`,
    );
    echoB.setAttribute(
      "transform",
      `translate(${(state.velocityX * 0.48).toFixed(2)} ${(state.velocityY * 0.18 + 0.5).toFixed(2)})`,
    );

    const stillSettling = state.intensity > 0.008 || state.targetIntensity > 0.008;
    if (state.active || state.autoDemo || stillSettling) {
      state.frame = window.requestAnimationFrame(updateMotion);
    } else {
      state.frame = null;
      state.lastTime = 0;
    }
  };

  const startMotion = (): void => {
    const state = stateRef.current;
    if (state.frame === null) state.frame = window.requestAnimationFrame(updateMotion);
  };

  useEffect(() => {
    if (reducedMotion) return;
    let cancelled = false;
    let timer: number | undefined;

    const beginAutoDemo = (): void => {
      if (cancelled || userInteractedRef.current) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      timer = window.setTimeout(() => {
        if (cancelled || userInteractedRef.current) return;
        // 指针已经停在标题上时不再示范，否则会和用户的悬停互相拉扯。
        if (rootRef.current?.matches(":hover")) return;
        const state = stateRef.current;
        const start = sampleAutoSweep(0);
        state.autoDemo = true;
        state.autoDemoStart = 0;
        state.targetX = start.x;
        state.targetY = start.y;
        state.targetIntensity = start.intensity;
        state.x = start.x;
        state.y = start.y;
        state.lastX = start.x;
        state.lastY = start.y;
        state.velocityX = 0;
        state.velocityY = 0;
        startMotion();
      }, AUTO_SWEEP_DELAY);
    };

    const pageReady = document.readyState === "complete"
      ? Promise.resolve()
      : new Promise<void>((resolve) => window.addEventListener("load", () => resolve(), { once: true }));
    void Promise.all([document.fonts.ready, pageReady]).then(beginAutoDemo);

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      stateRef.current.autoDemo = false;
    };
  }, [reducedMotion]);

  const updatePointer = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === "touch" || reducedMotion) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const state = stateRef.current;
    userInteractedRef.current = true;
    state.autoDemo = false;
    state.targetX = Math.max(0, Math.min(286, ((event.clientX - rect.left) / rect.width) * 286));
    state.targetY = Math.max(0, Math.min(72, ((event.clientY - rect.top) / rect.height) * 72));
    state.targetIntensity = 1;
    state.active = true;
    startMotion();
  };

  const handlePointerLeave = (): void => {
    const state = stateRef.current;
    state.active = false;
    state.targetIntensity = 0;
    startMotion();
  };

  return (
    <div
      ref={rootRef}
      className="welcome-title-motion"
      onPointerEnter={updatePointer}
      onPointerMove={updatePointer}
      onPointerLeave={handlePointerLeave}
    >
      <h1 className="welcome-title-motion__semantic">知无不言</h1>
      <svg
        ref={svgRef}
        className="welcome-title-motion__svg"
        viewBox="0 0 286 72"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient ref={flowGradientRef} id={flowGradientId} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="286" y2="72">
            <stop offset="0" stopColor="#0f70ff" />
            <stop offset="0.45" stopColor="#57c9ff" />
            <stop offset="0.72" stopColor="#8aa7ff" />
            <stop offset="1" stopColor="#ffd092" />
          </linearGradient>
          <radialGradient ref={lensRef} id={lensGradientId} gradientUnits="userSpaceOnUse" cx={TITLE_CENTER_X} cy={TITLE_CENTER_Y} r="0">
            <stop offset="0" stopColor="white" stopOpacity="1" />
            <stop offset="0.55" stopColor="white" stopOpacity="0.96" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </radialGradient>
          {/* 蒙版矩形必须盖过视图框：字形墨迹顶部越出 y=0 约 3 个单位，位移滤镜与回声平移还会外溢十余个单位，只覆盖 286×72 会把标题边缘削平。 */}
          <mask id={lensMaskId}><rect x="-32" y="-32" width="350" height="140" fill={`url(#${lensGradientId})`} /></mask>
          <filter id={refractionFilterId} x="-16%" y="-28%" width="132%" height="156%">
            <feTurbulence ref={noiseRef} id={noiseId} data-title-noise type="fractalNoise" baseFrequency="0.017 0.11" numOctaves="2" seed="8" result="noise" />
            <feDisplacementMap ref={displacementRef} id={displacementId} data-title-displacement in="SourceGraphic" in2="noise" scale="0" xChannelSelector="R" yChannelSelector="B" />
          </filter>
        </defs>
        <text className="welcome-title-motion__text welcome-title-motion__base" x="143" y="51" textAnchor="middle">知无不言</text>
        <text ref={echoARef} className="welcome-title-motion__text welcome-title-motion__echo-a" data-title-echo-a x="143" y="51" textAnchor="middle" mask={`url(#${lensMaskId})`}>知无不言</text>
        <text ref={echoBRef} className="welcome-title-motion__text welcome-title-motion__echo-b" data-title-echo-b x="143" y="51" textAnchor="middle" mask={`url(#${lensMaskId})`}>知无不言</text>
        <text ref={refractedRef} className="welcome-title-motion__text welcome-title-motion__refracted" data-title-refracted x="143" y="51" textAnchor="middle" mask={`url(#${lensMaskId})`} fill={`url(#${flowGradientId})`} filter={`url(#${refractionFilterId})`}>知无不言</text>
      </svg>
    </div>
  );
}

function WelcomeApp(): React.JSX.Element {
  const [continueState, setContinueState] = useState<ContinueState>("idle");
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  const continueWithZhihu = (): void => {
    if (continueState !== "idle") return;
    setContinueState("connecting");
    window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => {
      setContinueState("ready");
      resetTimer.current = window.setTimeout(() => setContinueState("idle"), 1600);
    }, 1050);
  };

  const buttonLabel = continueState === "connecting"
    ? "正在连接知乎"
    : continueState === "ready"
      ? "已准备好"
      : "使用知乎继续";

  return (
    <main className="welcome-stage">
      <section className="welcome-window" aria-label="知无不言首次打开演示">
        <div className="welcome-scene" aria-hidden="true">
          <img src={sceneArtwork} alt="" draggable={false} />
          <span className="welcome-scene-edge" />
        </div>

        <div className="welcome-panel">
          <span className="welcome-glow" aria-hidden="true" />
          <div className="product-version">v{__PRODUCT_VERSION__}</div>

          <div className="welcome-content">
            <div className="welcome-heading">
              <WelcomeTitleMotion />
              <p className="welcome-tagline">
                <span className="slogan-highlight">好奇心</span>，带我们去更大的世界
              </p>
            </div>

            <button
              className={`continue-button state-${continueState}`}
              type="button"
              disabled={continueState !== "idle"}
              onClick={continueWithZhihu}
            >
              <span className="zhihu-mark" aria-hidden="true">知</span>
              <span className="button-divider" aria-hidden="true" />
              <span className="button-label">{buttonLabel}</span>
              <span className="button-state" aria-hidden="true">
                {continueState === "connecting"
                  ? <LoaderCircle size={19} className="spin" />
                  : continueState === "ready"
                    ? <Check size={19} />
                    : <ArrowRight size={20} />}
              </span>
            </button>

          </div>

        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><WelcomeApp /></StrictMode>);
