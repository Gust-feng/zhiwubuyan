import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Check, LoaderCircle } from "lucide-react";
import { ZhihuLogo } from "@ui/components/zhihu-logo";
import "./login-view.css";

/** 主按钮的三态：等待、跳转中、就绪；三态共用同一颗按钮，不因状态换版式。 */
export type LoginContinueState = "idle" | "connecting" | "ready";

export type LoginViewProps = {
  /** 场景配图地址由调用方提供，视图只管版式。 */
  readonly artwork: string;
  /** 点「使用知乎继续」后的动作。 */
  readonly onContinue: () => void;
  readonly state?: LoginContinueState;
  /** 登录暂不可用时禁用按钮并给出简短说明。 */
  readonly unavailableReason?: string;
  /** 需要向用户交代的既有情况（如上次授权失败原因），不影响按钮可用性。 */
  readonly notice?: string;
  /** 产品版本号，缺省时不显示。 */
  readonly version?: string;
  /** 额外内容，插在按钮下方（如桌面端登录接力的操作区）。 */
  readonly footer?: ReactNode;
};

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
const TITLE_BASE_RADIUS = 62;

/** 加载完成到开始示范动画之间的等待时间。 */
const AUTO_SWEEP_DELAY = 600;
/** 一次示范扫过的总时长。 */
const AUTO_SWEEP_DURATION = 2600;
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

/** 标题的透镜扫光：指针经过时局部折射，空闲时自动示范一次。 */
function LoginTitleMotion() {
  const rootRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const lensRef = useRef<SVGRadialGradientElement>(null);
  const displacementRef = useRef<SVGFEDisplacementMapElement>(null);
  const noiseRef = useRef<SVGFETurbulenceElement>(null);
  const flowGradientRef = useRef<SVGLinearGradientElement>(null);
  const refractedRef = useRef<SVGTextElement>(null);
  const echoARef = useRef<SVGTextElement>(null);
  const echoBRef = useRef<SVGTextElement>(null);
  const glintRef = useRef<SVGCircleElement>(null);
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
  const flowGradientId = `loginTitleFlow-${id}`;
  const lensGradientId = `loginTitleLens-${id}`;
  const lensMaskId = `loginTitleMask-${id}`;
  const refractionFilterId = `loginTitleRefraction-${id}`;
  const noiseId = `loginTitleNoise-${id}`;
  const displacementId = `loginTitleDisplacement-${id}`;
  const glintGradientId = `loginTitleGlint-${id}`;

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
    const glint = glintRef.current;
    if (!svg || !lens || !displacement || !noise || !flowGradient || !refracted || !echoA || !echoB || !glint) {
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
      : Math.min(0.42, 0.06 + speed * 0.03) * visibility;

    lens.setAttribute("cx", state.x.toFixed(2));
    lens.setAttribute("cy", state.y.toFixed(2));
    lens.setAttribute("r", radius.toFixed(2));
    displacement.setAttribute("scale", reducedMotion ? "0" : (4.6 + speed * 1.25).toFixed(2));
    noise.setAttribute("baseFrequency", `${(0.017 + Math.sin(state.phase) * 0.002).toFixed(4)} 0.11`);
    flowGradient.setAttribute(
      "gradientTransform",
      `rotate(${(Math.sin(state.phase * 0.75) * 5 + state.velocityX * 0.8).toFixed(2)} 143 36)`,
    );

    refracted.style.opacity = (0.95 * visibility).toFixed(3);
    echoA.style.opacity = echoOpacity.toFixed(3);
    echoB.style.opacity = (echoOpacity * 0.6).toFixed(3);
    echoA.setAttribute(
      "transform",
      `translate(${(-state.velocityX * 1.15).toFixed(2)} ${(-state.velocityY * 0.4 - 0.8).toFixed(2)})`,
    );
    echoB.setAttribute(
      "transform",
      `translate(${(state.velocityX * 0.8).toFixed(2)} ${(state.velocityY * 0.3 + 0.8).toFixed(2)})`,
    );
    glint.setAttribute("cx", state.x.toFixed(2));
    glint.setAttribute("cy", (state.y - radius * 0.22).toFixed(2));
    glint.setAttribute("r", (radius * 0.62).toFixed(2));
    glint.style.opacity = (Math.min(0.5, 0.16 + speed * 0.05) * visibility).toFixed(3);

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
      className="login-title-motion"
      onPointerEnter={updatePointer}
      onPointerMove={updatePointer}
      onPointerLeave={handlePointerLeave}
    >
      <h1 className="login-title-motion__semantic">知无不言</h1>
      <svg
        ref={svgRef}
        className="login-title-motion__svg"
        viewBox="0 0 286 72"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient ref={flowGradientRef} id={flowGradientId} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="286" y2="72">
            <stop offset="0" stopColor="#00a6ff" />
            <stop offset="0.45" stopColor="#6fe6ff" />
            <stop offset="0.72" stopColor="#b9f2ff" />
            <stop offset="1" stopColor="#ffd9a0" />
          </linearGradient>
          <radialGradient id={glintGradientId}>
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.85" />
            <stop offset="0.55" stopColor="#dff6ff" stopOpacity="0.32" />
            <stop offset="1" stopColor="#dff6ff" stopOpacity="0" />
          </radialGradient>
          <radialGradient ref={lensRef} id={lensGradientId} gradientUnits="userSpaceOnUse" cx={TITLE_CENTER_X} cy={TITLE_CENTER_Y} r="0">
            <stop offset="0" stopColor="white" stopOpacity="1" />
            <stop offset="0.55" stopColor="white" stopOpacity="0.96" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </radialGradient>
          {/* 蒙版矩形必须盖过视图框：字形墨迹顶部越出 y=0 约 3 个单位，位移滤镜与回声平移还会外溢十余个单位，只覆盖 286×72 会把标题边缘削平。 */}
          <mask id={lensMaskId}><rect x="-32" y="-32" width="350" height="140" fill={`url(#${lensGradientId})`} /></mask>
          <filter id={refractionFilterId} x="-20%" y="-36%" width="140%" height="172%">
            <feTurbulence ref={noiseRef} id={noiseId} type="fractalNoise" baseFrequency="0.017 0.11" numOctaves="2" seed="8" result="noise" />
            <feDisplacementMap ref={displacementRef} id={displacementId} in="SourceGraphic" in2="noise" scale="0" xChannelSelector="R" yChannelSelector="B" result="displaced" />
            <feDropShadow in="displaced" dx="0" dy="0" stdDeviation="3.2" floodColor="#46d4ff" floodOpacity="0.5" />
          </filter>
        </defs>
        <text className="login-title-motion__text login-title-motion__base" x="143" y="51" textAnchor="middle">知无不言</text>
        <text ref={echoARef} className="login-title-motion__text login-title-motion__echo-a" x="143" y="51" textAnchor="middle" mask={`url(#${lensMaskId})`}>知无不言</text>
        <text ref={echoBRef} className="login-title-motion__text login-title-motion__echo-b" x="143" y="51" textAnchor="middle" mask={`url(#${lensMaskId})`}>知无不言</text>
        <text ref={refractedRef} className="login-title-motion__text login-title-motion__refracted" x="143" y="51" textAnchor="middle" mask={`url(#${lensMaskId})`} fill={`url(#${flowGradientId})`} filter={`url(#${refractionFilterId})`}>知无不言</text>
        <circle ref={glintRef} className="login-title-motion__glint" cx={TITLE_CENTER_X} cy={TITLE_CENTER_Y} r="0" fill={`url(#${glintGradientId})`} />
      </svg>
    </div>
  );
}

/**
 * 授权登录视图：左侧场景、右侧标题与「使用知乎继续」。
 * 网页端登录弹窗与桌面独立登录窗口共用这一份版式（同一份 3:2 画布）。
 */
export function LoginView({
  artwork,
  onContinue,
  state = "idle",
  unavailableReason,
  notice,
  version,
  footer,
}: LoginViewProps) {
  const disabled = state !== "idle" || unavailableReason !== undefined;
  const label = state === "connecting"
    ? "正在连接知乎"
    : state === "ready"
      ? "已准备好"
      : "使用知乎继续";

  return (
    <div className="login-view">
      <div className="login-view__scene" aria-hidden="true">
        <img src={artwork} alt="" draggable={false} />
        <span className="login-view__scene-edge" />
      </div>

      <div className="login-view__panel">
        <span className="login-view__glow" aria-hidden="true" />
        {version !== undefined && <span className="login-view__version">v{version}</span>}

        <div className="login-view__content">
          <div className="login-view__heading">
            <LoginTitleMotion />
            <p className="login-view__tagline">
              <span className="slogan-highlight">好奇心</span>，带我们去更大的世界
            </p>
          </div>

          <button
            className={`login-continue state-${state}`}
            type="button"
            disabled={disabled}
            onClick={() => {
              if (disabled) return;
              onContinue();
            }}
          >
            <span className="app-mark" aria-hidden="true"><ZhihuLogo /></span>
            <span className="button-divider" aria-hidden="true" />
            <span className="button-label">{label}</span>
            <span className="button-state" aria-hidden="true">
              {state === "connecting"
                ? <LoaderCircle size={19} className="spin" />
                : state === "ready"
                  ? <Check size={19} />
                  : <ArrowRight size={20} />}
            </span>
          </button>

          {notice !== undefined && (
            <p className="login-view__error" role="alert">{notice}</p>
          )}
          {unavailableReason !== undefined && (
            <p className="login-view__notice" role="status">{unavailableReason}</p>
          )}
          {footer}
        </div>
      </div>
    </div>
  );
}
