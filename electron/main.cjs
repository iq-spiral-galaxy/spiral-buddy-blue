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

// 추천 디폴트 모델 — Sonnet 4.6 (빠르고 충분히 똑똑함, 비용 효율적)
const DEFAULT_MODEL = "claude-sonnet-4-6";

/**
 * v0.5.28 일회성 마이그레이션: 옛 install에서 Opus가 디폴트로 박혀있던 경우 Sonnet 4.6으로.
 *   사용자가 명시적으로 다른 모델로 바꾼 적이 없을 가능성이 높은 케이스만 손댐:
 *   - cfg.model이 비어있거나 (= 한 번도 안 골랐음)
 *   - 또는 modelDefaultBaseline이 false/없음 + 현재 model이 어떤 opus 변형
 *   modelDefaultBaseline = true 플래그를 세팅해 두 번째 실행부터는 건드리지 않음.
 *   사용자가 settings에서 Opus를 명시적으로 다시 고르면 그 선택은 유지됨 (flag 안 건드림).
 */
function ensureSonnetDefault(cfg) {
  if (cfg.modelDefaultBaseline === true) return cfg;
  const m = (cfg.model ?? "").toString();
  // 한 번도 모델을 명시적으로 안 골랐거나, Opus 계열이 박혀있던 경우 → Sonnet 4.6으로 리셋
  if (!m || /^claude-opus-/i.test(m)) {
    cfg.model = DEFAULT_MODEL;
  }
  cfg.modelDefaultBaseline = true;
  return cfg;
}

// v0.5.52 — 같은 roadmapRoot를 가리키는 워크스페이스 중복 제거.
// 활성 워크스페이스 우선, 같은 path의 나머지는 제거. 데이터 손실 없음 (같은 파일 시스템 path).
function dedupeWorkspaces(cfg) {
  if (!Array.isArray(cfg.workspaces) || cfg.workspaces.length <= 1) return cfg;
  const seen = new Map(); // normalizedPath → keptWorkspace
  const kept = [];
  const activeId = cfg.activeWorkspaceId;
  // active 먼저 처리
  const ordered = [...cfg.workspaces].sort((a, b) =>
    a.id === activeId ? -1 : b.id === activeId ? 1 : 0,
  );
  for (const w of ordered) {
    const key =
      (w.roadmapRoot ?? "").trim() ||
      `__no-root__::${w.id}`;
    if (seen.has(key)) {
      // 중복 — 버림
      continue;
    }
    seen.set(key, w);
    kept.push(w);
  }
  // 원래 순서대로 정렬 (active 강제 이동 취소)
  const idOrder = new Map(cfg.workspaces.map((w, i) => [w.id, i]));
  kept.sort((a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));
  if (kept.length !== cfg.workspaces.length) {
    console.log(
      `[workspaces] 중복 ${cfg.workspaces.length - kept.length}개 제거 (같은 roadmapRoot)`,
    );
    cfg.workspaces = kept;
  }
  return cfg;
}

function migrateConfig(raw) {
  if (!raw) return null;
  // 이미 새 스키마
  if (Array.isArray(raw.workspaces)) return ensureSonnetDefault(dedupeWorkspaces(raw));
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
  return ensureSonnetDefault({
    anthropicApiKey: raw.anthropicApiKey,
    vaultPath: raw.vaultPath,
    vaultName: raw.vaultName,
    model: raw.model,
    maxTokens: raw.maxTokens,
    githubToken: raw.githubToken,
    curatedOrg: raw.curatedOrg ?? "iq-dev-lab",
    activeWorkspaceId: ws.id,
    workspaces: [ws],
  });
}

function loadConfig() {
  // 1순위: userData에 저장된 GUI 설정
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const original = JSON.parse(raw);
    const migrated = migrateConfig(original);
    // 마이그레이션으로 인해 model이 바뀌었거나 baseline 플래그가 추가됐으면 디스크에 반영
    // (다음 실행에선 다시 안 건드리도록)
    if (
      migrated &&
      (migrated.model !== original.model ||
        migrated.modelDefaultBaseline !== original.modelDefaultBaseline ||
        (Array.isArray(migrated.workspaces) &&
          Array.isArray(original.workspaces) &&
          migrated.workspaces.length !== original.workspaces.length))
    ) {
      try {
        saveConfig(migrated);
      } catch {
        /* best-effort */
      }
    }
    return migrated;
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
  // v0.5.72 — 세션 snapshot 저장 위치 (워크스페이스별 분리).
  // 앱 재시작/업데이트 후에도 pause된 세션을 이어갈 수 있게 함.
  process.env.SPIRAL_SESSION_DIR = path.join(
    app.getPath("userData"),
    "sessions",
    ws?.vaultSubDir || "default",
  );

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

  // 세션 진행 중일 때 client의 beforeunload가 preventDefault를 호출하면
  // Electron 기본 동작은 "close를 막되 다이얼로그 없음" → X 버튼이 안 먹히는
  // 것처럼 보이는 UX 버그. will-prevent-unload를 가로채서 native
  // confirm 다이얼로그를 띄우고 사용자 선택에 따라 강제 unload 진행.
  mainWindow.webContents.on("will-prevent-unload", (event) => {
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: "warning",
      buttons: ["취소", "저장 없이 종료"],
      defaultId: 0,
      cancelId: 0,
      title: "Spiral Buddy",
      message: "진행 중인 학습 세션이 있습니다.",
      detail:
        '닫으면 지금까지의 대화가 사라집니다.\n저장하려면 메인 창의 "End & Save"를 먼저 누르세요.',
    });
    if (choice === 1) {
      // preventDefault → beforeunload의 preventDefault를 무시하고 unload 진행
      event.preventDefault();
    }
  });

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

// ─── Auto-update (v0.5.32) ───────────────────────────────────
//
// 가벼운 구현: GitHub Releases latest를 폴링해서 새 버전이 있으면 알림.
// "받기" 누르면 detached bash로 install 스크립트 실행하고 앱 종료.
// 플랫폼별로 다른 자산 사용: darwin-arm64 / darwin-x64 / win32 / linux

const GH_OWNER = "iq-agent-lab";
const GH_REPO = "iq-spiral-buddy";
const APP_VERSION = require("../package.json").version;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            "User-Agent": `spiral-buddy/${require("../package.json").version}`,
            Accept: "application/vnd.github+json",
          },
        },
        (res) => {
          // 리다이렉트 처리 — 응답 종료 안 기다리고 새 URL로
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            res.resume(); // drain
            return fetchJson(res.headers.location).then(resolve, reject);
          }
          let body = "";
          res.on("data", (d) => (body += d));
          res.on("end", () => {
            try {
              const data = JSON.parse(body);
              // GitHub의 rate-limit/오류 응답은 200/403 둘 다 가능 — JSON에 message 있고 tag_name 없음
              if (res.statusCode && res.statusCode >= 400) {
                resolve({
                  _httpError: true,
                  status: res.statusCode,
                  ...data,
                });
              } else {
                resolve(data);
              }
            } catch (e) {
              reject(
                new Error(
                  `Bad JSON from ${url} (HTTP ${res.statusCode}): ${e.message}`,
                ),
              );
            }
          });
          res.on("error", reject);
        },
      )
      .on("error", reject);
  });
}

// 업데이트 결과 캐시 (5분) — repeated 설정 모달 열기로 rate-limit 피해 방지
let _updateCache = null;
const UPDATE_CACHE_TTL = 5 * 60 * 1000;

/** semver-ish 비교: "0.5.32" > "0.5.31" → 1 */
function cmpVersion(a, b) {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const av = pa[i] ?? 0;
    const bv = pb[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

ipcMain.handle("app:check-update", async (_e, { force } = {}) => {
  const releasesPageUrl = `https://github.com/${GH_OWNER}/${GH_REPO}/releases/latest`;
  // 캐시 — 5분 안 지났으면 그대로 반환 (단, force=true면 무시)
  if (
    !force &&
    _updateCache &&
    Date.now() - _updateCache.at < UPDATE_CACHE_TTL
  ) {
    return { ...(_updateCache.data ?? {}), cached: true };
  }
  try {
    const data = await fetchJson(
      `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/releases/latest`,
    );
    // rate-limit / 4xx 응답 — message 같이 보여줌
    if (data?._httpError) {
      const result = {
        current: APP_VERSION,
        latest: null,
        updateAvailable: false,
        error:
          data?.message ?? `GitHub API HTTP ${data.status}`,
        httpStatus: data.status,
        releasesPageUrl,
      };
      _updateCache = { at: Date.now(), data: result };
      return result;
    }
    const tag = (data?.tag_name ?? "").replace(/^v/, "");
    if (!tag) {
      const result = {
        current: APP_VERSION,
        latest: null,
        updateAvailable: false,
        error: "버전 정보를 받지 못했습니다 (응답에 tag_name 없음).",
        releasesPageUrl,
      };
      _updateCache = { at: Date.now(), data: result };
      return result;
    }
    const updateAvailable = cmpVersion(tag, APP_VERSION) > 0;
    const result = {
      current: APP_VERSION,
      latest: tag,
      updateAvailable,
      releaseUrl: data?.html_url ?? null,
      publishedAt: data?.published_at ?? null,
      releasesPageUrl,
    };
    _updateCache = { at: Date.now(), data: result };
    return result;
  } catch (err) {
    const result = {
      current: APP_VERSION,
      latest: null,
      updateAvailable: false,
      error: err instanceof Error ? err.message : String(err),
      releasesPageUrl,
    };
    // 에러도 짧게 캐시 (1분) — 네트워크 죽었을 때 폭주 방지
    _updateCache = { at: Date.now() - (UPDATE_CACHE_TTL - 60 * 1000), data: result };
    return result;
  }
});

/** 플랫폼별 install 스크립트 생성. macOS + Windows 자동 install 지원. */
function buildInstallScript(version, logPath) {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === "darwin") {
    const dmgName =
      arch === "arm64"
        ? `Spiral.Buddy-${version}-arm64.dmg`
        : `Spiral.Buddy-${version}.dmg`;
    const url = `https://github.com/${GH_OWNER}/${GH_REPO}/releases/download/v${version}/${dmgName}`;
    // 모든 출력을 logPath로 — 디버깅 가능.
    // set -e는 사용 X (한 단계 실패해도 다음 시도하고 마지막에 open). 단계마다 echo로 진행 로깅.
    return `#!/bin/bash
exec > "${logPath}" 2>&1
echo "=== Spiral Buddy update start (v${version}) ==="
date

echo "-- step 1: quitting current app"
osascript -e 'tell application "Spiral Buddy" to quit' 2>/dev/null || true
sleep 2.5

echo "-- step 2: downloading dmg from ${url}"
cd /tmp || exit 1
if ! curl -fL --retry 3 -o /tmp/spiral.dmg "${url}"; then
  echo "ERROR: download failed"
  exit 1
fi

echo "-- step 3: mounting dmg"
if ! hdiutil attach -nobrowse -quiet /tmp/spiral.dmg; then
  echo "ERROR: mount failed"
  exit 1
fi

echo "-- step 4: replacing app in /Applications"
rm -rf '/Applications/Spiral Buddy.app'
if ! cp -R "/Volumes/Spiral Buddy ${version}/Spiral Buddy.app" /Applications/; then
  echo "ERROR: copy failed — /Applications 권한이 부족할 수 있음"
  hdiutil detach -quiet "/Volumes/Spiral Buddy ${version}" 2>/dev/null || true
  exit 1
fi

echo "-- step 5: unmount + cleanup"
hdiutil detach -quiet "/Volumes/Spiral Buddy ${version}" 2>/dev/null || true
xattr -cr '/Applications/Spiral Buddy.app' 2>/dev/null || true
rm -f /tmp/spiral.dmg

echo "-- step 6: opening updated app"
open '/Applications/Spiral Buddy.app'
echo "=== done ==="
`;
  }
  return null;
}

// ─── v0.5.74 — 업데이트 실패 가시화 ──────────────────────────
//
// 업데이트 스크립트는 detached로 돌아서 실패해도 사용자가 알 수 없었음
// (앱이 구버전으로 다시 열리는 것만 보임). install 시작 시 marker 파일에
// 목표 버전을 기록해두고, 다음 부팅 때 현재 버전과 비교:
//   현재 >= 목표 → 업데이트 성공 → marker 조용히 삭제
//   현재 <  목표 → 업데이트 실패 → 다이얼로그 (Releases 열기 / 로그 보기)
//
// 로그도 os.tmpdir()(찾기 어려움) 대신 userData/last-update.log 고정 위치로.

function pendingUpdateMarkerPath() {
  return path.join(app.getPath("userData"), "pending-update.json");
}

function writePendingUpdateMarker(info) {
  try {
    fs.writeFileSync(pendingUpdateMarkerPath(), JSON.stringify(info), "utf8");
  } catch {
    // marker 못 써도 업데이트 자체는 진행
  }
}

function checkPendingUpdateOutcome() {
  const markerPath = pendingUpdateMarkerPath();
  let marker = null;
  try {
    marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  } catch {
    return; // marker 없음 — 직전에 업데이트 시도 안 함
  }
  // one-shot — 판정과 무관하게 제거 (실패 다이얼로그가 매 부팅 반복되지 않게)
  try {
    fs.unlinkSync(markerPath);
  } catch {}
  if (!marker?.targetVersion) return;
  if (cmpVersion(APP_VERSION, marker.targetVersion) >= 0) {
    return; // 성공 — 조용히
  }
  const hasLog = marker.logPath && fs.existsSync(marker.logPath);
  const buttons = hasLog
    ? ["Releases 페이지 열기", "로그 보기", "닫기"]
    : ["Releases 페이지 열기", "닫기"];
  const choice = dialog.showMessageBoxSync({
    type: "warning",
    title: "업데이트 실패",
    message: `v${marker.targetVersion} 업데이트가 완료되지 않았어요`,
    detail:
      `현재 버전: v${APP_VERSION}\n\n` +
      `다운로드나 설치 과정에서 문제가 있었던 것 같아요. ` +
      `Releases 페이지에서 직접 설치하면 해결됩니다.`,
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1,
  });
  if (choice === 0) {
    shell.openExternal(
      `https://github.com/${GH_OWNER}/${GH_REPO}/releases/latest`,
    );
  } else if (hasLog && choice === 1) {
    shell.showItemInFolder(marker.logPath);
  }
}

/**
 * v0.5.75 — 바이너리 다운로드 (redirect 추적 + 진행 콜백 + 30s inactivity).
 * GitHub release asset은 S3로 302 redirect되므로 follow 필수.
 */
function downloadFile(url, dest, onProgress, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { "User-Agent": `spiral-buddy/${APP_VERSION}` } },
      (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          if (redirectsLeft <= 0) {
            return reject(new Error("redirect 한도 초과"));
          }
          return downloadFile(
            res.headers.location,
            dest,
            onProgress,
            redirectsLeft - 1,
          ).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const total = Number(res.headers["content-length"] ?? 0);
        let received = 0;
        const out = fs.createWriteStream(dest);
        res.on("data", (chunk) => {
          received += chunk.length;
          if (onProgress) onProgress(received, total);
        });
        res.pipe(out);
        out.on("finish", () => out.close(() => resolve(undefined)));
        out.on("error", (e) => {
          res.destroy();
          reject(e);
        });
        res.on("error", (e) => {
          out.destroy();
          reject(e);
        });
      },
    );
    req.on("error", reject);
    // socket 30초 무활동 시 중단 (다운로드 hang 방지)
    req.setTimeout(30_000, () => {
      req.destroy(new Error("연결이 30초간 멈춰 중단했어요"));
    });
  });
}

ipcMain.handle("app:install-update", async (_e, { version }) => {
  if (!version) return { ok: false, reason: "no version" };
  // v0.5.74 — 로그를 고정 위치에 (tmpdir은 사용자가 못 찾음)
  const logPath = path.join(app.getPath("userData"), "last-update.log");

  // ── Windows (v0.5.75) — PowerShell 스크립트 방식 폐기, 직접 방식으로.
  //
  // 기존: detached PowerShell이 다운로드+설치 → 어떤 단계가 실패해도
  // (TLS, 정책, AV, 프록시...) 앱은 이미 꺼졌고 사용자는 아무것도 못 봄.
  // v0.5.71 TLS fix 후에도 "받기 누르면 그냥 꺼지고 업데이트 안 됨" 보고.
  //
  // 새 구조:
  //   1. 다운로드를 Electron 앱 안에서 Node https로 수행
  //      — 앱이 떠 있는 동안 진행률 표시, 실패 시 앱 유지 + 에러 표시
  //      — 업데이트 체크와 같은 네트워크 스택이라 체크가 되면 다운로드도 됨
  //   2. 받은 NSIS installer를 직접 실행: /S --force-run
  //      — --force-run은 electron-builder NSIS의 공식 옵션 (설치 후 자동 실행)
  //      — Node https 다운로드는 mark-of-the-web이 안 붙어 SmartScreen 차단 없음
  //   3. 그 후에만 앱 종료. 설치 실패는 v0.5.74 marker가 다음 부팅 때 감지.
  if (process.platform === "win32") {
    const exeName = `Spiral.Buddy.Setup.${version}.exe`;
    const url = `https://github.com/${GH_OWNER}/${GH_REPO}/releases/download/v${version}/${exeName}`;
    const dest = path.join(os.tmpdir(), `spiral-buddy-setup-${version}.exe`);
    const log = (msg) => {
      try {
        fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`);
      } catch {}
    };
    try {
      fs.writeFileSync(logPath, "", "utf8");
    } catch {}
    log(`win32 direct update v${APP_VERSION} → v${version}`);
    log(`download: ${url}`);

    let lastPctSent = -1;
    try {
      await downloadFile(url, dest, (received, total) => {
        const pct = total > 0 ? Math.round((received / total) * 100) : null;
        // IPC 폭주 방지 — 1% 단위로만 전송
        if (pct !== null && pct !== lastPctSent) {
          lastPctSent = pct;
          for (const w of BrowserWindow.getAllWindows()) {
            if (!w.isDestroyed()) {
              w.webContents.send("update:progress", { received, total, pct });
            }
          }
        }
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`download FAILED: ${msg}`);
      try {
        fs.unlinkSync(dest);
      } catch {}
      return { ok: false, reason: `다운로드 실패: ${msg}` };
    }

    let size = 0;
    try {
      size = fs.statSync(dest).size;
    } catch {}
    log(`downloaded ${size} bytes`);
    // installer는 정상적으로 수십 MB — 너무 작으면 에러 페이지/잘린 파일
    if (size < 10 * 1024 * 1024) {
      log("size too small — aborting");
      try {
        fs.unlinkSync(dest);
      } catch {}
      return {
        ok: false,
        reason: "다운로드된 파일이 비정상적으로 작아요 — 잠시 후 다시 시도해주세요",
      };
    }

    // 여기서부터는 앱이 꺼지므로 marker로 다음 부팅 때 성공/실패 판정 (v0.5.74)
    writePendingUpdateMarker({
      targetVersion: version,
      fromVersion: APP_VERSION,
      logPath,
      at: Date.now(),
    });
    log("spawning installer: /S --force-run");
    try {
      const child = spawn(dest, ["/S", "--force-run"], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`spawn FAILED: ${msg}`);
      try {
        fs.unlinkSync(pendingUpdateMarkerPath());
      } catch {}
      return { ok: false, reason: `설치 실행 실패: ${msg}` };
    }
    setTimeout(() => app.quit(), 800);
    return { ok: true, mode: "windows-direct", logPath };
  }

  // ── macOS / 기타 — 기존 스크립트 방식 유지 (안정 동작 확인됨)
  const script = buildInstallScript(version, logPath);
  if (!script) {
    shell.openExternal(
      `https://github.com/${GH_OWNER}/${GH_REPO}/releases/latest`,
    );
    return { ok: true, mode: "browser" };
  }
  // v0.5.74 — 다음 부팅에서 성공/실패 판정할 marker
  writePendingUpdateMarker({
    targetVersion: version,
    fromVersion: APP_VERSION,
    logPath,
    at: Date.now(),
  });
  try {
    // macOS
    const tmpPath = path.join(
      os.tmpdir(),
      `spiral-buddy-update-${Date.now()}.sh`,
    );
    fs.writeFileSync(tmpPath, script, { mode: 0o755 });
    // log 파일 미리 만들어 두기
    fs.writeFileSync(logPath, "", "utf8");
    const proc = spawn("/bin/bash", [tmpPath], {
      detached: true,
      stdio: "ignore",
    });
    proc.unref();
    setTimeout(() => app.quit(), 500);
    return { ok: true, mode: "macos-installer", logPath };
  } catch (err) {
    // 스크립트 spawn 자체가 실패 — 렌더러가 즉시 에러를 보여주므로
    // marker를 남기면 다음 부팅 때 중복 실패 알림이 뜸. 정리.
    try {
      fs.unlinkSync(pendingUpdateMarkerPath());
    } catch {}
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
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

/**
 * 초기 setup wizard를 다시 띄움. 사용자가 처음 설치 시 iq-dev-lab 받기를
 * 깜박했거나 다른 옵션을 다시 시도하고 싶을 때.
 * 메인 윈도우는 그대로 두고 setup window만 별도 모달처럼 띄움.
 */
ipcMain.handle("settings:open-setup-wizard", () => {
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.focus();
    return { ok: true };
  }
  createSetupWindow();
  return { ok: true };
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

  // v0.5.54 — 같은 이름의 워크스페이스가 이미 있으면 차단.
  // 표시 이름이 displayWorkspaceName으로 정규화되니 그것 기준으로 비교.
  const nameKey = name.trim().toLowerCase();
  const dupByName = cfg.workspaces.find(
    (w) => (w.name ?? "").trim().toLowerCase() === nameKey,
  );
  if (dupByName) {
    return {
      ok: false,
      error: `이미 같은 이름의 워크스페이스가 있습니다: "${dupByName.name}". 다른 이름을 사용하세요.`,
      duplicateId: dupByName.id,
    };
  }

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

  // v0.5.52 — 같은 roadmapRoot를 가리키는 워크스페이스가 이미 있으면 그걸 활성화하고 반환.
  // 중복 생성 차단.
  const existing = cfg.workspaces.find(
    (w) =>
      (w.roadmapRoot ?? "").trim().toLowerCase() ===
      (roadmapRoot ?? "").trim().toLowerCase(),
  );
  if (existing) {
    cfg.activeWorkspaceId = existing.id;
    saveConfig(cfg);
    send("settings:workspace-progress", {
      phase: "done",
      id: existing.id,
      name: existing.name,
      reused: true,
    });
    return { ok: true, workspace: existing, reused: true };
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

function shouldSkipRepo(repo, opts = {}) {
  // 명시 요청(JSON 정의에 들어있는) 레포는 fork여도 받기 — object 같은
  // 학습 자료 fork를 silent skip하면 카운트가 한 개 적게 들어옴.
  // v0.5.52 — `allowFork` true면 fork 통과.
  if (repo.archived) return true;
  if (!opts.allowFork && repo.fork) return true;
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

// v0.5.45 — 도메인 hierarchy 정보 제공
const DOMAINS_DATA_FILE = path.resolve(
  APP_ROOT,
  "data",
  "curated-domains.json",
);

function loadDomainsData() {
  try {
    return JSON.parse(fs.readFileSync(DOMAINS_DATA_FILE, "utf8"));
  } catch {
    return {};
  }
}

ipcMain.handle("curated:get-domains", (_e, args) => {
  const org = args?.org || CURATED_ORG;
  const all = loadDomainsData();
  return { org, ...(all[org] ?? {}) };
});

ipcMain.handle("curated:get-installed", (_e, args) => {
  const org = args?.org || CURATED_ORG;
  const parentDir = args?.parentDir;
  if (!parentDir) return { installed: [] };
  const target = path.join(parentDir, org);
  if (!fs.existsSync(target)) return { installed: [], targetDir: target };
  try {
    const installed = fs
      .readdirSync(target)
      .filter((n) => {
        try {
          const stat = fs.statSync(path.join(target, n));
          return stat.isDirectory() && !n.startsWith(".");
        } catch {
          return false;
        }
      });
    return { installed, targetDir: target };
  } catch {
    return { installed: [], targetDir: target };
  }
});

// 공유 helper — 주어진 repo 목록을 병렬 clone (이미 있는 건 skip)
async function _downloadReposByName(send, targetDir, requestedRepoNames) {
  send("curated:install-progress", {
    phase: "fetching",
    message: "GitHub에서 레포 목록 가져오는 중…",
  });
  // v0.5.52 — 명시 요청이 있으면 그 레포 이름들은 fork 여도 받을 수 있게.
  // 미명시(전체 받기)면 기존 정책(fork skip) 유지.
  const wantSet = new Set(requestedRepoNames ?? []);
  const wantList = wantSet.size > 0;
  let allRepos;
  try {
    allRepos = (await fetchOrgRepos(CURATED_ORG)).filter((r) =>
      wantList
        ? !shouldSkipRepo(r, { allowFork: wantSet.has(r.name) })
        : !shouldSkipRepo(r),
    );
  } catch (err) {
    return { ok: false, error: err.message };
  }
  const repos = wantList
    ? allRepos.filter((r) => wantSet.has(r.name))
    : allRepos;
  // v0.5.52 — 요청했는데 GitHub에 매칭 없는 레포는 표시 (fork 외 다른 이유로 빠진 케이스)
  if (requestedRepoNames && requestedRepoNames.length > 0) {
    const fetchedNames = new Set(repos.map((r) => r.name));
    const missing = requestedRepoNames.filter((n) => !fetchedNames.has(n));
    if (missing.length > 0) {
      console.warn(
        `[curated:install] 요청 ${requestedRepoNames.length}개 중 GitHub fetch 결과에 ${missing.length}개 매칭 없음 — silent skip:`,
        missing,
      );
    }
  }
  if (repos.length === 0) {
    return { ok: false, error: "받을 레포가 없습니다." };
  }

  send("curated:install-progress", {
    phase: "cloning",
    total: repos.length,
    done: 0,
    message: `${repos.length}개 레포 시도 시작 (이미 있는 건 skip)`,
  });

  const concurrency = 4;
  let cursor = 0;
  let completed = 0;
  let skipped = 0;
  const failed = [];

  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= repos.length) break;
      const repo = repos[idx];
      try {
        const result = await cloneRepo(targetDir, repo);
        if (result?.skipped) skipped++;
      } catch (err) {
        failed.push({ name: repo.name, error: err.message });
      }
      completed++;
      send("curated:install-progress", {
        phase: "cloning",
        total: repos.length,
        done: completed,
        current: repo.name,
        skipped,
        failedCount: failed.length,
      });
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  send("curated:install-progress", {
    phase: "done",
    total: repos.length,
    done: completed,
    skipped,
    failed: failed.length,
  });
  return {
    ok: true,
    targetDir,
    requested: repos.length,
    newlyInstalled: completed - skipped - failed.length,
    skipped,
    failed,
  };
}

ipcMain.handle("curated:install", async (event, args) => {
  const send = (channel, payload) => event.sender.send(channel, payload);
  const parentDir = args?.parentDir;
  const repoNames = Array.isArray(args?.repoNames) ? args.repoNames : null;
  if (!parentDir || !fs.existsSync(parentDir)) {
    return { ok: false, error: "부모 디렉토리가 존재하지 않습니다." };
  }
  const targetDir = path.join(parentDir, CURATED_ORG);
  fs.mkdirSync(targetDir, { recursive: true });
  return _downloadReposByName(send, targetDir, repoNames);
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

  // v0.5.74 — 직전 업데이트 시도의 성공/실패 판정.
  // 실패 시 다이얼로그로 알리고 수동 설치 경로 안내 (기존엔 조용히 실패).
  checkPendingUpdateOutcome();

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
