/* eslint-disable @typescript-eslint/no-require-imports -- Electron main process is intentionally CommonJS. */
const { app, BrowserWindow, dialog, shell } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const PORT = 3210;
const APP_URL = "http://127.0.0.1:" + PORT;
let mainWindow = null;
let backendStarted = false;

function assertPortAvailable() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(PORT, "127.0.0.1", () => {
      probe.close((error) => (error ? reject(error) : resolve()));
    });
  });
}

function waitForServer(timeoutMs = 45_000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    let finished = false;
    let retryScheduled = false;

    const retry = (error) => {
      if (finished || retryScheduled) return;
      retryScheduled = true;

      if (Date.now() >= deadline) {
        finished = true;
        reject(error || new Error("The local studio server did not start in time."));
        return;
      }

      setTimeout(() => {
        retryScheduled = false;
        check();
      }, 300);
    };

    const check = () => {
      if (finished) return;
      const request = http.get(APP_URL, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) {
          finished = true;
          resolve();
        } else {
          retry(new Error("The local studio server returned HTTP " + response.statusCode + "."));
        }
      });
      request.setTimeout(1500, () => {
        request.destroy(new Error("Timed out while checking the local studio server."));
      });
      request.on("error", retry);
    };

    check();
  });
}

async function startLocalStudioServer() {
  const standaloneDir = path.join(app.getAppPath(), "standalone");
  const serverFile = path.join(standaloneDir, "server.js");
  const templateDatabase = path.join(standaloneDir, "dev.db");

  if (!fs.existsSync(serverFile)) {
    throw new Error("The packaged Next.js server is missing. Rebuild the desktop installer.");
  }
  if (!fs.existsSync(templateDatabase) || fs.statSync(templateDatabase).size === 0) {
    throw new Error("The SQLite database template is missing. Rebuild the installer after running npm run db:push.");
  }

  const dataDirectory = app.getPath("userData");
  fs.mkdirSync(dataDirectory, { recursive: true });
  const databaseFile = path.join(dataDirectory, "garageband-studio.db");
  if (!fs.existsSync(databaseFile)) {
    fs.copyFileSync(templateDatabase, databaseFile);
  }

  process.env.NODE_ENV = "production";
  process.env.NEXT_TELEMETRY_DISABLED = "1";
  process.env.HOSTNAME = "127.0.0.1";
  process.env.PORT = String(PORT);
  process.env.DATABASE_URL = "file:" + databaseFile.replace(/\\/g, "/");

  // Run Next.js inside Electron's Node main process. This avoids requiring a
  // separately-installed Node.js runtime on Windows or ChromeOS Linux.
  process.chdir(standaloneDir);
  require(serverFile);

  await waitForServer();
  backendStarted = true;
}

function createStudioWindow() {
  if (mainWindow) {
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#1e1e1e",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_URL)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== APP_URL && !url.startsWith(APP_URL + "/")) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  mainWindow.once("ready-to-show", () => mainWindow && mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  void mainWindow.loadURL(APP_URL);
}

const hasSingleInstance = app.requestSingleInstanceLock();
if (!hasSingleInstance) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    } else if (backendStarted) {
      createStudioWindow();
    }
  });

  app.whenReady().then(async () => {
    try {
      await assertPortAvailable();
      await startLocalStudioServer();
      createStudioWindow();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dialog.showErrorBox("GarageBand Web Studio could not start", message);
      app.quit();
    }
  });

  app.on("activate", () => {
    if (backendStarted) createStudioWindow();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
