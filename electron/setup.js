// Setup wizard 클라이언트. window.spiralSetup IPC만 사용 (preload).

const $ = (id) => document.getElementById(id);
const apiKey = $("api-key");
const vaultPath = $("vault-path");
const roadmapRoot = $("roadmap-root");
const errorMsg = $("error-msg");
const saveBtn = $("save-btn");

const vaultDetected = $("vault-detected");
const downloadCard = $("download-card");
const downloadCardSub = $("download-card-sub");
const downloadProgress = $("download-progress");
const progressBarWrap = $("progress-bar-wrap");
const progressFill = $("progress-fill");

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
    }
  }

  // git 존재 확인 — 없으면 다운로드 카드 비활성화
  const git = await window.spiralSetup.checkGit();
  if (!git.ok) {
    downloadCard.classList.add("disabled");
    downloadCardSub.innerHTML = `⚠️ git CLI를 찾지 못했습니다. <code>git</code>을 설치한 뒤 다시 시도하세요.<br>macOS: <code>xcode-select --install</code> · Windows: <a id="link-git" data-href="https://git-scm.com/download/win">git-scm.com</a> 에서 받기`;
    const linkGit = document.getElementById("link-git");
    if (linkGit) {
      linkGit.addEventListener("click", () =>
        window.spiralSetup.openExternal(linkGit.dataset.href),
      );
    }
  }
}

// 다운로드 진행 이벤트 listener — 페이지 로드 시 한 번만 등록
window.spiralSetup.onDownloadProgress((p) => {
  if (p.phase === "fetching") {
    downloadProgress.classList.remove("hidden");
    downloadProgress.textContent = p.message;
    progressBarWrap.classList.remove("hidden");
    progressFill.style.width = "5%";
  } else if (p.phase === "cloning") {
    const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
    progressFill.style.width = `${pct}%`;
    downloadProgress.textContent = p.current
      ? `[${p.done}/${p.total}] ${p.current} clone 완료`
      : `${p.total}개 레포 클론 시작…`;
  } else if (p.phase === "done") {
    progressFill.style.width = "100%";
    const failedNote = p.failed > 0 ? ` (${p.failed}개 실패)` : "";
    downloadProgress.textContent = `✓ ${p.done - p.failed}/${p.total}개 완료${failedNote}`;
  }
});

downloadCard.addEventListener("click", async () => {
  if (downloading || downloadDone) return;
  if (downloadCard.classList.contains("disabled")) return;

  const parent = await window.spiralSetup.pickParentDir();
  if (!parent) return;

  downloading = true;
  downloadCard.classList.add("downloading");
  saveBtn.disabled = true;
  saveBtn.textContent = "다운로드 중…";

  const res = await window.spiralSetup.downloadCurated({ parentDir: parent });
  downloading = false;
  saveBtn.disabled = false;
  saveBtn.textContent = "시작하기";

  if (!res?.ok) {
    downloadProgress.textContent = `✗ 실패: ${res?.error ?? "unknown"}`;
    downloadCard.classList.remove("downloading");
    return;
  }
  downloadDone = true;
  downloadCard.classList.remove("downloading");
  downloadCard.classList.add("done");
  // 학습 자료 디렉토리 자동 채움
  roadmapRoot.value = res.targetDir;
  const failedNote =
    res.failed && res.failed.length > 0
      ? ` (${res.failed.length}개 실패: ${res.failed.map((f) => f.name).join(", ")})`
      : "";
  downloadCardSub.innerHTML = `✓ <code>${res.targetDir}</code>에 <strong>${res.count}개 레포</strong> 다운로드 완료${failedNote}`;
});

downloadCard.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    downloadCard.click();
  }
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
