import { ArrowRight, Check, FolderOpen, HardDrive, LoaderCircle, X } from "lucide-react";
import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { sendHostCommand, subscribeToHost, type HostMessage, type InstallActivity, type InstallLocation, type InstallPhase } from "./host";
import sceneArtwork from "./assets/scene.png";
import "./styles.css";

const initialLocation: InstallLocation = {
  installParentPath: "",
  installPath: "",
  requiredBytes: 0,
  availableBytes: 0,
};

const initialActivities: readonly InstallActivity[] = [
  { id: "prepare", label: "准备安装资源", state: "pending" },
  { id: "install", label: "写入应用文件", state: "pending" },
  { id: "verify", label: "校验应用文件", state: "pending" },
  { id: "register", label: "注册卸载信息", state: "pending" },
  { id: "shortcuts", label: "创建快捷方式", state: "pending" },
];

const phaseTitle: Readonly<Record<InstallPhase, string>> = {
  configure: "知无不言",
  preparing: "正在安装",
  installing: "正在安装",
  completed: "安装完成",
  failed: "安装未完成",
};

type RuntimeDetail = {
  readonly id: string;
  readonly activityId: string;
  readonly action: string;
  readonly detail: string;
};

const fallbackFiles = [
  { threshold: 0, path: "resources\\app.asar" },
  { threshold: 18, path: "知无不言.exe" },
  { threshold: 36, path: "resources.pak" },
  { threshold: 54, path: "locales\\zh-CN.pak" },
  { threshold: 72, path: "ffmpeg.dll" },
  { threshold: 88, path: "icudtl.dat" },
] as const;

function InstallerApp(): React.JSX.Element {
  const [phase, setPhase] = useState<InstallPhase>("configure");
  const [location, setLocation] = useState(initialLocation);
  const [activities, setActivities] = useState(initialActivities);
  const [progress, setProgress] = useState<{ written: number; total: number }>();
  const [error, setError] = useState<string>();
  const [desktopShortcut, setDesktopShortcut] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeToHost((message: HostMessage) => {
      if (message.type === "host.ready" || message.type === "directory.selected") setLocation(message.payload);
      if (message.type === "install.phase") setPhase(message.payload.phase);
      if (message.type === "install.progress") setProgress(message.payload);
      if (message.type === "install.activities") setActivities(message.payload.activities);
      if (message.type === "install.failure") {
        setError(message.payload.message);
        setPhase("failed");
      }
    });
    sendHostCommand({ type: "shell.ready" });
    return unsubscribe;
  }, []);

  const percentage = useMemo(() => {
    if (progress === undefined || progress.total <= 0) return 0;
    return Math.min(100, Math.round((progress.written / progress.total) * 100));
  }, [progress]);
  const busy = phase === "preparing" || phase === "installing";
  const insufficient = location.availableBytes > 0 && location.requiredBytes > location.availableBytes;
  const displayedPercentage = phase === "completed" ? 100 : percentage;
  const currentActivity = activities.find((activity) => activity.state === "active");
  const completedActivities = activities.filter((activity) => activity.state === "completed").length;
  const writingFiles = busy && currentActivity?.id === "install" && progress !== undefined;
  const progressIndeterminate = busy && !writingFiles;
  const progressStatus = busy
    ? currentActivity?.label ?? "正在准备安装"
    : phase === "completed"
      ? "安装内容已就绪"
      : currentActivity?.label ?? "安装已停止";
  const progressCount = writingFiles
    ? `${percentage}%`
    : phase === "completed"
      ? `${activities.length}/${activities.length}`
      : `${completedActivities}/${activities.length}`;
  const runtimeDetails = useMemo(
    () => buildRuntimeDetails(activities, percentage, location.installPath, desktopShortcut),
    [activities, desktopShortcut, location.installPath, percentage],
  );

  return (
    <main className={`installer-shell phase-${phase}`}>
      <aside className="installer-aside" aria-hidden="true">
        <div className="artwork-slot"><img src={sceneArtwork} alt="" draggable={false} /></div>
      </aside>

      <section className="installer-main">
        <header className="installer-header">
          <button className="close-button" type="button" disabled={busy} onClick={() => sendHostCommand({ type: "window.close" })} aria-label="关闭安装器">
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="installer-content">
          <div className="title-block">
            <h1>{phaseTitle[phase]}</h1>
          </div>

          {phase === "configure" && (
            <div className="configure-panel">
              <label className="field-label" htmlFor="install-path">安装位置</label>
              <div className="path-field">
                <HardDrive size={18} aria-hidden="true" />
                <input id="install-path" readOnly value={location.installPath || "正在读取安装位置…"} title={location.installPath} />
                <button type="button" onClick={() => sendHostCommand({ type: "directory.browse" })} disabled={busy || !location.installParentPath}>
                  <FolderOpen size={15} aria-hidden="true" />
                  更改
                </button>
              </div>
              <div className="storage-note">需要 {formatBytes(location.requiredBytes)} · 可用 {formatBytes(location.availableBytes)}</div>
              {insufficient && <div className="inline-error" role="alert">安装位置空间不足，请更改位置。</div>}
              <fieldset className="shortcut-options">
                <legend>快捷方式</legend>
                <label className="check-row check-row-fixed"><input type="checkbox" checked readOnly /><span className="custom-check" /><span>开始菜单</span></label>
                <label className="check-row"><input type="checkbox" checked={desktopShortcut} onChange={(event) => setDesktopShortcut(event.target.checked)} /><span className="custom-check" /><span>桌面</span></label>
              </fieldset>
              <div className="action-row">
                <button className="primary-button" type="button" disabled={!location.installParentPath || insufficient} onClick={() => sendHostCommand({ type: "install.start", payload: { installParentPath: location.installParentPath, createDesktopShortcut: desktopShortcut, createStartMenuShortcut: true } })}>
                  <span>开始安装</span>
                  <ArrowRight size={19} aria-hidden="true" />
                </button>
              </div>
            </div>
          )}

          {(busy || phase === "completed" || phase === "failed") && (
            <div className="progress-panel">
              <div className="progress-status">
                <strong>{progressStatus}</strong>
                <span>{progressCount}</span>
              </div>
              <div
                className={`progress-track${progressIndeterminate ? " is-indeterminate" : ""}`}
                role="progressbar"
                aria-label="安装进度"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progressIndeterminate ? undefined : displayedPercentage}
              >
                <span className="progress-fill" style={{ width: `${displayedPercentage}%` }} />
              </div>
              <div className="progress-meta">
                <span>{writingFiles && progress !== undefined ? `${formatBytes(progress.written)} / ${formatBytes(progress.total)}` : ""}</span>
                <span title={location.installPath}>{location.installPath}</span>
              </div>
              <div className="runtime-details" aria-live="polite" aria-label="安装运行记录">
                <div className="runtime-details-heading">
                  <span>运行记录</span>
                  <span>{runtimeDetails.length} 项</span>
                </div>
                <div className="runtime-log">
                  {runtimeDetails.map((item) => {
                    const activityState = activities.find((activity) => activity.id === item.activityId)?.state;
                    const running = activityState === "active" && item.id === runtimeDetails.at(-1)?.id;
                    return (
                      <div className={`runtime-line${running ? " is-running" : ""}`} key={item.id}>
                        <span className="runtime-state" aria-hidden="true">
                          {running ? <LoaderCircle size={12} className="spin" /> : <Check size={12} />}
                        </span>
                        <span className="runtime-action">{item.action}</span>
                        <code title={item.detail}>{item.detail}</code>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="result-slot">
                {phase === "failed" && (
                  <div className="failure-card" role="alert">
                    <span>{error ?? "安装过程中遇到问题。"}</span>
                    <button type="button" onClick={() => sendHostCommand({ type: "window.close" })}>关闭</button>
                  </div>
                )}
                {phase === "completed" && (
                  <div className="action-row progress-action-row">
                  <button className="primary-button launch-button" type="button" onClick={() => sendHostCommand({ type: "app.open" })}>
                    <span>打开知无不言</span>
                    <ArrowRight size={19} aria-hidden="true" />
                  </button>
                </div>
                )}
              </div>
            </div>
          )}
        </div>
        <footer className="installer-footer" />
      </section>
    </main>
  );
}

function buildRuntimeDetails(
  activities: readonly InstallActivity[],
  percentage: number,
  installPath: string,
  desktopShortcut: boolean,
): readonly RuntimeDetail[] {
  const stateOf = (id: string): InstallActivity["state"] | undefined => activities.find((activity) => activity.id === id)?.state;
  const visible = (id: string): boolean => stateOf(id) !== undefined && stateOf(id) !== "pending";
  const entries: RuntimeDetail[] = [];
  const target = installPath || "正在读取安装位置";

  if (visible("prepare")) {
    entries.push(
      { id: "prepare:directory", activityId: "prepare", action: "检查", detail: target },
      { id: "prepare:package", activityId: "prepare", action: "准备", detail: "知无不言应用包" },
    );
  }

  if (visible("install")) {
    for (const file of fallbackFiles) {
      if (stateOf("install") !== "completed" && percentage < file.threshold) break;
      entries.push({
        id: `install:${file.path}`,
        activityId: "install",
        action: "写入",
        detail: `${target}\\${file.path}`,
      });
    }
  }

  if (visible("verify")) {
    entries.push(
      { id: "verify:executable", activityId: "verify", action: "校验", detail: `${target}\\知无不言.exe` },
      { id: "verify:archive", activityId: "verify", action: "校验", detail: `${target}\\resources\\app.asar` },
    );
  }

  if (visible("register")) {
    entries.push({ id: "register:uninstall", activityId: "register", action: "登记", detail: "Windows 应用与功能" });
  }

  if (visible("shortcuts")) {
    entries.push({ id: "shortcuts:start-menu", activityId: "shortcuts", action: "创建", detail: "开始菜单\\知无不言.lnk" });
    if (desktopShortcut) entries.push({ id: "shortcuts:desktop", activityId: "shortcuts", action: "创建", detail: "桌面\\知无不言.lnk" });
  }

  return entries.slice(-8);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "读取中";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

createRoot(document.getElementById("root")!).render(<StrictMode><InstallerApp /></StrictMode>);
