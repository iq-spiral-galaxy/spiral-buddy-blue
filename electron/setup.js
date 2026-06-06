// Setup wizard 클라이언트. window.spiralSetup IPC만 사용 (preload).

const $ = (id) => document.getElementById(id);
const apiKey = $("api-key");
const vaultPath = $("vault-path");
const roadmapRoot = $("roadmap-root");
const errorMsg = $("error-msg");
const saveBtn = $("save-btn");

const vaultDetected = $("vault-detected");
const downloadProgress = $("download-progress");
const progressBarWrap = $("progress-bar-wrap");
const progressFill = $("progress-fill");
const presetsContainer = $("setup-presets");

let downloading = false;
let downloadDone = false;

async function init() {
  const cfg = await window.spiralSetup.getCurrentConfig();
  if (cfg.anthropicApiKey) apiKey.value = cfg.anthropicApiKey;
  if (cfg.vaultPath) vaultPath.value = cfg.vaultPath;
  if (cfg.roadmapRoot) roadmapRoot.value = cfg.roadmapRoot;

  // vault 자동 감지 — 이미 사용자가 입력한 게 있으면 skip
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
      // 자동 감지 실패 — Obsidian 미설치 가능성. 설치 안내 + 다운로드 링크.
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

  // git 존재 확인 — 없으면 프리셋 비활성화 + 안내
  const git = await window.spiralSetup.checkGit();
  if (!git.ok) {
    presetsContainer
      .querySelectorAll(".setup-preset")
      .forEach((b) => (b.disabled = true));
    const note = document.createElement("div");
    note.className = "setup-presets-hint";
    note.innerHTML = `⚠️ git CLI를 찾지 못했습니다. <code>git</code>을 설치한 뒤 다시 시도하세요. macOS: <code>xcode-select --install</code> · Windows: <a id="link-git" data-href="https://git-scm.com/download/win">git-scm.com</a> 에서 받기`;
    presetsContainer.parentNode.insertBefore(
      note,
      presetsContainer.nextSibling,
    );
    const linkGit = document.getElementById("link-git");
    if (linkGit) {
      linkGit.addEventListener("click", () =>
        window.spiralSetup.openExternal(linkGit.dataset.href),
      );
    }
  }
}

// v0.5.46 — 역할 프리셋 → curated:install
// 진행 이벤트 listener
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

async function _runPreset(presetId, presetLabel) {
  if (downloading || downloadDone) return;
  if (!window.spiralCurated) return;
  const parent = await window.spiralCurated.pickParentDir();
  if (!parent) return;

  // 이미 받은 거 빼고 미설치만 받기 (incremental)
  const want = await _domainReposForPreset(presetId);
  const installedRes = await window.spiralCurated.getInstalled({
    parentDir: parent,
  });
  const installed = new Set(installedRes?.installed ?? []);
  const missing = want.filter((r) => !installed.has(r));
  if (missing.length === 0) {
    alert(
      `${presetLabel} — 이미 ${want.length}개 모두 받음 ✓\n${installedRes.targetDir}`,
    );
    roadmapRoot.value = installedRes.targetDir;
    return;
  }
  if (
    !confirm(
      `${presetLabel}\n받을 레포: ${missing.length}개 (이미 받은 ${want.length - missing.length}개 skip)\n위치: ${parent}\n\n진행할까요?`,
    )
  )
    return;

  downloading = true;
  presetsContainer
    .querySelectorAll(".setup-preset")
    .forEach((b) => (b.disabled = true));
  saveBtn.disabled = true;
  saveBtn.textContent = "다운로드 중…";

  const res = await window.spiralCurated.install({
    parentDir: parent,
    repoNames: missing,
  });

  downloading = false;
  presetsContainer
    .querySelectorAll(".setup-preset")
    .forEach((b) => (b.disabled = false));
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

$("pick-vault").addEventListener("click", async () => {
  const p = await window.spiralSetup.pickDirectory({
    title: "Obsidian Vault 선택",
    defaultPath: vaultPath.value,
  });
  if (p) vaultPath.value = p;
});

$("pick-roadmap").addEventListener("click", async () => {
  const p = await window.spiralSetup.pickDirectory({
    title: "학습 자료 디렉토리 선택",
    defaultPath: roadmapRoot.value,
  });
  if (p) roadmapRoot.value = p;
});

$("link-console").addEventListener("click", (e) => {
  const url = e.currentTarget.dataset.href;
  if (url) window.spiralSetup.openExternal(url);
});

saveBtn.addEventListener("click", async () => {
  errorMsg.textContent = "";
  saveBtn.disabled = true;
  saveBtn.textContent = "검증 중…";
  const cfg = {
    anthropicApiKey: apiKey.value.trim(),
    vaultPath: vaultPath.value.trim(),
    roadmapRoot: roadmapRoot.value.trim() || null,
  };
  const result = await window.spiralSetup.validateAndSave(cfg);
  if (!result.ok) {
    errorMsg.textContent = result.error || "저장 실패";
    saveBtn.disabled = false;
    saveBtn.textContent = "시작하기";
  }
  // 성공 시 main에서 setup 창을 닫으므로 별도 처리 불필요
});

// Enter로도 저장
[apiKey, vaultPath, roadmapRoot].forEach((el) => {
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveBtn.click();
  });
});

init();
