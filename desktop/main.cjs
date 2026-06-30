"use strict";

const { app, BrowserWindow, Menu, dialog, shell, utilityProcess } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const os = require("os");

// ---------------------------------------------------------------------------
// Paths & configuration
// ---------------------------------------------------------------------------
// Whether built with asar or not, __dirname points at the app root that
// contains main.cjs and the assembled `dist/` folder.
const APP_ROOT = __dirname;
const SERVER_ENTRY = path.join(APP_ROOT, "dist", "server", "index.mjs");
const PUBLIC_DIR = path.join(APP_ROOT, "dist", "public");

// Fixed port so the phone bookmark stays stable; falls back to a free port
// if it is already taken.
const PREFERRED_PORT = 47615;

let serverProcess = null;
let mainWindow = null;
let activePort = PREFERRED_PORT;

function getUserDbPath() {
  const dir = app.getPath("userData");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
  return path.join(dir, "clinic.db");
}

function getLanAddresses(port) {
  const result = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        result.push(`http://${net.address}:${port}`);
      }
    }
  }
  return result;
}

function findFreePort(start) {
  return new Promise((resolve) => {
    const tester = http.createServer();
    tester.once("error", () => {
      // Port busy — try the next one.
      resolve(findFreePort(start + 1));
    });
    tester.once("listening", () => {
      tester.close(() => resolve(start));
    });
    tester.listen(start, "0.0.0.0");
  });
}

function waitForServer(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(
        { host: "127.0.0.1", port, path: "/api/healthz", timeout: 2000 },
        (res) => {
          res.resume();
          if (res.statusCode && res.statusCode < 500) {
            resolve();
          } else {
            retry();
          }
        },
      );
      req.on("error", retry);
      req.on("timeout", () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() > deadline) {
        reject(new Error("Server did not become ready in time"));
        return;
      }
      setTimeout(attempt, 300);
    };
    attempt();
  });
}

function startServer(port) {
  return new Promise((resolve, reject) => {
    const dbPath = getUserDbPath();
    serverProcess = utilityProcess.fork(SERVER_ENTRY, [], {
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: "production",
        SQLITE_DB_PATH: dbPath,
        SERVE_STATIC_DIR: PUBLIC_DIR,
      },
      stdio: "pipe",
    });

    if (serverProcess.stdout) {
      serverProcess.stdout.on("data", (d) => process.stdout.write(`[server] ${d}`));
    }
    if (serverProcess.stderr) {
      serverProcess.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
    }

    serverProcess.on("exit", (code) => {
      if (code !== 0 && !app.isQuitting) {
        dialog.showErrorBox(
          "خطای سرور",
          `سرور داخلی برنامه متوقف شد (کد ${code}). لطفاً برنامه را دوباره باز کنید.`,
        );
      }
    });

    waitForServer(port).then(resolve).catch(reject);
  });
}

function buildMenu(port) {
  const lan = getLanAddresses(port);
  const lanLabel =
    lan.length > 0
      ? `دسترسی از گوشی: ${lan.join("  |  ")}`
      : "دسترسی از گوشی: شبکه محلی یافت نشد";

  const template = [
    {
      label: "برنامه",
      submenu: [
        {
          label: "نمایش آدرس دسترسی از گوشی",
          click: () => {
            const addrs = getLanAddresses(port);
            dialog.showMessageBox(mainWindow, {
              type: "info",
              title: "دسترسی از گوشی / تبلت",
              message: "برای باز کردن برنامه روی گوشی، گوشی را به همان وای‌فای این کامپیوتر وصل کنید و یکی از این آدرس‌ها را در مرورگر گوشی باز کنید:",
              detail:
                addrs.length > 0
                  ? addrs.join("\n")
                  : "هیچ شبکه محلی فعالی پیدا نشد. اتصال وای‌فای/شبکه کامپیوتر را بررسی کنید.",
            });
          },
        },
        { type: "separator" },
        { role: "reload", label: "بارگذاری مجدد" },
        { role: "toggleDevTools", label: "ابزار توسعه‌دهنده" },
        { type: "separator" },
        { role: "quit", label: "خروج" },
      ],
    },
    {
      label: "ویرایش",
      submenu: [
        { role: "undo", label: "واگرد" },
        { role: "redo", label: "ازنو" },
        { type: "separator" },
        { role: "cut", label: "برش" },
        { role: "copy", label: "کپی" },
        { role: "paste", label: "چسباندن" },
        { role: "selectAll", label: "انتخاب همه" },
      ],
    },
    {
      label: "نما",
      submenu: [
        { role: "resetZoom", label: "اندازه پیش‌فرض" },
        { role: "zoomIn", label: "بزرگ‌نمایی" },
        { role: "zoomOut", label: "کوچک‌نمایی" },
        { type: "separator" },
        { role: "togglefullscreen", label: "تمام‌صفحه" },
      ],
    },
    {
      label: "راهنما",
      submenu: [{ label: lanLabel, enabled: false }],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: "مطب زیبایی دکتر یاری",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  // Open external links (http/https that are not the local server) in the
  // system browser instead of inside the app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://127.0.0.1:${port}`)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}/`);
}

async function bootstrap() {
  try {
    activePort = await findFreePort(PREFERRED_PORT);
    await startServer(activePort);
    buildMenu(activePort);
    createWindow(activePort);
  } catch (err) {
    dialog.showErrorBox(
      "خطا در راه‌اندازی",
      `برنامه نتوانست راه‌اندازی شود:\n${err && err.message ? err.message : err}`,
    );
    app.quit();
  }
}

// Single instance — prevent two copies fighting over the database/port.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(bootstrap);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(activePort);
    }
  });
}

app.on("before-quit", () => {
  app.isQuitting = true;
  if (serverProcess) {
    try {
      serverProcess.kill();
    } catch {
      /* ignore */
    }
  }
});

app.on("window-all-closed", () => {
  app.quit();
});
