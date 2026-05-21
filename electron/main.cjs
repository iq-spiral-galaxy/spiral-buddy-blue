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

function displayWorkspaceName(nameOrPath) {
  const raw = String(nameOrPath ?? "").trim();
  const base = raw ? path.basename(raw) : "";
  const normalized = (base || raw).toLowerCase().replace(/[\s_-]+/g, "-");
  if (normalized === "iq-dev-lab") return "IQ Dev Lab";
  return raw;
}

// Config 스키마 (multi-workspace):
//   {
//     anthropicApiKey, vaultPath, vaultName, model, maxTokens, githubToken, curatedOrg,  // 전역
//     activeWorkspaceId,
//     workspaces: [{ id, name, roadmapRoot, vaultSubDir, source, sourceUrl?, categoriesOrg? }]
//   }
//
// 옛 스키마 (single):
//   { anthropicApiKey, vaultPath, roadmapRoot, ... }  → workspaces[0]으로 자동 마이그레이션.

function migrateConfig(raw) {
  if (!raw) return null;
  // 이미 새 스키마
  if (Array.isArray(raw.workspaces)) return raw;
  // 옛 스키마 → workspaces 배열로 변환
  const ws = {
    id: "default",
    name: raw.roadmapRoot
      ? displayWorkspaceName(raw.roadmapRoot)
      : "기본 워크스페이스",
    roadmapRoot: raw.roadmapRoot ?? null,
    vaultSubDir: "spiral-buddy",
    source: "legacy",
    categoriesOrg: raw.curatedOrg ?? "iq-dev-lab",
  };
  return {
    anthropicApiKey: raw.anthropicApiKey,
    vaultPath: raw.vaultPath,
    vaultName: raw.vaultName,
    model: raw.model,
    maxTokens: raw.maxTokens,
    githubToken: raw.githubToken,
    curatedOrg: raw.curatedOrg ?? "iq-dev-lab",
    activeWorkspaceId: ws.id,
    workspaces: [ws],
  };
}

function loadConfig() {
  // 1순위: userData에 저장된 GUI 설정
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    return migrateConfig(JSON.parse(raw));
  } catch {
    /* fallthrough */
  }
  // 2순위: APP_ROOT/.env (dev 환경)
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
        return migrateConfig({
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
        });
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

function activeWorkspace(cfg) {
  if (!cfg?.workspaces?.length) return null;
  return (
    cfg.workspaces.find((w) => w.id === cfg.activeWorkspaceId) ??
    cfg.workspaces[0]
  );
}

function hasRequiredConfig(cfg) {
  return Boolean(
    cfg &&
      typeof cfg.anthropicApiKey === "string" &&
      cfg.anthropicApiKey.length > 0 &&
      typeof cfg.vaultPath === "string" &&
      cfg.vaultPath.length > 0 &&
      activeWorkspace(cfg),
  );
}

function uniqueId(base, taken) {
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "ws";
  if (!taken.has(slug)) return slug;
  for (let i = 2; i < 999; i++) {
    const candidate = `${slug}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${slug}-${Date.now()}`;
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
  const ws = activeWorkspace(cfg);
  // process.env에 active workspace 기반으로 주입
  process.env.ANTHROPIC_API_KEY = cfg.anthropicApiKey;
  process.env.SPIRAL_VAULT_PATH = cfg.vaultPath;
  process.env.PORT = String(port);
  process.env.NO_OPEN = "1";
  if (ws?.roadmapRoot) process.env.SPIRAL_ROADMAP_ROOT = ws.roadmapRoot;
  if (ws?.vaultSubDir) process.env.SPIRAL_VAULT_SUBDIR = ws.vaultSubDir;
  // categoriesOrg가 있으면 curated org를 그걸로 (iq-dev-lab 매핑용)
  const curatedOrg = ws?.categoriesOrg ?? cfg.curatedOrg;
  if (curatedOrg) process.env.SPIRAL_CURATED_ORG = curatedOrg;
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
    backgroundColor: "#090c12",
    icon: path.join(__dirname, "build", "icon.png"),
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
    backgroundColor: "#090c12",
    icon: path.join(__dirname, "build", "icon.png"),
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

ipcMain.handle("setup:validate-and-save", async (_e, input) => {
  // 최소 검증
  if (!input?.anthropicApiKey?.startsWith("sk-")) {
    return { ok: false, error: "API 키는 'sk-'로 시작해야 합니다." };
  }
  if (!input?.vaultPath || !fs.existsSync(input.vaultPath)) {
    return { ok: false, error: "Vault 경로가 존재하지 않습니다." };
  }
  if (input.roadmapRoot && !fs.existsSync(input.roadmapRoot)) {
    return { ok: false, error: "Roadmap 경로가 존재하지 않습니다." };
  }

  // 새 스키마로 저장. 첫 워크스페이스 = "기본" (또는 디렉토리 이름)
  const wsName = input.roadmapRoot
    ? displayWorkspaceName(input.roadmapRoot)
    : "기본 워크스페이스";
  const cfg = {
    anthropicApiKey: input.anthropicApiKey,
    vaultPath: input.vaultPath,
    vaultName: input.vaultName ?? null,
    model: input.model ?? null,
    maxTokens: input.maxTokens ?? null,
    githubToken: input.githubToken ?? null,
    curatedOrg: "iq-dev-lab",
    activeWorkspaceId: "default",
    workspaces: [
      {
        id: "default",
        name: wsName,
        roadmapRoot: input.roadmapRoot ?? null,
        vaultSubDir: "spiral-buddy",
        source: input.source ?? "setup",
        categoriesOrg: "iq-dev-lab",
      },
    ],
  };
  saveConfig(cfg);
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

// ─── Settings (메인 앱에서 설정/워크스페이스 관리) ─────────────

ipcMain.handle("settings:get", () => {
  const cfg = loadConfig();
  if (!cfg) return null;
  // API 키는 마스킹해서 반환 (UI 표시용). 수정 시 별도 IPC 사용.
  return {
    apiKeyMasked: cfg.anthropicApiKey
      ? cfg.anthropicApiKey.slice(0, 7) + "..." + cfg.anthropicApiKey.slice(-4)
      : null,
    vaultPath: cfg.vaultPath,
    vaultName: cfg.vaultName,
    model: cfg.model,
    activeWorkspaceId: cfg.activeWorkspaceId,
    workspaces: cfg.workspaces ?? [],
    githubToken: cfg.githubToken ? "(set)" : null,
  };
});

ipcMain.handle("settings:update-api-key", (_e, { apiKey }) => {
  if (!apiKey?.startsWith("sk-")) {
    return { ok: false, error: "API 키는 'sk-'로 시작해야 합니다." };
  }
  const cfg = loadConfig();
  if (!cfg) return { ok: false, error: "config not found" };
  cfg.anthropicApiKey = apiKey;
  saveConfig(cfg);
  return { ok: true };
});

ipcMain.handle("settings:update-vault", (_e, { vaultPath }) => {
  if (!vaultPath || !fs.existsSync(vaultPath)) {
    return { ok: false, error: "Vault 경로가 존재하지 않습니다." };
  }
  const cfg = loadConfig();
  if (!cfg) return { ok: false, error: "config not found" };
  cfg.vaultPath = vaultPath;
  cfg.vaultName = path.basename(vaultPath);
  saveConfig(cfg);
  return { ok: true, restartNeeded: true };
});

ipcMain.handle("settings:update-model", (_e, { model }) => {
  const cfg = loadConfig();
  if (!cfg) return { ok: false, error: "config not found" };
  cfg.model = model || null;
  saveConfig(cfg);
  return { ok: true };
});

ipcMain.handle("settings:switch-workspace", (_e, { id }) => {
  const cfg = loadConfig();
  if (!cfg) return { ok: false, error: "config not found" };
  if (!cfg.workspaces.find((w) => w.id === id)) {
    return { ok: false, error: "workspace 없음" };
  }
  cfg.activeWorkspaceId = id;
  saveConfig(cfg);
  // 워크스페이스 전환은 앱 재시작 (server in-process라 깔끔)
  setTimeout(() => {
    app.relaunch();
    app.exit(0);
  }, 100);
  return { ok: true };
});

ipcMain.handle("settings:remove-workspace", async (_e, args) => {
  const { id, deleteRoadmapDir, deleteNotes } = args ?? {};
  const cfg = loadConfig();
  if (!cfg) return { ok: false, error: "config not found" };
  if (cfg.workspaces.length <= 1) {
    return { ok: false, error: "마지막 워크스페이스는 삭제할 수 없습니다." };
  }
  const ws = cfg.workspaces.find((w) => w.id === id);
  if (!ws) return { ok: false, error: "워크스페이스를 찾을 수 없습니다." };

  const deletedPaths = [];
  const errors = [];

  // 1) 학습 자료 디렉토리 영구 삭제 (옵션)
  //    안전: 이 워크스페이스가 source: "git-clone" 또는 spiral이 만든 위치일 때만 권장.
  //    그래도 fs.rm은 사용자 명시적 동의로만 실행.
  if (deleteRoadmapDir && ws.roadmapRoot && fs.existsSync(ws.roadmapRoot)) {
    try {
      fs.rmSync(ws.roadmapRoot, { recursive: true, force: true });
      deletedPaths.push(`roadmap dir: ${ws.roadmapRoot}`);
    } catch (err) {
      errors.push(`자료 폴더 삭제 실패: ${err.message}`);
    }
  }

  // 2) vault 안 노트 폴더 .trash로 이동 (옵션)
  if (deleteNotes && cfg.vaultPath && ws.vaultSubDir) {
    const notesDir = path.join(cfg.vaultPath, ws.vaultSubDir);
    if (fs.existsSync(notesDir)) {
      try {
        const trashRoot = path.join(cfg.vaultPath, ws.vaultSubDir, ".trash-removed");
        // 그냥 trash 폴더 통째로 backup. 위 vaultSubDir 자체가 삭제 대상이라
        // sibling으로 이동시킴.
        const ts = new Date()
          .toISOString()
          .replace(/[:T]/g, "-")
          .replace(/\..+$/, "");
        const movedTo = path.join(
          cfg.vaultPath,
          `${ws.vaultSubDir}-removed-${ts}`,
        );
        fs.renameSync(notesDir, movedTo);
        deletedPaths.push(`notes (vault에서 이동): ${movedTo}`);
      } catch (err) {
        errors.push(`노트 이동 실패: ${err.message}`);
      }
    }
  }

  // 3) config에서 entry 제거
  cfg.workspaces = cfg.workspaces.filter((w) => w.id !== id);
  const wasActive = cfg.activeWorkspaceId === id;
  if (wasActive) cfg.activeWorkspaceId = cfg.workspaces[0].id;
  saveConfig(cfg);

  if (wasActive) {
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 100);
    return { ok: true, restartNeeded: true, deletedPaths, errors };
  }
  return { ok: true, deletedPaths, errors };
});

// Git URL 클론 또는 기존 디렉토리 지정으로 새 워크스페이스 추가
ipcMain.handle("settings:add-workspace", async (event, args) => {
  const cfg = loadConfig();
  if (!cfg) return { ok: false, error: "config not found" };
  const send = (channel, payload) => event.sender.send(channel, payload);

  const name = (args?.name ?? "").trim() || "새 워크스페이스";
  const sourceKind = args?.sourceKind; // "git" | "dir"
  const takenIds = new Set(cfg.workspaces.map((w) => w.id));
  const id = uniqueId(name, takenIds);
  // 기본 vault sub-dir: spiral-buddy-<id> (default와 안 겹치게)
  const vaultSubDir = id === "default" ? "spiral-buddy" : `spiral-buddy-${id}`;

  let roadmapRoot;
  if (sourceKind === "dir") {
    if (!args.localPath || !fs.existsSync(args.localPath)) {
      return { ok: false, error: "디렉토리가 존재하지 않습니다." };
    }
    roadmapRoot = args.localPath;
  } else if (sourceKind === "git") {
    if (!args.gitUrl?.startsWith("http")) {
      return { ok: false, error: "git URL이 잘못되었습니다." };
    }
    // 기본 클론 위치: <vaultPath>/../iq-spiral-buddy-data/<id>/<repoName>
    // 또는 사용자가 parentDir 지정 가능
    const parentDir =
      args.parentDir ||
      path.join(path.dirname(cfg.vaultPath), "iq-spiral-buddy-data", id);
    fs.mkdirSync(parentDir, { recursive: true });
    // repo 이름 추출
    const m = args.gitUrl.match(/\/([^/]+?)(?:\.git)?$/);
    const repoName = m?.[1] ?? id;
    const dest = path.join(parentDir, repoName);

    // 폴더 이미 있고 비어있지 않으면 git clone 안 하고 그대로 사용.
    // (이전에 받은 거라 가정. 다시 받고 싶으면 워크스페이스 삭제 시
    //  "학습 자료 디렉토리도 영구 삭제" 체크 후 다시 추가하면 됨.)
    let reusedExisting = false;
    if (fs.existsSync(dest)) {
      const entries = fs.readdirSync(dest).filter((n) => n !== ".DS_Store");
      if (entries.length > 0) {
        reusedExisting = true;
        send("settings:workspace-progress", {
          phase: "reusing",
          message: `기존 폴더 사용 (재클론 없이): ${dest}`,
        });
      }
    }
    if (!reusedExisting) {
      send("settings:workspace-progress", {
        phase: "cloning",
        message: `${args.gitUrl} → ${dest}`,
      });
      try {
        await new Promise((resolve, reject) => {
          const child = spawn(
            "git",
            ["clone", "--depth", "1", "--quiet", args.gitUrl, dest],
            { stdio: ["ignore", "ignore", "pipe"] },
          );
          let stderr = "";
          child.stderr.on("data", (b) => (stderr += b.toString()));
          child.on("exit", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`git clone failed: ${stderr.slice(0, 200)}`));
          });
          child.on("error", reject);
        });
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
    roadmapRoot = dest;
  } else {
    return { ok: false, error: "sourceKind는 'git' 또는 'dir'이어야 합니다." };
  }

  const ws = {
    id,
    name,
    roadmapRoot,
    vaultSubDir,
    source: sourceKind === "git" ? "git-clone" : "manual-dir",
    sourceUrl: args.gitUrl ?? null,
    // iq-dev-lab 카테고리는 자동 적용. 다른 레포면 카테고리 없음.
    categoriesOrg:
      args.gitUrl?.includes("iq-dev-lab") || roadmapRoot.includes("iq-dev-lab")
        ? "iq-dev-lab"
        : null,
  };
  cfg.workspaces.push(ws);
  saveConfig(cfg);
  send("settings:workspace-progress", { phase: "done", id, name });
  return { ok: true, workspace: ws };
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
