import { existsSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { BrowserWindow, Menu, Tray, app, dialog, ipcMain, nativeImage, shell } from "electron";
import { autoUpdater } from "electron-updater";

const PRODUCT = "WAB";

app.setName(PRODUCT);
app.setAppUserModelId("com.wab.app");

// Keep the tray app alive on unexpected errors instead of letting an
// unhandled rejection silently tear down the main process.
process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection:", reason);
  diagLog(`unhandledRejection: ${String(reason)}`);
});
process.on("uncaughtException", (err) => {
  console.error("uncaughtException:", err);
  diagLog(`uncaughtException: ${err?.stack ?? String(err)}`);
});

const userDataPath = app.getPath("userData");
process.env.WAB_AUTH_DIR = path.join(userDataPath, "auth");
process.env.WAB_MEDIA_DIR = path.join(userDataPath, "media");
process.env.WAB_ALIAS_FILE = path.join(userDataPath, "aliases.json");
process.env.WAB_LOG_FILE = path.join(userDataPath, "wab.log");
if (!process.env.WAB_LOG_LEVEL) process.env.WAB_LOG_LEVEL = "warn";

// Diagnostic log (separate file from the pino/Baileys log to avoid a shared
// file-handle contention on Windows). Captures main-process lifecycle and the
// renderer's console, so connection failures are visible without DevTools.
function diagLog(msg: string) {
  const f = process.env.WAB_LOG_FILE;
  if (!f) return;
  const sf = f.endsWith(".log") ? `${f.slice(0, -4)}-server.log` : `${f}-server.log`;
  appendFile(sf, `[main ${new Date().toISOString()}] ${msg}\n`).catch(() => {});
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

function trayIconPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "tray.png");
  }
  return path.join(app.getAppPath(), "build", "tray.png");
}

function badgeIconPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "badge.png");
  }
  return path.join(app.getAppPath(), "build", "badge.png");
}

function setUnreadBadge(count: number) {
  if (process.platform === "win32") {
    if (mainWindow) {
      if (count > 0) {
        try {
          mainWindow.setOverlayIcon(
            nativeImage.createFromPath(badgeIconPath()),
            `안 읽음 ${count}`,
          );
        } catch {
          // overlay unsupported / icon missing — ignore
        }
      } else {
        mainWindow.setOverlayIcon(null, "");
      }
    }
  } else if (process.platform === "darwin") {
    app.dock?.setBadge(count > 0 ? String(count) : "");
  }
  if (tray) tray.setToolTip(count > 0 ? `${PRODUCT} · 안 읽음 ${count}` : PRODUCT);
}

function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function buildTrayMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: "열기",
      click: showMainWindow,
    },
    { type: "separator" },
    {
      label: "업데이트 확인",
      click: () => {
        if (!app.isPackaged) {
          dialog.showMessageBox({
            type: "info",
            message: "개발 모드에서는 업데이트 확인이 비활성화됩니다.",
          });
          return;
        }
        autoUpdater.checkForUpdates().catch((err: unknown) => {
          console.error("checkForUpdates failed", err);
        });
      },
    },
    { type: "separator" },
    {
      label: "종료",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
}

function createTray() {
  if (tray) return;
  try {
    const image = nativeImage.createFromPath(trayIconPath());
    tray = new Tray(image);
    tray.setToolTip(PRODUCT);
    tray.setContextMenu(buildTrayMenu());
    tray.on("click", showMainWindow);
    tray.on("double-click", showMainWindow);
  } catch (err) {
    console.error("tray creation failed", err);
  }
}

async function getAvailablePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      if (typeof address === "object" && address) {
        const port = address.port;
        srv.close(() => resolve(port));
      } else {
        srv.close();
        reject(new Error("Could not determine port"));
      }
    });
  });
}

async function bootServer(): Promise<number> {
  if (!app.isPackaged && process.env.WAB_DEV_URL) {
    const url = new URL(process.env.WAB_DEV_URL);
    return Number(url.port) || 3000;
  }
  const port = await getAvailablePort();
  process.env.PORT = String(port);
  const appRoot = app.getAppPath();
  const { startServer } = (await import(path.join(appRoot, "dist", "lib", "server.js"))) as {
    startServer: (opts: {
      port: number;
      dir?: string;
      dev?: boolean;
    }) => Promise<{ port: number }>;
  };
  await startServer({ port, dir: appRoot, dev: false });
  return port;
}

async function createMainWindow(url: string) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 860,
    minHeight: 600,
    title: PRODUCT,
    icon: app.isPackaged ? undefined : path.join(app.getAppPath(), "build", "icon.ico"),
    backgroundColor: "#0b141a",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.removeMenu();

  // Capture the renderer's console (incl. socket.io-client connect errors) into
  // the diagnostic log so we can see why the client can't reach the server even
  // in the packaged build where DevTools isn't normally available.
  mainWindow.webContents.on(
    "console-message",
    (_e: Electron.Event, level: number, message: string) => {
      diagLog(`renderer[${level}] ${message}`);
    },
  );
  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    diagLog(`did-fail-load: ${code} ${desc} ${url}`);
  });
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    diagLog(`render-process-gone: ${details.reason} (exit ${details.exitCode})`);
  });

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  await mainWindow.loadURL(url);
  mainWindow.show();

  mainWindow.webContents.setWindowOpenHandler(({ url: openUrl }: { url: string }) => {
    try {
      const parsed = new URL(openUrl);
      if (parsed.protocol === "blob:") {
        return {
          action: "allow" as const,
          overrideBrowserWindowOptions: {
            autoHideMenuBar: true,
            backgroundColor: "#0b141a",
            webPreferences: {
              nodeIntegration: false,
              contextIsolation: true,
              sandbox: true,
            },
          },
        };
      }
      if (["http:", "https:", "mailto:"].includes(parsed.protocol)) {
        shell.openExternal(openUrl).catch((err) => diagLog(`openExternal failed: ${String(err)}`));
      } else {
        diagLog(`blocked window.open URL: ${openUrl}`);
      }
    } catch (err) {
      diagLog(`invalid window.open URL blocked: ${openUrl} (${String(err)})`);
    }
    return { action: "deny" as const };
  });

  mainWindow.on("close", (e: Electron.Event) => {
    if (isQuitting) return;
    e.preventDefault();
    mainWindow?.hide();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function setupAutoUpdater() {
  if (!app.isPackaged) return;
  // dist:dir builds (and any unpacked variant) don't include the update
  // manifest; electron-updater would spam ENOENT on every check. Skip cleanly.
  const manifestPath = path.join(process.resourcesPath, "app-update.yml");
  if (!existsSync(manifestPath)) {
    console.log("auto-updater: no app-update.yml in resources, update check disabled");
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info: { version: string }) => {
    console.log(`Update available: ${info.version}`);
  });

  autoUpdater.on("update-downloaded", async (info: { version: string }) => {
    const target = mainWindow ?? undefined;
    const result = await dialog.showMessageBox(target as BrowserWindow, {
      type: "info",
      message: "업데이트 준비 완료",
      detail: `버전 ${info.version}이 다운로드되었습니다.\n지금 재시작하여 적용할까요?`,
      buttons: ["지금 재시작", "나중에"],
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response === 0) {
      isQuitting = true;
      setImmediate(() => autoUpdater.quitAndInstall());
    }
  });

  autoUpdater.on("error", (err: Error) => {
    console.error("Auto-updater error:", err.message);
  });

  autoUpdater.checkForUpdates().catch((err: unknown) => {
    console.error("initial update check failed", err);
  });

  setInterval(
    () => {
      autoUpdater.checkForUpdates().catch((err: unknown) => {
        console.error("interval update check failed", err);
      });
    },
    60 * 60 * 1000,
  );
}

ipcMain.on("wab:set-unread", (_e, count: number) => {
  setUnreadBadge(Number(count) || 0);
});
ipcMain.on("wab:set-auto-launch", (_e, enabled: boolean) => {
  app.setLoginItemSettings({ openAtLogin: !!enabled });
});
ipcMain.handle("wab:get-auto-launch", () => app.getLoginItemSettings().openAtLogin);

app.on("second-instance", () => {
  if (mainWindow) {
    showMainWindow();
  }
});

app.on("window-all-closed", () => {
  // Window close is intercepted (hide-to-tray); this only fires on real quit.
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("activate", () => {
  if (mainWindow) {
    showMainWindow();
    return;
  }
  bootServer()
    .then((port: number) => createMainWindow(`http://127.0.0.1:${port}`))
    .catch((err: unknown) => console.error("activate boot failed", err));
});

app
  .whenReady()
  .then(async () => {
    try {
      diagLog("app ready, booting server...");
      const url = process.env.WAB_DEV_URL ?? `http://127.0.0.1:${await bootServer()}`;
      diagLog(`server booted, loading url=${url}`);
      createTray();
      await createMainWindow(url);
      diagLog("main window created");
      setupAutoUpdater();
    } catch (err) {
      console.error("startup failed", err);
      diagLog(`startup failed: ${String(err)}`);
      app.quit();
    }
  })
  .catch((err: unknown) => {
    console.error("app.whenReady failed", err);
    app.quit();
  });
