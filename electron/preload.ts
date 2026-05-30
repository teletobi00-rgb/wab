import { contextBridge, ipcRenderer } from "electron";

// Minimal, sandboxed bridge. The renderer can flag unread state (taskbar badge)
// and toggle launch-at-login; nothing else is exposed.
contextBridge.exposeInMainWorld("wab", {
  setUnread: (count: number) => ipcRenderer.send("wab:set-unread", count),
  setAutoLaunch: (enabled: boolean) => ipcRenderer.send("wab:set-auto-launch", enabled),
  getAutoLaunch: (): Promise<boolean> => ipcRenderer.invoke("wab:get-auto-launch"),
});
