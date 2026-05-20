// Spiral Buddy — Electron main process (CommonJS)
//
// 흐름:
//  1. app.whenReady → loadConfig (userData/config.json)
//  2. 필수값(API 키, vault) 없으면 setup wizard 창
//  3. 있으면 spawn server (Electron binary를 Node 모드로) + BrowserWindow(localhost:port)
//
// 빌드 전제: src/는 tsc로 dist/에 컴파일되어 있어야 함.
// 패키징 시 electron-builder가 dist/, client/, electron/, data/, node_modules/를 묶음.

const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawn, spawnSync } = require("node:child_process");
const net = require("node:net");
const https = require("node:https");
const { pathToFileURL } = require("node:url");

// dev: <worktree>/  ·  packaged: Contents/Resources/app/  (asar: false 기준)
// app.getAppPath()가 두 경우 모두 정확.
const APP_ROOT = app.getAppPath();

const CONFIG_PATH = path.join(app.getPath("userData"), "spiral-buddy-config.json");
const LOG_DIR = app.getPath("logs"); // macOS: ~/Library/Logs/<productName>
const SERVER_LOG_PATH = path.join(LOG_DIR, "server.log");

let mainWindow = null;
let setupWindow = null;
let serverPort = null;
let serverStarted = false;

function loadConfig() {
  // 1순위: userData에 저장된 GUI 설정
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    /* fallthrough */
  }
  // 2순위: APP_ROOT/.env (dev 환경, 또는 사용자가 직접 .env로 운영)
  try {
    const envPath = path.join(APP_ROOT, ".env");
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf-8");
      const get = (key) => {
        const m = content.match(new RegExp(`^${key}=(.+)$`, "m"));
        if (!m) return null;
        return m[1].trim().replace(/^["']|["']$/g, "");
      };
      const apiKey = get("ANTHROPIC_API_KEY");
      const vaultPath = get("SPIRAL_VAULT_PATH");
      if (apiKey && vaultPath) {
        return {
          anthropicApiKey: apiKey,
          vaultPath,
          roadmapRoot: get("SPIRAL_ROADMAP_ROOT"),
          curatedOrg: get("SPIRAL_CURATED_ORG"),
          model: get("SPIRAL_MODEL"),
          maxTokens: get("SPIRAL_MAX_TOKENS")
            ? Number(get("SPIRAL_MAX_TOKENS"))
            : null,
          vaultName: get("SPIRAL_VAULT_NAME"),
          githubToken: get("SPIRAL_GITHUB_TOKEN"),
        };
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf-8");
}

function hasRequiredConfig(cfg) {
  return Boolean(
    cfg &&
      typeof cfg.anthropicApiKey === "string" &&
      cfg.anthropicApiKey.length > 0 &&
      typeof cfg.vaultPath === "string" &&
      cfg.vaultPath.length > 0,
  );
}

async function findFreePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForServer(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      const sock = net.connect({ host: "127.0.0.1", port }, () => {
        sock.end();
        resolve(true);
      });
      sock.on("error", () => resolve(false));
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

async function startServerInProcess(cfg) {
  const port = serverPort;
  // process.env에 config 주입 — server는 process.env 기반으로 동작
  process.env.ANTHROPIC_API_KEY = cfg.anthropicApiKey;
  process.env.SPIRAL_VAULT_PATH = cfg.vaultPath;
  process.env.PORT = String(port);
  process.env.NO_OPEN = "1";
  if (cfg.roadmapRoot) process.env.SPIRAL_ROADMAP_ROOT = cfg.roadmapRoot;
  if (cfg.curatedOrg) process.env.SPIRAL_CURATED_ORG = cfg.curatedOrg;
  if (cfg.githubToken) process.env.SPIRAL_GITHUB_TOKEN = cfg.githubToken;
  if (cfg.model) process.env.SPIRAL_MODEL = cfg.model;
  if (cfg.maxTokens) process.env.SPIRAL_MAX_TOKENS = String(cfg.maxTokens);
  if (cfg.vaultName) process.env.SPIRAL_VAULT_NAME = cfg.vaultName;

  const serverEntry = path.join(APP_ROOT, "dist", "server.js");

  // 진단용 로그 — 패키지 앱에서 사용자가 확인 가능
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.appendFileSync(
    SERVER_LOG_PATH,
    `[${new Date().toISOString()}] startServer (in-process)\n` +
      `  APP_ROOT=${APP_ROOT}\n` +
      `  serverEntry=${serverEntry}\n` +
      `  exists=${fs.existsSync(serverEntry)}\n` +
      `  PORT=${port}\n` +
      `  isPackaged=${app.isPackaged}\n` +
      `  electron=${process.versions.electron}, node=${process.versions.node}\n\n`,
  );

  if (!fs.existsSync(serverEntry)) {
    throw new Error(
      `Server entry not found:\n${serverEntry}\n\n패키지 자산이 누락된 빌드일 수 있습니다.`,
    );
  }

  // CJS에서 ESM 동적 import. file:// URL 필수.
  const url = pathToFileURL(serverEntry).href;
  const mod = await import(url);
  if (typeof mod.startServer !== "function") {
    throw new Error(`dist/server.js does not export startServer()`);
  }
  // startServer는 listen 시작 직후 return. waitForServer로 실제 ready 시점 확인.
  await mod.startServer();
}

function createSetupWindow() {
  setupWindow = new BrowserWindow({
    width: 600,
    height: 640,
    title: "Spiral Buddy — 초기 설정",
    backgroundColor: "#0e0e11",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  setupWindow.setMenuBarVisibility(false);
  setupWindow.loadFile(path.join(__dirname, "setup.html"));
  setupWindow.on("closed", () => {
    setupWindow = null;
    if (!mainWindow && !serverStarted) {
      // 사용자가 설정 안 하고 닫음 → 앱 종료
      app.quit();
    }
  });
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: "Spiral Buddy",
    backgroundColor: "#0e0e11",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // 메인 메뉴 단순화 (macOS 표준 + 기본 단축키만)
  if (process.platform !== "darwin") {
    mainWindow.setMenuBarVisibility(false);
  }
  const url = `http://127.0.0.1:${serverPort}`;
  await mainWindow.loadURL(url);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function bootWithConfig(cfg) {
  serverPort = await findFreePort();
  try {
    await startServerInProcess(cfg);
  } catch (err) {
    const msg = err instanceof Error ? `${err.message}\n\n${err.stack ?? ""}` : String(err);
    try {
      fs.appendFileSync(
        SERVER_LOG_PATH,
        `[${new Date().toISOString()}] startServer error:\n${msg}\n\n`,
      );
    } catch {
      /* ignore */
    }
    dialog.showErrorBox(
      "Spiral Buddy — 서버 시작 실패",
      `서버를 시작할 수 없습니다.\n\n${err?.message ?? err}\n\n로그 파일: ${SERVER_LOG_PATH}`,
    );
    app.quit();
    return;
  }
  const ready = await waitForServer(serverPort, 8000);
  if (!ready) {
    dialog.showErrorBox(
      "Spiral Buddy — 서버 시작 실패",
      `서버가 localhost:${serverPort}에서 응답하지 않습니다.\n\n로그 파일: ${SERVER_LOG_PATH}`,
    );
    app.quit();
    return;
  }
  serverStarted = true;
  await createMainWindow();
}

// ─── IPC handlers (setup wizard) ─────────────────────────────

ipcMain.handle("setup:get-current-config", () => loadConfig() ?? {});

ipcMain.handle("setup:pick-directory", async (_e, opts) => {
  const result = await dialog.showOpenDialog({
    title: opts?.title ?? "디렉토리 선택",
    properties: ["openDirectory"],
    defaultPath: opts?.defaultPath || app.getPath("home"),
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("setup:validate-and-save", async (_e, cfg) => {
  // 최소 검증
  if (!cfg?.anthropicApiKey?.startsWith("sk-")) {
    return { ok: false, error: "API 키는 'sk-'로 시작해야 합니다." };
  }
  if (!cfg?.vaultPath || !fs.existsSync(cfg.vaultPath)) {
    return { ok: false, error: "Vault 경로가 존재하지 않습니다." };
  }
  if (cfg.roadmapRoot && !fs.existsSync(cfg.roadmapRoot)) {
    return { ok: false, error: "Roadmap 경로가 존재하지 않습니다." };
  }
  saveConfig(cfg);
  // setup → main으로 전환
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.close();
  }
  await bootWithConfig(cfg);
  return { ok: true };
});

ipcMain.handle("app:open-external", (_e, url) => {
  if (typeof url === "string") shell.openExternal(url);
});

// ─── Vault 자동 감지 ─────────────────────────────────────────

ipcMain.handle("setup:detect-vault", async () => {
  const candidates = [
    path.join(os.homedir(), "Documents", "Obsidian Vault"),
    path.join(os.homedir(), "Documents", "Obsidian"),
    path.join(os.homedir(), "Obsidian"),
    path.join(
      os.homedir(),
      "Library",
      "Mobile Documents",
      "iCloud~md~obsidian",
      "Documents",
    ),
    path.join(os.homedir(), "Documents"),
  ];
  // 1단계: 후보 자체가 .obsidian을 가진 vault인지
  for (const cand of candidates) {
    if (fs.existsSync(path.join(cand, ".obsidian"))) {
      return { found: true, path: cand };
    }
  }
  // 2단계: 후보 안 하위 디렉토리 한 단계 탐색
  for (const parent of candidates) {
    if (!fs.existsSync(parent)) continue;
    try {
      const children = fs.readdirSync(parent, { withFileTypes: true });
      for (const c of children) {
        if (!c.isDirectory()) continue;
        if (c.name.startsWith(".")) continue;
        const full = path.join(parent, c.name);
        if (fs.existsSync(path.join(full, ".obsidian"))) {
          return { found: true, path: full };
        }
      }
    } catch {
      /* skip */
    }
  }
  return { found: false };
});

// ─── git 존재 확인 ───────────────────────────────────────────

ipcMain.handle("setup:check-git", () => {
  try {
    const res = spawnSync("git", ["--version"], {
      encoding: "utf-8",
      timeout: 3000,
    });
    if (res.status === 0) {
      return { ok: true, version: (res.stdout || "").trim() };
    }
    return { ok: false, error: "git이 설치되어 있지 않습니다." };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ─── iq-dev-lab 38개 레포 자동 다운로드 ──────────────────────

const CURATED_ORG = "iq-dev-lab";

function fetchOrgRepos(org) {
  return new Promise((resolve, reject) => {
    const results = [];
    const fetchPage = (page) => {
      const req = https.request(
        {
          host: "api.github.com",
          path: `/orgs/${org}/repos?per_page=100&page=${page}&type=public`,
          headers: {
            "User-Agent": "spiral-buddy-setup",
            Accept: "application/vnd.github+json",
          },
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            if (res.statusCode !== 200) {
              return reject(
                new Error(
                  `GitHub API ${res.statusCode}: ${Buffer.concat(chunks).toString().slice(0, 200)}`,
                ),
              );
            }
            const data = JSON.parse(Buffer.concat(chunks).toString());
            results.push(...data);
            if (data.length === 100) fetchPage(page + 1);
            else resolve(results);
          });
        },
      );
      req.on("error", reject);
      req.end();
    };
    fetchPage(1);
  });
}

function shouldSkipRepo(repo) {
  if (repo.archived) return true;
  if (repo.fork) return true;
  if (repo.private) return true;
  if (repo.size === 0) return true;
  if (repo.name.startsWith(".")) return true;
  if (repo.name.endsWith(".github.io")) return true;
  return false;
}

function cloneRepo(parentDir, repo, depth = 1) {
  return new Promise((resolve, reject) => {
    const dest = path.join(parentDir, repo.name);
    if (fs.existsSync(dest)) {
      // 이미 있으면 skip
      return resolve({ name: repo.name, skipped: true });
    }
    const child = spawn(
      "git",
      [
        "clone",
        "--depth",
        String(depth),
        "--quiet",
        repo.clone_url,
        dest,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (b) => (stderr += b.toString()));
    child.on("exit", (code) => {
      if (code === 0) resolve({ name: repo.name, ok: true });
      else
        reject(
          new Error(`${repo.name} clone failed (exit ${code}): ${stderr.slice(0, 200)}`),
        );
    });
    child.on("error", reject);
  });
}

ipcMain.handle("setup:pick-parent-dir", async () => {
  const result = await dialog.showOpenDialog({
    title: "iq-dev-lab을 받을 부모 디렉토리 선택",
    properties: ["openDirectory", "createDirectory"],
    defaultPath: path.join(os.homedir(), "Documents"),
    buttonLabel: "이 폴더에 받기",
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("setup:download-curated", async (event, args) => {
  const send = (channel, payload) => {
    event.sender.send(channel, payload);
  };
  const parentDir = args?.parentDir;
  if (!parentDir || !fs.existsSync(parentDir)) {
    return { ok: false, error: "부모 디렉토리가 존재하지 않습니다." };
  }
  const targetDir = path.join(parentDir, CURATED_ORG);
  fs.mkdirSync(targetDir, { recursive: true });

  send("setup:download-progress", { phase: "fetching", message: "GitHub에서 레포 목록 가져오는 중…" });
  let repos;
  try {
    const all = await fetchOrgRepos(CURATED_ORG);
    repos = all.filter((r) => !shouldSkipRepo(r));
  } catch (err) {
    return { ok: false, error: err.message };
  }
  if (repos.length === 0) {
    return { ok: false, error: "받을 레포가 없습니다." };
  }

  send("setup:download-progress", {
    phase: "cloning",
    total: repos.length,
    done: 0,
    message: `${repos.length}개 레포 클론 시작`,
  });

  // 병렬 4개 + 직렬 큐
  const concurrency = 4;
  let cursor = 0;
  let completed = 0;
  const failed = [];

  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= repos.length) break;
      const repo = repos[idx];
      try {
        await cloneRepo(targetDir, repo);
      } catch (err) {
        failed.push({ name: repo.name, error: err.message });
      }
      completed++;
      send("setup:download-progress", {
        phase: "cloning",
        total: repos.length,
        done: completed,
        current: repo.name,
      });
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  send("setup:download-progress", {
    phase: "done",
    total: repos.length,
    done: completed,
    failed: failed.length,
  });

  return {
    ok: true,
    targetDir,
    count: completed - failed.length,
    failed,
  };
});

// ─── App lifecycle ───────────────────────────────────────────

app.whenReady().then(async () => {
  // macOS 기본 메뉴 유지 (Cmd+Q 등)
  if (process.platform === "darwin") {
    Menu.setApplicationMenu(Menu.getApplicationMenu());
  }

  const cfg = loadConfig();
  if (hasRequiredConfig(cfg)) {
    await bootWithConfig(cfg);
  } else {
    createSetupWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// 서버가 in-process라 별도 종료 처리 불필요 — Electron app exit 시 자연 종료.

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const cfg = loadConfig();
    if (hasRequiredConfig(cfg)) bootWithConfig(cfg);
    else createSetupWindow();
  }
});
