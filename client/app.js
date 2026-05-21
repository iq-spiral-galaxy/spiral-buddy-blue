// iq-spiral-buddy client — vanilla ES module
// 로드맵 상태 관리 + 마크다운 렌더링 + 스트리밍

import { marked } from "https://esm.sh/marked@13.0.3";
import { markedHighlight } from "https://esm.sh/marked-highlight@2.2.1";
import hljs from "https://esm.sh/highlight.js@11.10.0";

// ──────────────────────────────────────────────────────────
// Markdown setup
// ──────────────────────────────────────────────────────────

marked.use(
  markedHighlight({
    langPrefix: "hljs language-",
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : "plaintext";
      return hljs.highlight(code, { language, ignoreIllegals: true }).value;
    },
  }),
);
marked.setOptions({ breaks: true, gfm: true });

// ──────────────────────────────────────────────────────────
// State
// ──────────────────────────────────────────────────────────

const state = {
  config: null,
  models: [], // 사용 가능한 모델 목록
  selectedModel: null, // 현재 선택된 모델 id (localStorage 복원)
  roadmaps: [],
  curatedAvailable: [],
  curatedGroups: [],
  expandedCategories: new Set(), // Curated 받기 가능 카테고리
  expandedLocalCategories: new Set(), // Local 카테고리
  expandedLocalRepos: new Set(), // Local 레포 (key: "category::repo")
  // active 로드맵이 바뀌었을 때만 자동 펼침하기 위해 마지막으로 자동 펼침한 id 기록.
  // null이면 다음 렌더에서 active 로드맵의 cat/repo를 한 번 펼침.
  lastAutoExpandedRoadmapId: null,
  showAvailable: false,
  curatedOrg: null,
  activeRoadmapId: null,
  chapters: [],
  history: [],
  suggestion: null,
  session: null,
  messages: [],
  pending: false,
  installingRepo: null,
};

// localStorage에 마지막 로드맵 저장
const LS_KEY = "spiral-buddy:lastRoadmapId";

// ──────────────────────────────────────────────────────────
// DOM refs
// ──────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);
const els = {};

function cacheEls() {
  els.meta = $("meta");
  els.modelSelect = $("model-select");
  els.modelTierBadge = $("model-tier-badge");
  els.sidebarToggle = $("sidebar-toggle");
  els.roadmapCurrent = $("roadmap-current");
  els.roadmapList = $("roadmap-list");
  els.suggestion = $("suggestion-box");
  els.chapterList = $("chapter-list");
  els.historyList = $("history-list");
  els.topbar = $("current-chapter");
  els.messages = $("messages");
  els.input = $("input");
  els.sendBtn = $("send-btn");
  els.endBtn = $("end-btn");
  els.quizBtn = $("quiz-btn");
  els.form = $("input-form");
  els.statusBar = $("status-bar");
  els.trashOpenBtn = $("trash-open-btn");
  els.trashCount = $("trash-count");
  els.trashModal = $("trash-modal");
  els.trashModalClose = $("trash-modal-close");
  els.trashList = $("trash-list");
  els.searchModal = $("search-modal");
  els.searchInput = $("search-input");
  els.searchResults = $("search-results");
  els.activityOpenBtn = $("activity-open-btn");
  els.activityModal = $("activity-modal");
  els.activityModalClose = $("activity-modal-close");
  els.activitySummary = $("activity-summary");
  els.activityGrid = $("activity-grid");
  els.activityMonthLabels = $("activity-month-labels");
  // settings / workspace
  els.settingsBtn = $("settings-btn");
  els.settingsModal = $("settings-modal");
  els.settingsModalClose = $("settings-modal-close");
  els.workspaceCurrent = $("workspace-current");
  els.workspaceName = $("workspace-name");
  els.workspaceList = $("workspace-list");
  els.addWsModal = $("add-workspace-modal");
}

// ──────────────────────────────────────────────────────────
// Init
// ──────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  cacheEls();
  wireEvents();
  await loadInitial();
});

function wireEvents() {
  els.form.addEventListener("submit", (e) => {
    e.preventDefault();
    submitMessage();
  });
  els.input.addEventListener("keydown", (e) => {
    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      !e.isComposing &&
      e.keyCode !== 229
    ) {
      e.preventDefault();
      submitMessage();
    }
  });
  els.endBtn.addEventListener("click", endSession);
  els.quizBtn.addEventListener("click", () => {
    if (state.session && !state.pending) {
      sendMessage(
        "지금까지 다룬 내용을 바탕으로 내가 진짜 이해했는지 확인할 만한 짧은 질문 2개를 내줘. 답은 알려주지 말고.",
      );
    }
  });

  // 사이드바 토글 (버튼 + Cmd/Ctrl+B 단축키)
  const SIDEBAR_KEY = "spiral-buddy:sidebar-collapsed";
  function setSidebarCollapsed(collapsed, persist = true) {
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    if (persist) localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
  }
  // 초기 상태 복원
  if (localStorage.getItem(SIDEBAR_KEY) === "1") {
    setSidebarCollapsed(true, false);
  }
  if (els.sidebarToggle) {
    els.sidebarToggle.addEventListener("click", () => {
      const isCollapsed = document.body.classList.contains("sidebar-collapsed");
      setSidebarCollapsed(!isCollapsed);
    });
  }
  // Cmd/Ctrl + B 토글
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === "b" || e.key === "B")) {
      e.preventDefault();
      const isCollapsed = document.body.classList.contains("sidebar-collapsed");
      setSidebarCollapsed(!isCollapsed);
    }
  });

  // 사이드바 너비 조절 (드래그 핸들)
  const SIDEBAR_WIDTH_KEY = "spiral-buddy:sidebar-width";
  const SIDEBAR_MIN = 200;
  const SIDEBAR_MAX = 600;
  const savedWidth = localStorage.getItem(SIDEBAR_WIDTH_KEY);
  if (savedWidth) {
    const w = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, parseInt(savedWidth, 10) || 280));
    document.body.style.setProperty("--sidebar-w", `${w}px`);
  }
  const resizer = document.getElementById("sidebar-resizer");
  if (resizer) {
    let dragging = false;
    resizer.addEventListener("mousedown", (e) => {
      e.preventDefault();
      dragging = true;
      document.body.classList.add("sidebar-resizing");
    });
    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const w = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, e.clientX));
      document.body.style.setProperty("--sidebar-w", `${w}px`);
    });
    document.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove("sidebar-resizing");
      const w = document.body.style.getPropertyValue("--sidebar-w");
      if (w) localStorage.setItem(SIDEBAR_WIDTH_KEY, w.trim());
    });
    // 더블클릭으로 기본 너비 복원
    resizer.addEventListener("dblclick", () => {
      document.body.style.removeProperty("--sidebar-w");
      localStorage.removeItem(SIDEBAR_WIDTH_KEY);
    });
  }

  // 설정 + 워크스페이스 (Electron 모드에서만 동작 — window.spiralSettings 존재 여부)
  if (window.spiralSettings) {
    initSettings();
  } else {
    // 브라우저 모드 (pnpm dev) — 설정 버튼 숨김, 워크스페이스 셀렉터 숨김
    els.settingsBtn?.classList.add("hidden");
    document.getElementById("workspace-section")?.classList.add("hidden");
  }

  // 휴지통
  if (els.trashOpenBtn) {
    els.trashOpenBtn.addEventListener("click", openTrashModal);
  }
  if (els.trashModalClose) {
    els.trashModalClose.addEventListener("click", closeTrashModal);
  }
  if (els.trashModal) {
    els.trashModal.addEventListener("click", (e) => {
      // 오버레이 자체 클릭 시 닫기 (내부 클릭은 무시)
      if (e.target === els.trashModal) closeTrashModal();
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !els.trashModal?.classList.contains("hidden")) {
      closeTrashModal();
    }
  });
  // 백그라운드로 휴지통 개수 폴링은 안 함 — 사이드바 갱신마다 같이 fetch
  refreshTrashBadge();

  // 학습 활동 캘린더
  if (els.activityOpenBtn) {
    els.activityOpenBtn.addEventListener("click", openActivityModal);
  }
  if (els.activityModalClose) {
    els.activityModalClose.addEventListener("click", closeActivityModal);
  }
  if (els.activityModal) {
    els.activityModal.addEventListener("click", (e) => {
      if (e.target === els.activityModal) closeActivityModal();
    });
  }

  // Cmd/Ctrl+K — 검색 모달
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      openSearchModal();
    }
    if (e.key === "Escape" && els.activityModal && !els.activityModal.classList.contains("hidden")) {
      closeActivityModal();
    }
  });
  if (els.searchModal) {
    els.searchModal.addEventListener("click", (e) => {
      if (e.target === els.searchModal) closeSearchModal();
    });
  }
  if (els.searchInput) {
    let debounceTimer = null;
    els.searchInput.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      const q = els.searchInput.value;
      debounceTimer = setTimeout(() => runSearch(q), 150);
    });
    els.searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeSearchModal();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        moveSearchSelection(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        moveSearchSelection(-1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        activateSearchSelection();
      }
    });
  }

  // 모델 셀렉터 — 세션 중에는 비활성화
  els.modelSelect.addEventListener("change", (e) => {
    const modelId = e.target.value;
    if (!modelId) return;
    state.selectedModel = modelId;
    localStorage.setItem("spiral-buddy:model", modelId);
    updateModelTierBadge();
    if (state.session) {
      setStatus(
        "ℹ️ 모델 변경은 다음 세션부터 적용돼요 (현재 세션은 그대로 진행)",
      );
    }
  });
  els.roadmapCurrent.addEventListener("click", () => {
    els.roadmapList.classList.toggle("hidden");
  });
  // 클릭 외부 시 닫기
  document.addEventListener("click", (e) => {
    if (
      !els.roadmapCurrent.contains(e.target) &&
      !els.roadmapList.contains(e.target)
    ) {
      els.roadmapList.classList.add("hidden");
    }
  });

  // 세션 중 페이지 닫기 시 경고 (브라우저 기본 다이얼로그)
  window.addEventListener("beforeunload", (e) => {
    if (state.session) {
      e.preventDefault();
      e.returnValue =
        "진행 중인 세션이 있습니다. 닫으면 현재 대화가 사라집니다.";
      return e.returnValue;
    }
  });
}

async function loadInitial() {
  try {
    const [config, roadmaps, modelsData] = await Promise.all([
      fetch("/api/config").then((r) => r.json()),
      fetch("/api/roadmaps")
        .then((r) => r.json())
        .catch(() => []),
      fetch("/api/models").then((r) => r.json()).catch(() => null),
    ]);
    state.config = config;
    state.curatedOrg = config?.curatedOrg ?? null;
    state.roadmaps = Array.isArray(roadmaps) ? roadmaps : [];

    // 모델 목록 + 선택 상태
    state.models = modelsData?.models ?? [];
    const savedModel = localStorage.getItem("spiral-buddy:model");
    const defaultModel = modelsData?.default ?? config?.model ?? null;
    state.selectedModel =
      (savedModel && state.models.find((m) => m.id === savedModel)?.id) ||
      defaultModel;
    renderModelSelector();

    renderMeta();

    if (state.roadmaps.length === 0 && !state.curatedOrg) {
      setStatus(
        "로드맵이 없음. SPIRAL_ROADMAP_ROOT 또는 SPIRAL_CURATED_ORG 설정 필요.",
        "error",
      );
      renderRoadmapSelector();
      return;
    }

    // 마지막으로 사용한 로드맵 복원 → 없으면 가장 최근 학습한 로드맵 → 그 외 첫 로드맵
    const lastId = localStorage.getItem(LS_KEY);
    const restored = lastId && state.roadmaps.find((r) => r.id === lastId);
    if (restored) {
      state.activeRoadmapId = restored.id;
    } else {
      const mostRecent = state.roadmaps
        .filter((r) => r.lastDate)
        .sort((a, b) => (b.lastDate ?? "").localeCompare(a.lastDate ?? ""))[0];
      state.activeRoadmapId = mostRecent?.id ?? state.roadmaps[0]?.id ?? null;
    }

    renderRoadmapSelector();
    if (state.activeRoadmapId) {
      await loadRoadmapData();
      scrollToRecentChapter();
    } else {
      // 설치된 로드맵 없으면 placeholder + curated 가능 목록 자동 로드
      els.chapterList.innerHTML = `<li class="empty">로드맵 설치 안 됨. 위 셀렉터에서 "받기 가능" 펼쳐 큐레이션 로드맵을 받으세요.</li>`;
      els.historyList.innerHTML = `<li class="empty">—</li>`;
      els.suggestion.innerHTML = `<div class="empty">먼저 로드맵을 설치하세요</div>`;
      // curated available 자동 fetch
      await loadCuratedAvailable();
    }
  } catch (err) {
    setStatus(`Initial load failed: ${err.message}`, "error");
  }
}

async function loadCuratedAvailable(force = false) {
  if (!state.curatedOrg) return;
  try {
    const url = force
      ? "/api/curated/available?refresh=1"
      : "/api/curated/available";
    const res = await fetch(url);
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error ?? `HTTP ${res.status}`);
    }
    const data = await res.json();
    state.curatedAvailable = data.repos ?? [];
    state.curatedGroups = data.groups ?? [];
    renderRoadmapSelector();
  } catch (err) {
    state.curatedAvailable = [];
    state.curatedGroups = [];
    setStatus(`Curated 목록 로드 실패: ${err.message}`, "error");
  }
}

/** 현재 active 로드맵의 챕터/노트/추천을 모두 로드 */
async function loadRoadmapData() {
  if (!state.activeRoadmapId) return;
  const q = `?roadmap_id=${encodeURIComponent(state.activeRoadmapId)}`;

  els.chapterList.innerHTML = `<li class="loading">loading…</li>`;
  els.historyList.innerHTML = `<li class="loading">loading…</li>`;
  els.suggestion.innerHTML = `<div class="loading">🧭 Analyzing trajectory…</div>`;

  try {
    const [chaptersRes, historyRes] = await Promise.all([
      fetch(`/api/chapters${q}`).then((r) => r.json()),
      fetch(`/api/history${q}`).then((r) => r.json()),
    ]);

    state.chapters = chaptersRes.chapters ?? [];
    state.history = Array.isArray(historyRes) ? historyRes : [];

    renderChapters();
    renderHistory();

    // suggestion은 비동기로
    fetch(`/api/suggest${q}`)
      .then((r) => r.json())
      .then((suggestion) => {
        state.suggestion = suggestion;
        renderSuggestion();
      })
      .catch(() => {
        els.suggestion.innerHTML = `<div class="empty">suggestion 불러오기 실패</div>`;
      });
  } catch (err) {
    setStatus(`로드맵 데이터 로드 실패: ${err.message}`, "error");
  }
}

// ──────────────────────────────────────────────────────────
// Renderers
// ──────────────────────────────────────────────────────────

function renderMeta() {
  const c = state.config;
  if (els.meta) els.meta.textContent = c?.model ?? "";
}

function renderModelSelector() {
  if (!els.modelSelect) return;
  if (state.models.length === 0) {
    els.modelSelect.innerHTML = `<option>모델 로드 실패</option>`;
    els.modelSelect.disabled = true;
    return;
  }
  els.modelSelect.innerHTML = state.models
    .map(
      (m) =>
        `<option value="${escapeAttr(m.id)}" ${
          m.id === state.selectedModel ? "selected" : ""
        }>${escapeHtml(m.label)}</option>`,
    )
    .join("");
  els.modelSelect.disabled = false;
  updateModelTierBadge();
}

function updateModelTierBadge() {
  if (!els.modelTierBadge) return;
  const model = state.models.find((m) => m.id === state.selectedModel);
  if (!model) {
    els.modelTierBadge.textContent = "";
    els.modelTierBadge.className = "model-tier-badge";
    els.modelTierBadge.title = "";
    return;
  }
  els.modelTierBadge.textContent = model.tier;
  els.modelTierBadge.className = `model-tier-badge tier-${model.tier}`;
  els.modelTierBadge.title = model.description ?? "";
}

function renderRoadmapSelector() {
  const active = state.roadmaps.find((r) => r.id === state.activeRoadmapId);
  const activeName = active?.name ?? "선택된 로드맵 없음";
  const activeProgress = active
    ? `${active.visitedChapters}/${active.chapterCount}`
    : "";
  const activeSrc = active?.source === "curated" ? "📚" : "📁";

  els.roadmapCurrent.innerHTML = `
    <div class="roadmap-current-inner">
      <span class="roadmap-name">${active ? activeSrc + " " : ""}${escapeHtml(activeName)}</span>
      ${active ? `<span class="roadmap-progress">${activeProgress}</span>` : ""}
    </div>
    <span class="caret">▼</span>
  `;

  const local = state.roadmaps.filter((r) => r.source !== "curated");
  const curated = state.roadmaps.filter((r) => r.source === "curated");
  const installedNames = new Set(
    curated.map((r) => {
      // curated:org/repo[/sub] → repo 이름만
      const parts = r.id.replace(/^curated:/, "").split("/");
      return parts[1] ?? r.name;
    }),
  );
  const notInstalled = state.curatedAvailable.filter(
    (repo) => !installedNames.has(repo.name),
  );

  const parts = [];

  if (local.length > 0) {
    // 3-level 계층: category → repo → sub-roadmap
    // roadmap.id 예: "api & communication /grpc-deep-dive/grpc-fundamentals"
    //   → category: "API & Communication" (서버에서 category 필드로 줌)
    //   → repo: "grpc-deep-dive" (path 두 번째 segment)
    //   → sub-roadmap: "grpc-fundamentals" (path 세 번째+)
    function parseHierarchy(r) {
      // backend가 카테고리 정의(JSON repos)를 알고 있어서 평탄/계층 구조를
      // 정확히 판단 후 r.hierarchy로 보내줌. 그게 있으면 그대로 사용.
      if (r.hierarchy) {
        return {
          repo: r.hierarchy.repo,
          sub: r.hierarchy.sub,
          isFlat: r.hierarchy.sub === null,
        };
      }
      // fallback (옛 응답 형식 또는 curated): id 경로로 추정
      const segments = r.id
        .split("/")
        .map((s) => s.trim())
        .filter(Boolean);
      if (segments.length >= 3) {
        return {
          repo: segments[1],
          sub: segments.slice(2).join("/"),
          isFlat: false,
        };
      } else if (segments.length === 2) {
        return { repo: segments[1], sub: null, isFlat: true };
      }
      return { repo: segments[0] ?? r.name, sub: null, isFlat: true };
    }

    // 카테고리 → 레포 → 로드맵 트리 구조
    const tree = new Map(); // catName → Map<repoName, Roadmap[]>
    const catMeta = new Map(); // catName → category meta

    for (const r of local) {
      const catName = r.category?.name ?? "Uncategorized";
      catMeta.set(
        catName,
        r.category ?? { name: "Uncategorized", emoji: "📁", color: "#888888" },
      );
      const { repo } = parseHierarchy(r);
      if (!tree.has(catName)) tree.set(catName, new Map());
      const repoMap = tree.get(catName);
      if (!repoMap.has(repo)) repoMap.set(repo, []);
      repoMap.get(repo).push(r);
    }

    // active 로드맵의 카테고리 + 레포는 처음 한 번만 자동 펼침
    // (사용자가 직접 토글을 닫으면 그 의도를 존중)
    const activeRoadmap = local.find((r) => r.id === state.activeRoadmapId);
    if (
      activeRoadmap?.category?.name &&
      state.lastAutoExpandedRoadmapId !== state.activeRoadmapId
    ) {
      state.expandedLocalCategories.add(activeRoadmap.category.name);
      const { repo: activeRepo } = parseHierarchy(activeRoadmap);
      state.expandedLocalRepos.add(`${activeRoadmap.category.name}::${activeRepo}`);
      state.lastAutoExpandedRoadmapId = state.activeRoadmapId;
    }

    const totalRepos = Array.from(tree.values()).reduce(
      (sum, m) => sum + m.size,
      0,
    );
    parts.push(
      `<div class="roadmap-group-title">📁 Local · ${tree.size} categories · ${totalRepos} repos · ${local.length} roadmaps</div>`,
    );

    for (const [catName, repoMap] of tree) {
      const cat = catMeta.get(catName);
      const catExpanded = state.expandedLocalCategories.has(catName);
      const catCaret = catExpanded ? "▼" : "▶";

      let catBody = "";
      if (catExpanded) {
        for (const [repoName, roadmaps] of repoMap) {
          const repoKey = `${catName}::${repoName}`;
          const repoExpanded = state.expandedLocalRepos.has(repoKey);
          const repoCaret = repoExpanded ? "▼" : "▶";

          // 레포의 누적 진도
          const repoTotalChapters = roadmaps.reduce(
            (sum, r) => sum + r.chapterCount,
            0,
          );
          const repoVisitedChapters = roadmaps.reduce(
            (sum, r) => sum + r.visitedChapters,
            0,
          );
          const repoMaxDepth = roadmaps.reduce(
            (m, r) => Math.max(m, r.maxDepth ?? 0),
            0,
          );
          const repoDepthBadge =
            repoMaxDepth > 0
              ? `<span class="depth-pill">d${repoMaxDepth}</span>`
              : "";

          // 단일 sub-roadmap만 있고 그게 자기 자신(repo)이면 바로 클릭 가능하게
          const isSingleFlat =
            roadmaps.length === 1 && parseHierarchy(roadmaps[0]).isFlat;

          let repoBody = "";
          if (repoExpanded && !isSingleFlat) {
            // sub-roadmap 목록 렌더링.
            // 서버가 컨테이너 README의 학습 순서대로 정렬해서 보내준다 (roadmap.ts sortKey).
            // 여기서 다시 알파벳 정렬하면 그 순서가 깨지므로 그대로 사용.
            repoBody = roadmaps
              .map((r, idx) => {
                const isActive = r.id === state.activeRoadmapId;
                const { sub } = parseHierarchy(r);
                const displayName = sub ?? r.name;
                const lastDate = r.lastDate ?? "—";
                const visited = (r.maxDepth ?? 0) > 0;
                const depthBadge = visited
                  ? `<span class="depth-pill deletable" data-roadmap-delete="${escapeAttr(r.id)}" title="클릭하여 이 로드맵의 노트 삭제">d${r.maxDepth}</span>`
                  : "";
                const trashBtn = visited
                  ? `<span class="chapter-delete-btn" data-roadmap-delete="${escapeAttr(r.id)}" role="button" tabindex="0" title="이 로드맵의 노트 삭제">
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
                        <path d="M10 11v6M14 11v6"></path>
                        <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path>
                      </svg>
                    </span>`
                  : "";
                const pct =
                  r.chapterCount > 0
                    ? Math.min(100, Math.round((r.visitedChapters / r.chapterCount) * 100))
                    : 0;
                return `
                  <button class="roadmap-item sub-roadmap-item ${isActive ? "active" : ""}" data-id="${escapeAttr(r.id)}" data-roadmap-title="${escapeAttr(displayName)}" data-depths="${escapeAttr((r.depths ?? []).join(","))}">
                    <div class="roadmap-item-name"><span class="sub-roadmap-index">${idx + 1}.</span> ${escapeHtml(displayName)}</div>
                    <div class="progress-mini" aria-hidden="true"><div class="progress-fill" style="width:${pct}%"></div></div>
                    <div class="roadmap-item-meta">
                      ${depthBadge}
                      <span class="roadmap-item-progress">${r.visitedChapters}/${r.chapterCount}</span>
                      <span class="roadmap-item-date">${escapeHtml(lastDate)}</span>
                      ${trashBtn}
                    </div>
                  </button>
                `;
              })
              .join("");
          }

          // Flat 레포(sub 없는 단일 로드맵)이면 헤더 자체가 클릭으로 active 설정
          const repoHeaderAttrs = isSingleFlat
            ? `data-flat-roadmap-id="${escapeAttr(roadmaps[0].id)}"`
            : `data-local-repo="${escapeAttr(repoKey)}"`;
          const repoClass = isSingleFlat
            ? "repo-header flat-roadmap"
            : "repo-header";
          const isFlatActive =
            isSingleFlat && roadmaps[0].id === state.activeRoadmapId;

          catBody += `
            <div class="local-repo">
              <button class="${repoClass} ${isFlatActive ? "active" : ""}" ${repoHeaderAttrs}>
                ${!isSingleFlat ? `<span class="cat-caret">${repoCaret}</span>` : `<span class="cat-caret"> </span>`}
                <span class="repo-emoji">📦</span>
                <span class="repo-name">${escapeHtml(repoName)}</span>
                ${repoDepthBadge}
                <span class="cat-count">${isSingleFlat ? roadmaps[0].chapterCount : roadmaps.length}</span>
              </button>
              <div class="repo-body ${repoExpanded && !isSingleFlat ? "" : "hidden"}">${repoBody}</div>
            </div>
          `;
        }
      }

      const totalRoadmapsInCat = Array.from(repoMap.values()).reduce(
        (sum, arr) => sum + arr.length,
        0,
      );

      parts.push(`
        <div class="curated-category local-category">
          <button class="category-header" data-local-cat="${escapeAttr(catName)}" style="--cat-color: ${escapeAttr(cat.color)}">
            <span class="cat-caret">${catCaret}</span>
            <span class="cat-emoji">${escapeHtml(cat.emoji)}</span>
            <span class="cat-name">${escapeHtml(catName)}</span>
            <span class="cat-count">${repoMap.size}r · ${totalRoadmapsInCat}</span>
          </button>
          <div class="category-body ${catExpanded ? "" : "hidden"}">${catBody}</div>
        </div>
      `);
    }
  }

  if (curated.length > 0) {
    parts.push(
      `<div class="roadmap-group-title">📚 Curated · ${escapeHtml(state.curatedOrg ?? "")} (${curated.length})</div>`,
    );
    parts.push(curated.map(roadmapItemHtml).join(""));
  }

  if (state.curatedOrg) {
    const toggleLabel = state.showAvailable
      ? `▼ 받기 가능 숨기기`
      : `▶ 받기 가능 보기 (${state.curatedAvailable.length || "?"})`;
    parts.push(
      `<button class="curated-toggle" id="curated-toggle">${toggleLabel}</button>`,
    );

    if (state.showAvailable) {
      // 받기 가능한 레포만 카테고리별로 (installed 제외)
      const visibleGroups = state.curatedGroups
        .map((g) => ({
          ...g,
          repos: g.repos.filter(
            (r) => !r.installed && !installedNames.has(r.name),
          ),
        }))
        .filter((g) => g.repos.length > 0);

      const totalAvailable = visibleGroups.reduce(
        (sum, g) => sum + g.repos.length,
        0,
      );

      if (visibleGroups.length === 0 && state.curatedAvailable.length === 0) {
        parts.push(
          `<div class="empty curated-empty">로드 중이거나 받기 가능한 레포가 없음. <a href="#" id="curated-refresh">새로고침</a></div>`,
        );
      } else if (totalAvailable === 0) {
        parts.push(
          `<div class="empty curated-empty">모든 Curated 레포가 이미 설치됨 · <a href="#" id="curated-refresh">새로고침</a></div>`,
        );
      } else {
        parts.push(
          `<div class="curated-available-header"><span>총 ${totalAvailable}개 · ${visibleGroups.length}개 카테고리</span> · <a href="#" id="curated-refresh">새로고침</a></div>`,
        );

        for (const group of visibleGroups) {
          const isExpanded = state.expandedCategories.has(group.name);
          const caret = isExpanded ? "▼" : "▶";
          const groupRepos = isExpanded
            ? group.repos
                .map((repo) => {
                  const isInstalling = state.installingRepo === repo.name;
                  const desc = repo.description
                    ? escapeHtml(repo.description.slice(0, 80))
                    : "";
                  const buttonLabel = isInstalling ? "받는 중…" : "📥 받기";
                  return `
                    <div class="curated-available-item">
                      <div class="curated-available-name">${escapeHtml(repo.name)}</div>
                      ${desc ? `<div class="curated-available-desc">${desc}</div>` : ""}
                      <div class="curated-available-meta">
                        <span>⭐ ${repo.stars}</span>
                        <span>·</span>
                        <span>${escapeHtml(repo.pushedAt.slice(0, 10))}</span>
                        <button class="install-btn ${isInstalling ? "installing" : ""}" data-repo="${escapeAttr(repo.name)}" ${isInstalling ? "disabled" : ""}>${buttonLabel}</button>
                      </div>
                    </div>
                  `;
                })
                .join("")
            : "";

          parts.push(`
            <div class="curated-category">
              <button class="category-header" data-cat="${escapeAttr(group.name)}" style="--cat-color: ${escapeAttr(group.color)}">
                <span class="cat-caret">${caret}</span>
                <span class="cat-emoji">${escapeHtml(group.emoji)}</span>
                <span class="cat-name">${escapeHtml(group.name)}</span>
                <span class="cat-count">${group.repos.length}</span>
              </button>
              <div class="category-body ${isExpanded ? "" : "hidden"}">${groupRepos}</div>
            </div>
          `);
        }
      }
    }
  }

  if (parts.length === 0) {
    els.roadmapList.innerHTML = `<div class="empty">로드맵이 없음</div>`;
    return;
  }

  els.roadmapList.innerHTML = parts.join("");

  // wire installed roadmap items
  els.roadmapList.querySelectorAll(".roadmap-item").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      // 휴지통 또는 d배지 클릭은 삭제 팝오버로 분기 (sub-roadmap 전용)
      const trigger = e.target.closest("[data-roadmap-delete]");
      if (trigger) {
        e.preventDefault();
        e.stopPropagation();
        const id = trigger.getAttribute("data-roadmap-delete");
        const title = btn.dataset.roadmapTitle ?? id;
        const depths = (btn.dataset.depths ?? "")
          .split(",")
          .filter(Boolean)
          .map((s) => Number(s));
        openDeletePopover(trigger, {
          kind: "roadmap",
          roadmapId: id,
          title,
          depths,
        });
        return;
      }
      const id = btn.dataset.id;
      if (id === state.activeRoadmapId) {
        els.roadmapList.classList.add("hidden");
        return;
      }
      switchRoadmap(id);
    });
  });

  // wire curated toggle
  const toggle = document.getElementById("curated-toggle");
  if (toggle) {
    toggle.addEventListener("click", async (e) => {
      e.stopPropagation();
      state.showAvailable = !state.showAvailable;
      if (state.showAvailable && state.curatedAvailable.length === 0) {
        await loadCuratedAvailable();
      } else {
        renderRoadmapSelector();
      }
    });
  }

  // wire refresh
  const refresh = document.getElementById("curated-refresh");
  if (refresh) {
    refresh.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      setStatus("Curated 목록 새로고침 중…");
      await loadCuratedAvailable(true);
      setStatus("");
    });
  }

  // wire install buttons
  els.roadmapList.querySelectorAll(".install-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const repoName = btn.dataset.repo;
      await installCuratedRepo(repoName);
    });
  });

  // wire category headers (Curated 받기 가능)
  els.roadmapList.querySelectorAll(".category-header[data-cat]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const catName = btn.dataset.cat;
      if (state.expandedCategories.has(catName)) {
        state.expandedCategories.delete(catName);
      } else {
        state.expandedCategories.add(catName);
      }
      renderRoadmapSelector();
    });
  });

  // wire local category headers
  els.roadmapList.querySelectorAll(".category-header[data-local-cat]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const catName = btn.dataset.localCat;
      if (state.expandedLocalCategories.has(catName)) {
        state.expandedLocalCategories.delete(catName);
      } else {
        state.expandedLocalCategories.add(catName);
      }
      renderRoadmapSelector();
    });
  });

  // wire local repo headers (collapsible)
  els.roadmapList.querySelectorAll(".repo-header[data-local-repo]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const key = btn.dataset.localRepo;
      if (state.expandedLocalRepos.has(key)) {
        state.expandedLocalRepos.delete(key);
      } else {
        state.expandedLocalRepos.add(key);
      }
      renderRoadmapSelector();
    });
  });

  // wire flat repo headers (sub-roadmap 하나뿐 → 헤더 자체가 클릭으로 active 설정)
  els.roadmapList.querySelectorAll(".repo-header[data-flat-roadmap-id]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.flatRoadmapId;
      if (id === state.activeRoadmapId) {
        els.roadmapList.classList.add("hidden");
        return;
      }
      switchRoadmap(id);
    });
  });
}

function roadmapItemHtml(r) {
  const isActive = r.id === state.activeRoadmapId;
  const lastDate = r.lastDate ?? "—";
  const depthBadge =
    r.maxDepth > 0 ? `<span class="depth-pill">d${r.maxDepth}</span>` : "";
  return `
    <button class="roadmap-item ${isActive ? "active" : ""}" data-id="${escapeAttr(r.id)}">
      <div class="roadmap-item-name">${escapeHtml(r.name)}</div>
      <div class="roadmap-item-meta">
        ${depthBadge}
        <span class="roadmap-item-progress">${r.visitedChapters}/${r.chapterCount}</span>
        <span class="roadmap-item-date">${escapeHtml(lastDate)}</span>
      </div>
      <div class="roadmap-item-id">${escapeHtml(r.id)}</div>
    </button>
  `;
}

async function installCuratedRepo(repoName) {
  if (state.installingRepo) return; // 중복 클릭 방지
  state.installingRepo = repoName;
  renderRoadmapSelector();
  setStatus(`📥 ${repoName} 클론 중… (수초~수십초)`);

  try {
    const res = await fetch("/api/curated/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo_name: repoName }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error ?? `HTTP ${res.status}`);
    }
    // 성공 → 로드맵 목록 다시 불러옴
    const roadmaps = await fetch("/api/roadmaps").then((r) => r.json());
    state.roadmaps = Array.isArray(roadmaps) ? roadmaps : [];

    // 방금 받은 레포의 첫 sub-로드맵을 active로
    const newOne = state.roadmaps.find(
      (r) => r.source === "curated" && r.id.includes(`/${repoName}`),
    );
    if (newOne) {
      state.activeRoadmapId = newOne.id;
      localStorage.setItem(LS_KEY, newOne.id);
    }

    setStatus(`✓ ${repoName} 설치 완료`, "success");
    state.installingRepo = null;
    renderRoadmapSelector();
    if (state.activeRoadmapId) await loadRoadmapData();
    setTimeout(() => setStatus(""), 3000);
  } catch (err) {
    state.installingRepo = null;
    renderRoadmapSelector();
    setStatus(`설치 실패: ${err.message}`, "error");
  }
}

/**
 * 진행 중인 세션이 있을 때 다른 곳으로 이동하기 전 처리.
 * @returns 'continue' (세션 없음 또는 사용자가 저장/폐기 선택 후 이동 OK)
 *          'cancel'   (사용자가 취소함 — 호출자는 이동을 멈춰야 함)
 */
async function handleSessionInterruption() {
  if (!state.session) return "continue";

  const action = await sessionInterruptPrompt();
  if (action === "cancel") return "cancel";

  if (action === "save") {
    // 저장 — 진행 카드 표시 (endSession과 동일 흐름)
    setPending(true);
    const card = createEndProgressCard();
    els.messages.appendChild(card);
    scrollToBottom();

    try {
      const res = await fetch(`/api/session/${state.session.id}/end`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let result = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const rawMsg = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const parsed = parseSseMessage(rawMsg);
          if (!parsed) continue;
          if (parsed.event === "stage") {
            updateEndProgressCard(card, parsed.data);
          } else if (parsed.event === "done") {
            result = parsed.data;
            finalizeEndProgressCard(card, parsed.data);
          } else if (parsed.event === "error") {
            throw new Error(parsed.data.message ?? "unknown");
          }
        }
      }

      if (!result) throw new Error("저장 완료 신호를 받지 못함");

      const roadmaps = await fetch("/api/roadmaps").then((r) => r.json());
      state.roadmaps = Array.isArray(roadmaps) ? roadmaps : [];
      setStatus("✓ 저장 완료 — 이동합니다", "success");
      setTimeout(() => setStatus(""), 2500);
    } catch (err) {
      card.classList.add("error");
      const titleEl = card.querySelector(".end-progress-card-title");
      if (titleEl)
        titleEl.innerHTML = `<span style="color:#f85149">❌ 저장 실패</span>`;
      setStatus(`저장 실패: ${err.message}`, "error");
      setPending(false);
      return "cancel";
    }
    setPending(false);
  } else if (action === "discard") {
    // 폐기 — 서버 세션도 정리 (메모리 누수 방지)
    fetch(`/api/session/${state.session.id}/cancel`, { method: "POST" }).catch(
      () => {},
    );
  }

  state.session = null;
  state.messages = [];
  enableSessionUi(false);
  updateTopbar();
  els.messages.innerHTML = `<div class="placeholder"><p>왼쪽에서 챕터를 골라 세션을 시작하세요.</p></div>`;
  return "continue";
}

/**
 * 세션 인터럽트 프롬프트. 3-way custom modal.
 * 브라우저 confirm은 yes/no 2-way라 새 모달로 구현.
 * @returns 'save' | 'discard' | 'cancel'
 */
function sessionInterruptPrompt() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-title">진행 중인 세션이 있어요</div>
        <div class="modal-body">
          <p><strong>${escapeHtml(state.session?.chapterTitle ?? "")}</strong> (depth ${state.session?.depth ?? "?"})</p>
          <p class="modal-hint">이대로 이동하면 현재까지의 대화는 사라집니다. 어떻게 할까요?</p>
        </div>
        <div class="modal-actions">
          <button class="modal-btn cancel" data-action="cancel">취소</button>
          <button class="modal-btn discard" data-action="discard">폐기하고 이동</button>
          <button class="modal-btn primary" data-action="save">저장하고 이동</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    function cleanup(action) {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(action);
    }

    function onKey(e) {
      if (e.key === "Escape") cleanup("cancel");
    }
    document.addEventListener("keydown", onKey);

    overlay.querySelectorAll(".modal-btn").forEach((btn) => {
      btn.addEventListener("click", () => cleanup(btn.dataset.action));
    });
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) cleanup("cancel");
    });
  });
}

async function switchRoadmap(roadmapId) {
  const decision = await handleSessionInterruption();
  if (decision === "cancel") return;

  state.activeRoadmapId = roadmapId;
  localStorage.setItem(LS_KEY, roadmapId);
  els.roadmapList.classList.add("hidden");
  renderRoadmapSelector();
  await loadRoadmapData();
  scrollToRecentChapter();
}

/**
 * 가장 최근 학습한 챕터(lastDate 기준)를 viewport 중앙으로 스크롤.
 * 없으면 아무것도 하지 않음.
 */
function scrollToRecentChapter() {
  if (!Array.isArray(state.chapters) || state.chapters.length === 0) return;
  const visited = state.chapters
    .filter((c) => c.lastDate)
    .sort((a, b) => (b.lastDate ?? "").localeCompare(a.lastDate ?? ""));
  const target = visited[0];
  if (!target) return;
  requestAnimationFrame(() => {
    const el = els.chapterList.querySelector(
      `button[data-id="${CSS.escape(target.id)}"]`,
    );
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  });
}

function renderChapters() {
  els.chapterList.innerHTML = "";
  if (state.chapters.length === 0) {
    els.chapterList.innerHTML = `<li class="empty">챕터 없음</li>`;
    return;
  }
  state.chapters.forEach((ch, i) => {
    const li = document.createElement("li");
    li.className = "chapter-item";
    const visited = (ch.maxDepth ?? 0) > 0;
    const badge = visited
      ? `<span class="chapter-depth-pill deletable" data-chapter-delete="${escapeAttr(ch.id)}" title="클릭하여 노트 삭제 · 마지막 학습: ${escapeAttr(ch.lastDate ?? "")} · 총 ${ch.visitCount}회">d${ch.maxDepth}</span>`
      : `<span class="chapter-depth-pill empty"></span>`;
    // visited 챕터에 노트 열기 + 삭제 트리거 (hover 시 등장)
    const openBtn = visited
      ? `<span class="chapter-open-btn" data-chapter-open="${escapeAttr(ch.id)}" role="button" tabindex="0" title="기존 노트 열기 (Obsidian)">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
          </svg>
        </span>`
      : "";
    const trashBtn = visited
      ? `<span class="chapter-delete-btn" data-chapter-delete="${escapeAttr(ch.id)}" role="button" tabindex="0" title="이 챕터의 노트 삭제">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
            <path d="M10 11v6M14 11v6"></path>
            <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path>
          </svg>
        </span>`
      : "";
    li.innerHTML = `
      <button class="chapter-btn ${visited ? "visited" : ""}" data-id="${escapeAttr(ch.id)}">
        <span class="num">${i + 1}.</span>
        <span class="title">${escapeHtml(ch.title)}</span>
        ${badge}
        ${openBtn}
        ${trashBtn}
      </button>
    `;
    const btn = li.querySelector("button");
    btn.addEventListener("click", async (e) => {
      // 노트 열기 (📖) 클릭은 Obsidian 노트 열기로 분기
      const openTrigger = e.target.closest("[data-chapter-open]");
      if (openTrigger) {
        e.preventDefault();
        e.stopPropagation();
        openChapterNotePopover(openTrigger, ch);
        return;
      }
      // depth 배지 또는 휴지통 클릭은 삭제 팝오버로 분기
      const trigger = e.target.closest("[data-chapter-delete]");
      if (trigger) {
        e.preventDefault();
        e.stopPropagation();
        openDeletePopover(trigger, {
          kind: "chapter",
          roadmapId: state.activeRoadmapId,
          chapterId: ch.id,
          title: ch.title,
          depths: ch.depths,
        });
        return;
      }
      const decision = await handleSessionInterruption();
      if (decision === "cancel") return;
      startSession(ch.id);
    });
    els.chapterList.appendChild(li);
  });
}

function openChapterNotePopover(anchorEl, chapter) {
  const links = Array.isArray(chapter.noteLinks) ? chapter.noteLinks : [];
  if (links.length === 0) return;
  // 1개면 바로 열기
  if (links.length === 1) {
    window.location.href = links[0].url;
    return;
  }
  // 여러 개면 팝오버
  closeDeletePopover();
  const pop = document.createElement("div");
  pop.className = "delete-popover";
  const header = `<div class="delete-popover-title">노트 열기 — ${escapeHtml(chapter.title)}</div>`;
  const items = links
    .map(
      (l) =>
        `<a class="delete-popover-item" href="${escapeAttr(l.url)}">📖 d${l.depth} 노트 (${escapeHtml(l.date)})</a>`,
    )
    .join("");
  const hint = `<div class="delete-popover-hint">Obsidian에서 열림</div>`;
  pop.innerHTML = header + items + hint;
  const rect = anchorEl.getBoundingClientRect();
  pop.style.position = "fixed";
  pop.style.top = `${rect.bottom + 4}px`;
  pop.style.left = `${Math.min(rect.left, window.innerWidth - 240)}px`;
  document.body.appendChild(pop);
  _activePopover = pop;
  pop.addEventListener("click", (e) => {
    if (e.target.closest("a")) closeDeletePopover();
  });
  setTimeout(() => {
    document.addEventListener("mousedown", _onOutsideClick, true);
    document.addEventListener("keydown", _onPopoverKey, true);
  }, 0);
}

// ──────────────────────────────────────────────────────────
// 설정 + 워크스페이스 (Electron 모드 전용)
// ──────────────────────────────────────────────────────────

let _settingsCache = null;

async function initSettings() {
  _settingsCache = await window.spiralSettings.get();
  renderWorkspaceSelector();

  // topbar 설정 버튼
  els.settingsBtn?.addEventListener("click", openSettingsModal);
  els.settingsModalClose?.addEventListener("click", closeSettingsModal);
  els.settingsModal?.addEventListener("click", (e) => {
    if (e.target === els.settingsModal) closeSettingsModal();
  });

  // 워크스페이스 셀렉터 토글
  els.workspaceCurrent?.addEventListener("click", () => {
    els.workspaceList?.classList.toggle("hidden");
  });

  // ESC로 모달 닫기
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (els.settingsModal && !els.settingsModal.classList.contains("hidden")) {
        closeSettingsModal();
      }
      if (els.addWsModal && !els.addWsModal.classList.contains("hidden")) {
        closeAddWorkspaceModal();
      }
    }
  });

  // 설정 모달 탭 스위칭
  els.settingsModal?.querySelectorAll(".settings-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      els.settingsModal
        .querySelectorAll(".settings-tab")
        .forEach((t) => t.classList.toggle("active", t === tab));
      const target = tab.dataset.tab;
      els.settingsModal
        .querySelectorAll(".settings-panel")
        .forEach((p) =>
          p.classList.toggle("hidden", p.dataset.panel !== target),
        );
    });
  });

  // 일반 설정 액션들
  document.getElementById("settings-save-api-key")?.addEventListener("click", saveApiKey);
  document.getElementById("settings-save-vault")?.addEventListener("click", saveVault);
  document.getElementById("settings-pick-vault")?.addEventListener("click", pickVault);
  document.getElementById("settings-save-model")?.addEventListener("click", saveModel);

  // 워크스페이스 액션
  document
    .getElementById("settings-add-workspace-btn")
    ?.addEventListener("click", openAddWorkspaceModal);

  // 새 워크스페이스 모달
  initAddWorkspaceModal();
}

function renderWorkspaceSelector() {
  if (!_settingsCache) return;
  const active = _settingsCache.workspaces.find(
    (w) => w.id === _settingsCache.activeWorkspaceId,
  );
  if (active && els.workspaceName) {
    els.workspaceName.textContent = active.name;
  }
  if (!els.workspaceList) return;
  els.workspaceList.innerHTML = _settingsCache.workspaces
    .map((w) => {
      const isActive = w.id === _settingsCache.activeWorkspaceId;
      return `
        <button class="workspace-item ${isActive ? "active" : ""}" data-id="${escapeAttr(w.id)}">
          <span class="workspace-item-icon">${isActive ? "✓" : "·"}</span>
          <span class="workspace-item-name">${escapeHtml(w.name)}</span>
        </button>
      `;
    })
    .join("") +
    `<button class="workspace-item add" id="workspace-list-add">＋ 새 워크스페이스</button>`;

  els.workspaceList.querySelectorAll(".workspace-item[data-id]").forEach((b) => {
    b.addEventListener("click", async () => {
      const id = b.dataset.id;
      if (id === _settingsCache.activeWorkspaceId) {
        els.workspaceList.classList.add("hidden");
        return;
      }
      const ok = window.confirm(
        `워크스페이스를 전환하면 앱이 재시작됩니다. 진행할까요?`,
      );
      if (!ok) return;
      await window.spiralSettings.switchWorkspace(id);
    });
  });
  document.getElementById("workspace-list-add")?.addEventListener("click", () => {
    els.workspaceList.classList.add("hidden");
    openAddWorkspaceModal();
  });
}

function openSettingsModal() {
  if (!_settingsCache) return;
  els.settingsModal.classList.remove("hidden");
  els.settingsModal.setAttribute("aria-hidden", "false");
  document.getElementById("settings-api-key").value = "";
  document.getElementById("settings-api-key").placeholder =
    _settingsCache.apiKeyMasked ?? "sk-ant-...";
  document.getElementById("settings-vault-path").value =
    _settingsCache.vaultPath ?? "";
  document.getElementById("settings-api-key-status").textContent = "";

  // 모델 목록은 state.models에서 (이미 메인앱에 로드됨)
  const modelSel = document.getElementById("settings-model");
  if (modelSel) {
    modelSel.innerHTML = (state.models ?? [])
      .map(
        (m) =>
          `<option value="${escapeAttr(m.id)}"${m.id === _settingsCache.model ? " selected" : ""}>${escapeHtml(m.label ?? m.id)}</option>`,
      )
      .join("");
  }

  renderWorkspaceListInSettings();
}

function closeSettingsModal() {
  els.settingsModal?.classList.add("hidden");
}

async function saveApiKey() {
  const input = document.getElementById("settings-api-key");
  const status = document.getElementById("settings-api-key-status");
  const val = input.value.trim();
  if (!val) {
    status.textContent = "키를 입력하세요.";
    return;
  }
  const res = await window.spiralSettings.updateApiKey(val);
  if (res.ok) {
    status.textContent = "✓ 저장됨 (다음 세션부터 적용)";
    _settingsCache = await window.spiralSettings.get();
    input.value = "";
    input.placeholder = _settingsCache.apiKeyMasked;
  } else {
    status.textContent = `✗ ${res.error}`;
  }
}

async function pickVault() {
  const p = await window.spiralSettings.pickDirectory({
    title: "Vault 경로 선택",
  });
  if (p) document.getElementById("settings-vault-path").value = p;
}

async function saveVault() {
  const val = document.getElementById("settings-vault-path").value.trim();
  const res = await window.spiralSettings.updateVault(val);
  if (res.ok) {
    alert("Vault 경로가 저장됐습니다. 앱을 재시작합니다.");
    // restartNeeded → 사용자에게 안내. 자동 재시작은 메인 process에서.
  } else {
    alert(`저장 실패: ${res.error}`);
  }
}

async function saveModel() {
  const val = document.getElementById("settings-model").value;
  await window.spiralSettings.updateModel(val);
  _settingsCache = await window.spiralSettings.get();
}

function renderWorkspaceListInSettings() {
  const container = document.getElementById("settings-workspace-list");
  if (!container || !_settingsCache) return;
  container.innerHTML = _settingsCache.workspaces
    .map((w) => {
      const isActive = w.id === _settingsCache.activeWorkspaceId;
      const sourceTag = w.source ? `<span class="ws-source">${escapeHtml(w.source)}</span>` : "";
      return `
        <div class="ws-row ${isActive ? "active" : ""}">
          <div class="ws-row-main">
            <div class="ws-row-name">
              ${isActive ? "✓ " : ""}${escapeHtml(w.name)}
              ${sourceTag}
            </div>
            <div class="ws-row-path"><code>${escapeHtml(w.roadmapRoot ?? "")}</code></div>
            <div class="ws-row-vaultsub">노트: <code>vault/${escapeHtml(w.vaultSubDir ?? "spiral-buddy")}/</code></div>
          </div>
          <div class="ws-row-actions">
            ${
              isActive
                ? '<span class="ws-active-label">활성</span>'
                : `<button data-action="switch" data-id="${escapeAttr(w.id)}" class="ws-btn">전환</button>`
            }
            ${
              _settingsCache.workspaces.length > 1
                ? `<button data-action="remove" data-id="${escapeAttr(w.id)}" class="ws-btn danger">삭제</button>`
                : ""
            }
          </div>
        </div>
      `;
    })
    .join("");
  container.querySelectorAll(".ws-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (action === "switch") {
        const ok = window.confirm("전환 시 앱이 재시작됩니다. 진행할까요?");
        if (!ok) return;
        await window.spiralSettings.switchWorkspace(id);
      } else if (action === "remove") {
        const ws = _settingsCache.workspaces.find((w) => w.id === id);
        const ok = window.confirm(
          `워크스페이스 "${ws?.name}"를 삭제할까요?\n(학습 자료 폴더와 노트 파일은 그대로 남습니다.)`,
        );
        if (!ok) return;
        const res = await window.spiralSettings.removeWorkspace(id);
        if (!res.ok) alert(res.error);
        else {
          _settingsCache = await window.spiralSettings.get();
          renderWorkspaceListInSettings();
          renderWorkspaceSelector();
        }
      }
    });
  });
}

// ─── 새 워크스페이스 추가 모달 ─────────────────────────────────

function initAddWorkspaceModal() {
  document.getElementById("add-ws-close")?.addEventListener("click", closeAddWorkspaceModal);
  document.getElementById("add-ws-cancel")?.addEventListener("click", closeAddWorkspaceModal);
  els.addWsModal?.addEventListener("click", (e) => {
    if (e.target === els.addWsModal) closeAddWorkspaceModal();
  });
  document.querySelectorAll('input[name="ws-source"]').forEach((r) => {
    r.addEventListener("change", () => {
      const isGit = document.querySelector('input[name="ws-source"]:checked').value === "git";
      document.getElementById("add-ws-git-field").classList.toggle("hidden", !isGit);
      document.getElementById("add-ws-dir-field").classList.toggle("hidden", isGit);
    });
  });
  document.getElementById("add-ws-pick-dir")?.addEventListener("click", async () => {
    const p = await window.spiralSettings.pickDirectory({
      title: "학습 자료 디렉토리 선택",
    });
    if (p) document.getElementById("add-ws-local-path").value = p;
  });
  document.getElementById("add-ws-submit")?.addEventListener("click", submitAddWorkspace);

  // progress listener
  window.spiralSettings.onWorkspaceProgress((p) => {
    const box = document.getElementById("add-ws-progress");
    if (!box) return;
    box.classList.remove("hidden");
    if (p.phase === "cloning") {
      box.textContent = `git clone 중… ${p.message ?? ""}`;
    } else if (p.phase === "done") {
      box.textContent = `✓ "${p.name}" 추가 완료`;
    }
  });
}

function openAddWorkspaceModal() {
  els.addWsModal.classList.remove("hidden");
  els.addWsModal.setAttribute("aria-hidden", "false");
  document.getElementById("add-ws-name").value = "";
  document.getElementById("add-ws-git-url").value = "";
  document.getElementById("add-ws-local-path").value = "";
  document.getElementById("add-ws-error").classList.add("hidden");
  document.getElementById("add-ws-progress").classList.add("hidden");
  document.querySelector('input[name="ws-source"][value="git"]').checked = true;
  document.getElementById("add-ws-git-field").classList.remove("hidden");
  document.getElementById("add-ws-dir-field").classList.add("hidden");
}

function closeAddWorkspaceModal() {
  els.addWsModal?.classList.add("hidden");
}

async function submitAddWorkspace() {
  const errBox = document.getElementById("add-ws-error");
  errBox.classList.add("hidden");
  const name = document.getElementById("add-ws-name").value.trim();
  if (!name) {
    errBox.textContent = "이름을 입력하세요.";
    errBox.classList.remove("hidden");
    return;
  }
  const sourceKind = document.querySelector('input[name="ws-source"]:checked').value;
  const submitBtn = document.getElementById("add-ws-submit");
  submitBtn.disabled = true;
  submitBtn.textContent = "추가 중…";
  const args = { name, sourceKind };
  if (sourceKind === "git") {
    args.gitUrl = document.getElementById("add-ws-git-url").value.trim();
  } else {
    args.localPath = document.getElementById("add-ws-local-path").value.trim();
  }
  const res = await window.spiralSettings.addWorkspace(args);
  submitBtn.disabled = false;
  submitBtn.textContent = "추가";
  if (!res.ok) {
    errBox.textContent = res.error;
    errBox.classList.remove("hidden");
    return;
  }
  _settingsCache = await window.spiralSettings.get();
  renderWorkspaceListInSettings();
  renderWorkspaceSelector();
  closeAddWorkspaceModal();
  // 새 워크스페이스로 전환 제안
  const switchOk = window.confirm(
    `"${name}" 추가 완료. 지금 이 워크스페이스로 전환할까요? (앱 재시작)`,
  );
  if (switchOk) await window.spiralSettings.switchWorkspace(res.workspace.id);
}

// ──────────────────────────────────────────────────────────
// 휴지통
// ──────────────────────────────────────────────────────────

async function refreshTrashBadge() {
  try {
    const list = await fetch("/api/trash").then((r) => r.json());
    const count = Array.isArray(list) ? list.length : 0;
    if (els.trashCount) els.trashCount.textContent = String(count);
    if (els.trashOpenBtn) {
      els.trashOpenBtn.classList.toggle("hidden", count === 0);
    }
  } catch {
    /* ignore */
  }
}

async function openTrashModal() {
  if (!els.trashModal) return;
  els.trashModal.classList.remove("hidden");
  els.trashModal.setAttribute("aria-hidden", "false");
  els.trashList.innerHTML = `<li class="empty">loading…</li>`;
  try {
    const list = await fetch("/api/trash").then((r) => r.json());
    renderTrashList(Array.isArray(list) ? list : []);
  } catch (err) {
    els.trashList.innerHTML = `<li class="empty">목록 로드 실패: ${escapeHtml(err.message)}</li>`;
  }
}

function closeTrashModal() {
  if (!els.trashModal) return;
  els.trashModal.classList.add("hidden");
  els.trashModal.setAttribute("aria-hidden", "true");
}

function renderTrashList(entries) {
  if (entries.length === 0) {
    els.trashList.innerHTML = `<li class="empty">비어있음</li>`;
    return;
  }
  els.trashList.innerHTML = entries
    .map((e) => {
      const title = e.title || e.topic || e.originalName || e.fileName;
      const depthLabel = e.depth !== null ? `d${e.depth}` : "—";
      const trashedAt = (e.trashedAt ?? "").slice(0, 19).replace("T", " ");
      const scope = [e.roadmapName, e.chapterId].filter(Boolean).join(" · ");
      return `
        <li class="trash-item">
          <div class="trash-item-main">
            <div class="trash-item-title">${escapeHtml(title)}</div>
            <div class="trash-item-meta">
              <span class="trash-depth">${depthLabel}</span>
              ${scope ? `<span>${escapeHtml(scope)}</span>` : ""}
              <span class="trash-item-when">${escapeHtml(trashedAt)} 삭제</span>
            </div>
          </div>
          <button class="trash-restore-btn" data-file="${escapeAttr(e.fileName)}" type="button" title="복구">
            ↩ 복구
          </button>
        </li>
      `;
    })
    .join("");
  els.trashList.querySelectorAll(".trash-restore-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const fileName = btn.dataset.file;
      btn.disabled = true;
      btn.textContent = "복구 중…";
      try {
        const res = await fetch("/api/trash/restore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          alert(`복구 실패: ${err.error ?? res.status}`);
          btn.disabled = false;
          btn.textContent = "↩ 복구";
          return;
        }
        // 갱신: 모달 + 사이드바 + 챕터
        await Promise.all([
          openTrashModal(),
          refreshSidebarRoadmaps(),
          loadRoadmapData(),
        ]);
      } catch (err) {
        alert(`복구 실패: ${err.message}`);
        btn.disabled = false;
        btn.textContent = "↩ 복구";
      }
    });
  });
}

// ──────────────────────────────────────────────────────────
// 학습 활동 캘린더 (contribution graph)
// ──────────────────────────────────────────────────────────

async function openActivityModal() {
  if (!els.activityModal) return;
  els.activityModal.classList.remove("hidden");
  els.activityModal.setAttribute("aria-hidden", "false");
  els.activitySummary.innerHTML = "loading…";
  els.activityGrid.innerHTML = "";
  els.activityMonthLabels.innerHTML = "";
  try {
    const data = await fetch("/api/activity?days=365").then((r) => r.json());
    renderActivity(data);
  } catch (err) {
    els.activitySummary.innerHTML = `로드 실패: ${escapeHtml(err.message)}`;
  }
}

function closeActivityModal() {
  if (!els.activityModal) return;
  els.activityModal.classList.add("hidden");
  els.activityModal.setAttribute("aria-hidden", "true");
}

function renderActivity(data) {
  const byDate = data.byDate ?? {};
  const byDepth = data.byDepth ?? {};
  const totalNotes = data.total ?? 0;

  // 365일치 그리드 — 오늘부터 거꾸로 365일, 일요일 시작 column 정렬
  // GitHub처럼 row=요일(일~토 7개), col=주
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const oneDay = 86400000;
  const start = new Date(today.getTime() - 364 * oneDay);
  // 첫 주의 시작 일요일까지 padding
  const startDay = start.getDay(); // 0=일
  const gridStart = new Date(start.getTime() - startDay * oneDay);

  const weeks = Math.ceil((today.getTime() - gridStart.getTime()) / oneDay / 7) + 1;
  const cells = [];
  // depth 분포 계산 위해 최댓값
  const counts = Object.values(byDate);
  const max = counts.length ? Math.max(...counts) : 0;
  const level = (n) => {
    if (n === 0) return 0;
    if (max <= 1) return 4;
    if (n >= max * 0.75) return 4;
    if (n >= max * 0.5) return 3;
    if (n >= max * 0.25) return 2;
    return 1;
  };

  // 활성 일수
  let activeDays = 0;
  let currentStreak = 0;
  let longestStreak = 0;
  let runningStreak = 0;
  // 그리드 셀
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const ts = gridStart.getTime() + (w * 7 + d) * oneDay;
      const date = new Date(ts);
      if (ts > today.getTime()) {
        cells.push(`<div class="activity-cell" data-level="-1"></div>`);
        continue;
      }
      const dateStr = date.toISOString().slice(0, 10);
      const count = byDate[dateStr] ?? 0;
      if (count > 0) {
        activeDays++;
        runningStreak++;
        if (runningStreak > longestStreak) longestStreak = runningStreak;
      } else {
        runningStreak = 0;
      }
      cells.push(
        `<div class="activity-cell" data-level="${level(count)}" title="${dateStr}: ${count}개 노트"></div>`,
      );
    }
  }
  // current streak: 오늘부터 거꾸로 연속 노트 있는 일수
  for (let i = 0; i <= 364; i++) {
    const ts = today.getTime() - i * oneDay;
    const ds = new Date(ts).toISOString().slice(0, 10);
    if (byDate[ds]) currentStreak++;
    else break;
  }

  els.activityGrid.style.gridTemplateColumns = `repeat(${weeks}, 1fr)`;
  els.activityGrid.innerHTML = cells.join("");

  // 월 레이블 (대략 매 4주마다)
  const monthLabels = [];
  let lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    const ts = gridStart.getTime() + w * 7 * oneDay;
    const date = new Date(ts);
    if (date.getMonth() !== lastMonth) {
      monthLabels.push(`<span style="grid-column: ${w + 1};">${date.toLocaleDateString("ko", { month: "short" })}</span>`);
      lastMonth = date.getMonth();
    }
  }
  els.activityMonthLabels.style.gridTemplateColumns = `repeat(${weeks}, 1fr)`;
  els.activityMonthLabels.innerHTML = monthLabels.join("");

  // 요약
  const depthSummary = Object.entries(byDepth)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([d, n]) => `<span class="activity-stat">d${d}: <strong>${n}</strong></span>`)
    .join("");
  els.activitySummary.innerHTML = `
    <span class="activity-stat">총 노트: <strong>${totalNotes}</strong></span>
    <span class="activity-stat">활동일 (1년): <strong>${activeDays}</strong></span>
    <span class="activity-stat">현재 연속: <strong>${currentStreak}일</strong></span>
    <span class="activity-stat">최장 연속: <strong>${longestStreak}일</strong></span>
    ${depthSummary}
  `;
}

// ──────────────────────────────────────────────────────────
// 검색 (Cmd+K)
// ──────────────────────────────────────────────────────────

const _searchState = {
  items: [], // flat list: [{kind, payload, label, sublabel}, ...]
  selectedIndex: 0,
  lastQuery: "",
  inflight: null,
};

function openSearchModal() {
  if (!els.searchModal) return;
  els.searchModal.classList.remove("hidden");
  els.searchModal.setAttribute("aria-hidden", "false");
  els.searchInput.value = "";
  els.searchResults.innerHTML = `<div class="search-hint">최소 2글자 입력해 검색</div>`;
  _searchState.items = [];
  _searchState.selectedIndex = 0;
  _searchState.lastQuery = "";
  setTimeout(() => els.searchInput.focus(), 0);
}

function closeSearchModal() {
  if (!els.searchModal) return;
  els.searchModal.classList.add("hidden");
  els.searchModal.setAttribute("aria-hidden", "true");
}

async function runSearch(q) {
  const trimmed = q.trim();
  if (trimmed.length < 2) {
    els.searchResults.innerHTML = `<div class="search-hint">최소 2글자 입력해 검색</div>`;
    _searchState.items = [];
    _searchState.selectedIndex = 0;
    return;
  }
  if (trimmed === _searchState.lastQuery) return;
  _searchState.lastQuery = trimmed;

  // 이전 inflight 무시 (덮어쓰기)
  const myToken = (_searchState.inflight = Symbol("search"));
  els.searchResults.innerHTML = `<div class="search-hint">검색 중…</div>`;
  try {
    const res = await fetch(
      `/api/search?q=${encodeURIComponent(trimmed)}`,
    ).then((r) => r.json());
    if (_searchState.inflight !== myToken) return; // 다른 검색이 뒤에 시작됨
    renderSearchResults(res, trimmed);
  } catch (err) {
    if (_searchState.inflight !== myToken) return;
    els.searchResults.innerHTML = `<div class="search-hint">검색 실패: ${escapeHtml(err.message)}</div>`;
  }
}

function highlight(text, q) {
  if (!text || !q) return escapeHtml(text ?? "");
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return escapeHtml(text);
  return (
    escapeHtml(text.slice(0, idx)) +
    `<mark>${escapeHtml(text.slice(idx, idx + q.length))}</mark>` +
    escapeHtml(text.slice(idx + q.length))
  );
}

function renderSearchResults(res, q) {
  const items = [];
  // 로드맵
  for (const r of res.roadmaps ?? []) {
    items.push({
      kind: "roadmap",
      payload: r,
      label: r.name,
      sublabel: r.path,
    });
  }
  // 챕터
  for (const c of res.chapters ?? []) {
    items.push({
      kind: "chapter",
      payload: c,
      label: c.title,
      sublabel: `${c.roadmapName} · ${c.chapterId}`,
    });
  }
  // 노트
  for (const n of res.notes ?? []) {
    items.push({
      kind: "note",
      payload: n,
      label: n.title || n.topic,
      sublabel: `d${n.depth} · ${n.date} · ${n.roadmapName ?? "?"} · ${n.chapterId ?? "?"}`,
    });
  }
  _searchState.items = items;
  _searchState.selectedIndex = 0;

  if (items.length === 0) {
    els.searchResults.innerHTML = `<div class="search-hint">결과 없음</div>`;
    return;
  }
  const sections = [];
  const groups = [
    { kind: "roadmap", label: "로드맵", icon: "📕" },
    { kind: "chapter", label: "챕터", icon: "🔖" },
    { kind: "note", label: "노트", icon: "📝" },
  ];
  let flatIdx = 0;
  for (const g of groups) {
    const group = items.filter((it) => it.kind === g.kind);
    if (group.length === 0) continue;
    sections.push(
      `<div class="search-section-label">${g.icon} ${g.label} · ${group.length}</div>`,
    );
    for (const it of group) {
      const idxInFlat = items.indexOf(it);
      sections.push(`
        <div class="search-item" data-idx="${idxInFlat}">
          <div class="search-item-label">${highlight(it.label, q)}</div>
          <div class="search-item-sublabel">${highlight(it.sublabel, q)}</div>
        </div>
      `);
      flatIdx++;
    }
  }
  els.searchResults.innerHTML = sections.join("");
  updateSearchSelection();
  els.searchResults.querySelectorAll(".search-item").forEach((el) => {
    el.addEventListener("click", () => {
      _searchState.selectedIndex = Number(el.dataset.idx);
      activateSearchSelection();
    });
    el.addEventListener("mouseenter", () => {
      _searchState.selectedIndex = Number(el.dataset.idx);
      updateSearchSelection();
    });
  });
}

function updateSearchSelection() {
  const nodes = els.searchResults.querySelectorAll(".search-item");
  nodes.forEach((n) => {
    const isActive = Number(n.dataset.idx) === _searchState.selectedIndex;
    n.classList.toggle("active", isActive);
    if (isActive && typeof n.scrollIntoView === "function") {
      n.scrollIntoView({ block: "nearest" });
    }
  });
}

function moveSearchSelection(delta) {
  if (_searchState.items.length === 0) return;
  _searchState.selectedIndex =
    (_searchState.selectedIndex + delta + _searchState.items.length) %
    _searchState.items.length;
  updateSearchSelection();
}

async function activateSearchSelection() {
  const item = _searchState.items[_searchState.selectedIndex];
  if (!item) return;
  closeSearchModal();
  if (item.kind === "roadmap") {
    await switchRoadmap(item.payload.id);
  } else if (item.kind === "chapter") {
    // 로드맵 전환 + 챕터 자동 시작
    if (state.activeRoadmapId !== item.payload.roadmapId) {
      await switchRoadmap(item.payload.roadmapId);
    }
    // 챕터 시작 전 세션 인터럽트 체크
    const decision = await handleSessionInterruption();
    if (decision === "cancel") return;
    startSession(item.payload.chapterId);
  } else if (item.kind === "note") {
    if (item.payload.obsidianUrl) {
      window.location.href = item.payload.obsidianUrl;
    }
  }
}

async function refreshSidebarRoadmaps() {
  try {
    const list = await fetch("/api/roadmaps").then((r) => r.json());
    state.roadmaps = Array.isArray(list) ? list : [];
    renderRoadmapSelector();
  } catch {
    /* ignore — 사이드바 갱신 실패는 치명적이지 않음 */
  }
}

let _activePopover = null;

function closeDeletePopover() {
  if (_activePopover) {
    _activePopover.remove();
    _activePopover = null;
    document.removeEventListener("mousedown", _onOutsideClick, true);
    document.removeEventListener("keydown", _onPopoverKey, true);
  }
}

function _onOutsideClick(e) {
  if (_activePopover && !_activePopover.contains(e.target)) {
    closeDeletePopover();
  }
}

function _onPopoverKey(e) {
  if (e.key === "Escape") closeDeletePopover();
}

/**
 * 삭제 팝오버. target은 챕터 또는 sub-roadmap.
 *   - 챕터: { kind: "chapter", roadmapId, chapterId, title, depths }
 *   - 로드맵: { kind: "roadmap", roadmapId, title, depths }
 */
function openDeletePopover(anchorEl, target) {
  closeDeletePopover();
  const depths = Array.isArray(target.depths) ? target.depths : [];
  if (depths.length === 0) return;

  const isRoadmap = target.kind === "roadmap";
  const pop = document.createElement("div");
  pop.className = "delete-popover";

  const scopeLabel = isRoadmap ? "로드맵 전체" : "챕터";
  const header = `<div class="delete-popover-title">${escapeHtml(scopeLabel)} 노트 삭제 — ${escapeHtml(target.title)}</div>`;
  const perDepthBtns =
    depths.length > 1
      ? depths
          .map(
            (d) =>
              `<button class="delete-popover-item" data-depth="${d}">d${d} 노트만 삭제</button>`,
          )
          .join("")
      : "";
  const allLabel =
    depths.length > 1
      ? isRoadmap
        ? "이 로드맵 모두 삭제 (초기화)"
        : "모두 삭제 (초기화)"
      : isRoadmap
        ? `이 로드맵의 d${depths[0]} 삭제 (초기화)`
        : `d${depths[0]} 삭제 (초기화)`;
  const allBtn = `<button class="delete-popover-item danger" data-all="1">${allLabel}</button>`;
  const hint = `<div class="delete-popover-hint">vault의 spiral-buddy/.trash/로 이동 — 복구 가능</div>`;

  pop.innerHTML = header + perDepthBtns + allBtn + hint;

  // 위치 계산
  const rect = anchorEl.getBoundingClientRect();
  pop.style.position = "fixed";
  pop.style.top = `${rect.bottom + 4}px`;
  pop.style.left = `${Math.min(rect.left, window.innerWidth - 240)}px`;

  document.body.appendChild(pop);
  _activePopover = pop;

  pop.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-depth], button[data-all]");
    if (!btn) return;
    const depthAttr = btn.getAttribute("data-depth");
    const isAll = btn.hasAttribute("data-all");
    const payload = { roadmapId: target.roadmapId };
    if (!isRoadmap) payload.chapterId = target.chapterId;
    if (depthAttr !== null) payload.depth = Number(depthAttr);

    // "모두 삭제(초기화)" 액션엔 한 번 confirm. depth 부분 삭제는 confirm 없음.
    if (isAll) {
      const scope = isRoadmap ? "로드맵 전체" : "이 챕터";
      const ok = window.confirm(
        `${scope}의 모든 노트를 .trash/로 옮길까요?\n— ${target.title}`,
      );
      if (!ok) return;
    }
    closeDeletePopover();
    try {
      const res = await fetch("/api/notes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`삭제 실패: ${err.error ?? res.status}`);
        return;
      }
      // 챕터 목록 + 사이드바 진도/배지 + 휴지통 뱃지 모두 갱신
      await Promise.all([
        loadRoadmapData(),
        refreshSidebarRoadmaps(),
        refreshTrashBadge(),
      ]);
    } catch (err) {
      alert(`삭제 실패: ${err.message}`);
    }
  });

  // 외부 클릭 / ESC 로 닫기 (다음 tick부터 활성)
  setTimeout(() => {
    document.addEventListener("mousedown", _onOutsideClick, true);
    document.addEventListener("keydown", _onPopoverKey, true);
  }, 0);
}

function renderHistory() {
  els.historyList.innerHTML = "";
  if (state.history.length === 0) {
    els.historyList.innerHTML = `<li class="empty">아직 노트 없음</li>`;
    return;
  }
  state.history.forEach((note) => {
    const li = document.createElement("li");
    li.className = "history-item";
    const topicHtml = note.obsidianUri
      ? `<a class="topic-link" href="${escapeAttr(note.obsidianUri)}" title="옵시디언에서 열기">${escapeHtml(note.topic)}</a>`
      : `<span class="topic">${escapeHtml(note.topic)}</span>`;
    li.innerHTML = `
      <div class="row1">
        <span class="depth-pill">d${note.depth}</span>
        ${topicHtml}
      </div>
      <div class="row2">
        <span class="date">${escapeHtml(note.date)}</span>
        ${note.summary ? `<span class="summary">${escapeHtml(note.summary)}</span>` : ""}
      </div>
    `;
    els.historyList.appendChild(li);
  });
}

function renderSuggestion() {
  const s = state.suggestion;
  if (!s) {
    els.suggestion.innerHTML = `<div class="empty">no suggestion</div>`;
    return;
  }
  const chapter = state.chapters.find((c) => c.id === s.recommendedChapterId);
  els.suggestion.innerHTML = `
    <div class="suggestion-mode">🧭 ${s.mode}</div>
    ${
      chapter
        ? `<div class="suggestion-title">${escapeHtml(chapter.title)}</div>`
        : ""
    }
    <div class="suggestion-rationale">${escapeHtml(s.rationale)}</div>
    ${
      chapter
        ? `<button class="start-suggested primary">Start with this</button>`
        : ""
    }
  `;
  const btn = els.suggestion.querySelector(".start-suggested");
  if (btn && chapter) {
    btn.addEventListener("click", async () => {
      const decision = await handleSessionInterruption();
      if (decision === "cancel") return;
      startSession(chapter.id);
    });
  }
}

// ──────────────────────────────────────────────────────────
// Session
// ──────────────────────────────────────────────────────────

async function startSession(chapterId) {
  els.messages.innerHTML = "";
  state.messages = [];

  const chapter = state.chapters.find((c) => c.id === chapterId);
  setStatus("Starting session…");
  setPending(true);

  try {
    const res = await fetch("/api/session/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chapterId,
        roadmapId: state.activeRoadmapId,
        model: state.selectedModel ?? undefined,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errText}`);
    }

    const sessionId = res.headers.get("X-Session-Id");
    const depth = Number(res.headers.get("X-Depth") ?? "1");
    const titleEnc = res.headers.get("X-Chapter-Title") ?? "";
    const roadmapIdEnc = res.headers.get("X-Roadmap-Id") ?? "";
    const roadmapNameEnc = res.headers.get("X-Roadmap-Name") ?? "";
    const chapterTitle = decodeURIComponent(titleEnc) || chapter?.title || "";

    state.session = {
      id: sessionId,
      depth,
      chapterTitle,
      roadmapId: decodeURIComponent(roadmapIdEnc),
      roadmapName: decodeURIComponent(roadmapNameEnc),
    };
    updateTopbar();
    enableSessionUi(true);

    const assistantEl = appendAssistantMessage("");
    await streamInto(res, assistantEl);

    setPending(false);
    setStatus("");
    els.input.focus();
  } catch (err) {
    setPending(false);
    enableSessionUi(false);
    state.session = null;
    setStatus(`Failed: ${err.message}`, "error");
  }
}

async function submitMessage() {
  if (!state.session || state.pending) return;
  const text = els.input.value.trim();
  if (!text) return;
  els.input.value = "";
  await sendMessage(text);
}

async function sendMessage(text) {
  if (!state.session) return;
  appendUserMessage(text);
  setPending(true);

  try {
    const res = await fetch(`/api/session/${state.session.id}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const assistantEl = appendAssistantMessage("");
    await streamInto(res, assistantEl);
  } catch (err) {
    setStatus(`Message failed: ${err.message}`, "error");
  } finally {
    setPending(false);
    els.input.focus();
  }
}

async function endSession() {
  if (!state.session || state.pending) return;
  if (!confirm("세션 종료하고 옵시디언에 노트 생성할까?")) return;

  setPending(true);

  // 진행 카드 생성 (메시지 영역에 inline으로)
  const card = createEndProgressCard();
  els.messages.appendChild(card);
  scrollToBottom();

  try {
    const res = await fetch(`/api/session/${state.session.id}/end`, {
      method: "POST",
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text);
    }

    // SSE 파싱 - reader로 직접 청크 읽기 (EventSource는 GET 전용이라 못 씀)
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE 메시지 단위 (빈 줄로 구분)
      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const rawMsg = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const parsed = parseSseMessage(rawMsg);
        if (!parsed) continue;
        if (parsed.event === "stage") {
          updateEndProgressCard(card, parsed.data);
        } else if (parsed.event === "done") {
          result = parsed.data;
          finalizeEndProgressCard(card, parsed.data);
        } else if (parsed.event === "error") {
          throw new Error(parsed.data.message ?? "unknown");
        }
      }
    }

    if (!result) throw new Error("저장 완료 신호를 받지 못함");

    state.session = null;
    state.messages = [];
    enableSessionUi(false);
    updateTopbar();

    // 진도 갱신
    const roadmaps = await fetch("/api/roadmaps").then((r) => r.json());
    state.roadmaps = Array.isArray(roadmaps) ? roadmaps : [];
    renderRoadmapSelector();
    await loadRoadmapData();
    setStatus("");
  } catch (err) {
    card.classList.add("error");
    const titleEl = card.querySelector(".end-progress-card-title");
    if (titleEl) titleEl.innerHTML = `<span style="color:#f85149">❌ 저장 실패</span>`;
    setStatus(`End failed: ${err.message}`, "error");
  } finally {
    setPending(false);
  }
}

function parseSseMessage(raw) {
  const lines = raw.split("\n");
  let event = "message";
  let data = "";
  for (const line of lines) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!data) return null;
  try {
    return { event, data: JSON.parse(data) };
  } catch {
    return null;
  }
}

const END_STAGES = [
  { stage: "analyzing", label: "대화 분석 & 구조화", detail: "8섹션 노트 생성" },
  { stage: "writing", label: "노트 파일 작성", detail: "frontmatter + 본문" },
  { stage: "saving", label: "Obsidian vault에 저장", detail: "디스크 기록" },
];

function createEndProgressCard() {
  const div = document.createElement("div");
  div.className = "end-progress-card";
  div.innerHTML = `
    <div class="end-progress-card-title">
      <span class="spin-indicator"></span>
      <span class="title-text">세션 마무리 & Obsidian 저장</span>
    </div>
    <div class="end-progress-steps">
      ${END_STAGES.map(
        (s) => `
        <div class="end-progress-step" data-stage="${s.stage}">
          <div class="step-marker">${END_STAGES.indexOf(s) + 1}</div>
          <div class="step-content">
            <div class="step-label">${escapeHtml(s.label)}</div>
            <div class="step-detail">${escapeHtml(s.detail)}</div>
          </div>
        </div>
      `,
      ).join("")}
    </div>
  `;
  return div;
}

function updateEndProgressCard(card, data) {
  // 현재 stage를 active로, 이전 stage들은 done으로
  const steps = card.querySelectorAll(".end-progress-step");
  const currentIdx = END_STAGES.findIndex((s) => s.stage === data.stage);
  steps.forEach((step, i) => {
    step.classList.remove("active", "done");
    if (i < currentIdx) {
      step.classList.add("done");
      step.querySelector(".step-marker").innerHTML = "✓";
    } else if (i === currentIdx) {
      step.classList.add("active");
      // detail 업데이트 (서버에서 보낸 동적 detail)
      if (data.detail) {
        step.querySelector(".step-detail").textContent = data.detail;
      }
    }
  });
}

function finalizeEndProgressCard(card, result) {
  // 모든 step done 처리
  const steps = card.querySelectorAll(".end-progress-step");
  steps.forEach((step) => {
    step.classList.remove("active");
    step.classList.add("done");
    step.querySelector(".step-marker").innerHTML = "✓";
  });

  // 타이틀을 완료 상태로
  const titleEl = card.querySelector(".end-progress-card-title");
  if (titleEl) {
    titleEl.innerHTML = `
      <svg class="done-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      <span>저장 완료</span>
    `;
  }

  // 결과 요약 + 옵시디언 링크 추가
  const elapsedMin = ((result.elapsedMs ?? 0) / 60000).toFixed(1);
  const summaryDiv = document.createElement("div");
  summaryDiv.className = "end-progress-summary";
  summaryDiv.innerHTML = `
    <div class="summary-topic"><strong>${escapeHtml(result.topic ?? "")}</strong> · depth ${result.depth}</div>
    ${result.summary ? `<div class="summary-text">${escapeHtml(result.summary)}</div>` : ""}
    <div class="summary-stats">
      <span>⏱ ${elapsedMin}분</span>
      <span>·</span>
      <span>${result.inputTokens ?? 0} in · ${result.outputTokens ?? 0} out</span>
      ${result.bodyChars ? `<span>·</span><span>${result.bodyChars.toLocaleString()}자</span>` : ""}
    </div>
    ${
      result.obsidianUri
        ? `<a href="${escapeAttr(result.obsidianUri)}" class="obsidian-link">📖 옵시디언에서 열기</a>`
        : ""
    }
    <div class="summary-path"><code>${escapeHtml(result.path ?? "")}</code></div>
  `;
  card.appendChild(summaryDiv);
  scrollToBottom();
}

// ──────────────────────────────────────────────────────────
// Streaming
// ──────────────────────────────────────────────────────────

async function streamInto(response, messageEl) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const contentEl = messageEl.querySelector(".content");
  let raw = "";
  let renderScheduled = false;

  const scheduleRender = () => {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      contentEl.innerHTML = marked.parse(raw);
      scrollToBottom();
    });
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    raw += chunk;
    scheduleRender();
  }
  contentEl.innerHTML = marked.parse(raw);
  scrollToBottom();
  state.messages.push({ role: "assistant", content: raw });
}

// ──────────────────────────────────────────────────────────
// Message UI
// ──────────────────────────────────────────────────────────

function appendUserMessage(text) {
  const div = document.createElement("div");
  div.className = "message user";
  div.innerHTML = `
    <div class="role">You</div>
    <div class="content"></div>
  `;
  div.querySelector(".content").textContent = text;
  els.messages.appendChild(div);
  state.messages.push({ role: "user", content: text });
  scrollToBottom();
  return div;
}

function appendAssistantMessage(initialMarkdown) {
  const placeholder = els.messages.querySelector(".placeholder");
  if (placeholder) placeholder.remove();

  const div = document.createElement("div");
  div.className = "message assistant";
  div.innerHTML = `
    <div class="role">Claude</div>
    <div class="content"></div>
  `;
  if (initialMarkdown) {
    div.querySelector(".content").innerHTML = marked.parse(initialMarkdown);
  }
  els.messages.appendChild(div);
  scrollToBottom();
  return div;
}

function showCompletionCard(result) {
  const div = document.createElement("div");
  div.className = "message system completion";
  const elapsedMin = ((result.elapsedMs ?? 0) / 60000).toFixed(1);
  const pathHtml = result.obsidianUri
    ? `<a href="${escapeAttr(result.obsidianUri)}" class="obsidian-link">📖 옵시디언에서 열기</a> · <code>${escapeHtml(result.path ?? "")}</code>`
    : `<code>${escapeHtml(result.path ?? "")}</code>`;
  div.innerHTML = `
    <div class="role">✓ Saved</div>
    <div class="content">
      <p><strong>${escapeHtml(result.topic ?? "")}</strong> (depth ${result.depth})</p>
      <p class="summary">${escapeHtml(result.summary ?? "")}</p>
      <p class="path">${pathHtml}</p>
      <p class="stats">
        ${elapsedMin} min · ${result.inputTokens ?? 0} in · ${result.outputTokens ?? 0} out
      </p>
    </div>
  `;
  els.messages.appendChild(div);
  scrollToBottom();
}

function updateTopbar() {
  if (state.session) {
    els.topbar.innerHTML = `📖 <strong>${escapeHtml(state.session.chapterTitle)}</strong> <span class="depth">depth ${state.session.depth}</span> <span class="roadmap-badge">${escapeHtml(state.session.roadmapName)}</span>`;
  } else {
    els.topbar.textContent = "Select a chapter to start";
  }
}

function enableSessionUi(enabled) {
  els.input.disabled = !enabled;
  els.sendBtn.disabled = !enabled;
  els.endBtn.disabled = !enabled;
  els.quizBtn.disabled = !enabled;
  els.input.placeholder = enabled
    ? "메시지 입력 후 Enter (Shift+Enter는 줄바꿈)"
    : "세션을 시작하면 입력할 수 있어요";
}

function setPending(p) {
  state.pending = p;
  els.sendBtn.disabled = p || !state.session;
  els.endBtn.disabled = p || !state.session;
  els.quizBtn.disabled = p || !state.session;
}

function setStatus(text, kind = "") {
  els.statusBar.textContent = text;
  els.statusBar.className = `status-bar ${kind}`;
}

function scrollToBottom() {
  els.messages.scrollTop = els.messages.scrollHeight;
}

function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s) {
  return escapeHtml(s);
}
