// iq-spiral-buddy client — SVG 아이콘 데이터 + 렌더 헬퍼 (순수, 5색 공유 모듈)

// 카테고리/도메인 이름 → 아이콘 키. (도메인 헤더도 같은 lookup 사용)
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

export function svgIcon(name, className = "inline-icon") {
  const body = ICON_SVG[name] ?? ICON_SVG.folder;
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export function categoryIconHtml(category) {
  const key = String(category?.name ?? "uncategorized").toLowerCase();
  const iconName = CATEGORY_ICON_BY_NAME[key] ?? "folder";
  return `<span class="cat-icon" aria-hidden="true">${svgIcon(iconName, "cat-icon-svg")}</span>`;
}

export function repoIconHtml() {
  return `<span class="repo-icon" aria-hidden="true">${svgIcon("repo", "repo-icon-svg")}</span>`;
}

export function groupIconHtml(name) {
  return `<span class="group-icon" aria-hidden="true">${svgIcon(name, "group-icon-svg")}</span>`;
}

// depth(concise/medium/deep) 표시용 아이콘
export const DEPTH_ICONS = {
  concise:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="14" y2="12"/><circle cx="19" cy="12" r="1.4" fill="currentColor"/></svg>',
  medium:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="14" y2="15"/></svg>',
  deep:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="13" y2="18"/></svg>',
};

export const CONTEXT_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`;

export const THUMBS_UP_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 10v12"/><path d="M15 5.88L14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H7"/><path d="M3 22h4V10H3z"/></svg>`;

export const THUMBS_DOWN_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 14V2"/><path d="M9 18.12L10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H17"/><path d="M21 2h-4v12h4z"/></svg>`;
