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

// Rolling buffer of the most recent server output, used to surface the real
// error to the user (and to a log file) when the server fails to start.
let serverOutput = "";
let logStream = null;
const SERVER_OUTPUT_LIMIT = 16000;

function getUserDataDir() {
  const dir = app.getPath("userData");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
  return dir;
}

function getUserDbPath() {
  return path.join(getUserDataDir(), "clinic.db");
}

function getServerLogPath() {
  return path.join(getUserDataDir(), "server.log");
}

function recordServerOutput(chunk) {
  const text = chunk.toString();
  serverOutput += text;
  if (serverOutput.length > SERVER_OUTPUT_LIMIT) {
    serverOutput = serverOutput.slice(serverOutput.length - SERVER_OUTPUT_LIMIT);
  }
  if (logStream) {
    try {
      logStream.write(text);
    } catch {
      /* ignore */
    }
  }
}

function lastOutputLines(maxLines = 25) {
  const lines = serverOutput.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return lines.slice(-maxLines).join("\n");
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

function waitForServer(port, timeoutMs = 30000, shouldAbort = () => false) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (shouldAbort()) {
        reject(new Error("aborted"));
        return;
      }
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
      if (shouldAbort()) {
        reject(new Error("aborted"));
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error("سرور برنامه به‌موقع آماده نشد (Server did not become ready in time)."));
        return;
      }
      setTimeout(attempt, 300);
    };
    attempt();
  });
}

function failureDetail(message) {
  const detail = lastOutputLines();
  return (
    `${message}\n\n` +
    `جزئیات سرور (لطفاً از این پیام عکس بگیرید و برای پشتیبانی بفرستید):\n` +
    `${detail || "(خروجی‌ای ثبت نشد)"}\n\n` +
    `گزارش کامل: ${getServerLogPath()}`
  );
}

function closeLogStream() {
  if (logStream) {
    try {
      logStream.end();
    } catch {
      /* ignore */
    }
    logStream = null;
  }
}

function startServer(port) {
  return new Promise((resolve, reject) => {
    const dbPath = getUserDbPath();
    const logPath = getServerLogPath();

    serverOutput = "";
    try {
      logStream = fs.createWriteStream(logPath, { flags: "w" });
      logStream.on("error", () => {
        logStream = null;
      });
      logStream.write(
        `--- Doctor Yari Clinic server log ---\n` +
          `time: ${new Date().toISOString()}\n` +
          `entry: ${SERVER_ENTRY}\n` +
          `db: ${dbPath}\n` +
          `port: ${port}\n\n`,
      );
    } catch {
      logStream = null;
    }

    if (!fs.existsSync(SERVER_ENTRY)) {
      reject(
        new Error(
          `فایل سرور پیدا نشد:\n${SERVER_ENTRY}\nبه نظر می‌رسد بسته‌ی برنامه ناقص ساخته شده است.`,
        ),
      );
      return;
    }

    // Single source of truth for the startup outcome so the user never sees
    // two competing error dialogs (server-exit vs. readiness-timeout).
    let settled = false;
    let serverReady = false;
    const finishOk = () => {
      if (settled) return;
      settled = true;
      serverReady = true;
      resolve();
    };
    const finishErr = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

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
      serverProcess.stdout.on("data", (d) => {
        recordServerOutput(d);
        process.stdout.write(`[server] ${d}`);
      });
    }
    if (serverProcess.stderr) {
      serverProcess.stderr.on("data", (d) => {
        recordServerOutput(d);
        process.stderr.write(`[server] ${d}`);
      });
    }

    serverProcess.on("error", (err) => {
      recordServerOutput(`\n[main] failed to launch server process: ${err && err.message}\n`);
      finishErr(
        new Error(
          failureDetail(`برنامه نتوانست سرور داخلی را اجرا کند: ${err && err.message}`),
        ),
      );
    });

    serverProcess.on("exit", (code) => {
      if (code === 0) {
        closeLogStream();
        return;
      }
      if (!serverReady) {
        // Crashed during startup -> single, immediate failure handled by bootstrap.
        finishErr(new Error(failureDetail(`سرور داخلی هنگام راه‌اندازی متوقف شد (کد ${code}).`)));
      } else if (!app.isQuitting) {
        // Crashed after a successful start -> standalone notification.
        dialog.showErrorBox(
          "خطای سرور",
          failureDetail(`سرور داخلی برنامه متوقف شد (کد ${code}). لطفاً برنامه را دوباره باز کنید.`),
        );
      }
      closeLogStream();
    });

    waitForServer(port, 30000, () => settled)
      .then(finishOk)
      .catch((err) => {
        if (err && err.message === "aborted") return;
        finishErr(new Error(failureDetail(err.message)));
      });
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
  closeLogStream();
});

app.on("window-all-closed", () => {
  app.quit();
});
