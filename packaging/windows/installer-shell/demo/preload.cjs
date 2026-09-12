const { contextBridge, ipcRenderer } = require("electron");

const listeners = new Set();

ipcRenderer.on("installer:message", (_event, message) => {
  for (const listener of listeners) listener({ data: message });
});

contextBridge.exposeInMainWorld("__zhiwubuyanInstallerMock", {
  postMessage(message) {
    ipcRenderer.send("installer:command", message);
  },
  addEventListener(type, listener) {
    if (type === "message") listeners.add(listener);
  },
  removeEventListener(type, listener) {
    if (type === "message") listeners.delete(listener);
  },
});
