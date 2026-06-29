// iq-spiral-buddy client — 순수 유틸리티 (DOM/state 비의존, 5색 공유 모듈)

/** HTML 텍스트 이스케이프 — &<>"' 전부 인코딩. */
export function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// escapeAttr는 escapeHtml과 동일(따옴표까지 인코딩) — 의도적 alias.
// 호출부 가독성(속성 컨텍스트 표시)을 위해 별도 이름 유지.
export function escapeAttr(s) {
  return escapeHtml(s);
}

/** CSS 셀렉터/식별자 이스케이프 — CSS.escape 우선, 폴백 정규식. */
export function cssEscape(s) {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(s);
  return String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}

/** 길이 n 초과 시 말줄임표. */
export function truncate(s, n) {
  if (!s) return "";
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

/** 상대 시간 — "방금" / "N분 전" / "N시간 전" / "N일 전". */
export function _relTime(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  return `${d}일 전`;
}
