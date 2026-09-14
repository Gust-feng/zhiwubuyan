import { app, BrowserWindow, net, shell } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";

// 后端以随包 Node 语义运行（ELECTRON_RUN_AS_NODE），产物与窗口壳同包：dist/backend/desktop-server.mjs。
const backendEntry = path.resolve(__dirname, "../backend/desktop-server.mjs");
/** 登录窗口沿用设计稿画布比例（1080×720）。 */
const LOGIN_WINDOW_SIZE = { width: 1080, height: 720 } as const;
const LOGIN_POLL_INTERVAL_MS = 1200;

let backendProcess: ChildProcessWithoutNullStreams | undefined;
let backendOrigin: string | undefined;
let mainWindow: BrowserWindow | undefined;
let loginWindow: BrowserWindow | undefined;
let loginPollTimer: NodeJS.Timeout | undefined;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

/** 拉起本地后端（端口 0 由系统分配），解析 stdout 里的 BACKEND_PORT 标记得到实际来源。 */
function startBackend(): Promise<string> {
  return new Promise((resolveOrigin, rejectOrigin) => {
    // --use-system-ca：与 dev:api 同理，本机网络存在 TLS 拦截，模型 API 需要系统证书链。
    const child = spawn(process.execPath, ["--use-system-ca", backendEntry], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        KANSHAN_EDITION: "desktop",
        RESEARCH_DATA_DIR: path.join(app.getPath("userData"), "research"),
        KANSHAN_ENV_FILE: path.join(app.getPath("userData"), ".env"),
      },
      stdio: ["ignore", "pipe", "inherit"],
    });
    backendProcess = child;

    let settled = false;
    let buffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (settled) {
        process.stdout.write(`[backend] ${text}`);
        return;
      }
      buffer += text;
      const match = /BACKEND_PORT=(\d+)/.exec(buffer);
      if (!match) return;
      settled = true;
      resolveOrigin(`http://127.0.0.1:${match[1]}`);
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      rejectOrigin(error);
    });
    child.once("exit", (code) => {
      backendProcess = undefined;
      if (settled) {
        console.error(`[backend] 进程已退出（代码 ${code ?? "未知"}），重启应用后恢复。`);
        return;
      }
      settled = true;
      rejectOrigin(new Error(`后端进程在就绪前退出（代码 ${code ?? "未知"}）。`));
    });
  });
}

async function createMainWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#f4f2ef",
    title: "知无不言",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = window;

  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    // 工作台用 window.open('/login') 请求授权登录；桌面端据此开独立登录窗口，
    // 不把主窗口导航到知乎授权页。
    if (isLoginRequestUrl(url)) {
      void openLoginWindow();
      return { action: "deny" };
    }
    if (isExternalWebUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (backendOrigin !== undefined && url.startsWith(backendOrigin)) return;
    event.preventDefault();
    if (isExternalWebUrl(url)) void shell.openExternal(url);
  });
  window.on("closed", () => {
    mainWindow = undefined;
    closeLoginWindow();
  });

  try {
    backendOrigin ??= await startBackend();
    await window.loadURL(`${backendOrigin}/`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[desktop] 后端启动失败：", message);
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(startupErrorPage(message))}`);
  }
}

/**
 * 独立登录窗口：加载 /login，允许窗口内跳转到知乎授权页。
 * 授权回调建立会话后由轮询发现，关闭登录窗口并刷新主界面，主窗口自身从不导航出去。
 */
async function openLoginWindow(): Promise<void> {
  if (backendOrigin === undefined) return;
  if (loginWindow !== undefined && !loginWindow.isDestroyed()) {
    loginWindow.focus();
    return;
  }
  const window = new BrowserWindow({
    width: LOGIN_WINDOW_SIZE.width,
    height: LOGIN_WINDOW_SIZE.height,
    minWidth: 720,
    minHeight: 480,
    resizable: true,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#edf2f8",
    title: "登录知无不言",
    parent: mainWindow,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  loginWindow = window;

  window.once("ready-to-show", () => window.show());
  window.webContents.on("will-navigate", (event, url) => {
    // 授权必须在本窗口内完成，才能让回调回到同一个后端来源。
    if (url.startsWith(backendOrigin) || isZhihuAuthUrl(url)) return;
    event.preventDefault();
    if (isExternalWebUrl(url)) void shell.openExternal(url);
  });
  window.on("closed", () => {
    loginWindow = undefined;
    stopLoginPolling();
  });

  try {
    await window.loadURL(`${backendOrigin}/login`);
  } catch (error) {
    console.error("[desktop] 登录窗口加载失败：", error instanceof Error ? error.message : String(error));
  }
  startLoginPolling();
}

function closeLoginWindow(): void {
  stopLoginPolling();
  if (loginWindow !== undefined && !loginWindow.isDestroyed()) loginWindow.close();
  loginWindow = undefined;
}

/** 轮询本地后端会话：回调落在同一后端来源时，这里会先看到已登录。 */
function startLoginPolling(): void {
  stopLoginPolling();
  loginPollTimer = setInterval(() => {
    void (async () => {
      if (backendOrigin === undefined) return;
      try {
        const response = await fetch(`${backendOrigin}/api/auth/session`);
        if (!response.ok) return;
        const body = (await response.json()) as { authenticated?: unknown; developerMode?: unknown };
        if (body.authenticated !== true || body.developerMode === true) return;
        closeLoginWindow();
        mainWindow?.reload();
      } catch {
        // 授权期间后端短暂不可达不值得中断轮询。
      }
    })();
  }, LOGIN_POLL_INTERVAL_MS);
}

function stopLoginPolling(): void {
  if (loginPollTimer !== undefined) clearInterval(loginPollTimer);
  loginPollTimer = undefined;
}

app.whenReady().then(() => {
  app.setName("知无不言");
  void createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
  });
});

app.on("second-instance", () => {
  const window = mainWindow;
  if (window === undefined || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.focus();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  stopLoginPolling();
  backendProcess?.kill();
  backendProcess = undefined;
});

function isExternalWebUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/** 工作台请求打开登录窗口的地址：同源 /login（可带查询）。 */
function isLoginRequestUrl(url: string): boolean {
  if (backendOrigin === undefined) return false;
  try {
    const parsed = new URL(url);
    const origin = new URL(backendOrigin);
    return parsed.origin === origin.origin && parsed.pathname.replace(/\/+$/, "") === "/login";
  } catch {
    return false;
  }
}

/** 知乎授权页与其后续跳转；这些地址必须在登录窗口内继续加载。 */
function isZhihuAuthUrl(url: string): boolean {
  return url.startsWith("https://openapi.zhihu.com/") || url.startsWith("https://www.zhihu.com/");
}

function startupErrorPage(message: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>知无不言</title></head>
<body style="margin:0;display:flex;height:100vh;align-items:center;justify-content:center;background:#f4f2ef;color:#292722;font-family:system-ui,sans-serif;">
<div style="max-width:420px;text-align:center;">
<h1 style="font-size:17px;">后端服务没有起来</h1>
<p style="font-size:13px;color:#646a73;">${message.replace(/</g, "&lt;")}</p>
<p style="font-size:13px;color:#646a73;">关闭窗口后重新打开应用；反复出现请把这条信息反馈给开发者。</p>
</div></body></html>`;
}
