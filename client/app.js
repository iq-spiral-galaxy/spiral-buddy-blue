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
  expandedLocalDomains: new Set(), // Local 도메인 (v0.5.53)
  expandedLocalCategories: new Set(), // Local 카테고리 (key: "domain::category")
  expandedLocalRepos: new Set(), // Local 레포 (key: "domain::category::repo")
  // 검색 활성 시 임시 펼침 셋 (v0.5.56 — toggle 핸들러에서도 접근하려고 state로 끌어올림)
  _searchExpandedDoms: null,
  _searchExpandedCats: null,
  _searchExpandedRepos: null,
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
  // Prompt refine (다듬기) state
  refining: false, // 다듬는 중 (UI lock)
  refineOriginal: null, // 마지막 다듬기 전 원본 텍스트 (rollback용). null이면 다듬은 결과 없음.
  refineApplied: null, // 다듬어서 입력란에 들어간 텍스트 (입력 비교용)
  // Quiz 단계 (v0.5.31) — 매 클릭마다 1→2→3→4→1 순환
  quizLevel: 1,
  // 사이드바 검색 (v0.5.51)
  sidebarQuery: "",
};

// localStorage에 마지막 로드맵 저장
const LS_KEY = "spiral-buddy:lastRoadmapId";

const CATEGORY_ICON_BY_NAME = {
  // Backend categories
  "java core": "coffee",
  "spring ecosystem": "leaf",
  "architecture & design": "temple",
  "infrastructure & devops": "monitor",
  database: "database",
  "messaging & streaming": "mail",
  "api & communication": "plug",
  "security engineering": "lock",
  "performance & quality": "bolt",
  // v0.5.52~55 — 도메인 자체 + 자식 카테고리 둘 다 들어갈 수 있음.
  // 도메인 헤더에서도 같은 lookup을 사용하므로 도메인 이름들도 포함.
  foundations: "rock",
  languages: "brick",
  "languages & runtimes": "brick",
  backend: "wrench",
  "data engineering": "chart",
  frontend: "globe",
  "web platform & engine": "globe",
  "web language & framework": "atom",
  android: "android",
  ios: "apple",
  "cross platform": "shuffle",
  "cross-platform": "shuffle",
  synthesis: "dna",
  uncategorized: "folder",
};

const ICON_SVG = {
  bolt: `<path d="M13 2 5 13h6l-1 9 8-12h-6l1-8Z" />`,
  coffee: `<path d="M5 8h9v4.5A4.5 4.5 0 0 1 9.5 17 4.5 4.5 0 0 1 5 12.5V8Z" /><path d="M14 9h1.5a2.5 2.5 0 0 1 0 5H14" /><path d="M4 20h13" /><path d="M8 4c-.7.7-.7 1.3 0 2M11 3c-.8.8-.8 1.5 0 2.3" />`,
  database: `<ellipse cx="12" cy="5" rx="6" ry="2.5" /><path d="M6 5v10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V5" /><path d="M6 10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5" />`,
  folder: `<path d="M3.5 6.5h6l1.8 2H20v8.5a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2V6.5Z" />`,
  leaf: `<path d="M19 4c-6.5.3-11.3 2.8-13 7-1 2.7.7 5.8 3.8 6.2 4.5.6 8.2-3.4 9.2-13.2Z" /><path d="M6 18c2.8-4.7 6.1-7.7 10-9.3" />`,
  lock: `<rect x="5" y="10" width="14" height="9" rx="2" /><path d="M8 10V8a4 4 0 0 1 8 0v2" /><path d="M12 14v2" />`,
  mail: `<rect x="4" y="6" width="16" height="12" rx="2" /><path d="m4.8 7.2 7.2 5.4 7.2-5.4" /><path d="m4.8 16.8 4.8-4" /><path d="m19.2 16.8-4.8-4" />`,
  monitor: `<rect x="4" y="5" width="16" height="11" rx="2" /><path d="M9 20h6" /><path d="M12 16v4" />`,
  plug: `<path d="M8 6v5" /><path d="M12 6v5" /><path d="M6 11h8v2a4 4 0 0 1-8 0v-2Z" /><path d="M10 17v2" /><path d="M10 19h5a3 3 0 0 0 3-3v-1" />`,
  repo: `<path d="m12 3 7 4-7 4-7-4 7-4Z" /><path d="m5 7v8l7 4 7-4V7" /><path d="M12 11v8" />`,
  temple: `<path d="M4 9h16" /><path d="m5 8 7-5 7 5" /><path d="M6 10v7" /><path d="M10 10v7" /><path d="M14 10v7" /><path d="M18 10v7" /><path d="M4 19h16" />`,
  // v0.5.52 — 새 카테고리/도메인 아이콘
  rock: `<path d="M6 18 c-2.5 0 -3.5 -2 -2 -4 l1 -1 c0 -2 2 -3.5 4 -3 l1 -2 c1 -2 4 -2 5 0 l1 1 c2 -0.5 4 1 4 3 l0.5 1 c1.5 1.5 0.5 5 -2 5 z"/>`,
  brick: `<rect x="3" y="6" width="18" height="4" rx="0.5"/><rect x="3" y="14" width="18" height="4" rx="0.5"/><line x1="9" y1="6" x2="9" y2="10"/><line x1="15" y1="6" x2="15" y2="10"/><line x1="6" y1="14" x2="6" y2="18"/><line x1="12" y1="14" x2="12" y2="18"/><line x1="18" y1="14" x2="18" y2="18"/>`,
  chart: `<line x1="4" y1="20" x2="20" y2="20"/><rect x="5" y="13" width="3" height="7"/><rect x="10" y="9" width="3" height="11"/><rect x="15" y="5" width="3" height="15"/>`,
  globe: `<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><line x1="3" y1="12" x2="21" y2="12"/>`,
  atom: `<circle cx="12" cy="12" r="1.5"/><ellipse cx="12" cy="12" rx="9" ry="3.5"/><ellipse cx="12" cy="12" rx="9" ry="3.5" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="3.5" transform="rotate(-60 12 12)"/>`,
  android: `<path d="M6 12v6a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-6"/><path d="M5 11.5a7 7 0 0 1 14 0v0.5H5z"/><line x1="8" y1="5" x2="9.5" y2="7"/><line x1="16" y1="5" x2="14.5" y2="7"/><circle cx="9.5" cy="9.5" r="0.6"/><circle cx="14.5" cy="9.5" r="0.6"/><line x1="4" y1="12" x2="4" y2="16"/><line x1="20" y1="12" x2="20" y2="16"/><line x1="9" y1="19" x2="9" y2="22"/><line x1="15" y1="19" x2="15" y2="22"/>`,
  apple: `<path d="M16 11c0 -2 1.5 -3 1.5 -3s-1.5 -1 -3 0c-0.7 -2.5 -3 -2.5 -4 -2 -1 -0.5 -3.3 -0.5 -4 2 -1.5 -1 -3 0 -3 0s1.5 1 1.5 3c-1 1 -1.5 3 0 6 1 2 3 3 5.5 2 2.5 1 4.5 0 5.5 -2 1.5 -3 1 -5 0 -6Z"/><path d="M12 6c0 -1.5 1 -3 2.5 -3"/>`,
  shuffle: `<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/>`,
  dna: `<path d="M5 4c14 4 0 12 14 16"/><path d="M19 4c-14 4 0 12 -14 16"/><line x1="7" y1="8" x2="14" y2="8"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="17" y2="16"/>`,
  // v0.5.55 — Backend 도메인용 wrench
  wrench: `<path d="M14.7 6.3a4.5 4.5 0 0 1 5.6 5.6L18 14l-4-4 0.7-2.1z"/><path d="M14 10l-9 9a2 2 0 0 1-3-3l9-9"/>`,
};

function svgIcon(name, className = "inline-icon") {
  const body = ICON_SVG[name] ?? ICON_SVG.folder;
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

function categoryIconHtml(category) {
  const key = String(category?.name ?? "uncategorized").toLowerCase();
  const iconName = CATEGORY_ICON_BY_NAME[key] ?? "folder";
  return `<span class="cat-icon" aria-hidden="true">${svgIcon(iconName, "cat-icon-svg")}</span>`;
}

function repoIconHtml() {
  return `<span class="repo-icon" aria-hidden="true">${svgIcon("repo", "repo-icon-svg")}</span>`;
}

function groupIconHtml(name) {
  return `<span class="group-icon" aria-hidden="true">${svgIcon(name, "group-icon-svg")}</span>`;
}

function displayWorkspaceName(workspace) {
  const rawName = String(workspace?.name ?? "");
  const normalized = rawName.toLowerCase().replace(/[\s_-]+/g, "-");
  const rootBase = String(workspace?.roadmapRoot ?? "")
    .split(/[\\/]/)
    .filter(Boolean)
    .pop()
    ?.toLowerCase();
  if (normalized === "iq-dev-lab" || rootBase === "iq-dev-lab") {
    return "IQ Dev Lab";
  }
  return rawName || "Workspace";
}

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
  // v0.5.51 사이드바 검색
  els.sidebarSearch = $("sidebar-search");
  els.sidebarSearchClear = $("sidebar-search-clear");
  els.sidebarSearchMeta = $("sidebar-search-meta");
  els.suggestion = $("suggestion-box");
  els.chapterList = $("chapter-list");
  els.historyList = $("history-list");
  els.topbar = $("current-chapter");
  els.messages = $("messages");
  els.messagesWrap = $("messages-wrap");
  els.scrollBottomBtn = $("scroll-bottom-btn");
  els.lookupPanelBodyWrap = $("lookup-panel-body-wrap");
  els.lookupScrollBottomBtn = $("lookup-scroll-bottom-btn");
  els.pausedSection = $("paused-section");
  els.pausedList = $("paused-list");
  els.pausedCountBadge = $("paused-count-badge");
  els.pauseBtn = $("pause-btn");
  els.input = $("input");
  els.sendBtn = $("send-btn");
  els.refineBtn = $("refine-btn");
  els.refineBar = $("refine-bar");
  els.refineBarText = document.querySelector("#refine-bar .refine-bar-text");
  els.refineUndo = $("refine-undo");
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
  els.activityStreak = $("activity-streak");
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
  // Look-up panel + selection toolbar
  els.lookupPanel = $("lookup-panel");
  els.lookupPanelBody = $("lookup-panel-body");
  els.lookupClear = $("lookup-clear");
  els.lookupExpand = $("lookup-expand");
  els.lookupResizer = $("lookup-resizer");
  els.lookupToolbar = $("lookup-toolbar");
  // Look-up: 질문 추가 popover
  els.lookupQuestionPopover = $("lookup-question-popover");
  els.lookupQuestionKeyword = $("lookup-question-keyword");
  els.lookupQuestionText = $("lookup-question-text");
  els.lookupQuestionDepth = $("lookup-question-depth");
  els.lookupQuestionSubmit = $("lookup-question-submit");
  els.lookupQuestionCancel = $("lookup-question-cancel");
  // Look-up: 직접 입력
  els.lookupDirectForm = $("lookup-direct-form");
  els.lookupDirectInput = $("lookup-direct-input");
  els.lookupDirectContext = $("lookup-direct-context");
  els.lookupDirectCtxToggle = $("lookup-direct-ctx-toggle");
  els.lookupDirectDepth = $("lookup-direct-depth");
  els.lookupDirectResizer = $("lookup-direct-resizer");
  // Composer 높이 조절
  els.composerResizer = $("composer-resizer");
}

// ──────────────────────────────────────────────────────────
// Init
// ──────────────────────────────────────────────────────────

// v0.5.35 — 테마 (다크/라이트) 적용
const THEME_KEY = "spiral-buddy:theme";

function applyTheme(theme) {
  const t = theme === "light" ? "light" : "dark";
  document.body.classList.toggle("light-mode", t === "light");
  document.body.classList.toggle("dark-mode", t === "dark");
  document.querySelectorAll(".theme-opt").forEach((b) => {
    const active = b.dataset.theme === t;
    b.classList.toggle("active", active);
    b.setAttribute("aria-checked", active ? "true" : "false");
  });
}

function getStoredTheme() {
  try {
    return localStorage.getItem(THEME_KEY) || "dark";
  } catch {
    return "dark";
  }
}

// DOMContentLoaded 전에 미리 적용 — FOUC 방지
applyTheme(getStoredTheme());

document.addEventListener("DOMContentLoaded", async () => {
  cacheEls();
  wireEvents();
  applyTheme(getStoredTheme()); // 버튼 active 상태 동기화
  document.querySelectorAll(".theme-opt").forEach((btn) => {
    btn.addEventListener("click", () => {
      const t = btn.dataset.theme === "light" ? "light" : "dark";
      try {
        localStorage.setItem(THEME_KEY, t);
      } catch {}
      applyTheme(t);
    });
  });
  await loadInitial();
});

function wireEvents() {
  els.form.addEventListener("submit", (e) => {
    e.preventDefault();
    submitMessage();
  });
  els.input.addEventListener("keydown", (e) => {
    // ⌘⇧↵ (or Ctrl+Shift+Enter) — 다듬어서 바로 send
    if (
      e.key === "Enter" &&
      e.shiftKey &&
      (e.metaKey || e.ctrlKey) &&
      !e.isComposing &&
      e.keyCode !== 229
    ) {
      e.preventDefault();
      refineThenSend();
      return;
    }
    // ⌘J / Ctrl+J — 다듬기만 (send 안 함)
    if (
      (e.metaKey || e.ctrlKey) &&
      !e.shiftKey &&
      (e.key === "j" || e.key === "J")
    ) {
      e.preventDefault();
      refineInPlace();
      return;
    }
    // ⌘Z — 다듬은 직후 입력란에 있을 때만 원본 복원
    if (
      (e.metaKey || e.ctrlKey) &&
      !e.shiftKey &&
      (e.key === "z" || e.key === "Z") &&
      state.refineOriginal != null
    ) {
      e.preventDefault();
      undoRefine();
      return;
    }
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
  // 사용자가 직접 타이핑하면 다듬기 배너/원본 캐시 무효화
  els.input.addEventListener("input", () => {
    if (state.refineOriginal != null && els.input.value !== state.refineApplied) {
      clearRefineState();
    }
  });
  if (els.refineBtn) {
    els.refineBtn.addEventListener("click", () => refineInPlace());
  }
  if (els.refineUndo) {
    els.refineUndo.addEventListener("click", () => undoRefine());
  }
  els.endBtn.addEventListener("click", endSession);

  // v0.5.41+: 세션 일시정지 + 맨 아래로 + 줄바꿈 보존
  els.pauseBtn?.addEventListener("click", pauseSession);
  initScrollControls();
  // 페이지 로드 시 일시정지된 세션들 렌더
  refreshPausedList();

  // v0.5.31 #4: 입력창 높이 조절 (드래그 핸들)
  initComposerResizer();
  els.quizBtn.addEventListener("click", () => {
    if (!state.session || state.pending) return;
    advanceQuiz();
  });

  // 사이드바 토글 (버튼 + Cmd/Ctrl+B 단축키)
  const SIDEBAR_KEY = "spiral-buddy:sidebar-collapsed";
  function setSidebarCollapsed(collapsed, persist = true) {
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    if (persist) localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
    // v0.5.62 — 펼친 직후 chat composer/Look-up이 침범당하지 않도록 cap 재적용.
    // (Look-up이 열려있는 상태에서 사이드바 펼침 시 발생할 수 있는 케이스)
    if (!collapsed) {
      // window resize 이벤트를 한 번 발화 — 이미 등록된 cap 핸들러들이 알아서 처리
      // (사이드바 cap, lookup cap 둘 다 resize listener 등록돼 있음)
      window.dispatchEvent(new Event("resize"));
    }
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
  // v0.5.65 — 사용자 피드백 "최대 크기를 픽스해놓는거 어때?":
  // SIDEBAR_MAX를 강하게 줄여서 사용자가 드래그로 늘려도 절대 그 이상 안 가게.
  // chat 컬럼의 composer Send/다듬기 + topbar의 lookup-toggle 버튼이 보장됨.
  const SIDEBAR_WIDTH_KEY = "spiral-buddy:sidebar-width:v2";
  const SIDEBAR_DEFAULT = 320; // 400 → 320 (디폴트도 더 컴팩트하게)
  const SIDEBAR_MIN = 280;
  const SIDEBAR_MAX = 420; // 680 → 420 (절대 더 못 늘림)
  // chat composer + topbar actions를 모두 보장하는 최소 폭
  const CHAT_MIN_FOR_SIDEBAR = 760; // 620 → 760 (composer + topbar actions 둘 다 안전)

  // 현재 viewport 기준으로 사이드바가 가질 수 있는 최대 폭 계산.
  // Look-up이 열려있으면 그 폭도 빼야 함.
  function _sidebarMaxForViewport() {
    let lookupW = 0;
    if (document.body.classList.contains("lookup-open")) {
      const inline = document.body.style.getPropertyValue("--lookup-w").trim();
      const cs = inline
        ? inline
        : getComputedStyle(document.body).getPropertyValue("--lookup-w").trim();
      lookupW = parseInt(cs, 10) || 0;
    }
    const headroom = window.innerWidth - CHAT_MIN_FOR_SIDEBAR - lookupW;
    return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, headroom));
  }

  const savedWidth = localStorage.getItem(SIDEBAR_WIDTH_KEY);
  if (savedWidth) {
    const parsed = parseInt(savedWidth, 10) || SIDEBAR_DEFAULT;
    const w = Math.max(
      SIDEBAR_MIN,
      Math.min(_sidebarMaxForViewport(), parsed),
    );
    document.body.style.setProperty("--sidebar-w", `${w}px`);
    // v0.5.65 — saved가 새 cap보다 크면 localStorage도 갱신해서
    // 다음 진입 시 cap에 맞는 값으로 시작 (옛 버전에서 큰 값으로 저장된 케이스 대응)
    if (parsed > w) {
      try {
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(w));
      } catch {}
    }
  } else {
    // saved 값이 없어도 viewport가 좁으면 cap 적용 (디폴트가 너무 넓을 수 있으므로)
    const cap = _sidebarMaxForViewport();
    if (cap < SIDEBAR_DEFAULT) {
      document.body.style.setProperty("--sidebar-w", `${cap}px`);
    }
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
      // v0.5.62 — 드래그 시도 cap 적용 (chat 영역 침범 방지)
      const w = Math.max(
        SIDEBAR_MIN,
        Math.min(_sidebarMaxForViewport(), e.clientX),
      );
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

  // v0.5.62 — 창 크기 변경 시 사이드바도 자동 재클램프.
  // saved localStorage는 안 건드림 — 창 다시 키우면 원래 폭으로 복원되도록.
  window.addEventListener("resize", () => {
    if (document.body.classList.contains("sidebar-collapsed")) return;
    const inline = document.body.style.getPropertyValue("--sidebar-w").trim();
    const cur =
      parseInt(inline, 10) ||
      parseInt(
        getComputedStyle(document.body).getPropertyValue("--sidebar-w").trim(),
        10,
      ) ||
      SIDEBAR_DEFAULT;
    const cap = _sidebarMaxForViewport();
    if (cur > cap) {
      document.body.style.setProperty("--sidebar-w", `${cap}px`);
    }
  });

  // 설정 + 워크스페이스 (Electron 모드에서만 동작 — window.spiralSettings 존재 여부)
  if (window.spiralSettings) {
    initSettings();
  } else {
    // 브라우저 모드 (pnpm dev) — 설정 버튼 숨김, 워크스페이스 셀렉터 숨김
    els.settingsBtn?.classList.add("hidden");
    document.getElementById("workspace-section")?.classList.add("hidden");
  }

  // Look-up 기능 (사이드 학습)
  initLookup();

  // v0.5.51 — 사이드바 검색
  initSidebarSearch();

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
  refreshActivityBadge();

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

  // 예전 홈 모델 셀렉터가 남아 있는 빌드도 안전하게 지원.
  if (els.modelSelect) {
    els.modelSelect.addEventListener("change", (e) => {
      const modelId = e.target.value;
      if (!modelId) return;
      state.selectedModel = modelId;
      updateModelTierBadge();
      if (state.session) {
        setStatus("모델 변경은 다음 세션부터 적용됩니다.");
      }
    });
  }
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
    const defaultModel = modelsData?.default ?? config?.model ?? null;
    state.selectedModel =
      state.models.find((m) => m.id === defaultModel)?.id ||
      state.models[0]?.id ||
      defaultModel;
    localStorage.removeItem("spiral-buddy:model");
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
  // suggestion 영역은 일단 숨겨두고 chapters 확인 후 결정
  els.suggestion.classList.remove("hidden");
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

    // 다음 챕터 카드(suggestion)는 첫 진행 시에만 띄움.
    // 이미 visited 챕터가 있으면(= 한 번이라도 학습 진행) 노이즈가 되므로 영역 자체 숨김.
    // 사용자는 그 후엔 사이드바 챕터 리스트에서 직접 선택.
    const visitedCount = state.chapters.filter(
      (c) => (c.maxDepth ?? 0) > 0,
    ).length;
    if (visitedCount > 0) {
      els.suggestion.classList.add("hidden");
      state.suggestion = null;
    } else {
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
    }
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

  // v0.5.51 — 사이드바 검색어가 있으면 매칭되는 로드맵만 남김.
  // 매칭 대상: roadmap.name, category.name, repo 이름, sub-roadmap 이름.
  // 대소문자 무시 + 공백 정규화.
  const searchQuery = (state.sidebarQuery ?? "").trim().toLowerCase();
  const matchesQuery = (r) => {
    if (!searchQuery) return true;
    const fields = [
      r.name ?? "",
      r.category?.name ?? "",
      r.hierarchy?.repo ?? "",
      r.hierarchy?.sub ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return fields.includes(searchQuery);
  };
  const local = state.roadmaps
    .filter((r) => r.source !== "curated")
    .filter(matchesQuery);
  const curated = state.roadmaps
    .filter((r) => r.source === "curated")
    .filter(matchesQuery);
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

    // v0.5.53 — 도메인 → 카테고리 → 레포 → 로드맵 4단 계층.
    // domName → { meta, order, cats: Map<catName, Map<repoName, Roadmap[]>> }
    const domainTree = new Map();
    const catMeta = new Map(); // catName → category meta (도메인 무관 메타)
    const UNCAT_DOMAIN = { id: "_uncategorized", name: "기타", emoji: null, color: "#888888", order: 999 };

    for (const r of local) {
      const catName = r.category?.name ?? "Uncategorized";
      catMeta.set(
        catName,
        r.category ?? { name: "Uncategorized", emoji: "📁", color: "#888888" },
      );
      const dom = r.domain ?? UNCAT_DOMAIN;
      const domKey = dom.name;
      if (!domainTree.has(domKey)) {
        domainTree.set(domKey, { meta: dom, cats: new Map() });
      }
      const domEntry = domainTree.get(domKey);
      if (!domEntry.cats.has(catName)) domEntry.cats.set(catName, new Map());
      const repoMap = domEntry.cats.get(catName);
      const { repo } = parseHierarchy(r);
      if (!repoMap.has(repo)) repoMap.set(repo, []);
      repoMap.get(repo).push(r);
    }

    // 도메인 정렬: order 오름차순 (foundations 1 → backend 3 → ... → synthesis 99 → _uncategorized 999)
    const sortedDomains = Array.from(domainTree.entries()).sort(
      (a, b) => (a[1].meta.order ?? 99) - (b[1].meta.order ?? 99),
    );

    // active 로드맵 자동 펼침 (처음 한 번)
    const activeRoadmap = local.find((r) => r.id === state.activeRoadmapId);
    if (
      activeRoadmap?.category?.name &&
      state.lastAutoExpandedRoadmapId !== state.activeRoadmapId
    ) {
      const activeDomName = activeRoadmap.domain?.name ?? UNCAT_DOMAIN.name;
      const activeCatName = activeRoadmap.category.name;
      state.expandedLocalDomains.add(activeDomName);
      state.expandedLocalCategories.add(`${activeDomName}::${activeCatName}`);
      const { repo: activeRepo } = parseHierarchy(activeRoadmap);
      state.expandedLocalRepos.add(
        `${activeDomName}::${activeCatName}::${activeRepo}`,
      );
      state.lastAutoExpandedRoadmapId = state.activeRoadmapId;
    }

    // 검색 활성 시 매칭 전체 임시 펼침. 이전엔 함수 로컬이었지만 v0.5.56부터
    // state에 저장 — 토글 핸들러에서도 빼야 검색 중 사용자가 닫을 수 있음.
    if (searchQuery) {
      // 검색 활성 = 매 렌더마다 셋을 처음부터 재구성 (이전 상태 무시).
      // 사용자가 toggle로 닫은 항목도 같은 키워드 검색이면 다시 펼쳐짐 — 의도.
      state._searchExpandedDoms = new Set();
      state._searchExpandedCats = new Set();
      state._searchExpandedRepos = new Set();
      for (const [domName, domEntry] of domainTree) {
        state._searchExpandedDoms.add(domName);
        for (const [catName, repoMap] of domEntry.cats) {
          state._searchExpandedCats.add(`${domName}::${catName}`);
          for (const repoName of repoMap.keys()) {
            state._searchExpandedRepos.add(`${domName}::${catName}::${repoName}`);
          }
        }
      }
    } else {
      // 검색 비활성 — 셋 클리어
      state._searchExpandedDoms = null;
      state._searchExpandedCats = null;
      state._searchExpandedRepos = null;
    }
    const isDomExpanded = (n) =>
      state.expandedLocalDomains.has(n) ||
      (state._searchExpandedDoms?.has(n) ?? false);
    const isCatExpanded = (k) =>
      state.expandedLocalCategories.has(k) ||
      (state._searchExpandedCats?.has(k) ?? false);
    const isRepoExpanded = (k) =>
      state.expandedLocalRepos.has(k) ||
      (state._searchExpandedRepos?.has(k) ?? false);

    const totalCats = sortedDomains.reduce(
      (sum, [, e]) => sum + e.cats.size,
      0,
    );
    const totalRepos = sortedDomains.reduce(
      (sum, [, e]) =>
        sum +
        Array.from(e.cats.values()).reduce((s2, m) => s2 + m.size, 0),
      0,
    );
    parts.push(
      `<div class="roadmap-group-title">${groupIconHtml("folder")}<span>Local · ${sortedDomains.length} domains · ${totalCats} categories · ${totalRepos} repos · ${local.length} roadmaps</span></div>`,
    );

    for (const [domName, domEntry] of sortedDomains) {
      const dom = domEntry.meta;
      const domExpanded = isDomExpanded(domName);
      const domCaret = domExpanded ? "▼" : "▶";

      // 도메인 누적 통계
      const domCats = domEntry.cats;
      let domRoadmaps = 0;
      let domVisitedRoadmaps = 0;
      let domMaxDepth = 0;
      for (const repoMap of domCats.values()) {
        for (const rs of repoMap.values()) {
          for (const r of rs) {
            domRoadmaps++;
            if ((r.maxDepth ?? 0) > 0) domVisitedRoadmaps++;
            domMaxDepth = Math.max(domMaxDepth, r.maxDepth ?? 0);
          }
        }
      }
      const domDepthBadge =
        domMaxDepth > 0
          ? `<span class="depth-pill">d${domMaxDepth}</span>`
          : "";

      // v0.5.57 — 도메인에 카테고리가 하나뿐이면 카테고리 헤더 생략.
      // (Foundations, Android, iOS, Cross Platform, Data Eng, Languages,
      //  Synthesis 7개 도메인이 single-cat — 도메인↔카테고리가 사실상 동의어).
      // 도메인 헤더 토글로 바로 레포 목록 보이게 → 펼치는 클릭 한 번 절약.
      const isSingleCat = domCats.size === 1;

      let domBody = "";
      if (domExpanded) {
        for (const [catName, repoMap] of domCats) {
          const cat = catMeta.get(catName);
          const catKey = `${domName}::${catName}`;
          // single-cat이면 카테고리 항상 펼침 (별도 토글 없음)
          const catExpanded = isSingleCat ? true : isCatExpanded(catKey);
          const catCaret = catExpanded ? "▼" : "▶";

          let catBody = "";
          if (catExpanded) {
            for (const [repoName, roadmaps] of repoMap) {
              const repoKey = `${domName}::${catName}::${repoName}`;
              const repoExpanded = isRepoExpanded(repoKey);
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
                ${repoIconHtml()}
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

          if (isSingleCat) {
            // v0.5.57 — 카테고리 헤더 생략. catBody(레포 목록)만 도메인 body에 직접.
            domBody += catBody;
          } else {
            domBody += `
              <div class="curated-category local-category">
                <button class="category-header" data-local-cat="${escapeAttr(catKey)}" style="--cat-color: ${escapeAttr(cat.color)}">
                  <span class="cat-caret">${catCaret}</span>
                  ${categoryIconHtml(cat)}
                  <span class="cat-name">${escapeHtml(catName)}</span>
                  <span class="cat-count">${repoMap.size}r · ${totalRoadmapsInCat}</span>
                </button>
                <div class="category-body ${catExpanded ? "" : "hidden"}">${catBody}</div>
              </div>
            `;
          }
        }  // end category loop
      }  // end if domExpanded

      // 도메인 헤더 자체 push.
      // v0.5.57 — single-cat이면 "Nr · M"(레포 / sub-roadmap),
      //           multi-cat이면 "Nc · M"(카테고리 / sub-roadmap)으로 표시.
      const domStyle = dom.color
        ? `style="--dom-color: ${escapeAttr(dom.color)}"`
        : "";
      let domCountText;
      if (isSingleCat) {
        const repoCount = Array.from(domCats.values())[0]?.size ?? 0;
        domCountText = `${repoCount}r · ${domRoadmaps}`;
      } else {
        domCountText = `${domCats.size}c · ${domRoadmaps}`;
      }
      // single-cat 도메인 body는 별도 클래스 → CSS에서 들여쓰기 한 단계 빼기
      const bodyClass = `domain-body${isSingleCat ? " single-cat" : ""}${domExpanded ? "" : " hidden"}`;
      parts.push(`
        <div class="local-domain">
          <button class="domain-header" data-local-dom="${escapeAttr(domName)}" ${domStyle}>
            <span class="cat-caret">${domCaret}</span>
            ${categoryIconHtml({ name: dom.name })}
            <span class="dom-name">${escapeHtml(dom.name)}</span>
            ${domDepthBadge}
            <span class="dom-count">${domCountText}</span>
          </button>
          <div class="${bodyClass}">${domBody}</div>
        </div>
      `);
    }  // end domain loop
  }

  if (curated.length > 0) {
    parts.push(
      `<div class="roadmap-group-title">${groupIconHtml("database")}<span>Curated · ${escapeHtml(state.curatedOrg ?? "")} (${curated.length})</span></div>`,
    );
    parts.push(curated.map(roadmapItemHtml).join(""));
  }

  // "받기 가능 보기" 토글은 제거됨 (v0.5.20) — 설정의 한 번에 받기로 대체.
  // 디버그/수동 받기 시에만 토글 켜기: localStorage.spiral-buddy:show-available = "1"
  const showAvailableEnabled =
    typeof localStorage !== "undefined" &&
    localStorage.getItem("spiral-buddy:show-available") === "1";
  if (state.curatedOrg && showAvailableEnabled) {
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
                ${categoryIconHtml(group)}
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

  // wire local domain headers (v0.5.53)
  // v0.5.56 — 검색 활성 시 search-expanded set에도 들어있을 수 있으므로 둘 다 확인.
  // 화면상 열려 있으면(state || search) → 닫기 (둘 다에서 제거).
  // 화면상 닫혀 있으면 → 열기 (state에 add).
  els.roadmapList.querySelectorAll(".domain-header[data-local-dom]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const domName = btn.dataset.localDom;
      const inState = state.expandedLocalDomains.has(domName);
      const inSearch = state._searchExpandedDoms?.has(domName) ?? false;
      if (inState || inSearch) {
        state.expandedLocalDomains.delete(domName);
        state._searchExpandedDoms?.delete(domName);
      } else {
        state.expandedLocalDomains.add(domName);
      }
      renderRoadmapSelector();
    });
  });

  // wire local category headers (key는 v0.5.53부터 "domain::category")
  els.roadmapList.querySelectorAll(".category-header[data-local-cat]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const catKey = btn.dataset.localCat;
      const inState = state.expandedLocalCategories.has(catKey);
      const inSearch = state._searchExpandedCats?.has(catKey) ?? false;
      if (inState || inSearch) {
        state.expandedLocalCategories.delete(catKey);
        state._searchExpandedCats?.delete(catKey);
      } else {
        state.expandedLocalCategories.add(catKey);
      }
      renderRoadmapSelector();
    });
  });

  // wire local repo headers (collapsible)
  els.roadmapList.querySelectorAll(".repo-header[data-local-repo]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const key = btn.dataset.localRepo;
      const inState = state.expandedLocalRepos.has(key);
      const inSearch = state._searchExpandedRepos?.has(key) ?? false;
      if (inState || inSearch) {
        state.expandedLocalRepos.delete(key);
        state._searchExpandedRepos?.delete(key);
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

  // v0.5.56 — 검색으로 들어온 경우, 챕터 리스트도 검색어로 필터돼서 비어 보임.
  // 사용자가 검색해서 로드맵을 골랐으면 검색 의도는 끝난 셈 — 자동으로 해제.
  if (state.sidebarQuery) {
    state.sidebarQuery = "";
    if (els.sidebarSearch) els.sidebarSearch.value = "";
    els.sidebarSearchClear?.classList.add("hidden");
    if (els.sidebarSearchMeta) {
      els.sidebarSearchMeta.classList.add("hidden");
      els.sidebarSearchMeta.textContent = "";
    }
    // search-expanded 셋은 다음 렌더 때 자동으로 null로 reset됨.
  }

  renderRoadmapSelector();
  await loadRoadmapData();
  scrollToRecentChapter();
}

/**
 * 가장 최근 학습한 챕터(lastDate 기준)를 viewport 중앙으로 스크롤.
 * 없으면 아무것도 하지 않음.
 *
 * v0.5.51 — DOM commit 타이밍 안정화. 단일 rAF은 정적 파일 로드 직후처럼
 * 레이아웃이 아직 안 잡힌 순간에 sidebar scroll이 안 먹힐 수 있어서,
 * 2회 rAF + 짧은 setTimeout 보강으로 더 확실하게.
 */
function scrollToRecentChapter() {
  if (!Array.isArray(state.chapters) || state.chapters.length === 0) return;
  const visited = state.chapters
    .filter((c) => c.lastDate)
    .sort((a, b) => (b.lastDate ?? "").localeCompare(a.lastDate ?? ""));
  const target = visited[0];
  if (!target) return;
  const tryScroll = () => {
    const el = els.chapterList?.querySelector(
      `button[data-id="${CSS.escape(target.id)}"]`,
    );
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      return true;
    }
    return false;
  };
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      // 챕터 list 자체에 scroll, 그리고 sidebar 컨테이너도 따라 움직이도록.
      if (!tryScroll()) setTimeout(tryScroll, 80);
    });
  });
}

// v0.5.51 — 사이드바 검색 wire-up.
// 디바운스로 input 부담 줄이고, 변경 시 로드맵 셀렉터 + 챕터 리스트 둘 다 갱신.
function initSidebarSearch() {
  if (!els.sidebarSearch) return;
  let timer = null;
  const apply = (raw) => {
    const q = (raw ?? "").trim();
    const prev = state.sidebarQuery ?? "";
    if (prev === q) return;
    state.sidebarQuery = q;
    els.sidebarSearchClear?.classList.toggle("hidden", q.length === 0);
    // 검색 시작 시 roadmap-list 자동 노출 → 결과를 바로 볼 수 있게
    if (q) {
      els.roadmapList?.classList.remove("hidden");
    }
    renderRoadmapSelector();
    renderChapters();
    // 매칭 수 카운트 표시
    if (els.sidebarSearchMeta) {
      if (!q) {
        els.sidebarSearchMeta.classList.add("hidden");
        els.sidebarSearchMeta.textContent = "";
      } else {
        const ql = q.toLowerCase();
        const roadmapHits = state.roadmaps.filter((r) => {
          const fields = [
            r.name ?? "",
            r.category?.name ?? "",
            r.hierarchy?.repo ?? "",
            r.hierarchy?.sub ?? "",
          ]
            .join(" ")
            .toLowerCase();
          return fields.includes(ql);
        }).length;
        const chapterHits = (state.chapters ?? []).filter((c) =>
          (c.title ?? "").toLowerCase().includes(ql),
        ).length;
        els.sidebarSearchMeta.innerHTML = `로드맵 <strong>${roadmapHits}</strong> · 챕터 <strong>${chapterHits}</strong>`;
        els.sidebarSearchMeta.classList.remove("hidden");
      }
    }
  };
  els.sidebarSearch.addEventListener("input", (e) => {
    if (timer) clearTimeout(timer);
    const val = e.target.value;
    timer = setTimeout(() => apply(val), 100);
  });
  // Esc → 검색어 비우기 + 포커스 해제
  els.sidebarSearch.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      els.sidebarSearch.value = "";
      apply("");
      els.sidebarSearch.blur();
    }
  });
  // X 버튼
  els.sidebarSearchClear?.addEventListener("click", () => {
    els.sidebarSearch.value = "";
    apply("");
    els.sidebarSearch.focus();
  });
  // 글로벌 단축키: Cmd+F (or Ctrl+F)로 사이드바 검색 포커스
  // (브라우저 기본 검색 막고 사이드바 search 사용)
  document.addEventListener("keydown", (e) => {
    if (
      (e.metaKey || e.ctrlKey) &&
      e.key.toLowerCase() === "f" &&
      !e.shiftKey
    ) {
      // 입력 필드에서는 default 허용
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      e.preventDefault();
      els.sidebarSearch?.focus();
      els.sidebarSearch?.select();
    }
  });
}

// v0.5.51 — 검색어 하이라이트 (case-insensitive). HTML 안전.
function _highlightMatch(text, query) {
  const t = String(text ?? "");
  const q = String(query ?? "").trim();
  if (!q) return escapeHtml(t);
  const lower = t.toLowerCase();
  const ql = q.toLowerCase();
  const idx = lower.indexOf(ql);
  if (idx < 0) return escapeHtml(t);
  const before = escapeHtml(t.slice(0, idx));
  const match = escapeHtml(t.slice(idx, idx + q.length));
  const after = escapeHtml(t.slice(idx + q.length));
  return `${before}<mark class="sidebar-search-hit">${match}</mark>${after}`;
}

function renderChapters() {
  els.chapterList.innerHTML = "";
  if (state.chapters.length === 0) {
    els.chapterList.innerHTML = `<li class="empty">챕터 없음</li>`;
    return;
  }
  // v0.5.51 — 가장 최근 학습한 챕터 id를 미리 뽑아두기.
  // 재진입 시 사용자가 "어디까지 했더라" 바로 찾을 수 있게 강한 시각 표식.
  const recentChapterId = (() => {
    const visited = state.chapters
      .filter((c) => c.lastDate)
      .sort((a, b) => (b.lastDate ?? "").localeCompare(a.lastDate ?? ""));
    return visited[0]?.id ?? null;
  })();
  // 검색어가 있으면 필터링 (v0.5.51)
  const q = (state.sidebarQuery ?? "").trim().toLowerCase();
  const filtered = q
    ? state.chapters.filter((c) =>
        (c.title ?? "").toLowerCase().includes(q),
      )
    : state.chapters;
  if (filtered.length === 0) {
    els.chapterList.innerHTML = `<li class="empty">"${escapeHtml(q)}" 일치 없음</li>`;
    return;
  }
  filtered.forEach((ch, i) => {
    const li = document.createElement("li");
    li.className = "chapter-item";
    const visited = (ch.maxDepth ?? 0) > 0;
    const isRecent = ch.id === recentChapterId;
    if (isRecent) li.classList.add("chapter-item--recent");
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
    // v0.5.51 — 검색 중일 땐 원본 인덱스를 보여줘서 "전체 중 N번째" 알 수 있게
    const originalIdx = q ? state.chapters.indexOf(ch) : i;
    const titleHtml = q ? _highlightMatch(ch.title, q) : escapeHtml(ch.title);
    // v0.5.69 — preview는 hover tooltip으로 보여줌. data-preview에 저장
    // (title attribute는 native browser tooltip이 떠서 충돌하므로 안 씀)
    const previewAttr = ch.preview
      ? ` data-chapter-preview="${escapeAttr(ch.preview)}"`
      : "";
    // v0.5.70 — 💡 AI 카드 버튼. 캐시 있으면 채워진 외관, 없으면 비어있음.
    const aiReady = ch.aiCardReady === true;
    const aiBtn = `<span class="chapter-ai-btn${aiReady ? " ready" : ""}" data-chapter-ai="${escapeAttr(ch.id)}" role="button" tabindex="0" title="${aiReady ? "AI 미리보기 카드 보기" : "AI 미리보기 카드 만들기 (1회 생성, 캐시됨)"}">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="${aiReady ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M9 18h6"></path>
          <path d="M10 22h4"></path>
          <path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2V17a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-.3c0-.8.4-1.5 1-2A7 7 0 0 0 12 2z"></path>
        </svg>
      </span>`;
    li.innerHTML = `
      <button class="chapter-btn ${visited ? "visited" : ""}" data-id="${escapeAttr(ch.id)}"${previewAttr}>
        <span class="num">${originalIdx + 1}.</span>
        <span class="title">${titleHtml}</span>
        ${badge}
        ${aiBtn}
        ${openBtn}
        ${trashBtn}
      </button>
    `;
    const btn = li.querySelector("button");
    btn.addEventListener("click", async (e) => {
      // v0.5.70 — AI 카드(💡) 클릭은 별도 popover 흐름
      const aiTrigger = e.target.closest("[data-chapter-ai]");
      if (aiTrigger) {
        e.preventDefault();
        e.stopPropagation();
        openChapterAiCardPopover(aiTrigger, ch);
        return;
      }
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
  _ensureChapterPreviewTooltip();
}

// v0.5.69 — 사이드바 챕터 hover 시 첫 단락 미리보기 floating tooltip.
// chapterList 컨테이너에 한 번만 delegation 리스너 붙이고, 재렌더 시 재사용.
let _chapterPreviewState = {
  tipEl: null,
  attached: false,
  showTimer: null,
  current: null, // 현재 hover 중인 chapter-btn (마우스 이동 race 방지)
};

function _ensureChapterPreviewTooltip() {
  if (_chapterPreviewState.attached || !els.chapterList) return;
  _chapterPreviewState.attached = true;

  const onEnter = (e) => {
    const btn = e.target.closest("[data-chapter-preview]");
    if (!btn) return;
    const preview = btn.getAttribute("data-chapter-preview");
    if (!preview) return;
    _chapterPreviewState.current = btn;
    if (_chapterPreviewState.showTimer) {
      clearTimeout(_chapterPreviewState.showTimer);
    }
    _chapterPreviewState.showTimer = setTimeout(() => {
      // 그 사이 다른 항목으로 이동/벗어남 → 표시 안 함
      if (_chapterPreviewState.current !== btn) return;
      _showChapterPreviewTooltip(btn, preview);
    }, 220);
  };
  const onLeave = (e) => {
    const btn = e.target.closest("[data-chapter-preview]");
    if (!btn) return;
    // mouseout는 자식으로 들어갈 때도 발생 — relatedTarget이 같은 btn 안이면 무시
    const related = e.relatedTarget;
    if (related && btn.contains(related)) return;
    _chapterPreviewState.current = null;
    if (_chapterPreviewState.showTimer) {
      clearTimeout(_chapterPreviewState.showTimer);
      _chapterPreviewState.showTimer = null;
    }
    _hideChapterPreviewTooltip();
  };

  // mouseover/mouseout는 버블링 — chapterList 한 곳에만 붙이면 됨
  els.chapterList.addEventListener("mouseover", onEnter);
  els.chapterList.addEventListener("mouseout", onLeave);
  // 사이드바 스크롤 시 tooltip 가리기 (위치 어긋남 방지)
  els.chapterList.addEventListener("scroll", _hideChapterPreviewTooltip, {
    passive: true,
  });
  // 사이드바 자체(부모) 스크롤도
  const sidebarScroller = els.chapterList.closest(".sidebar") ?? null;
  sidebarScroller?.addEventListener("scroll", _hideChapterPreviewTooltip, {
    passive: true,
  });
  window.addEventListener("blur", _hideChapterPreviewTooltip);
}

function _showChapterPreviewTooltip(btn, text) {
  let tip = _chapterPreviewState.tipEl;
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "chapter-preview-tooltip";
    tip.setAttribute("role", "tooltip");
    document.body.appendChild(tip);
    _chapterPreviewState.tipEl = tip;
  }
  tip.textContent = text;

  // 위치 계산: 챕터 항목 우측에 띄움. viewport 밖이면 좌측으로 fallback.
  // 우선 화면에 그려서 size 측정 → 위치 결정
  tip.style.visibility = "hidden";
  tip.classList.add("visible");
  const rect = btn.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  const GAP = 10;
  let left = rect.right + GAP;
  // viewport 우측 넘으면 좌측으로
  if (left + tipRect.width > window.innerWidth - 8) {
    left = rect.left - tipRect.width - GAP;
  }
  // 좌측도 안 되면 viewport 안에서 clamp
  if (left < 8) left = 8;
  // 세로 — 챕터 중앙에 tooltip 중앙
  let top = rect.top + rect.height / 2 - tipRect.height / 2;
  if (top < 8) top = 8;
  if (top + tipRect.height > window.innerHeight - 8) {
    top = window.innerHeight - tipRect.height - 8;
  }
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
  tip.style.visibility = "visible";
}

function _hideChapterPreviewTooltip() {
  const tip = _chapterPreviewState.tipEl;
  if (tip) tip.classList.remove("visible");
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

/**
 * v0.5.70 — 챕터 AI 미리보기 카드 popover.
 *
 * 사용자가 사이드바 💡 버튼을 클릭하면 호출. 서버에 fetch — 캐시 있으면
 * 즉시 카드 받음, 없으면 Claude(Haiku 4.5)로 생성 후 받음. 결과는 서버에서
 * 자동 캐시되므로 다음 클릭은 latency 0.
 *
 * 카드 구조:
 *   - summary    한 문장 — 이 챕터가 다루는 것
 *   - keyQuestions  이 챕터를 읽으면 답할 수 있게 되는 질문 2-3개
 *   - prerequisites  선수 지식 (있을 때만)
 *   - "이 챕터 시작" 버튼  바로 세션 진입
 */
async function openChapterAiCardPopover(anchorEl, chapter) {
  closeDeletePopover();
  const pop = document.createElement("div");
  pop.className = "chapter-ai-popover";
  pop.innerHTML = `
    <div class="chapter-ai-popover-header">
      <span class="chapter-ai-popover-title">${escapeHtml(chapter.title)}</span>
      <button class="chapter-ai-popover-close" type="button" aria-label="닫기">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
    <div class="chapter-ai-popover-body chapter-ai-loading">
      <div class="chapter-ai-loading-dots"><span></span><span></span><span></span></div>
      <div class="chapter-ai-loading-text">AI가 챕터를 살펴보는 중…</div>
      <div class="chapter-ai-loading-hint">처음 한 번만 생성, 다음 클릭부터는 즉시 표시</div>
    </div>
  `;
  // 위치 — 챕터 항목 우측. viewport 넘으면 좌측으로 fallback.
  const rect = anchorEl.getBoundingClientRect();
  const POP_WIDTH = 380;
  let left = rect.right + 12;
  if (left + POP_WIDTH > window.innerWidth - 8) {
    left = Math.max(8, rect.left - POP_WIDTH - 12);
  }
  let top = rect.top - 4;
  // viewport 아래 넘으면 위로 조정 — 일단 표시 후 실제 height로 보정
  pop.style.position = "fixed";
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  pop.style.width = `${POP_WIDTH}px`;
  document.body.appendChild(pop);
  _activePopover = pop;

  // 표시 후 viewport 충돌 보정
  requestAnimationFrame(() => {
    const r = pop.getBoundingClientRect();
    if (r.bottom > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - r.height - 8);
      pop.style.top = `${top}px`;
    }
  });

  // 닫기 버튼
  pop.querySelector(".chapter-ai-popover-close")?.addEventListener("click", () => {
    closeDeletePopover();
  });

  // 외부 클릭/ESC 닫기 — 다른 popover와 동일 메커니즘
  setTimeout(() => {
    document.addEventListener("mousedown", _onOutsideClick, true);
    document.addEventListener("keydown", _onPopoverKey, true);
  }, 0);

  // fetch
  try {
    const res = await fetch("/api/chapter-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roadmap_id: state.activeRoadmapId,
        chapter_id: chapter.id,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.card) {
      throw new Error(data.error || "미리보기 생성 실패");
    }
    // popover 가 그새 닫혔을 수 있음 (사용자가 다른 챕터 클릭)
    if (_activePopover !== pop) return;
    _renderChapterAiCardBody(pop, chapter, data.card);
    _aiCardRetryCount.delete(chapter.id); // v0.5.73 — 성공 시 재시도 카운터 리셋
    // state 갱신 — 다음 렌더링에서 💡 채워진 상태로 표시
    chapter.aiCardReady = true;
    const btn = document.querySelector(
      `[data-chapter-ai="${cssEscape(chapter.id)}"]`,
    );
    if (btn) btn.classList.add("ready");
  } catch (e) {
    if (_activePopover !== pop) return;
    const body = pop.querySelector(".chapter-ai-popover-body");
    if (body) {
      body.classList.remove("chapter-ai-loading");
      // v0.5.73 — 재시도 횟수 제한. 기존엔 무한 재시도 가능 → 같은 실패
      // 요청을 연타하면 API 호출만 반복 낭비.
      const tries = (_aiCardRetryCount.get(chapter.id) ?? 0) + 1;
      _aiCardRetryCount.set(chapter.id, tries);
      const canRetry = tries < AI_CARD_MAX_RETRIES;
      body.innerHTML = `
        <div class="chapter-ai-error">
          <div class="chapter-ai-error-title">생성 실패</div>
          <div class="chapter-ai-error-msg">${escapeHtml(String(e?.message || e))}</div>
          ${
            canRetry
              ? `<button class="chapter-ai-retry" type="button">다시 시도 (${tries}/${AI_CARD_MAX_RETRIES})</button>`
              : `<div class="chapter-ai-error-msg">여러 번 실패했어요 — 네트워크/API 키 상태 확인 후 잠시 뒤에 다시 시도해주세요.</div>`
          }
        </div>
      `;
      body.querySelector(".chapter-ai-retry")?.addEventListener("click", () => {
        closeDeletePopover();
        openChapterAiCardPopover(anchorEl, chapter);
      });
    }
  }
}

// v0.5.73 — AI 카드 생성 재시도 제한 (챕터별). 성공 시 리셋.
const AI_CARD_MAX_RETRIES = 3;
const _aiCardRetryCount = new Map();

function _renderChapterAiCardBody(pop, chapter, card) {
  const body = pop.querySelector(".chapter-ai-popover-body");
  if (!body) return;
  body.classList.remove("chapter-ai-loading");

  const questionsHtml =
    Array.isArray(card.keyQuestions) && card.keyQuestions.length
      ? `<ul class="chapter-ai-questions">${card.keyQuestions
          .map((q) => `<li>${escapeHtml(q)}</li>`)
          .join("")}</ul>`
      : "";
  const prereqHtml = card.prerequisites
    ? `<div class="chapter-ai-prereq"><span class="chapter-ai-prereq-label">선수 지식</span> ${escapeHtml(card.prerequisites)}</div>`
    : "";

  body.innerHTML = `
    <div class="chapter-ai-summary">${escapeHtml(card.summary)}</div>
    <div class="chapter-ai-section-label">이 챕터를 읽으면 답할 수 있게 됩니다</div>
    ${questionsHtml}
    ${prereqHtml}
    <div class="chapter-ai-actions">
      <button class="chapter-ai-start-btn" type="button">이 챕터 시작</button>
    </div>
  `;

  body.querySelector(".chapter-ai-start-btn")?.addEventListener("click", async () => {
    closeDeletePopover();
    const decision = await handleSessionInterruption();
    if (decision === "cancel") return;
    startSession(chapter.id);
  });
}

/** CSS.escape polyfill — 안전한 selector 생성. */
function cssEscape(s) {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(s);
  return String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
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
  // v0.5.45: curated 도메인 그리드 init
  initCuratedZone();
  document
    .getElementById("settings-open-wizard")
    ?.addEventListener("click", async () => {
      await window.spiralSettings.openSetupWizard?.();
    });

  // 새 워크스페이스 모달
  initAddWorkspaceModal();
}

function renderWorkspaceSelector() {
  if (!_settingsCache) return;
  const active = _settingsCache.workspaces.find(
    (w) => w.id === _settingsCache.activeWorkspaceId,
  );
  if (active && els.workspaceName) {
    els.workspaceName.textContent = displayWorkspaceName(active);
  }
  if (!els.workspaceList) return;
  els.workspaceList.innerHTML = _settingsCache.workspaces
    .map((w) => {
      const isActive = w.id === _settingsCache.activeWorkspaceId;
      return `
        <button class="workspace-item ${isActive ? "active" : ""}" data-id="${escapeAttr(w.id)}">
          <span class="workspace-item-icon">${isActive ? "✓" : "·"}</span>
          <span class="workspace-item-name">${escapeHtml(displayWorkspaceName(w))}</span>
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

// v0.5.32+ — 업데이트 banner. v0.5.36: 실패 명시 + manual 진입점 항상 노출.
async function refreshUpdateBanner({ force = false } = {}) {
  const banner = document.getElementById("update-banner");
  const text = document.getElementById("update-banner-text");
  const installBtn = document.getElementById("update-install-btn");
  const recheckBtn = document.getElementById("update-recheck-btn");
  const releasesLink = document.getElementById("update-releases-link");
  if (!banner || !text || !installBtn) return;
  if (!window.spiralUpdate) {
    banner.classList.add("hidden");
    return;
  }
  banner.classList.remove("hidden");
  banner.classList.remove("has-update", "errored");
  text.textContent = "업데이트 확인 중…";
  installBtn.classList.add("hidden");
  installBtn.disabled = true;
  if (recheckBtn) recheckBtn.disabled = true;

  // releases link 기본값
  const RELEASES_URL =
    "https://github.com/iq-agent-lab/iq-spiral-buddy/releases/latest";
  if (releasesLink) {
    releasesLink.classList.remove("hidden");
    releasesLink.onclick = (e) => {
      e.preventDefault();
      window.spiralUpdate.openExternal?.(RELEASES_URL);
    };
  }

  let info;
  try {
    info = await window.spiralUpdate.check({ force });
  } catch (err) {
    banner.classList.add("errored");
    text.innerHTML = `⚠ 확인 실패: ${escapeHtml(err?.message ?? String(err))} — 우측 <strong>Releases</strong>에서 수동으로 받기`;
    if (recheckBtn) recheckBtn.disabled = false;
    return;
  }

  if (recheckBtn) recheckBtn.disabled = false;

  if (info?.error) {
    banner.classList.add("errored");
    const hint =
      info?.httpStatus === 403
        ? " (GitHub API 시간당 제한 — 잠시 후 다시 확인하거나 우측 Releases에서 수동으로 받기)"
        : " — 우측 Releases에서 수동으로 받기";
    text.innerHTML = `⚠ 확인 실패: ${escapeHtml(info.error)}${hint}`;
    return;
  }

  if (info?.updateAvailable) {
    banner.classList.add("has-update");
    text.innerHTML = `✨ <strong>새 버전 v${escapeHtml(info.latest)}</strong> 사용 가능 — 현재 v${escapeHtml(info.current)}`;
    installBtn.dataset.version = info.latest;
    installBtn.classList.remove("hidden");
    installBtn.disabled = false;
    installBtn.textContent = "받기";
    installBtn.onclick = async () => {
      if (
        !confirm(
          `v${info.latest}으로 업데이트 받을게요.\n앱이 자동으로 종료 후 다시 열립니다. 진행할까요?`,
        )
      )
        return;
      installBtn.disabled = true;
      installBtn.textContent = "받는 중…";
      // v0.5.75 — Windows는 다운로드가 앱 안에서 진행됨 → 진행률 표시
      const offProgress = window.spiralUpdate.onProgress?.((p) => {
        if (p?.pct != null) {
          installBtn.textContent = `다운로드 ${p.pct}%`;
        }
      });
      try {
        const result = await window.spiralUpdate.install({
          version: info.latest,
        });
        // v0.5.75 — 실패가 명시적 반환으로 옴 (앱이 안 꺼졌다는 뜻).
        // 기존엔 실패해도 앱이 꺼져서 사용자가 아무것도 못 봤음.
        if (result && result.ok === false) {
          installBtn.disabled = false;
          installBtn.textContent = "받기";
          alert(
            `업데이트 실패: ${result.reason ?? "알 수 없는 오류"}\n\n` +
              `잠시 후 다시 시도하거나, 우측 Releases 링크에서 수동으로 받아주세요.`,
          );
        }
        // ok=true면 곧 앱이 종료되고 설치가 진행됨
      } catch (err) {
        installBtn.disabled = false;
        installBtn.textContent = "받기";
        alert(`업데이트 실패: ${err?.message ?? err}`);
      } finally {
        offProgress?.();
      }
    };
  } else {
    const cacheTag = info?.cached ? " (캐시)" : "";
    text.innerHTML = `✓ 최신 버전 v${escapeHtml(info?.current ?? "")}${cacheTag}`;
  }
}

// 다시 확인 버튼 wire — DOMContentLoaded에서 한 번만
document.addEventListener("DOMContentLoaded", () => {
  document
    .getElementById("update-recheck-btn")
    ?.addEventListener("click", () => refreshUpdateBanner({ force: true }));
});

function openSettingsModal() {
  if (!_settingsCache) return;
  els.settingsModal.classList.remove("hidden");
  els.settingsModal.setAttribute("aria-hidden", "false");

  // v0.5.32: 자동 업데이트 체크
  refreshUpdateBanner();
  // v0.5.45: 도메인 그리드 상태 갱신
  refreshCuratedZone().catch(() => {});

  // API 키: 입력은 비움(보안). 저장된 키는 별도 status 라인에 명확히 표시.
  const apiInput = document.getElementById("settings-api-key");
  const apiStatus = document.getElementById("settings-api-key-status");
  const apiSaveBtn = document.getElementById("settings-save-api-key");
  apiInput.value = "";
  apiInput.placeholder = "새 키 입력 (변경할 때만)";
  if (_settingsCache.apiKeyMasked) {
    apiStatus.innerHTML = `✓ <strong>저장된 키:</strong> <code>${escapeHtml(_settingsCache.apiKeyMasked)}</code> · 변경하려면 위에 새 키 입력`;
    apiStatus.classList.add("ok");
  } else {
    apiStatus.textContent = "키가 저장되어 있지 않습니다.";
    apiStatus.classList.remove("ok");
  }
  // 빈 input일 땐 저장 버튼 disabled — 의도치 않게 빈 키로 덮어쓰는 사고 방지
  apiSaveBtn.disabled = true;
  apiInput.oninput = () => {
    apiSaveBtn.disabled = apiInput.value.trim().length === 0;
  };

  document.getElementById("settings-vault-path").value =
    _settingsCache.vaultPath ?? "";

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
  const saveBtn = document.getElementById("settings-save-api-key");
  const val = input.value.trim();
  if (!val) {
    status.textContent = "키를 입력하세요.";
    status.classList.remove("ok");
    return;
  }
  saveBtn.disabled = true;
  saveBtn.textContent = "저장 중…";
  const res = await window.spiralSettings.updateApiKey(val);
  saveBtn.textContent = "저장";
  if (res.ok) {
    _settingsCache = await window.spiralSettings.get();
    input.value = "";
    input.placeholder = "새 키 입력 (변경할 때만)";
    status.innerHTML = `✓ <strong>저장됨:</strong> <code>${escapeHtml(_settingsCache.apiKeyMasked)}</code> · 다음 세션부터 적용`;
    status.classList.add("ok");
  } else {
    status.textContent = `✗ ${res.error}`;
    status.classList.remove("ok");
    saveBtn.disabled = false;
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
  const val = document.getElementById("settings-model")?.value;
  if (!val) return;
  await window.spiralSettings.updateModel(val);
  _settingsCache = await window.spiralSettings.get();
  state.selectedModel = val;
  localStorage.removeItem("spiral-buddy:model");
  renderModelSelector();
  setStatus("모델 설정이 저장됐습니다. 다음 세션부터 적용됩니다.");
}

function renderWorkspaceListInSettings() {
  const container = document.getElementById("settings-workspace-list");
  if (!container || !_settingsCache) return;
  container.innerHTML = _settingsCache.workspaces
    .map((w) => {
      const isActive = w.id === _settingsCache.activeWorkspaceId;
      const sourceTag = w.source ? `<span class="ws-source">${escapeHtml(w.source)}</span>` : "";
      const displayName = displayWorkspaceName(w);
      return `
        <div class="ws-row ${isActive ? "active" : ""}">
          <div class="ws-row-main">
            <div class="ws-row-name">
              ${isActive ? "✓ " : ""}${escapeHtml(displayName)}
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
        if (ws) openRemoveWorkspaceModal(ws);
      }
    });
  });
}

function openRemoveWorkspaceModal(ws) {
  const modal = document.getElementById("remove-ws-modal");
  if (!modal) return;
  document.getElementById("remove-ws-name").textContent = displayWorkspaceName(ws);
  document.getElementById("remove-ws-dir-path").innerHTML = ws.roadmapRoot
    ? `<code>${escapeHtml(ws.roadmapRoot)}</code> 가 영구 삭제됩니다.`
    : "이 워크스페이스에 학습 자료 경로가 없습니다.";
  document.getElementById("remove-ws-notes-path").innerHTML = `<code>${escapeHtml(_settingsCache.vaultPath ?? "")}/${escapeHtml(ws.vaultSubDir ?? "spiral-buddy")}</code> 이 옆 폴더로 이동(보관)됩니다.`;
  document.getElementById("remove-ws-del-dir").checked = false;
  document.getElementById("remove-ws-del-notes").checked = false;
  document.getElementById("remove-ws-error").classList.add("hidden");
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");

  // 핸들러 매번 새로 (중복 방지)
  const confirmBtn = document.getElementById("remove-ws-confirm");
  const cancelBtn = document.getElementById("remove-ws-cancel");
  const closeBtn = document.getElementById("remove-ws-close");
  const cleanup = () => {
    modal.classList.add("hidden");
    confirmBtn.replaceWith(confirmBtn.cloneNode(true));
    cancelBtn.replaceWith(cancelBtn.cloneNode(true));
    closeBtn.replaceWith(closeBtn.cloneNode(true));
  };

  document.getElementById("remove-ws-confirm").addEventListener("click", async () => {
    const deleteRoadmapDir = document.getElementById("remove-ws-del-dir").checked;
    const deleteNotes = document.getElementById("remove-ws-del-notes").checked;
    const btn = document.getElementById("remove-ws-confirm");
    btn.disabled = true;
    btn.textContent = "삭제 중…";
    const res = await window.spiralSettings.removeWorkspace({
      id: ws.id,
      deleteRoadmapDir,
      deleteNotes,
    });
    if (!res.ok) {
      const errBox = document.getElementById("remove-ws-error");
      errBox.textContent = res.error;
      errBox.classList.remove("hidden");
      btn.disabled = false;
      btn.textContent = "삭제";
      return;
    }
    cleanup();
    _settingsCache = await window.spiralSettings.get();
    renderWorkspaceListInSettings();
    renderWorkspaceSelector();
    // 에러가 있었으면 알림
    if (res.errors && res.errors.length > 0) {
      alert(
        "삭제는 됐지만 일부 정리 실패:\n" + res.errors.join("\n"),
      );
    }
  });
  document.getElementById("remove-ws-cancel").addEventListener("click", cleanup);
  document.getElementById("remove-ws-close").addEventListener("click", cleanup);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) cleanup();
  }, { once: true });
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
    } else if (p.phase === "reusing") {
      box.textContent = `↪ ${p.message ?? "기존 폴더 사용"} (재클론 없이 등록)`;
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

/**
 * 설정 모달 안에서 iq-dev-lab 38개를 한 번에 받기 + 워크스페이스로 자동 등록.
 * setup wizard 흐름과 동일한 IPC를 재사용한다.
 */
// ──────────────────────────────────────────────────────────
// v0.5.45 — Curated 도메인 그리드 (설정 모달)
// ──────────────────────────────────────────────────────────

const _curatedState = {
  data: null, // { org, domains, rolePresets }
  parentDir: null,
  installed: new Set(),
  busy: false,
};

const CURATED_PARENT_KEY = "spiral-buddy:curated-parent";

// v0.5.55 — 활성 워크스페이스의 roadmapRoot 부모 디렉토리 반환.
// roadmapRoot가 "/Users/x/spiral/iq-dev-lab"이면 부모는 "/Users/x/spiral".
// curated install은 parentDir 안에 <org>/<repo> 형태로 설치됨.
function _activeWorkspaceParentDir() {
  if (!_settingsCache?.workspaces) return null;
  const active = _settingsCache.workspaces.find(
    (w) => w.id === _settingsCache.activeWorkspaceId,
  );
  const root = active?.roadmapRoot;
  if (!root) return null;
  // 부모 경로 추출 (path.dirname 동등 — 마지막 슬래시 이전까지)
  const idx = Math.max(root.lastIndexOf("/"), root.lastIndexOf("\\"));
  if (idx < 1) return null;
  return root.slice(0, idx);
}

async function initCuratedZone() {
  if (!window.spiralCurated) return;
  const targetRow = document.getElementById("curated-target-row");
  if (!targetRow) return;
  // v0.5.55 — 우선 활성 워크스페이스 부모 디렉토리로 자동 채움.
  // 사용자가 명시적으로 다른 위치를 골랐었으면 그게 우선.
  const wsParent = _activeWorkspaceParentDir();
  const saved = localStorage.getItem(CURATED_PARENT_KEY);
  if (saved) {
    _curatedState.parentDir = saved;
  } else if (wsParent) {
    _curatedState.parentDir = wsParent;
  }

  document
    .getElementById("curated-target-pick")
    ?.addEventListener("click", async () => {
      const p = await window.spiralCurated.pickParentDir();
      if (!p) return;
      _curatedState.parentDir = p;
      try {
        localStorage.setItem(CURATED_PARENT_KEY, p);
      } catch {}
      await refreshCuratedZone();
    });

  // v0.5.55 — "현재 워크스페이스 폴더로" 빠른 복귀 버튼
  document
    .getElementById("curated-target-use-ws")
    ?.addEventListener("click", async () => {
      const p = _activeWorkspaceParentDir();
      if (!p) {
        alert(
          "활성 워크스페이스에 학습 자료 폴더(roadmapRoot)가 설정되지 않아 자동으로 못 잡았어요. '선택…'으로 직접 골라주세요.",
        );
        return;
      }
      _curatedState.parentDir = p;
      try {
        localStorage.setItem(CURATED_PARENT_KEY, p);
      } catch {}
      await refreshCuratedZone();
    });

  await refreshCuratedZone();
}

async function refreshCuratedZone() {
  if (!_curatedState.data) {
    _curatedState.data = await window.spiralCurated.getDomains({});
  }
  const data = _curatedState.data;
  const pathEl = document.getElementById("curated-target-path");
  if (pathEl) {
    pathEl.textContent = _curatedState.parentDir ?? "선택되지 않음";
    pathEl.classList.toggle("empty", !_curatedState.parentDir);
  }
  // v0.5.55 — 현재 위치 vs 활성 워크스페이스 비교 → 경고/안내 표시
  const warnEl = document.getElementById("curated-target-warning");
  const hintEl = document.getElementById("curated-target-hint");
  const wsParent = _activeWorkspaceParentDir();
  const isUsingWs =
    wsParent &&
    _curatedState.parentDir &&
    wsParent.toLowerCase() === _curatedState.parentDir.toLowerCase();
  if (warnEl && hintEl) {
    if (!_curatedState.parentDir || !wsParent) {
      warnEl.classList.add("hidden");
      hintEl.classList.add("hidden");
    } else if (isUsingWs) {
      warnEl.classList.add("hidden");
      hintEl.classList.remove("hidden");
    } else {
      warnEl.classList.remove("hidden");
      hintEl.classList.add("hidden");
    }
  }
  if (_curatedState.parentDir) {
    const res = await window.spiralCurated.getInstalled({
      parentDir: _curatedState.parentDir,
    });
    _curatedState.installed = new Set(res?.installed ?? []);
  } else {
    _curatedState.installed = new Set();
  }
  renderCuratedPresets();
  renderCuratedDomains();
}

function _domainReposByIds(domainIds) {
  const set = new Set();
  const domains = _curatedState.data?.domains ?? [];
  for (const id of domainIds) {
    const d = domains.find((x) => x.id === id);
    if (d) for (const c of d.categories) for (const r of c.repos) set.add(r);
  }
  return Array.from(set);
}

function renderCuratedPresets() {
  const grid = document.getElementById("curated-presets-grid");
  if (!grid) return;
  const presets = _curatedState.data?.rolePresets ?? [];
  grid.innerHTML = presets
    .map((p) => {
      const repos = _domainReposByIds(p.domains);
      const installedCount = repos.filter((r) =>
        _curatedState.installed.has(r),
      ).length;
      const allDone = installedCount === repos.length;
      return `
        <button class="curated-preset-card${p.recommended ? " recommended" : ""}${p.heavy ? " heavy" : ""}" data-preset="${escapeAttr(p.id)}" type="button" ${!_curatedState.parentDir || _curatedState.busy ? "disabled" : ""}>
          <div class="curated-preset-head">
            <span class="curated-preset-emoji">${escapeHtml(p.emoji ?? "")}</span>
            <span class="curated-preset-name">${escapeHtml(p.name)}</span>
            ${p.recommended ? `<span class="curated-preset-tag">추천</span>` : ""}
            ${p.heavy ? `<span class="curated-preset-tag heavy">무거움</span>` : ""}
          </div>
          <div class="curated-preset-sub">${escapeHtml(p.subtitle ?? "")}</div>
          <div class="curated-preset-meta">${repos.length} repos · ${installedCount}/${repos.length} 받음 ${allDone ? "✓" : ""}</div>
        </button>`;
    })
    .join("");
  grid.querySelectorAll(".curated-preset-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.preset;
      installCuratedPreset(id);
    });
  });
}

function renderCuratedDomains() {
  const list = document.getElementById("curated-domains-list");
  if (!list) return;
  const domains = _curatedState.data?.domains ?? [];
  list.innerHTML = domains
    .map((d) => {
      const repos = d.categories.flatMap((c) => c.repos);
      const installedRepos = repos.filter((r) =>
        _curatedState.installed.has(r),
      );
      const missing = repos.length - installedRepos.length;
      const isAllDone = missing === 0;
      const isPartial = installedRepos.length > 0 && missing > 0;
      const btnLabel = isAllDone
        ? "✓ 모두 받음"
        : isPartial
          ? `+${missing}개 추가`
          : `받기 (${repos.length})`;
      return `
        <div class="curated-domain-row ${isAllDone ? "all-done" : ""} ${isPartial ? "partial" : ""}">
          <div class="curated-domain-info">
            <div class="curated-domain-head">
              <span class="curated-domain-emoji">${escapeHtml(d.emoji ?? "")}</span>
              <span class="curated-domain-name">${escapeHtml(d.name)}</span>
              <span class="curated-domain-counts">${installedRepos.length}/${repos.length}</span>
            </div>
            <div class="curated-domain-sub">${escapeHtml(d.subtitle ?? "")}</div>
            ${d.hint ? `<div class="curated-domain-hint">ⓘ ${escapeHtml(d.hint)}</div>` : ""}
          </div>
          <button class="curated-domain-btn ${isAllDone ? "done" : ""} ${isPartial ? "partial" : ""}" data-domain="${escapeAttr(d.id)}" type="button" ${!_curatedState.parentDir || _curatedState.busy || isAllDone ? "disabled" : ""}>${btnLabel}</button>
        </div>`;
    })
    .join("");
  list.querySelectorAll(".curated-domain-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.domain;
      installCuratedDomain(id);
    });
  });
}

async function installCuratedPreset(presetId) {
  const preset = _curatedState.data?.rolePresets?.find(
    (p) => p.id === presetId,
  );
  if (!preset) return;
  const repos = _domainReposByIds(preset.domains);
  if (!_curatedState.parentDir) {
    alert("먼저 받을 위치를 선택해주세요.");
    return;
  }
  const missing = repos.filter((r) => !_curatedState.installed.has(r));
  if (missing.length === 0) {
    alert(`${preset.name} — 이미 모두 받음 ✓`);
    return;
  }
  const msg = `${preset.name} (${preset.subtitle ?? ""})\n\n받을 레포: ${missing.length}개 (이미 받은 ${repos.length - missing.length}개는 skip)\n위치: ${_curatedState.parentDir}\n\n진행할까요?`;
  if (!confirm(msg)) return;
  await runCuratedInstall(missing, preset.name);
}

async function installCuratedDomain(domainId) {
  const d = _curatedState.data?.domains?.find((x) => x.id === domainId);
  if (!d) return;
  const repos = d.categories.flatMap((c) => c.repos);
  if (!_curatedState.parentDir) {
    alert("먼저 받을 위치를 선택해주세요.");
    return;
  }
  const missing = repos.filter((r) => !_curatedState.installed.has(r));
  if (missing.length === 0) {
    alert(`${d.name} — 이미 모두 받음 ✓`);
    return;
  }
  const msg = `${d.emoji} ${d.name}\n${d.subtitle ?? ""}\n\n받을 레포: ${missing.length}개\n위치: ${_curatedState.parentDir}\n\n진행할까요?`;
  if (!confirm(msg)) return;
  await runCuratedInstall(missing, d.name);
}

async function runCuratedInstall(repoNames, label) {
  if (_curatedState.busy) return;
  _curatedState.busy = true;
  const progress = document.getElementById("curated-progress");
  const text = document.getElementById("curated-progress-text");
  const fill = document.getElementById("curated-progress-fill");
  progress?.classList.remove("hidden");
  if (text) text.textContent = `${label} — 준비 중…`;
  if (fill) fill.style.width = "0%";
  // 버튼 disable 상태 반영
  renderCuratedPresets();
  renderCuratedDomains();

  const off = window.spiralCurated.onProgress((p) => {
    if (!text) return;
    if (p.phase === "fetching") {
      text.textContent = `${label} — ${p.message ?? "레포 목록 가져오는 중…"}`;
    } else if (p.phase === "cloning") {
      const pct =
        p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
      text.textContent = `${label} — [${p.done}/${p.total}] ${p.current ?? ""}${p.skipped ? ` · skip ${p.skipped}` : ""}`;
      if (fill) fill.style.width = `${pct}%`;
    } else if (p.phase === "done") {
      text.textContent = `${label} — ✓ 완료 (${p.done - (p.failed ?? 0)}/${p.total}, skip ${p.skipped ?? 0}, 실패 ${p.failed ?? 0})`;
      if (fill) fill.style.width = `100%`;
    }
  });

  const res = await window.spiralCurated.install({
    parentDir: _curatedState.parentDir,
    repoNames,
  });
  off?.();
  _curatedState.busy = false;

  if (!res?.ok) {
    if (text) text.textContent = `✗ ${label} 실패: ${res?.error ?? "unknown"}`;
  } else {
    if (text)
      text.textContent = `✓ ${label} 완료 — 새로 받음 ${res.newlyInstalled}, skip ${res.skipped}, 실패 ${res.failed?.length ?? 0}`;
    // 워크스페이스가 없으면 자동 등록 제안
    const ws = _settingsCache?.workspaces ?? [];
    const targetDir = res.targetDir;
    const matches = ws.some((w) => w.roadmapRoot === targetDir);
    if (!matches && window.spiralSettings) {
      if (
        confirm(
          `iq-dev-lab을 워크스페이스로 등록할까요?\n${targetDir}\n(이미 등록되어 있다면 패스하세요)`,
        )
      ) {
        const wsRes = await window.spiralSettings.addWorkspace({
          name: "iq-dev-lab",
          sourceKind: "dir",
          localPath: targetDir,
        });
        if (wsRes?.ok) {
          _settingsCache = await window.spiralSettings.get();
          renderWorkspaceListInSettings?.();
          renderWorkspaceSelector?.();
        }
      }
    }
  }
  await refreshCuratedZone();
}

// ──────────────────────────────────────────────────────────
// Look-up (사이드 학습 패널)
//
// 사용자가 대화 메시지에서 텍스트를 드래그하면 floating mini-toolbar가 뜸.
// 깊이(간결/중간/깊이) 선택 → 우측 사이드 패널에 SSE 스트리밍으로 답변 추가.
// 메인 대화 흐름엔 영향 없음.
// ──────────────────────────────────────────────────────────

const _lookupState = {
  open: false,
  cardCount: 0,
};

function initLookup() {
  if (!els.messages || !els.lookupToolbar || !els.lookupPanel) return;

  // 메시지 영역 + Look-up 패널 안의 selection 감지 (v0.5.31: 카드 본문 드래그도 지원)
  els.messages.addEventListener("mouseup", handleSelectionChange);
  els.messages.addEventListener("keyup", handleSelectionChange);
  els.lookupPanelBody?.addEventListener("mouseup", handleSelectionChange);
  els.lookupPanelBody?.addEventListener("keyup", handleSelectionChange);
  // 외부 클릭 시 toolbar 숨김 (단 toolbar 자체는 제외)
  document.addEventListener("mousedown", (e) => {
    if (els.lookupToolbar.contains(e.target)) return;
    if (els.lookupQuestionPopover?.contains(e.target)) return;
    // 잠시 뒤에 selection이 사라졌는지 확인
    setTimeout(() => {
      const sel = window.getSelection();
      const txt = sel?.toString().trim() ?? "";
      const inMain = sel?.anchorNode && els.messages.contains(sel.anchorNode);
      const inLookup =
        sel?.anchorNode && els.lookupPanelBody?.contains(sel.anchorNode);
      if (!txt || (!inMain && !inLookup)) {
        hideLookupToolbar();
      }
    }, 0);
  });

  // toolbar 버튼 핸들러 — mousedown에서 직접 실행 (click 이벤트는 선택 해제 후
  // 발생할 수 있어 selection이 비어 있는 경우가 생김).
  els.lookupToolbar.querySelectorAll(".lookup-tool-btn").forEach((b) => {
    b.addEventListener("mousedown", (e) => {
      e.preventDefault(); // selection이 사라지지 않게 + focus 변경 방지
      e.stopPropagation();
      const text = (window.getSelection()?.toString() ?? "").trim();
      if (!text) return;
      const action = b.dataset.action;
      const depth = b.dataset.depth;
      if (action === "question") {
        // v0.5.31 #1: 질문 추가 popover 열기 — selection 위치를 기억
        openLookupQuestionPopover(text);
        hideLookupToolbar();
        return;
      }
      if (action === "context") {
        // v0.5.58 — 챕터 본문 맥락 요약. selection이 어떤 assistant 메시지 안에 있는지 찾아
        // 그 메시지 전체를 target으로, 선택 텍스트를 selectionText로 보냄.
        const sel = window.getSelection();
        const anchor = sel?.anchorNode;
        const anchorEl =
          anchor?.nodeType === Node.ELEMENT_NODE
            ? anchor
            : anchor?.parentElement;
        const msgEl = anchorEl?.closest?.(".message.assistant");
        const messageText =
          msgEl?.querySelector(".content")?.innerText?.trim() ?? text;
        hideLookupToolbar();
        try {
          window.getSelection()?.removeAllRanges();
        } catch {}
        runChapterContext({ targetMessageText: messageText, selectionText: text });
        return;
      }
      if (!depth) return;
      hideLookupToolbar();
      try {
        window.getSelection()?.removeAllRanges();
      } catch {}
      runLookup(text, depth);
    });
  });

  // 질문 popover
  initLookupQuestionPopover();
  // 직접 입력 form
  initLookupDirectForm();

  // topbar 토글 버튼 (다시 열기 진입점)
  document.getElementById("lookup-toggle")?.addEventListener("click", () => {
    if (_lookupState.open) closeLookupPanel();
    else openLookupPanel();
  });
  // Cmd/Ctrl+L 토글
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === "l" || e.key === "L")) {
      e.preventDefault();
      if (_lookupState.open) closeLookupPanel();
      else openLookupPanel();
    }
  });

  // 패널 clear/expand (X 닫기는 제거됨 — 상단 토글 또는 Cmd+L로 닫기)
  els.lookupClear?.addEventListener("click", () => {
    if (els.lookupPanelBody) els.lookupPanelBody.innerHTML = "";
    _lookupState.cardCount = 0;
  });
  els.lookupExpand?.addEventListener("click", () => {
    document.body.classList.toggle("lookup-fullscreen");
  });

  // 패널 너비 조절 (사이드바와 동일 패턴, 우측에서 드래그)
  // v0.5.66 — 사용자 피드백 "맥락 버튼 눌렀는데 우측 패널이 커지면 좌측 다듬기 send를 덮어버리네"
  // LOOKUP_MAX와 CHAT_MIN을 사이드바 정책과 일관성 있게 정리:
  //   - LOOKUP_MAX 760 → 520 (Look-up은 보조 도구 — 너무 클 필요 없음)
  //   - CHAT_MIN 620 → 760 (composer 다듬기/Send + topbar 모두 보장)
  const LOOKUP_WIDTH_KEY = "spiral-buddy:lookup-width";
  const LOOKUP_DEFAULT = 380;
  const LOOKUP_MIN = 280;
  const LOOKUP_MAX = 520;
  // chat 컬럼 최소 폭 — composer btn-col(다듬기/Send) + topbar 액션이 모두 fit
  const CHAT_MIN = 760;
  function _sidebarPx() {
    const v = getComputedStyle(document.body)
      .getPropertyValue("--sidebar-w")
      .trim();
    return parseInt(v, 10) || 0;
  }
  function _lookupMaxForViewport() {
    // 사이드바와 채팅 최소 폭을 빼고 남는 만큼이 lookup의 진짜 최대.
    // 그게 LOOKUP_MAX보다 작으면 그걸로 캡 — chat이 항상 ≥520px.
    const headroom = window.innerWidth - _sidebarPx() - CHAT_MIN;
    return Math.min(LOOKUP_MAX, Math.max(LOOKUP_MIN, headroom));
  }
  const savedLookupW = localStorage.getItem(LOOKUP_WIDTH_KEY);
  if (savedLookupW) {
    const parsed = parseInt(savedLookupW, 10) || LOOKUP_DEFAULT;
    const w = Math.max(LOOKUP_MIN, Math.min(_lookupMaxForViewport(), parsed));
    // 패널이 열려 있을 때만 적용. 처음엔 width 0이므로 변수만 저장.
    document.body.style.setProperty("--lookup-w-saved", `${w}px`);
    // v0.5.66 — saved가 새 cap보다 크면 localStorage 갱신 (옛 큰 값 마이그레이션)
    if (parsed > w) {
      try {
        localStorage.setItem(LOOKUP_WIDTH_KEY, String(w));
      } catch {}
    }
  }
  if (els.lookupResizer) {
    let dragging = false;
    els.lookupResizer.addEventListener("mousedown", (e) => {
      e.preventDefault();
      dragging = true;
      document.body.classList.add("lookup-resizing");
    });
    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      // viewport 우측 끝에서 mouseX를 빼면 panel width
      const w = Math.max(
        LOOKUP_MIN,
        Math.min(_lookupMaxForViewport(), window.innerWidth - e.clientX),
      );
      document.body.style.setProperty("--lookup-w", `${w}px`);
      document.body.style.setProperty("--lookup-w-saved", `${w}px`);
    });
    document.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove("lookup-resizing");
      const w = document.body.style.getPropertyValue("--lookup-w-saved");
      if (w) localStorage.setItem(LOOKUP_WIDTH_KEY, w.trim());
    });
    // 더블클릭 → 기본값
    els.lookupResizer.addEventListener("dblclick", () => {
      document.body.style.setProperty("--lookup-w", `${LOOKUP_DEFAULT}px`);
      document.body.style.setProperty("--lookup-w-saved", `${LOOKUP_DEFAULT}px`);
      localStorage.setItem(LOOKUP_WIDTH_KEY, String(LOOKUP_DEFAULT));
    });
  }

  // v0.5.49 — 창 축소 시 lookup 폭을 자동으로 줄여 chat 컬럼 최소 폭 유지
  window.addEventListener("resize", () => {
    if (!_lookupState.open) return;
    const cur = parseInt(
      (document.body.style.getPropertyValue("--lookup-w") || "").trim(),
      10,
    );
    if (!cur) return;
    const cap = _lookupMaxForViewport();
    if (cur > cap) {
      document.body.style.setProperty("--lookup-w", `${cap}px`);
      // saved는 유지 — 창 다시 키우면 원래 폭으로 복원되도록
    }
  });

  // ESC로 panel 닫기
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && _lookupState.open) {
      // 다른 모달이 열려있지 않을 때만 (이미 다른 ESC 핸들러가 잡으면 그쪽 우선)
      const anyModalOpen =
        document.querySelector(".modal-overlay:not(.hidden)") !== null;
      if (!anyModalOpen) closeLookupPanel();
    }
  });
}

function handleSelectionChange() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) {
    hideLookupToolbar();
    return;
  }
  const text = sel.toString().trim();
  if (!text || text.length < 2 || text.length > 400) {
    hideLookupToolbar();
    return;
  }
  // 메시지 영역 또는 Look-up 패널 본문인지 확인 (v0.5.31)
  const anchorEl =
    sel.anchorNode?.nodeType === Node.ELEMENT_NODE
      ? sel.anchorNode
      : sel.anchorNode?.parentElement;
  const inMain = anchorEl && els.messages.contains(anchorEl);
  const inLookup =
    anchorEl && els.lookupPanelBody?.contains(anchorEl);
  if (!anchorEl || (!inMain && !inLookup)) {
    hideLookupToolbar();
    return;
  }
  // selection rect 기준으로 toolbar 위치
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    hideLookupToolbar();
    return;
  }
  showLookupToolbar(rect);
}

function showLookupToolbar(rect) {
  if (!els.lookupToolbar) return;
  els.lookupToolbar.classList.remove("hidden");
  // 위치: selection 위쪽 (위 공간 없으면 아래)
  const tbWidth = els.lookupToolbar.offsetWidth || 220;
  const tbHeight = els.lookupToolbar.offsetHeight || 36;
  let top = rect.top - tbHeight - 8;
  if (top < 12) top = rect.bottom + 8;
  let left = rect.left + rect.width / 2 - tbWidth / 2;
  left = Math.max(12, Math.min(window.innerWidth - tbWidth - 12, left));
  els.lookupToolbar.style.top = `${top}px`;
  els.lookupToolbar.style.left = `${left}px`;
}

function hideLookupToolbar() {
  els.lookupToolbar?.classList.add("hidden");
}

// v0.5.67 — openLookupPanel과 setupLookupResizer가 같은 cap 정책을 쓰도록
// 모듈 레벨 상수/함수로 끌어올림. 기존엔 openLookupPanel에 옛 hard-coded
// 값(LOOKUP_MAX=760, CHAT_MIN=620, sidebar-collapsed 무시)이 남아있어서
// 첫 열림 시 cap이 잘못 적용 → resize handle 한 번 만지면 정상화되는 증상.
const LOOKUP_MAX_CAP = 520; // v0.5.66 LOOKUP_MAX와 동일
const LOOKUP_MIN_CAP = 280;
const CHAT_MIN_CAP = 760; // v0.5.66 CHAT_MIN과 동일
const LOOKUP_DEFAULT_W = 380; // v0.5.68 — CSS body.lookup-open { --lookup-w: 380px }와 일치

function _currentSidebarPxForCap() {
  // sidebar가 collapsed 상태면 grid track이 0px라 cap 계산 시 0으로 봐야 함
  if (document.body.classList.contains("sidebar-collapsed")) return 0;
  const v = getComputedStyle(document.body)
    .getPropertyValue("--sidebar-w")
    .trim();
  return parseInt(v, 10) || 0;
}

function _lookupMaxForViewportShared() {
  const headroom =
    window.innerWidth - _currentSidebarPxForCap() - CHAT_MIN_CAP;
  return Math.min(LOOKUP_MAX_CAP, Math.max(LOOKUP_MIN_CAP, headroom));
}

function openLookupPanel() {
  // v0.5.67 — sidebar-collapsed 상태로 먼저 전환한 후 cap 계산
  // (자동 사이드바 접힘 이후 viewport headroom이 달라지므로 순서 중요)
  if (!document.body.classList.contains("sidebar-collapsed")) {
    document.body.classList.add("sidebar-collapsed");
    try {
      localStorage.setItem("spiral-buddy:sidebar-collapsed", "1");
    } catch {}
  }

  // v0.5.68 — 항상 inline --lookup-w 적용. 옛 버전엔 saved 없을 때
  // removeProperty 해서 CSS default(380px)가 cap 무시하고 적용됐고,
  // 작은 viewport에선 380px가 chat 컬럼을 압박해 composer가 Look-up 패널
  // 좌측 경계에 침범하던 증상. 첫 클릭에서만 saved가 없으니 정확히
  // "처음에만 안 됨, resize 한 번 만지면 정상" 패턴과 일치.
  const cap = _lookupMaxForViewportShared();
  const saved = (document.body.style.getPropertyValue("--lookup-w-saved") || "").trim();
  const savedPx = parseInt(saved, 10);
  const base = Number.isFinite(savedPx) && savedPx >= LOOKUP_MIN_CAP
    ? savedPx
    : LOOKUP_DEFAULT_W;
  const applied = Math.max(LOOKUP_MIN_CAP, Math.min(base, cap));
  document.body.style.setProperty("--lookup-w", `${applied}px`);
  document.body.classList.add("lookup-open");
  els.lookupPanel?.classList.remove("hidden");
  els.lookupResizer?.classList.remove("hidden");
  els.lookupPanel?.setAttribute("aria-hidden", "false");
  _lookupState.open = true;
}

function closeLookupPanel() {
  // v0.5.73 — 진행 중 lookup/맥락 스트림 중단 (네트워크/서버 생성 낭비 방지)
  abortStreams("lookup");
  document.body.classList.remove("lookup-open");
  document.body.classList.remove("lookup-fullscreen");
  els.lookupPanel?.classList.add("hidden");
  els.lookupResizer?.classList.add("hidden");
  els.lookupPanel?.setAttribute("aria-hidden", "true");
  _lookupState.open = false;
  // v0.5.50 — inline --lookup-w를 제거해야 grid track이 0으로 돌아감.
  // 안 지우면 panel은 hidden인데 grid column은 400px(또는 saved)로 남아
  // 채팅 우측에 빈 검은 영역이 발생함. saved 값은 별도(--lookup-w-saved)에 보존 → 재오픈 시 복원.
  document.body.style.removeProperty("--lookup-w");
}

// ──────────────────────────────────────────────────────────
// v0.5.31 #1 Look-up "질문 추가" popover
// ──────────────────────────────────────────────────────────

let _pendingKeyword = "";

function openLookupQuestionPopover(keyword) {
  if (!els.lookupQuestionPopover) return;
  _pendingKeyword = keyword;
  els.lookupQuestionKeyword.textContent = keyword;
  els.lookupQuestionText.value = "";
  els.lookupQuestionDepth.value = "medium";
  // 위치: 화면 중앙 상단쯤 (간단히 fixed CSS로 처리)
  els.lookupQuestionPopover.classList.remove("hidden");
  setTimeout(() => els.lookupQuestionText.focus(), 30);
}

function closeLookupQuestionPopover() {
  els.lookupQuestionPopover?.classList.add("hidden");
  _pendingKeyword = "";
}

function initLookupQuestionPopover() {
  if (!els.lookupQuestionPopover) return;
  els.lookupQuestionCancel?.addEventListener("click", closeLookupQuestionPopover);
  els.lookupQuestionSubmit?.addEventListener("click", () => {
    const question = els.lookupQuestionText.value.trim();
    const depth = els.lookupQuestionDepth.value || "medium";
    const keyword = _pendingKeyword;
    if (!keyword) return;
    closeLookupQuestionPopover();
    try {
      window.getSelection()?.removeAllRanges();
    } catch {}
    runLookup(keyword, depth, { userQuestion: question });
  });
  // Enter (Shift 없이) → 보내기
  els.lookupQuestionText?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      els.lookupQuestionSubmit.click();
    }
    if (e.key === "Escape") {
      closeLookupQuestionPopover();
    }
  });
}

// ──────────────────────────────────────────────────────────
// v0.5.31 #2 Look-up 패널 하단 직접 입력
// ──────────────────────────────────────────────────────────

function initLookupDirectForm() {
  if (!els.lookupDirectForm) return;
  // depth pill 순환
  const depths = ["concise", "medium", "deep"];
  els.lookupDirectDepth?.addEventListener("click", () => {
    const cur = els.lookupDirectDepth.dataset.depth || "medium";
    const next = depths[(depths.indexOf(cur) + 1) % depths.length];
    els.lookupDirectDepth.dataset.depth = next;
    els.lookupDirectDepth.textContent = DEPTH_LABEL_TEXT[next] ?? next;
  });
  // 문맥 입력창 toggle
  els.lookupDirectCtxToggle?.addEventListener("click", () => {
    const hidden = els.lookupDirectContext.classList.toggle("hidden");
    els.lookupDirectCtxToggle.classList.toggle("active", !hidden);
    if (!hidden) els.lookupDirectContext.focus();
  });
  // Enter (Shift 없이) → submit (textarea라서 기본 동작은 줄바꿈)
  els.lookupDirectInput?.addEventListener("keydown", (e) => {
    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      !e.isComposing &&
      e.keyCode !== 229
    ) {
      e.preventDefault();
      els.lookupDirectForm.requestSubmit();
    }
  });
  // submit
  els.lookupDirectForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const keyword = els.lookupDirectInput.value.trim();
    if (keyword.length < 2) return;
    const ctx = els.lookupDirectContext.value.trim();
    const depth = els.lookupDirectDepth.dataset.depth || "medium";
    els.lookupDirectInput.value = "";
    els.lookupDirectContext.value = "";
    // 문맥은 userQuestion으로 보냄 (서버는 lookup에서 보존)
    runLookup(keyword, depth, { userQuestion: ctx || undefined });
  });

  // 높이 리사이즈 (좌측 composer-resizer와 동일 패턴)
  initLookupDirectResizer();
}

function initLookupDirectResizer() {
  if (!els.lookupDirectResizer || !els.lookupDirectInput) return;
  const KEY = "spiral-buddy:lookup-input-height";
  const MIN = 60;
  const MAX = 420;
  const saved = parseInt(localStorage.getItem(KEY) ?? "0", 10);
  if (saved >= MIN && saved <= MAX) {
    els.lookupDirectInput.style.minHeight = `${saved}px`;
    els.lookupDirectInput.style.maxHeight = `${saved}px`;
  }
  let dragging = false;
  let startY = 0;
  let startH = 0;
  els.lookupDirectResizer.addEventListener("mousedown", (e) => {
    e.preventDefault();
    dragging = true;
    startY = e.clientY;
    startH = els.lookupDirectInput.offsetHeight;
    document.body.classList.add("composer-resizing");
  });
  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const dy = startY - e.clientY;
    const next = Math.max(MIN, Math.min(MAX, startH + dy));
    els.lookupDirectInput.style.minHeight = `${next}px`;
    els.lookupDirectInput.style.maxHeight = `${next}px`;
  });
  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove("composer-resizing");
    const h = els.lookupDirectInput.offsetHeight;
    localStorage.setItem(KEY, String(h));
  });
  els.lookupDirectResizer.addEventListener("dblclick", () => {
    els.lookupDirectInput.style.minHeight = "";
    els.lookupDirectInput.style.maxHeight = "";
    localStorage.removeItem(KEY);
  });
}

// ──────────────────────────────────────────────────────────
// v0.5.31 #4 Composer 높이 조절 (드래그 핸들)
// ──────────────────────────────────────────────────────────

function initComposerResizer() {
  if (!els.composerResizer || !els.input) return;
  const KEY = "spiral-buddy:input-height";
  const MIN = 72;
  const MAX = 480;
  const saved = parseInt(localStorage.getItem(KEY) ?? "0", 10);
  if (saved >= MIN && saved <= MAX) {
    els.input.style.minHeight = `${saved}px`;
    els.input.style.maxHeight = `${saved}px`;
  }
  let dragging = false;
  let startY = 0;
  let startH = 0;
  els.composerResizer.addEventListener("mousedown", (e) => {
    e.preventDefault();
    dragging = true;
    startY = e.clientY;
    startH = els.input.offsetHeight;
    document.body.classList.add("composer-resizing");
  });
  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    // 위로 드래그 → 입력창 커짐
    const dy = startY - e.clientY;
    const next = Math.max(MIN, Math.min(MAX, startH + dy));
    els.input.style.minHeight = `${next}px`;
    els.input.style.maxHeight = `${next}px`;
  });
  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove("composer-resizing");
    const h = els.input.offsetHeight;
    localStorage.setItem(KEY, String(h));
  });
  // 더블클릭 → 기본값으로 리셋
  els.composerResizer.addEventListener("dblclick", () => {
    els.input.style.minHeight = "";
    els.input.style.maxHeight = "";
    localStorage.removeItem(KEY);
  });
}

// ─── 공통 SVG 아이콘 (이모지 → lucide 통일) ───
const FLAME_SVG_INLINE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>`;
const SPIRAL_SVG_INLINE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 12 m0 0 a1 1 0 0 1 2 0 a2 2 0 0 1 -4 0 a3 3 0 0 1 6 0 a4 4 0 0 1 -8 0 a5 5 0 0 1 10 0"/></svg>`;
// lucide copy — 두 사각형 오버랩 (Look-up 카드의 복사 버튼용)
const COPY_SVG_INLINE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
// 복사 성공 후 잠깐 보여줄 체크
const CHECK_SVG_INLINE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;
// 카드 닫기 X
const X_SVG_INLINE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

const DEPTH_ICONS = {
  concise:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="14" y2="12"/><circle cx="19" cy="12" r="1.4" fill="currentColor"/></svg>',
  medium:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="14" y2="15"/></svg>',
  deep:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="13" y2="18"/></svg>',
};
const DEPTH_LABEL_TEXT = {
  concise: "간결",
  medium: "중간",
  deep: "깊이",
};

// ──────────────────────────────────────────────────────────
// v0.5.73 — SSE 스트림 lifecycle 관리 (abort + inactivity timeout)
//
// 기존엔 진행 중 스트림을 중단할 방법이 없어서:
//   - Look-up 패널을 닫아도 reader가 계속 살아 네트워크/서버 생성 낭비
//   - 새 세션 시작 시 이전 스트림이 사라진 DOM에 계속 write
//   - 서버가 hang하면 클라이언트가 영구 대기
//
// 모든 스트리밍 fetch는 handle을 만들어 group("session"/"lookup")으로
// 추적하고, 패널 닫기/세션 전환 시 abortStreams(group)으로 일괄 중단.
// chunk 간 STREAM_INACTIVITY_MS 넘으면 자동 abort (총 시간 제한이 아니라
// "멈춤" 감지 — 긴 생성은 chunk가 계속 오므로 안 걸림).
// ──────────────────────────────────────────────────────────

const STREAM_INACTIVITY_MS = 60_000;
const _activeStreams = new Set();

function createStreamHandle(group) {
  const handle = {
    group,
    controller: new AbortController(),
    // 사용자 액션(패널 닫기/세션 전환)에 의한 중단 = true → 에러 UI 안 띄움
    intentional: false,
  };
  _activeStreams.add(handle);
  return handle;
}

function finishStreamHandle(handle) {
  _activeStreams.delete(handle);
}

/** group의 진행 중 스트림 전부 중단. group 생략 시 전체. */
function abortStreams(group) {
  for (const h of [..._activeStreams]) {
    if (group && h.group !== group) continue;
    h.intentional = true;
    try {
      h.controller.abort();
    } catch {}
    _activeStreams.delete(h);
  }
}

function isIntentionalAbort(err, handle) {
  return !!handle?.intentional && err?.name === "AbortError";
}

/**
 * reader를 inactivity timeout과 함께 소비. chunk마다 onChunk(text) 호출.
 * 멈춤 감지 시 abort + throw — 호출자 catch에서 사용자에게 표시.
 */
async function pumpStream(reader, handle, onChunk) {
  const decoder = new TextDecoder();
  while (true) {
    let timer = null;
    let result;
    const readP = reader.read();
    // race에서 진 read의 늦은 reject가 unhandled rejection 안 되게
    readP.catch(() => {});
    try {
      result = await Promise.race([
        readP,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            try {
              handle.controller.abort();
            } catch {}
            reject(
              new Error(
                `서버 응답이 ${STREAM_INACTIVITY_MS / 1000}초간 멈춰서 중단했어요 — 다시 시도해주세요`,
              ),
            );
          }, STREAM_INACTIVITY_MS);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (result.done) break;
    onChunk(decoder.decode(result.value, { stream: true }));
  }
}

/**
 * 같은 (query, depth, userQuestion) 조합을 fingerprint로 만들어 중복 카드 막기.
 * v0.5.51 — 토큰 절약 + 카드 중복 방지.
 */
function _lookupFingerprint(query, depth, userQuestion) {
  const norm = (s) =>
    String(s ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  return `${norm(query)}::${depth}::${norm(userQuestion)}`;
}

/**
 * @param query 키워드/표현
 * @param depth concise|medium|deep
 * @param opts.userQuestion 키워드 옆에 같이 던질 추가 질문
 */
async function runLookup(query, depth, opts = {}) {
  openLookupPanel();
  if (!els.lookupPanelBody) return;
  const userQuestion = (opts.userQuestion ?? "").trim() || undefined;

  // v0.5.51 — 동일한 (query, depth, userQuestion) 조합이 이미 있으면
  // 기존 카드로 이동 + 플래시 + 토스트. 새 API 호출/카드 생성 안 함.
  const fingerprint = _lookupFingerprint(query, depth, userQuestion);
  const existing = els.lookupPanelBody.querySelector(
    `.lookup-card[data-lookup-key="${CSS.escape(fingerprint)}"]`,
  );
  if (existing) {
    existing.classList.remove("collapsed");
    existing.classList.add("lookup-card-flash");
    existing.scrollIntoView({ block: "center", behavior: "smooth" });
    setTimeout(() => existing.classList.remove("lookup-card-flash"), 1500);
    setStatus(
      depth === "concise"
        ? `"${query}" 간결 답변은 이미 받은 게 있어요 — 위에 표시했어요`
        : depth === "medium"
          ? `"${query}" 중간 답변은 이미 받은 게 있어요 — 위에 표시했어요`
          : `"${query}" 깊이 답변은 이미 받은 게 있어요 — 위에 표시했어요`,
      "info",
    );
    return;
  }

  // 기존 카드는 모두 접기 (v0.5.31: 새 질문만 펼침)
  els.lookupPanelBody.querySelectorAll(".lookup-card").forEach((c) => {
    c.classList.add("collapsed");
  });

  // 카드 생성 (펼친 상태로)
  const card = document.createElement("article");
  card.className = "lookup-card";
  card.dataset.lookupKey = fingerprint; // v0.5.51 — 중복 차단용
  const questionLine = userQuestion
    ? `<div class="lookup-card-userq" title="${escapeAttr(userQuestion)}">Q. ${escapeHtml(userQuestion)}</div>`
    : "";
  card.innerHTML = `
    <div class="lookup-card-head" role="button" tabindex="0" title="클릭하여 펼침/접기">
      <span class="lookup-card-depth" data-depth="${escapeAttr(depth)}">
        <span class="lookup-card-depth-icon">${DEPTH_ICONS[depth] ?? ""}</span>
        <span>${DEPTH_LABEL_TEXT[depth] ?? depth}</span>
      </span>
      <span class="lookup-card-query" title="${escapeAttr(query)}">${escapeHtml(query)}</span>
      <span class="lookup-card-fold" aria-hidden="true">▾</span>
      <div class="lookup-card-actions">
        <button class="lookup-card-act" data-act="copy" type="button" title="복사" aria-label="복사">${COPY_SVG_INLINE}</button>
        <button class="lookup-card-act" data-act="close" type="button" title="삭제" aria-label="삭제">${X_SVG_INLINE}</button>
      </div>
    </div>
    ${questionLine}
    <div class="lookup-card-body"><span style="opacity:0.6">…</span></div>
    ${renderFeedbackBar("lookup")}
  `;
  // 새 카드는 위에 (최신순)
  els.lookupPanelBody.insertBefore(card, els.lookupPanelBody.firstChild);
  _lookupState.cardCount++;
  // v0.5.31: 새 카드가 보이게 자동 스크롤 최상단
  els.lookupPanelBody.scrollTop = 0;

  const bodyEl = card.querySelector(".lookup-card-body");

  // 카드 head 클릭 → 펼침/접기 토글 (액션 버튼은 제외)
  const headEl = card.querySelector(".lookup-card-head");
  headEl.addEventListener("click", (e) => {
    if (e.target.closest(".lookup-card-act")) return;
    card.classList.toggle("collapsed");
  });
  headEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      card.classList.toggle("collapsed");
    }
  });

  // 카드 액션
  card.querySelectorAll(".lookup-card-act").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const act = btn.dataset.act;
      if (act === "close") {
        card.remove();
        _lookupState.cardCount--;
      } else if (act === "copy") {
        const txt = bodyEl?.innerText ?? "";
        navigator.clipboard?.writeText(txt).then(() => {
          btn.innerHTML = CHECK_SVG_INLINE;
          btn.classList.add("copied");
          setTimeout(() => {
            btn.innerHTML = COPY_SVG_INLINE;
            btn.classList.remove("copied");
          }, 1200);
        });
      }
    });
  });

  // 따봉 wire
  wireFeedbackBar(card.querySelector(".feedback-bar"));

  // 현재 챕터/메시지 맥락 — 가장 최근 메시지 일부를 context로
  let context = "";
  if (state?.activeRoadmapId && state?.session?.chapterId) {
    const lastMsg = state.messages?.[state.messages.length - 1];
    if (lastMsg?.content) {
      const head = String(lastMsg.content).slice(0, 600);
      context = `학습 챕터: ${state.session.chapterId}\n최근 대화 일부:\n${head}`;
    }
  }

  // SSE 스트림 수신 (v0.5.73 — abort 가능 + inactivity timeout)
  let acc = "";
  const handle = createStreamHandle("lookup");
  try {
    const res = await fetch("/api/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: handle.controller.signal,
      body: JSON.stringify({
        query,
        depth,
        context: context || undefined,
        model: state.selectedModel ?? undefined,
        sessionId: state.session?.id,
        userQuestion,
      }),
    });
    if (!res.ok || !res.body) {
      bodyEl.textContent = `(요청 실패: ${res.status})`;
      return;
    }
    await pumpStream(res.body.getReader(), handle, (chunk) => {
      acc += chunk;
      try {
        bodyEl.innerHTML = marked.parse(acc);
      } catch {
        bodyEl.textContent = acc;
      }
    });
  } catch (err) {
    // 패널 닫기/세션 전환에 의한 중단 — 카드도 곧 사라지므로 조용히
    if (isIntentionalAbort(err, handle)) return;
    bodyEl.innerHTML = `<p>(에러: ${escapeHtml(err.message)})</p>`;
  } finally {
    finishStreamHandle(handle);
  }
}

// ──────────────────────────────────────────────────────────
// v0.5.58 — 챕터 본문 맥락 요약 (β 방향)
//   Buddy 메시지가 챕터의 어느 부분을 가리키는지 (인용+요약) 형식으로
//   Look-up 패널에 카드로 표시. 매 메시지 📋 버튼 또는 드래그 toolbar에서 트리거.
// ──────────────────────────────────────────────────────────

async function runChapterContext({ targetMessageText, selectionText } = {}) {
  if (!state.session?.id) {
    setStatus("세션을 먼저 시작해줘 — 챕터 맥락을 잡으려면 활성 세션이 필요해", "info");
    return;
  }
  openLookupPanel();
  if (!els.lookupPanelBody) return;

  // 중복 차단 — 같은 메시지+선택에 대해 카드가 이미 있으면 그걸 강조.
  const fingerprint = _chapterContextFingerprint(targetMessageText, selectionText);
  const existing = els.lookupPanelBody.querySelector(
    `.lookup-card[data-context-key="${CSS.escape(fingerprint)}"]`,
  );
  if (existing) {
    existing.classList.remove("collapsed");
    existing.classList.add("lookup-card-flash");
    existing.scrollIntoView({ block: "center", behavior: "smooth" });
    setTimeout(() => existing.classList.remove("lookup-card-flash"), 1500);
    setStatus("이 메시지의 본문 맥락은 위에 표시했어요", "info");
    return;
  }

  // 기존 카드는 접기 — Look-up과 동일 UX
  els.lookupPanelBody.querySelectorAll(".lookup-card").forEach((c) => {
    c.classList.add("collapsed");
  });

  const card = document.createElement("article");
  card.className = "lookup-card lookup-card-ctx";
  card.dataset.contextKey = fingerprint;
  const previewText = (selectionText ?? targetMessageText).slice(0, 80).trim();
  card.innerHTML = `
    <div class="lookup-card-head" role="button" tabindex="0" title="클릭하여 펼침/접기">
      <span class="lookup-card-depth lookup-card-kind-ctx" data-kind="ctx">
        <span class="lookup-card-depth-icon">${CONTEXT_ICON_SVG}</span>
        <span>본문 맥락</span>
      </span>
      <span class="lookup-card-query" title="${escapeAttr(previewText)}">${escapeHtml(previewText)}${previewText.length >= 80 ? "…" : ""}</span>
      <span class="lookup-card-fold" aria-hidden="true">▾</span>
      <div class="lookup-card-actions">
        <button class="lookup-card-act" data-act="copy" type="button" title="복사" aria-label="복사">${COPY_SVG_INLINE}</button>
        <button class="lookup-card-act" data-act="close" type="button" title="삭제" aria-label="삭제">${X_SVG_INLINE}</button>
      </div>
    </div>
    <div class="lookup-card-body"><span style="opacity:0.6">맥락 찾는 중…</span></div>
    ${renderFeedbackBar("lookup")}
  `;
  els.lookupPanelBody.insertBefore(card, els.lookupPanelBody.firstChild);
  _lookupState.cardCount++;
  els.lookupPanelBody.scrollTop = 0;

  const bodyEl = card.querySelector(".lookup-card-body");
  const headEl = card.querySelector(".lookup-card-head");
  headEl.addEventListener("click", (e) => {
    if (e.target.closest(".lookup-card-act")) return;
    card.classList.toggle("collapsed");
  });
  headEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      card.classList.toggle("collapsed");
    }
  });
  card.querySelectorAll(".lookup-card-act").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const act = btn.dataset.act;
      if (act === "close") {
        card.remove();
        _lookupState.cardCount--;
      } else if (act === "copy") {
        const txt = bodyEl?.innerText ?? "";
        navigator.clipboard?.writeText(txt).then(() => {
          btn.innerHTML = CHECK_SVG_INLINE;
          btn.classList.add("copied");
          setTimeout(() => {
            btn.innerHTML = COPY_SVG_INLINE;
            btn.classList.remove("copied");
          }, 1200);
        });
      }
    });
  });
  wireFeedbackBar(card.querySelector(".feedback-bar"));

  // SSE 수신 (v0.5.73 — abort 가능 + inactivity timeout)
  let acc = "";
  const handle = createStreamHandle("lookup");
  try {
    const res = await fetch("/api/chapter-context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: handle.controller.signal,
      body: JSON.stringify({
        sessionId: state.session.id,
        targetMessageText,
        selectionText: selectionText || undefined,
        model: state.selectedModel ?? undefined,
      }),
    });
    if (!res.ok || !res.body) {
      bodyEl.textContent = `(요청 실패: ${res.status})`;
      return;
    }
    await pumpStream(res.body.getReader(), handle, (chunk) => {
      acc += chunk;
      try {
        bodyEl.innerHTML = marked.parse(acc);
      } catch {
        bodyEl.textContent = acc;
      }
    });
  } catch (err) {
    if (isIntentionalAbort(err, handle)) return;
    bodyEl.innerHTML = `<p>(에러: ${escapeHtml(err.message)})</p>`;
  } finally {
    finishStreamHandle(handle);
  }
}

function _chapterContextFingerprint(targetMessageText, selectionText) {
  const norm = (s) =>
    String(s ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
      .slice(0, 400);
  return `ctx::${norm(targetMessageText)}::${norm(selectionText)}`;
}

const CONTEXT_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`;

// ──────────────────────────────────────────────────────────
// 따봉 (👍/👎) — v0.5.31
// ──────────────────────────────────────────────────────────

const THUMBS_UP_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 10v12"/><path d="M15 5.88L14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H7"/><path d="M3 22h4V10H3z"/></svg>`;
const THUMBS_DOWN_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 14V2"/><path d="M9 18.12L10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H17"/><path d="M21 2h-4v12h4z"/></svg>`;

function renderFeedbackBar(kind /* "msg" | "lookup" */) {
  return `<div class="feedback-bar" data-kind="${escapeAttr(kind)}" role="group" aria-label="응답 만족도">
    <button class="feedback-btn" data-vote="up" type="button" title="도움됐어요" aria-label="좋아요">${THUMBS_UP_SVG}</button>
    <button class="feedback-btn" data-vote="down" type="button" title="아쉬워요" aria-label="아쉬워요">${THUMBS_DOWN_SVG}</button>
  </div>`;
}

function wireFeedbackBar(bar) {
  if (!bar) return;
  bar.querySelectorAll(".feedback-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const vote = btn.dataset.vote;
      // 이미 같은 vote 선택돼 있으면 취소 (toggle)
      if (btn.classList.contains("active")) {
        btn.classList.remove("active");
        return;
      }
      bar.querySelectorAll(".feedback-btn").forEach((b) =>
        b.classList.remove("active"),
      );
      btn.classList.add("active");
      // 짧은 시각 피드백 — 살짝 스케일
      btn.classList.add("just-clicked");
      setTimeout(() => btn.classList.remove("just-clicked"), 320);
    });
  });
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

/**
 * 사이드바 활동 버튼의 streak 뱃지 갱신.
 * 오늘 또는 어제까지 끊김 없이 학습한 일수.
 */
async function refreshActivityBadge() {
  if (!els.activityStreak) return;
  try {
    const data = await fetch("/api/activity?days=90").then((r) => r.json());
    const byDate = data.byDate ?? {};
    const total = data.total ?? 0;
    // 오늘부터 거꾸로 연속 일수
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const oneDay = 86400000;
    let streak = 0;
    for (let i = 0; i < 90; i++) {
      const ds = new Date(today.getTime() - i * oneDay)
        .toISOString()
        .slice(0, 10);
      if ((byDate[ds] ?? 0) > 0) streak++;
      else if (i === 0) {
        // 오늘 0이면 어제부터 streak (오늘 아직 학습 안 한 경우)
        continue;
      } else break;
    }
    // streak 티어: 효과 강도 (CSS animation 분기용)
    // tier 1 (1-2일) · tier 2 (3-6일) · tier 3 (7-13일) · tier 4 (14-29일) · tier 5 (30일+)
    const streakTier =
      streak >= 30 ? 5 : streak >= 14 ? 4 : streak >= 7 ? 3 : streak >= 3 ? 2 : streak >= 1 ? 1 : 0;
    els.activityStreak.dataset.tier = String(streakTier);
    if (streak > 0) {
      els.activityStreak.innerHTML = `<span class="streak-flame">${FLAME_SVG_INLINE}</span><span class="streak-num">${streak}</span>`;
      els.activityStreak.classList.add("on-fire");
      els.activityOpenBtn?.setAttribute(
        "title",
        `학습 활동 — ${streak}일 연속 (총 나선 ${total}개)`,
      );
    } else if (total > 0) {
      els.activityStreak.innerHTML = `<span class="streak-num">${total}</span>`;
      els.activityStreak.classList.remove("on-fire");
      els.activityOpenBtn?.setAttribute(
        "title",
        `학습 활동 — 총 나선 ${total}개 (오늘 학습으로 streak 시작!)`,
      );
    } else {
      els.activityStreak.textContent = "—";
      els.activityStreak.classList.remove("on-fire");
      els.activityOpenBtn?.setAttribute("title", "학습 활동 — 아직 기록 없음");
    }
  } catch {
    /* ignore */
  }
}

// 글로벌 tooltip 요소 — 활동 셀 등에서 공용. fixed 포지션이라 부모 overflow 영향 X.
let _activityTooltip = null;
function showActivityTooltip(text, anchorEl) {
  if (!_activityTooltip) {
    _activityTooltip = document.createElement("div");
    _activityTooltip.className = "activity-tooltip";
    document.body.appendChild(_activityTooltip);
  }
  _activityTooltip.textContent = text;
  _activityTooltip.classList.add("visible");
  // 위치: anchor 위쪽, viewport 안 fit
  const rect = anchorEl.getBoundingClientRect();
  // 먼저 표시해서 크기 측정
  _activityTooltip.style.left = "0px";
  _activityTooltip.style.top = "0px";
  const tipRect = _activityTooltip.getBoundingClientRect();
  let left = rect.left + rect.width / 2 - tipRect.width / 2;
  left = Math.max(8, Math.min(window.innerWidth - tipRect.width - 8, left));
  let top = rect.top - tipRect.height - 8;
  if (top < 8) top = rect.bottom + 8; // 위 공간 없으면 아래
  _activityTooltip.style.left = `${left}px`;
  _activityTooltip.style.top = `${top}px`;
}
function hideActivityTooltip() {
  _activityTooltip?.classList.remove("visible");
}

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
  hideActivityTooltip();
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
  // 절대값 기준 — 하루 20개 이상 = 최고 강도. 학습 강도 5단계로 세분화.
  // tier 1: 1-2개 (가벼운 복습)
  // tier 2: 3-5개 (보통)
  // tier 3: 6-10개 (몰입)
  // tier 4: 11-19개 (집중 학습일)
  // tier 5: 20+ (대규모 학습 · 글로우)
  const level = (n) => {
    if (n === 0) return 0;
    if (n >= 20) return 5;
    if (n >= 11) return 4;
    if (n >= 6) return 3;
    if (n >= 3) return 2;
    return 1;
  };
  // 라벨 텍스트 (tooltip 의미 보강용)
  const levelLabel = (n) => {
    if (n >= 20) return "대규모";
    if (n >= 11) return "집중";
    if (n >= 6) return "몰입";
    if (n >= 3) return "보통";
    return "가볍게";
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
      // 한국어 날짜 + "나선" 용어로 tooltip — 강도 라벨 포함
      const koDate = `${date.getMonth() + 1}월 ${date.getDate()}일 (${["일", "월", "화", "수", "목", "금", "토"][date.getDay()]})`;
      const tip =
        count === 0
          ? `${koDate} · 휴식`
          : `${koDate} · 나선 ${count}개 · ${levelLabel(count)}`;
      cells.push(
        `<div class="activity-cell" data-level="${level(count)}" data-tip="${escapeAttr(tip)}"></div>`,
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

  // 글로벌 tooltip + wheel → horizontal scroll (한 번만 attach)
  if (!els.activityGrid._wired) {
    els.activityGrid.addEventListener("mouseover", (e) => {
      const cell = e.target.closest(".activity-cell[data-tip]");
      if (cell) showActivityTooltip(cell.dataset.tip, cell);
    });
    els.activityGrid.addEventListener("mouseout", (e) => {
      const cell = e.target.closest(".activity-cell[data-tip]");
      if (cell && !cell.contains(e.relatedTarget)) hideActivityTooltip();
    });
    // 오른쪽 끝(최신)에서 시작 + 휠로 좌우 이동
    const wrap = document.getElementById("activity-grid-wrap");
    if (wrap) {
      wrap.addEventListener("wheel", (e) => {
        // 수직 휠을 수평으로 흘려보냄 (shift 휠은 그대로)
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && !e.shiftKey) {
          e.preventDefault();
          wrap.scrollLeft += e.deltaY;
          hideActivityTooltip();
        }
      }, { passive: false });
    }
    els.activityGrid._wired = true;
  }
  // 항상 최신(우측 끝)으로 스크롤해서 시작
  const wrap = document.getElementById("activity-grid-wrap");
  if (wrap) {
    requestAnimationFrame(() => {
      wrap.scrollLeft = wrap.scrollWidth;
    });
  }

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

  // 요약 — "나선" 용어로
  const depthSummary = Object.entries(byDepth)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([d, n]) => `<span class="activity-stat">d${d} 나선: <strong>${n}</strong></span>`)
    .join("");
  els.activitySummary.innerHTML = `
    <span class="activity-stat"><span class="stat-ic stat-ic-spiral">${SPIRAL_SVG_INLINE}</span>총 나선: <strong>${totalNotes}</strong></span>
    <span class="activity-stat">활동일 (1년): <strong>${activeDays}</strong></span>
    <span class="activity-stat"><span class="stat-ic stat-ic-flame">${FLAME_SVG_INLINE}</span>현재 연속: <strong>${currentStreak}일</strong></span>
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
      // 챕터 목록 + 사이드바 진도/배지 + 휴지통/활동 뱃지 모두 갱신
      await Promise.all([
        loadRoadmapData(),
        refreshSidebarRoadmaps(),
        refreshTrashBadge(),
        refreshActivityBadge(),
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

// v0.5.73 — 세션 시작 중복 방지. 시작 fetch/stream 중 다른 챕터를 또
// 클릭하면 els.messages가 두 번 비워지고 이전 스트림이 사라진 DOM에
// write하는 race가 있었음.
let _sessionStartInFlight = false;

async function startSession(chapterId) {
  if (_sessionStartInFlight) {
    setStatus("세션 시작 중이에요 — 잠시만요", "info");
    return;
  }
  // v0.5.75 — 플래그 set 이후 전 구간을 try로 감쌈. 기존엔 try 진입 전
  // (abortStreams/resetQuiz 등)에서 예외가 나면 플래그가 영구 true로
  // 남아 이후 모든 챕터 클릭이 "시작 중" 안내만 받는 잠금 상태가 됐음.
  _sessionStartInFlight = true;
  const handle = createStreamHandle("session");
  try {
    els.messages.innerHTML = "";
    state.messages = [];

    // 이전 세션의 lookup 카드 자동 비우기 — 챕터별로 깨끗하게 시작
    // v0.5.73 — 카드를 비우기 전에 진행 중 lookup 스트림부터 중단
    abortStreams("lookup");
    if (els.lookupPanelBody) {
      els.lookupPanelBody.innerHTML = "";
      _lookupState.cardCount = 0;
    }

    // 퀴즈 단계 리셋 (v0.5.31 #8)
    resetQuiz();

    const chapter = state.chapters.find((c) => c.id === chapterId);
    setStatus("Starting session…");
    setPending(true);

    const res = await fetch("/api/session/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: handle.controller.signal,
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
      chapterId,
      depth,
      chapterTitle,
      roadmapId: decodeURIComponent(roadmapIdEnc),
      roadmapName: decodeURIComponent(roadmapNameEnc),
    };
    refreshPausedList(); // 일시정지 목록 갱신
    updateTopbar();
    enableSessionUi(true);

    const assistantEl = appendAssistantMessage("");
    await streamInto(res, assistantEl, handle);

    setPending(false);
    setStatus("");
    els.input.focus();
  } catch (err) {
    setPending(false);
    if (isIntentionalAbort(err, handle)) return;
    // v0.5.75 — 세션이 이미 성립됐으면 (서버에 세션 존재, 첫 응답만 실패/부분)
    // UI를 죽이지 않음. 기존엔 무조건 enableSessionUi(false) + session=null이라
    // "Buddy 첫 메시지는 보이는데 입력이 영구 비활성" 증상이 났음.
    // 서버 세션은 살아있으므로 사용자가 그냥 메시지를 보내면 이어짐.
    if (state.session?.id) {
      enableSessionUi(true);
      setStatus(
        `첫 응답이 중단됐어요 (${err.message}) — 그대로 메시지를 보내면 이어집니다`,
        "error",
      );
      els.input.focus();
    } else {
      enableSessionUi(false);
      state.session = null;
      setStatus(`세션 시작 실패: ${err.message} — 챕터를 다시 클릭해주세요`, "error");
    }
  } finally {
    finishStreamHandle(handle);
    _sessionStartInFlight = false;
  }
}

async function submitMessage() {
  if (!state.session || state.pending) return;
  const text = els.input.value.trim();
  if (!text) return;
  els.input.value = "";
  clearRefineState();
  await sendMessage(text);
}

// ──────────────────────────────────────────────────────────
// v0.5.31 #8 Quiz 단계별 난이도 — 누를수록 깊어짐
// ──────────────────────────────────────────────────────────

const QUIZ_LEVELS = [
  {
    level: 1,
    label: "개념 확인",
    color: "violet",
    prompt:
      "지금까지 다룬 내용에서 핵심 개념을 짚는 짧은 질문 2개를 내줘. 답은 알려주지 말고, 내가 먼저 말해보게 해줘.",
  },
  {
    level: 2,
    label: "적용",
    color: "cyan",
    prompt:
      "오늘 배운 개념을 살짝 다른 시나리오에 적용해야 답할 수 있는 질문 2개를 내줘. 답은 알려주지 마.",
  },
  {
    level: 3,
    label: "함정·엣지케이스",
    color: "orange",
    prompt:
      "오늘 다룬 개념의 흔한 오해, 함정, 또는 엣지 케이스를 찌르는 날카로운 질문 2개를 내줘. 답은 알려주지 마.",
  },
  {
    level: 4,
    label: "종합 시나리오",
    color: "gold",
    prompt:
      "오늘 다룬 개념 + 관련된 사전 지식까지 엮어서 답해야 하는, 실무에서 마주칠 만한 종합 시나리오 1개를 내줘. 답을 풀어주지 말고 내가 생각해보게 해줘.",
  },
];

function advanceQuiz() {
  const idx = (state.quizLevel - 1 + QUIZ_LEVELS.length) % QUIZ_LEVELS.length;
  const def = QUIZ_LEVELS[idx];
  sendMessage(def.prompt);
  // 다음 클릭에 다음 단계
  state.quizLevel = (state.quizLevel % QUIZ_LEVELS.length) + 1;
  updateQuizButton();
}

function resetQuiz() {
  state.quizLevel = 1;
  updateQuizButton();
}

function updateQuizButton() {
  if (!els.quizBtn) return;
  const next = QUIZ_LEVELS[(state.quizLevel - 1) % QUIZ_LEVELS.length];
  // 라벨에 다음 단계 번호 표시
  const labelEl = els.quizBtn.querySelector("span");
  if (labelEl) {
    labelEl.textContent =
      next.level === 1 ? "Quiz" : `Quiz · ${next.level}`;
  }
  // data-level로 색 변화
  els.quizBtn.dataset.quizLevel = String(next.level);
  els.quizBtn.title = `퀴즈 ${next.level}/${QUIZ_LEVELS.length} — ${next.label}`;
}

// ──────────────────────────────────────────────────────────
// Prompt refine (다듬기) — /api/refine-prompt
// ──────────────────────────────────────────────────────────

function buildRefineContext() {
  if (!state.session) return undefined;
  const parts = [];
  if (state.session.chapterTitle) {
    parts.push(`학습 챕터: ${state.session.chapterTitle}`);
  }
  // 직전 어시스턴트 메시지 일부만 (질문 흐름 맥락)
  const lastAssistant = [...(state.messages ?? [])]
    .reverse()
    .find((m) => m.role === "assistant" && m.content);
  if (lastAssistant?.content) {
    parts.push(`직전 튜터 응답 일부:\n${String(lastAssistant.content).slice(0, 400)}`);
  }
  return parts.join("\n\n") || undefined;
}

async function callRefineApi(text) {
  const res = await fetch("/api/refine-prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      context: buildRefineContext(),
      model: state.selectedModel ?? undefined,
    }),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch {}
    throw new Error(msg);
  }
  return res.json(); // { original, refined }
}

function setRefining(on) {
  state.refining = on;
  if (!els.refineBtn) return;
  els.refineBtn.classList.toggle("is-loading", on);
  els.refineBtn.disabled = on || state.pending || !state.session;
  els.input.disabled = on || !state.session;
  if (on) setStatus("프롬프트 다듬는 중…");
  else if (els.statusBar?.textContent === "프롬프트 다듬는 중…") setStatus("");
}

function showRefineBar(label = "프롬프트가 다듬어졌어요") {
  if (!els.refineBar) return;
  if (els.refineBarText) els.refineBarText.textContent = label;
  els.refineBar.classList.remove("hidden");
}

function hideRefineBar() {
  if (els.refineBar) els.refineBar.classList.add("hidden");
}

function clearRefineState() {
  state.refineOriginal = null;
  state.refineApplied = null;
  hideRefineBar();
}

function undoRefine() {
  if (state.refineOriginal == null) return;
  els.input.value = state.refineOriginal;
  clearRefineState();
  els.input.focus();
  // 커서를 끝으로
  const len = els.input.value.length;
  els.input.setSelectionRange(len, len);
}

async function refineInPlace() {
  if (!state.session || state.pending || state.refining) return;
  const raw = els.input.value.trim();
  if (raw.length < 2) {
    setStatus("다듬을 내용이 너무 짧아요.", "error");
    setTimeout(() => setStatus(""), 1800);
    return;
  }
  // 이미 다듬어진 상태에서 한 번 더 누르면, 원본 보존 유지하고 다시 다듬기
  const originalForRollback = state.refineOriginal ?? raw;
  setRefining(true);
  try {
    const { refined } = await callRefineApi(raw);
    if (!refined || refined === raw) {
      setStatus("이미 충분히 명확해요.", "");
      setTimeout(() => setStatus(""), 1800);
      return;
    }
    state.refineOriginal = originalForRollback;
    state.refineApplied = refined;
    els.input.value = refined;
    showRefineBar("프롬프트가 다듬어졌어요 — ⌘Z 또는 [원본]으로 되돌릴 수 있어요");
    els.input.focus();
    const len = els.input.value.length;
    els.input.setSelectionRange(len, len);
  } catch (err) {
    setStatus(`다듬기 실패: ${err.message}`, "error");
    setTimeout(() => setStatus(""), 2500);
  } finally {
    setRefining(false);
  }
}

async function refineThenSend() {
  if (!state.session || state.pending || state.refining) return;
  const raw = els.input.value.trim();
  if (raw.length < 2) return;
  setRefining(true);
  let toSend = raw;
  try {
    const { refined } = await callRefineApi(raw);
    if (refined && refined !== raw) {
      toSend = refined;
      // 보낸 직후에도 마지막 메시지의 원본을 잠깐 알 수 있게 status로
      setStatus(`다듬어 보냄: "${truncate(raw, 40)}" → "${truncate(refined, 40)}"`);
      setTimeout(() => {
        if (els.statusBar?.textContent?.startsWith("다듬어 보냄:")) setStatus("");
      }, 4000);
    }
  } catch (err) {
    setStatus(`다듬기 실패 — 원본 그대로 보냄`, "error");
    setTimeout(() => setStatus(""), 2500);
  } finally {
    setRefining(false);
  }
  els.input.value = "";
  clearRefineState();
  await sendMessage(toSend);
}

function truncate(s, n) {
  if (!s) return "";
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

async function sendMessage(text) {
  // v0.5.73 — pending 가드를 sendMessage 자체에도. submitMessage는 이미
  // 가드하지만 퀴즈 버튼(advanceQuiz) 등 직접 호출 경로는 안 막혀 있어서
  // 스트리밍 중 연타 시 turn이 겹칠 수 있었음.
  if (!state.session || state.pending) return;
  appendUserMessage(text);
  setPending(true);

  const handle = createStreamHandle("session");
  try {
    const res = await fetch(`/api/session/${state.session.id}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: handle.controller.signal,
      body: JSON.stringify({ message: text }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const assistantEl = appendAssistantMessage("");
    await streamInto(res, assistantEl, handle);
  } catch (err) {
    if (!isIntentionalAbort(err, handle)) {
      setStatus(`Message failed: ${err.message}`, "error");
    }
  } finally {
    finishStreamHandle(handle);
    setPending(false);
    els.input.focus();
  }
}

// ──────────────────────────────────────────────────────────
// v0.5.41–v0.5.43 — Pause / Resume session (멀티)
// localStorage에 paused 세션들의 배열을 보관 — 사이드바 PAUSED 섹션에서 관리.
// 서버는 그대로 in-memory 세션 유지 → 이어가기 시 GET /api/session/:id로 복원.
// ──────────────────────────────────────────────────────────

const PAUSED_KEY = "spiral-buddy:paused-sessions"; // 배열 (v0.5.43~)
const PAUSED_LEGACY_KEY = "spiral-buddy:paused-session"; // 단일 (v0.5.41~v0.5.42)
const PAUSED_MAX = 10;

function readPausedList() {
  try {
    const raw = localStorage.getItem(PAUSED_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    }
    // 이전 단일 객체 형식 마이그레이션
    const legacy = localStorage.getItem(PAUSED_LEGACY_KEY);
    if (legacy) {
      const obj = JSON.parse(legacy);
      if (obj && obj.id) {
        localStorage.setItem(PAUSED_KEY, JSON.stringify([obj]));
        localStorage.removeItem(PAUSED_LEGACY_KEY);
        return [obj];
      }
    }
  } catch {}
  return [];
}

function writePausedList(list) {
  try {
    localStorage.setItem(PAUSED_KEY, JSON.stringify(list));
  } catch {}
}

function _relTime(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  return `${d}일 전`;
}

function refreshPausedList() {
  if (!els.pausedSection || !els.pausedList) return;
  const list = readPausedList();
  els.pausedCountBadge.textContent = String(list.length);
  if (list.length === 0) {
    els.pausedSection.classList.add("hidden");
    els.pausedList.innerHTML = "";
    return;
  }
  els.pausedSection.classList.remove("hidden");
  // 최신순
  const sorted = [...list].sort((a, b) => (b.pausedAt ?? 0) - (a.pausedAt ?? 0));
  els.pausedList.innerHTML = sorted
    .map(
      (p) => `
      <li class="paused-item" data-id="${escapeAttr(p.id)}">
        <button class="paused-item-main" data-action="resume" data-id="${escapeAttr(p.id)}" type="button" title="이어가기">
          <div class="paused-item-title">${escapeHtml(p.chapterTitle ?? "세션")}</div>
          <div class="paused-item-meta">
            ${p.depth ? `<span class="paused-item-depth">d${p.depth}</span>` : ""}
            <span class="paused-item-roadmap">${escapeHtml(p.roadmapName ?? "")}</span>
            <span class="paused-item-time">${_relTime(p.pausedAt ?? Date.now())}</span>
          </div>
        </button>
        <button class="paused-item-discard" data-action="discard" data-id="${escapeAttr(p.id)}" type="button" title="폐기" aria-label="폐기">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/>
          </svg>
        </button>
      </li>`,
    )
    .join("");

  // 이벤트 wire — 위임
  els.pausedList.onclick = (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    if (action === "resume") {
      resumePausedSession(id);
    } else if (action === "discard") {
      discardPausedSession(id);
    }
  };
}

async function pauseSession() {
  if (!state.session || state.pending) return;
  const meta = {
    id: state.session.id,
    chapterId: state.session.chapterId,
    chapterTitle: state.session.chapterTitle,
    roadmapId: state.session.roadmapId,
    roadmapName: state.session.roadmapName,
    depth: state.session.depth,
    activeRoadmapId: state.activeRoadmapId,
    pausedAt: Date.now(),
  };
  const list = readPausedList();
  // 같은 id가 이미 있으면 갱신
  const filtered = list.filter((p) => p.id !== meta.id);
  filtered.push(meta);
  // 너무 많아지면 오래된 것부터 evict
  while (filtered.length > PAUSED_MAX) {
    filtered.sort((a, b) => (a.pausedAt ?? 0) - (b.pausedAt ?? 0));
    const evicted = filtered.shift();
    if (evicted) {
      // 서버 세션도 정리
      fetch(`/api/session/${evicted.id}/cancel`, { method: "POST" }).catch(
        () => {},
      );
    }
  }
  writePausedList(filtered);

  state.session = null;
  state.messages = [];
  els.messages.innerHTML = "";
  enableSessionUi(false);
  updateTopbar();
  setStatus(`⏸ "${meta.chapterTitle}" 일시정지됨 — 좌측 PAUSED에서 언제든 이어가기`);
  setTimeout(() => {
    if (els.statusBar?.textContent?.startsWith("⏸")) setStatus("");
  }, 3500);
  refreshPausedList();
}

async function resumePausedSession(id) {
  if (!id) return;
  const list = readPausedList();
  const info = list.find((p) => p.id === id);
  if (!info) {
    refreshPausedList();
    return;
  }
  // 진행 중인 세션이 있다면 자동으로 그것도 pause
  if (state.session) {
    if (
      !confirm(
        "진행 중인 세션이 있습니다. 자동으로 일시정지하고 이 세션으로 이어갈까요?",
      )
    )
      return;
    await pauseSession();
  }
  setStatus("⏵ 세션 복원 중…");
  try {
    const res = await fetch(`/api/session/${info.id}`);
    if (res.status === 404) {
      if (
        confirm(
          "서버 세션이 만료되어 이어갈 수 없습니다. 일시정지 항목을 폐기할까요?",
        )
      ) {
        writePausedList(list.filter((p) => p.id !== id));
        refreshPausedList();
      }
      setStatus("");
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // 로드맵이 다른 곳에 가 있다면 원래 로드맵으로 전환
    if (
      data.chapter?.roadmapId &&
      data.chapter.roadmapId !== state.activeRoadmapId
    ) {
      await switchRoadmap(data.chapter.roadmapId);
    }

    state.session = {
      id: data.id,
      chapterId: data.chapter.id,
      depth: data.depth,
      chapterTitle: data.chapter.title,
      roadmapId: data.chapter.roadmapId,
      roadmapName: data.chapter.roadmapName,
    };
    state.messages = (data.messages ?? []).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    els.messages.innerHTML = "";
    for (const m of data.messages ?? []) {
      if (m.role === "user") {
        appendUserMessage(m.content, { skipPush: true });
      } else if (m.role === "assistant") {
        appendAssistantMessage(m.content);
      }
    }

    enableSessionUi(true);
    updateTopbar();
    // resumed 항목은 paused 목록에서 제거
    writePausedList(readPausedList().filter((p) => p.id !== id));
    refreshPausedList();
    setStatus(`✓ "${info.chapterTitle}" 이어가기 시작`, "success");
    setTimeout(() => setStatus(""), 2000);
    scrollToBottom(true);
  } catch (err) {
    setStatus(`복원 실패: ${err.message}`, "error");
    setTimeout(() => setStatus(""), 3000);
  }
}

async function discardPausedSession(id) {
  if (!id) return;
  const list = readPausedList();
  const info = list.find((p) => p.id === id);
  if (!info) return;
  if (!confirm(`"${info.chapterTitle}" 일시정지 세션을 폐기할까요?\n(서버에서도 제거됩니다)`))
    return;
  try {
    await fetch(`/api/session/${id}/cancel`, { method: "POST" });
  } catch {}
  writePausedList(list.filter((p) => p.id !== id));
  refreshPausedList();
  setStatus("일시정지 세션 폐기됨");
  setTimeout(() => setStatus(""), 1500);
}

async function endSession() {
  if (!state.session || state.pending) return;
  if (!confirm("세션 종료하고 옵시디언에 노트 생성할까?")) return;
  const endingSessionId = state.session.id;

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
    // 같은 세션이 일시정지 목록에 있었다면 정리
    writePausedList(readPausedList().filter((p) => p.id !== endingSessionId));
    refreshPausedList();

    // 진도 + 활동 streak 갱신
    const roadmaps = await fetch("/api/roadmaps").then((r) => r.json());
    state.roadmaps = Array.isArray(roadmaps) ? roadmaps : [];
    renderRoadmapSelector();
    await loadRoadmapData();
    refreshActivityBadge();
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

  // 결과 요약 + 옵시디언 링크 + 다음 챕터 진입 추가
  const elapsedMin = ((result.elapsedMs ?? 0) / 60000).toFixed(1);

  // 다음 챕터 추정 — state.session이 비워지기 전이라 chapterId 사용 가능
  const currentChapterId = state.session?.chapterId ?? null;
  const currentDepth = result.depth ?? state.session?.depth ?? 1;
  const idx = currentChapterId
    ? state.chapters.findIndex((c) => c.id === currentChapterId)
    : -1;
  const nextChapter =
    idx >= 0 && idx < state.chapters.length - 1
      ? state.chapters[idx + 1]
      : null;
  const isLast = idx === state.chapters.length - 1 && idx >= 0;

  // 같은 챕터 더 깊이 — depth 3 미만이고 next도 있을 때만 보조 옵션
  const canGoDeeper = currentDepth < 3 && currentChapterId;

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
    <div class="end-actions">
      ${
        result.obsidianUri
          ? `<a href="${escapeAttr(result.obsidianUri)}" class="end-action-btn obsidian-action">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M4 4h12a3 3 0 0 1 3 3v13a1 1 0 0 1-1.5.87L12 18.4l-5.5 2.47A1 1 0 0 1 5 20V7"/>
                <path d="M8 4v4l2-1 2 1V4"/>
              </svg>
              <span>옵시디언에서 열기</span>
            </a>`
          : ""
      }
      ${
        nextChapter
          ? `<button class="end-action-btn next-chapter-btn" data-next-id="${escapeAttr(nextChapter.id)}" type="button">
              <span class="next-label">
                <span class="next-eyebrow">다음 챕터</span>
                <span class="next-title">${escapeHtml(nextChapter.title ?? nextChapter.id)}</span>
              </span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="5" y1="12" x2="19" y2="12"/>
                <polyline points="12 5 19 12 12 19"/>
              </svg>
            </button>`
          : isLast
            ? `<div class="end-action-roadmap-done">🎉 이 로드맵의 마지막 챕터를 마쳤어요!</div>`
            : ""
      }
      ${
        canGoDeeper && currentDepth < 3
          ? `<button class="end-action-btn deeper-btn" data-same-id="${escapeAttr(currentChapterId)}" type="button" title="이 챕터를 한 단계 더 깊게 다시 학습">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 4v16"/>
                <polyline points="6 14 12 20 18 14"/>
              </svg>
              <span>이 챕터 더 깊이 (d${currentDepth + 1})</span>
            </button>`
          : ""
      }
    </div>
    <div class="summary-path"><code>${escapeHtml(result.path ?? "")}</code></div>
  `;
  card.appendChild(summaryDiv);
  scrollToBottom();

  // 버튼 wire — state.session은 곧 null이 되므로 click 시 startSession에 직접 chapterId 전달
  const nextBtn = summaryDiv.querySelector(".next-chapter-btn");
  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      const id = nextBtn.dataset.nextId;
      if (!id) return;
      nextBtn.disabled = true;
      startSession(id);
    });
  }
  const deeperBtn = summaryDiv.querySelector(".deeper-btn");
  if (deeperBtn) {
    deeperBtn.addEventListener("click", () => {
      const id = deeperBtn.dataset.sameId;
      if (!id) return;
      deeperBtn.disabled = true;
      startSession(id);
    });
  }
}

// ──────────────────────────────────────────────────────────
// Streaming
// ──────────────────────────────────────────────────────────

// v0.5.75 — marked.parse 안전 래퍼.
// 기존엔 streamInto의 최종 parse가 무방비라, 특정 마크다운(깨진 테이블,
// 비정상 중첩 등)에서 marked가 throw하면 startSession catch로 전파 →
// enableSessionUi(false) → "Buddy 메시지는 보이는데 입력이 영구 비활성"
// 증상 발생. 파싱 실패 시 plain text로 graceful 표시.
function safeMarkedInto(el, raw) {
  try {
    el.innerHTML = marked.parse(raw);
  } catch {
    el.textContent = raw;
  }
}

async function streamInto(response, messageEl, handle) {
  const reader = response.body.getReader();
  const contentEl = messageEl.querySelector(".content");
  let raw = "";
  let renderScheduled = false;

  const scheduleRender = () => {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      safeMarkedInto(contentEl, raw);
      scrollToBottom();
    });
  };

  // v0.5.73 — inactivity timeout + abort 지원. handle 없이 호출되는
  // 레거시 경로 대비 fallback handle 생성.
  const h = handle ?? createStreamHandle("session");
  try {
    await pumpStream(reader, h, (chunk) => {
      raw += chunk;
      scheduleRender();
    });
  } finally {
    if (!handle) finishStreamHandle(h);
    // v0.5.75 — 스트림이 어떻게 끝나든 (성공/중단/에러) 받은 만큼은
    // 화면과 히스토리에 남김. 기존엔 에러 시 state.messages.push가
    // 안 돼서 부분 응답이 히스토리에서 증발했음.
    safeMarkedInto(contentEl, raw);
    scrollToBottom();
    if (raw.trim()) {
      state.messages.push({ role: "assistant", content: raw });
    }
  }
}

// ──────────────────────────────────────────────────────────
// Message UI
// ──────────────────────────────────────────────────────────

function appendUserMessage(text, opts = {}) {
  const div = document.createElement("div");
  div.className = "message user";
  div.innerHTML = `
    <div class="role">You</div>
    <div class="content"></div>
  `;
  // textContent로 입력 — 줄바꿈은 CSS white-space: pre-wrap이 유지함
  div.querySelector(".content").textContent = text;
  els.messages.appendChild(div);
  if (!opts.skipPush) state.messages.push({ role: "user", content: text });
  scrollToBottom();
  return div;
}

function appendAssistantMessage(initialMarkdown) {
  const placeholder = els.messages.querySelector(".placeholder");
  if (placeholder) placeholder.remove();

  const div = document.createElement("div");
  div.className = "message assistant";
  div.innerHTML = `
    <div class="role">Buddy</div>
    <div class="content"></div>
    ${renderFeedbackBar("msg")}
    ${_renderChapterContextBtn()}
  `;
  if (initialMarkdown) {
    div.querySelector(".content").innerHTML = marked.parse(initialMarkdown);
  }
  els.messages.appendChild(div);
  wireFeedbackBar(div.querySelector(".feedback-bar"));
  _wireChapterContextBtn(div);
  scrollToBottom();
  return div;
}

// v0.5.58 — Buddy 메시지마다 "📋 문맥" 버튼 (챕터 본문 맥락 요약 카드 트리거)
function _renderChapterContextBtn() {
  return `<button class="chapter-context-btn" type="button" title="이 메시지가 챕터 본문의 어느 부분인지 확인" aria-label="챕터 본문 맥락 보기">
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
      <polyline points="10 9 9 9 8 9"/>
    </svg>
    <span>문맥</span>
  </button>`;
}

function _wireChapterContextBtn(messageDiv) {
  const btn = messageDiv.querySelector(".chapter-context-btn");
  if (!btn) return;
  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const contentEl = messageDiv.querySelector(".content");
    const text = contentEl?.innerText?.trim();
    if (!text || text.length < 5) return;
    await runChapterContext({ targetMessageText: text });
  });
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
    const rmName = state.session.roadmapName ?? "";
    els.topbar.innerHTML = `
      <svg class="topbar-chapter-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
      </svg>
      <strong class="topbar-chapter-title" title="${escapeAttr(state.session.chapterTitle)}${rmName ? ` — ${escapeAttr(rmName)}` : ""}">${escapeHtml(state.session.chapterTitle)}</strong>
      <span class="depth">depth ${state.session.depth}</span>
    `;
  } else {
    els.topbar.textContent = "";
  }
}

function enableSessionUi(enabled) {
  els.input.disabled = !enabled;
  els.sendBtn.disabled = !enabled;
  els.endBtn.disabled = !enabled;
  els.quizBtn.disabled = !enabled;
  if (els.pauseBtn) els.pauseBtn.disabled = !enabled;
  if (els.refineBtn) els.refineBtn.disabled = !enabled;
  els.input.placeholder = enabled
    ? "메시지 입력 후 Enter (Shift+Enter는 줄바꿈) — 다듬어 보내기 ⌘⇧↵"
    : "세션을 시작하면 입력할 수 있어요";
}

function setPending(p) {
  state.pending = p;
  els.sendBtn.disabled = p || !state.session;
  els.endBtn.disabled = p || !state.session;
  els.quizBtn.disabled = p || !state.session;
  if (els.pauseBtn) els.pauseBtn.disabled = p || !state.session;
  if (els.refineBtn) {
    els.refineBtn.disabled = p || !state.session || state.refining === true;
  }
}

function setStatus(text, kind = "") {
  els.statusBar.textContent = text;
  els.statusBar.className = `status-bar ${kind}`;
}

// v0.5.41: 스트리밍 중 사용자가 스크롤 올리면 자동 스크롤 잠금.
// "맨 아래로" 버튼은 사용자가 스크롤 올렸을 때만 표시.
const _scrollState = {
  messagesStick: true, // messages 영역이 자동 스크롤 활성 상태인지
  lookupStick: true, // lookup body 영역
};

function _isNearBottom(el, threshold = 60) {
  return el.scrollHeight - (el.scrollTop + el.clientHeight) < threshold;
}

function _updateScrollBtn(btn, stick) {
  if (!btn) return;
  btn.classList.toggle("hidden", stick);
}

function initScrollControls() {
  if (els.messages) {
    els.messages.addEventListener("scroll", () => {
      _scrollState.messagesStick = _isNearBottom(els.messages);
      _updateScrollBtn(els.scrollBottomBtn, _scrollState.messagesStick);
    });
  }
  if (els.scrollBottomBtn) {
    els.scrollBottomBtn.addEventListener("click", () => {
      _scrollState.messagesStick = true;
      scrollToBottom(true);
    });
  }
  if (els.lookupPanelBody) {
    els.lookupPanelBody.addEventListener("scroll", () => {
      _scrollState.lookupStick = _isNearBottom(els.lookupPanelBody);
      _updateScrollBtn(els.lookupScrollBottomBtn, _scrollState.lookupStick);
    });
  }
  if (els.lookupScrollBottomBtn) {
    els.lookupScrollBottomBtn.addEventListener("click", () => {
      _scrollState.lookupStick = true;
      els.lookupPanelBody.scrollTop = els.lookupPanelBody.scrollHeight;
    });
  }
}

function scrollToBottom(force = false) {
  if (!els.messages) return;
  if (!force && !_scrollState.messagesStick) return;
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
