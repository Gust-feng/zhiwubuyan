const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const path = require("node:path");

const requiredBytes = 214 * 1024 * 1024;
const availableBytes = 18.4 * 1024 * 1024 * 1024;
const rendererPath = path.join(process.resourcesPath, "installer", "index.html");
const preloadPath = path.join(__dirname, "preload.cjs");
const activeTimers = new Set();

let installParentPath = "";

function send(window, message) {
  if (!window.isDestroyed()) window.webContents.send("installer:message", message);
}

function locationPayload() {
  return {
    installParentPath,
    installPath: path.join(installParentPath, "知无不言"),
    requiredBytes,
    availableBytes,
  };
}

function schedule(callback, delay) {
  const timer = setTimeout(() => {
    activeTimers.delete(timer);
    callback();
  }, delay);
  activeTimers.add(timer);
}

function runInstallDemo(window) {
  const activities = [
    { id: "prepare", label: "准备安装资源", state: "active" },
    { id: "install", label: "写入应用文件", state: "pending" },
    { id: "verify", label: "校验应用文件", state: "pending" },
    { id: "register", label: "注册卸载信息", state: "pending" },
    { id: "shortcuts", label: "创建快捷方式", state: "pending" },
  ];

  const publishActivities = () => {
    send(window, { type: "install.activities", payload: { activities: activities.map((activity) => ({ ...activity })) } });
  };

  const activate = (index) => {
    for (let activityIndex = 0; activityIndex < activities.length; activityIndex += 1) {
      activities[activityIndex].state = activityIndex < index ? "completed" : activityIndex === index ? "active" : "pending";
    }
    publishActivities();
  };

  send(window, { type: "install.phase", payload: { phase: "preparing" } });
  publishActivities();

  schedule(() => {
    activate(1);
    send(window, { type: "install.phase", payload: { phase: "installing" } });

    let written = 0;
    const increment = requiredBytes / 14;
    const progressTimer = setInterval(() => {
      written = Math.min(requiredBytes, written + increment);
      send(window, { type: "install.progress", payload: { written, total: requiredBytes } });

      if (written < requiredBytes) return;
      clearInterval(progressTimer);
      activeTimers.delete(progressTimer);
      activate(2);
      schedule(() => {
        activate(3);
        schedule(() => {
          activate(4);
          schedule(() => {
            for (const activity of activities) activity.state = "completed";
            publishActivities();
            send(window, { type: "install.phase", payload: { phase: "completed" } });
          }, 460);
        }, 520);
      }, 620);
    }, 180);
    activeTimers.add(progressTimer);
  }, 760);
}

function registerInstallerCommands() {
  ipcMain.on("installer:command", async (event, command) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window === null || typeof command !== "object" || command === null) return;

    if (command.type === "shell.ready") {
      send(window, { type: "host.ready", payload: locationPayload() });
      return;
    }

    if (command.type === "directory.browse") {
      const result = await dialog.showOpenDialog(window, {
        title: "选择安装位置",
        defaultPath: installParentPath,
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled || result.filePaths[0] === undefined) return;
      installParentPath = result.filePaths[0];
      send(window, { type: "directory.selected", payload: locationPayload() });
      return;
    }

    if (command.type === "install.start") {
      runInstallDemo(window);
      return;
    }

    if (command.type === "window.close" || command.type === "app.open") window.close();
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 760,
    minHeight: 540,
    frame: false,
    show: false,
    backgroundColor: "#ffffff",
    title: "知无不言",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath,
    },
  });

  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  void window.loadFile(rendererPath);
}

if (!app.requestSingleInstanceLock()) app.quit();

app.whenReady().then(() => {
  app.setName("知无不言安装器演示");
  installParentPath = process.env.LOCALAPPDATA || app.getPath("home");
  registerInstallerCommands();
  createWindow();
});

app.on("second-instance", () => {
  const window = BrowserWindow.getAllWindows()[0];
  if (window === undefined) return;
  if (window.isMinimized()) window.restore();
  window.focus();
});

app.on("window-all-closed", () => app.quit());

app.on("before-quit", () => {
  for (const timer of activeTimers) clearTimeout(timer);
  activeTimers.clear();
});
