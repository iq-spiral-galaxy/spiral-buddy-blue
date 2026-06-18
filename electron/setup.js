// Setup wizard 클라이언트. window.spiralSetup IPC만 사용 (preload).

const $ = (id) => document.getElementById(id);
const vaultPath = $("vault-path");
const roadmapRoot = $("roadmap-root");
const errorMsg = $("error-msg");
const saveBtn = $("save-btn");
const apiKeyInput = $("api-key");

const vaultDetected = $("vault-detected");
const downloadProgress = $("download-progress");
const progressBarWrap = $("progress-bar-wrap");
const progressFill = $("progress-fill");
const presetsContainer = $("setup-presets");

let downloading = false;
let downloadDone = false;

// ─── 인증 모드 선택 ────────────────────────────────────────────

function getAuthMode() {
  return document.querySelector('input[name="auth-mode"]:checked')?.value ?? "oauth";
}

function updateAuthUI(mode) {
  const oauthBlock = $("oauth-status-block");
  const apikeyBlock = $("apikey-block");
  if (mode === "apikey") {
    oauthBlock?.classList.add("hidden");
    apikeyBlock?.classList.remove("hidden");
  } else {
    oauthBlock?.classList.remove("hidden");
    apikeyBlock?.classList.add("hidden");
  }
}

async function refreshOAuthStatus() {
  const statusEl = $("oauth-status-text");
  if (!statusEl) return;
  try {
    // preload에서 직접 IPC 호출 — spiralSetup에 getAuthStatus 추가 필요.
    // 없으면 폴백: fetch /api/auth-status (서버가 아직 안 뜬 시점이라 실패할 수 있음)
    let info = null;
    if (window.spiralSetup?.getAuthStatus) {
      info = await window.spiralSetup.getAuthStatus();
    }
    if (!info) {
      statusEl.innerHTML = `<span style="color:var(--text-muted)">상태 확인 불가 (서버 준비 전)</span>`;
      return;
    }
    if (!info.loggedIn) {
      statusEl.innerHTML = `⚠️ <strong>로그인 필요</strong> — 터미널에서 <code>claude /login</code> 실행 후 재시작`;
      return;
    }
    if (info.expired) {
      statusEl.innerHTML = `⚠️ <strong>토큰 만료</strong> — 터미널에서 <code>claude /login</code>으로 재인증`;
      return;
    }
    const tier = info.subscriptionType
      ? info.subscriptionType.charAt(0).toUpperCase() + info.subscriptionType.slice(1)
      : "구독";
    statusEl.innerHTML = `✅ <strong>로그인됨</strong> · ${tier} 구독`;
  } catch {
    statusEl.innerHTML = `<span style="color:var(--text-muted)">상태 확인 불가</span>`;
  }
}

document.querySelectorAll('input[name="auth-mode"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    updateAuthUI(getAuthMode());
    if (getAuthMode() === "oauth") refreshOAuthStatus();
  });
});

// ─── 초기화 ────────────────────────────────────────────────────

async function init() {
  const cfg = await window.spiralSetup.getCurrentConfig();

  // 저장된 authMode 복원
  const savedMode = cfg.authMode ?? "oauth";
  const radioToCheck = document.querySelector(`input[name="auth-mode"][value="${savedMode}"]`);
  if (radioToCheck) radioToCheck.checked = true;
  updateAuthUI(savedMode);

  if (cfg.vaultPath) vaultPath.value = cfg.vaultPath;
  if (cfg.roadmapRoot) roadmapRoot.value = cfg.roadmapRoot;
  if (savedMode === "apikey" && cfg.anthropicApiKey && apiKeyInput) {
    apiKeyInput.value = cfg.anthropicApiKey;
  }
  if (savedMode === "oauth") refreshOAuthStatus();

  // vault 자동 감지
  if (!vaultPath.value) {
    const det = await window.spiralSetup.detectVault();
    if (det?.found) {
      vaultDetected.classList.remove("hidden");
      vaultDetected.innerHTML = `💡 자동 감지: <code>${det.path}</code> — 클릭해서 사용`;
      vaultDetected.addEventListener(
        "click",
        () => {
          vaultPath.value = det.path;
          vaultDetected.classList.add("hidden");
        },
        { once: true },
      );
    } else {
      const notFound = document.getElementById("vault-not-found");
      if (notFound) {
        notFound.classList.remove("hidden");
        const linkObsidian = document.getElementById("link-obsidian");
        if (linkObsidian) {
          linkObsidian.addEventListener("click", (e) => {
            e.preventDefault();
            window.spiralSetup.openExternal(linkObsidian.dataset.href);
          });
        }
      }
    }
  }

  // git 존재 확인
  const git = await window.spiralSetup.checkGit();
  if (!git.ok) {
    presetsContainer
      .querySelectorAll(".setup-preset")
      .forEach((b) => (b.disabled = true));
    const note = document.createElement("div");
    note.className = "setup-presets-hint";
    note.innerHTML = `⚠️ git CLI를 찾지 못했습니다. <code>git</code>을 설치한 뒤 다시 시도하세요. macOS: <code>xcode-select --install</code> · Windows: <a id="link-git" data-href="https://git-scm.com/download/win">git-scm.com</a> 에서 받기`;
    presetsContainer.parentNode.insertBefore(note, presetsContainer.nextSibling);
    const linkGit = document.getElementById("link-git");
    if (linkGit) {
      linkGit.addEventListener("click", () =>
        window.spiralSetup.openExternal(linkGit.dataset.href),
      );
    }
  }
}

// ─── 프리셋 / 다운로드 ────────────────────────────────────────

window.spiralCurated?.onProgress((p) => {
  if (p.phase === "fetching") {
    downloadProgress.classList.remove("hidden");
    downloadProgress.textContent = p.message ?? "레포 목록 가져오는 중…";
    progressBarWrap.classList.remove("hidden");
    progressFill.style.width = "5%";
  } else if (p.phase === "cloning") {
    const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
    progressFill.style.width = `${pct}%`;
    downloadProgress.textContent = p.current
      ? `[${p.done}/${p.total}] ${p.current}${p.skipped ? ` · skip ${p.skipped}` : ""}`
      : `${p.total}개 레포 시도 시작…`;
  } else if (p.phase === "done") {
    progressFill.style.width = "100%";
    downloadProgress.textContent = `✓ 완료 — 새로 ${p.done - (p.failed ?? 0) - (p.skipped ?? 0)}개, skip ${p.skipped ?? 0}개, 실패 ${p.failed ?? 0}개`;
  }
});

async function _domainReposForPreset(presetId) {
  const data = await window.spiralCurated.getDomains({});
  const preset = data?.rolePresets?.find((p) => p.id === presetId);
  if (!preset) return [];
  const ids = new Set(preset.domains);
  const repos = new Set();
  for (const d of data?.domains ?? []) {
    if (!ids.has(d.id)) continue;
    for (const c of d.categories) for (const r of c.repos) repos.add(r);
  }
  return Array.from(repos);
}

function _parentDirOfRoadmapRoot() {
  const v = (roadmapRoot.value ?? "").trim();
  if (!v) return null;
  const idx = Math.max(v.lastIndexOf("/"), v.lastIndexOf("\\"));
  if (idx < 1) return v;
  const lastSeg = v.slice(idx + 1).toLowerCase();
  if (lastSeg === "iq-dev-lab") return v.slice(0, idx);
  return v;
}

async function _runPreset(presetId, presetLabel) {
  if (downloading || downloadDone) return;
  if (!window.spiralCurated) return;
  let parent = _parentDirOfRoadmapRoot();
  if (!parent) {
    parent = await window.spiralCurated.pickParentDir();
    if (!parent) return;
  }
  const want = await _domainReposForPreset(presetId);
  const installedRes = await window.spiralCurated.getInstalled({ parentDir: parent });
  const installed = new Set(installedRes?.installed ?? []);
  const missing = want.filter((r) => !installed.has(r));
  if (missing.length === 0) {
    alert(`${presetLabel} — 이미 ${want.length}개 모두 받음 ✓\n${installedRes.targetDir}`);
    roadmapRoot.value = installedRes.targetDir;
    return;
  }
  if (!confirm(`${presetLabel}\n받을 레포: ${missing.length}개 (이미 받은 ${want.length - missing.length}개 skip)\n위치: ${parent}\n\n진행할까요?`))
    return;

  downloading = true;
  presetsContainer.querySelectorAll(".setup-preset").forEach((b) => (b.disabled = true));
  saveBtn.disabled = true;
  saveBtn.textContent = "다운로드 중…";

  const res = await window.spiralCurated.install({ parentDir: parent, repoNames: missing });

  downloading = false;
  presetsContainer.querySelectorAll(".setup-preset").forEach((b) => (b.disabled = false));
  saveBtn.disabled = false;
  saveBtn.textContent = "시작하기";

  if (!res?.ok) {
    downloadProgress.textContent = `✗ 실패: ${res?.error ?? "unknown"}`;
    return;
  }
  downloadDone = true;
  roadmapRoot.value = res.targetDir;
}

presetsContainer?.querySelectorAll(".setup-preset").forEach((btn) => {
  btn.addEventListener("click", () => {
    const id = btn.dataset.preset;
    const label = btn.querySelector("strong")?.textContent ?? id;
    _runPreset(id, label);
  });
});

// ─── 버튼 핸들러 ──────────────────────────────────────────────

$("pick-vault").addEventListener("click", async () => {
  const p = await window.spiralSetup.pickDirectory({ title: "Obsidian Vault 선택", defaultPath: vaultPath.value });
  if (p) vaultPath.value = p;
});

$("pick-roadmap").addEventListener("click", async () => {
  const p = await window.spiralSetup.pickDirectory({ title: "학습 자료 디렉토리 선택", defaultPath: roadmapRoot.value });
  if (p) roadmapRoot.value = p;
});

// link-console은 apikey 블록 안으로 이동했으므로 동적으로 바인딩
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-href]");
  if (el && el.id === "link-console") {
    e.preventDefault();
    window.spiralSetup.openExternal(el.dataset.href);
  }
});

saveBtn.addEventListener("click", async () => {
  errorMsg.textContent = "";
  saveBtn.disabled = true;
  saveBtn.textContent = "검증 중…";
  const mode = getAuthMode();
  const cfg = {
    authMode: mode,
    anthropicApiKey: mode === "apikey" ? (apiKeyInput?.value?.trim() ?? "") : "",
    vaultPath: vaultPath.value.trim(),
    roadmapRoot: roadmapRoot.value.trim() || null,
  };
  const result = await window.spiralSetup.validateAndSave(cfg);
  if (!result.ok) {
    errorMsg.textContent = result.error || "저장 실패";
    saveBtn.disabled = false;
    saveBtn.textContent = "시작하기";
  }
});

[vaultPath, roadmapRoot].forEach((el) => {
  el.addEventListener("keydown", (e) => { if (e.key === "Enter") saveBtn.click(); });
});

init();
