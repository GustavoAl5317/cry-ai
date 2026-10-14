// Desktop shell for the meeting copilot: a small always-on-top window that
// is excluded from screen capture, so it never shows up when the user shares
// their screen in Teams, Zoom or Meet.
import { execSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, desktopCapturer, globalShortcut, session } from "electron";

const PORT = Number(process.env.COPILOT_PORT ?? 3000);
const APP_URL = `http://localhost:${PORT}`;
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHORTCUT_TOGGLE = "CommandOrControl+Alt+H";
const SHORTCUT_ANSWER = "CommandOrControl+Alt+Space";

let server = null;
let win = null;

async function isServerUp() {
  try {
    const res = await fetch(APP_URL);
    return res.ok;
  } catch {
    return false;
  }
}

// Reuses a server the user already started; otherwise runs `npm run dev`.
async function ensureServer() {
  if (await isServerUp()) return;
  server = spawn("npm run dev", { cwd: ROOT, shell: true, stdio: "inherit" });
  for (let i = 0; i < 240; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isServerUp()) return;
  }
  throw new Error(`Servidor nao respondeu em ${APP_URL}`);
}

function stopServer() {
  if (!server?.pid) return;
  if (process.platform === "win32") {
    // The shell wraps npm and next; kill the whole tree.
    try {
      execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: "ignore" });
    } catch {}
  } else {
    server.kill();
  }
  server = null;
}

function setupMedia() {
  const ses = session.defaultSession;
  const allowed = new Set(["media", "display-capture"]);
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(allowed.has(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

  // getDisplayMedia() has no picker in Electron: grant the main screen and
  // all system audio (loopback, Windows only), which carries the meeting.
  ses.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ["screen"] });
      if (sources.length === 0) return callback(null);
      callback({ video: sources[0], audio: "loopback" });
    } catch {
      callback(null);
    }
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 480,
    height: 760,
    minWidth: 360,
    minHeight: 420,
    title: "Copiloto",
    backgroundColor: "#0a0a0a",
    alwaysOnTop: true,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  // Windows 10 2004+ removes the window from every screen capture.
  win.setContentProtection(true);
  win.setAlwaysOnTop(true, "floating");
  win.loadURL(APP_URL);
  win.on("closed", () => {
    win = null;
  });
}

function registerShortcuts() {
  globalShortcut.register(SHORTCUT_TOGGLE, () => {
    if (!win) return;
    if (win.isVisible()) win.hide();
    else win.showInactive();
  });
  // Ask for an answer without taking focus away from the meeting.
  globalShortcut.register(SHORTCUT_ANSWER, () => {
    win?.webContents.executeJavaScript(
      "window.dispatchEvent(new Event('copilot:answer-now'))",
    );
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    win?.show();
    win?.focus();
  });

  app.whenReady().then(async () => {
    setupMedia();
    try {
      await ensureServer();
    } catch (err) {
      console.error(err);
      stopServer();
      app.quit();
      return;
    }
    createWindow();
    registerShortcuts();
  });

  app.on("window-all-closed", () => app.quit());
  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    stopServer();
  });
}
