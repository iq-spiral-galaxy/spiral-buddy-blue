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
  roadmaps: [],
  curatedAvailable: [],
  curatedGroups: [],
  expandedCategories: new Set(), // Curated 받기 가능 카테고리
  expandedLocalCategories: new Set(), // Local 카테고리
  expandedLocalRepos: new Set(), // Local 레포 (key: "category::repo")
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
}

async function loadInitial() {
  try {
    const [config, roadmaps] = await Promise.all([
      fetch("/api/config").then((r) => r.json()),
      fetch("/api/roadmaps")
        .then((r) => r.json())
        .catch(() => []),
    ]);
    state.config = config;
    state.curatedOrg = config?.curatedOrg ?? null;
    state.roadmaps = Array.isArray(roadmaps) ? roadmaps : [];

    renderMeta();

    if (state.roadmaps.length === 0 && !state.curatedOrg) {
      setStatus(
        "로드맵이 없음. SPIRAL_ROADMAP_ROOT 또는 SPIRAL_CURATED_ORG 설정 필요.",
        "error",
      );
      renderRoadmapSelector();
      return;
    }

    // 마지막으로 사용한 로드맵 복원
    const lastId = localStorage.getItem(LS_KEY);
    const restored = lastId && state.roadmaps.find((r) => r.id === lastId);
    state.activeRoadmapId = restored
      ? restored.id
      : state.roadmaps[0]?.id ?? null;

    renderRoadmapSelector();
    if (state.activeRoadmapId) {
      await loadRoadmapData();
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
  els.meta.textContent = c?.model ?? "";
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
        // category 폴더 안에 바로 sub 없는 레포 (드물 듯)
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

    // active 로드맵의 카테고리 + 레포는 자동 펼침
    const activeRoadmap = local.find((r) => r.id === state.activeRoadmapId);
    if (activeRoadmap?.category?.name) {
      state.expandedLocalCategories.add(activeRoadmap.category.name);
      const { repo: activeRepo } = parseHierarchy(activeRoadmap);
      state.expandedLocalRepos.add(`${activeRoadmap.category.name}::${activeRepo}`);
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
            // sub-roadmap 목록 렌더링
            const sortedSubs = [...roadmaps].sort((a, b) => {
              const subA = parseHierarchy(a).sub ?? a.name;
              const subB = parseHierarchy(b).sub ?? b.name;
              return subA.localeCompare(subB);
            });
            repoBody = sortedSubs
              .map((r) => {
                const isActive = r.id === state.activeRoadmapId;
                const { sub } = parseHierarchy(r);
                const displayName = sub ?? r.name;
                const lastDate = r.lastDate ?? "—";
                const depthBadge =
                  r.maxDepth > 0
                    ? `<span class="depth-pill">d${r.maxDepth}</span>`
                    : "";
                return `
                  <button class="roadmap-item sub-roadmap-item ${isActive ? "active" : ""}" data-id="${escapeAttr(r.id)}">
                    <div class="roadmap-item-name">${escapeHtml(displayName)}</div>
                    <div class="roadmap-item-meta">
                      ${depthBadge}
                      <span class="roadmap-item-progress">${r.visitedChapters}/${r.chapterCount}</span>
                      <span class="roadmap-item-date">${escapeHtml(lastDate)}</span>
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
    btn.addEventListener("click", () => {
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

async function switchRoadmap(roadmapId) {
  if (state.session) {
    if (
      !confirm(
        "진행 중인 세션이 있어. 종료 안 하고 로드맵을 바꾸면 현재 세션 노트는 만들어지지 않아.\n계속할래?",
      )
    ) {
      return;
    }
    state.session = null;
    enableSessionUi(false);
    updateTopbar();
    els.messages.innerHTML = `<div class="placeholder"><p>왼쪽에서 챕터를 골라 세션을 시작하세요.</p></div>`;
  }

  state.activeRoadmapId = roadmapId;
  localStorage.setItem(LS_KEY, roadmapId);
  els.roadmapList.classList.add("hidden");
  renderRoadmapSelector();
  await loadRoadmapData();
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
      ? `<span class="chapter-depth-pill" title="마지막 학습: ${escapeAttr(ch.lastDate ?? "")} · 총 ${ch.visitCount}회">d${ch.maxDepth}</span>`
      : `<span class="chapter-depth-pill empty"></span>`;
    li.innerHTML = `
      <button class="chapter-btn ${visited ? "visited" : ""}" data-id="${escapeAttr(ch.id)}">
        <span class="num">${i + 1}.</span>
        <span class="title">${escapeHtml(ch.title)}</span>
        ${badge}
      </button>
    `;
    li.querySelector("button").addEventListener("click", () => {
      if (state.session) {
        if (
          !confirm(
            "진행 중인 세션이 있어. 종료 안 하고 새로 시작할까?\n(현재 세션 노트는 만들어지지 않음)",
          )
        )
          return;
        state.session = null;
      }
      startSession(ch.id);
    });
    els.chapterList.appendChild(li);
  });
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
    btn.addEventListener("click", () => {
      if (state.session) {
        if (
          !confirm(
            "진행 중인 세션이 있어. 종료 안 하고 새로 시작할까?\n(현재 세션 노트는 만들어지지 않음)",
          )
        )
          return;
        state.session = null;
      }
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
  setStatus("📝 Generating note…");

  try {
    const res = await fetch(`/api/session/${state.session.id}/end`, {
      method: "POST",
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text);
    }
    const result = await res.json();
    showCompletionCard(result);

    state.session = null;
    enableSessionUi(false);
    updateTopbar();

    // 현재 로드맵 데이터 전체 새로고침 + 전체 로드맵 진도도 갱신
    const [roadmaps] = await Promise.all([
      fetch("/api/roadmaps").then((r) => r.json()),
    ]);
    state.roadmaps = Array.isArray(roadmaps) ? roadmaps : [];
    renderRoadmapSelector();
    await loadRoadmapData();
    setStatus("");
  } catch (err) {
    setStatus(`End failed: ${err.message}`, "error");
  } finally {
    setPending(false);
  }
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
