/**
 * Curated 레포의 분류 구조.
 *
 * 데이터 source: data/curated-domains.json
 *   - domains (v0.5.44~): 도메인 단위 hierarchy (Foundations, Backend, Frontend, …)
 *   - rolePresets: 역할 추천 (백엔드/프론트/모바일/풀스택)
 *   - 각 domain은 categories[]를 가짐 (구버전 호환)
 *
 * Backward compat:
 *   - getOrgCategories()는 모든 domain의 categories[]를 평탄화해서 반환.
 *     사이드바 그룹화나 기존 코드는 그대로 동작.
 *
 * 매핑 안 된 레포는 'Other' 카테고리로 묶임.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.resolve(
  __dirname,
  "..",
  "data",
  "curated-domains.json",
);
// 이전 파일 — 마이그레이션 미완료 환경에서 fallback
const LEGACY_FILE = path.resolve(
  __dirname,
  "..",
  "data",
  "curated-categories.json",
);

export interface CategoryDef {
  name: string;
  emoji: string;
  color: string;
  repos: string[];
}

export interface DomainDef {
  id: string;
  name: string;
  emoji: string;
  subtitle?: string;
  hint?: string;
  color: string;
  order: number;
  recommended?: boolean;
  lastRecommended?: boolean;
  categories: CategoryDef[];
}

export interface RolePresetDef {
  id: string;
  name: string;
  emoji: string;
  subtitle?: string;
  /** 이 프리셋이 추천하는 domain id 목록 */
  domains: string[];
  color: string;
  /** 전체 도메인 포함 등 무거운 옵션 표시용 */
  heavy?: boolean;
  recommended?: boolean;
}

interface OrgEntry {
  /** v0.5.44+ 도메인 hierarchy */
  domains?: DomainDef[];
  /** v0.5.44+ 역할 프리셋 */
  rolePresets?: RolePresetDef[];
  /** 이전 단순 categories — backward compat */
  categories?: CategoryDef[];
}

let _cache: Record<string, OrgEntry> | null = null;

async function load(): Promise<Record<string, OrgEntry>> {
  if (_cache) return _cache;
  // 1순위: curated-domains.json (v0.5.44+)
  try {
    const raw = await fs.readFile(DATA_FILE, "utf-8");
    _cache = JSON.parse(raw);
    return _cache!;
  } catch {}
  // 2순위: curated-categories.json (구 파일, 패키지 안 업데이트 환경)
  try {
    const raw = await fs.readFile(LEGACY_FILE, "utf-8");
    _cache = JSON.parse(raw);
    return _cache!;
  } catch {}
  _cache = {};
  return _cache!;
}

/**
 * 특정 org에 정의된 카테고리들. 정의 안 됐으면 null.
 *
 * domains가 있으면 모든 domain.categories를 평탄화해서 반환 (사이드바 등 호환).
 * 카테고리 순서는 domain.order → category 정의 순.
 */
export async function getOrgCategories(
  org: string,
): Promise<CategoryDef[] | null> {
  const all = await load();
  const entry = all[org];
  if (!entry) return null;
  if (entry.domains?.length) {
    const sortedDomains = [...entry.domains].sort(
      (a, b) => (a.order ?? 99) - (b.order ?? 99),
    );
    return sortedDomains.flatMap((d) => d.categories);
  }
  return entry.categories ?? null;
}

/**
 * 특정 org의 도메인 hierarchy (v0.5.44+). 도메인 정의가 없으면 null.
 */
export async function getOrgDomains(
  org: string,
): Promise<DomainDef[] | null> {
  const all = await load();
  const entry = all[org];
  if (!entry?.domains?.length) return null;
  return [...entry.domains].sort(
    (a, b) => (a.order ?? 99) - (b.order ?? 99),
  );
}

/**
 * 특정 org의 역할 프리셋 (v0.5.44+).
 */
export async function getOrgRolePresets(
  org: string,
): Promise<RolePresetDef[] | null> {
  const all = await load();
  const entry = all[org];
  return entry?.rolePresets ?? null;
}

/**
 * 도메인 id로 도메인 정의 조회.
 */
export async function getDomainById(
  org: string,
  domainId: string,
): Promise<DomainDef | null> {
  const domains = await getOrgDomains(org);
  return domains?.find((d) => d.id === domainId) ?? null;
}

/**
 * 한 도메인에 속한 모든 레포 이름 평탄화.
 */
export function reposInDomain(domain: DomainDef): string[] {
  return domain.categories.flatMap((c) => c.repos);
}

/**
 * 여러 도메인의 합집합 레포 이름 (중복 제거).
 */
export function reposInDomains(domains: DomainDef[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of domains) {
    for (const r of reposInDomain(d)) {
      if (!seen.has(r)) {
        seen.add(r);
        out.push(r);
      }
    }
  }
  return out;
}

/**
 * 레포 목록을 카테고리별로 그룹화. 카테고리는 정의된 순서 유지.
 * 매핑 안 된 레포는 'Other' 카테고리에 묶임.
 */
export async function groupReposByCategory<T extends { name: string }>(
  org: string,
  repos: T[],
): Promise<Array<{ category: CategoryDef; repos: T[] }>> {
  const defs = await getOrgCategories(org);
  if (!defs || defs.length === 0) {
    return [
      {
        category: {
          name: "All",
          emoji: "📚",
          color: "#888888",
          repos: [],
        },
        repos: [...repos].sort((a, b) => a.name.localeCompare(b.name)),
      },
    ];
  }

  const groups: Array<{ category: CategoryDef; repos: T[] }> = [];
  const usedNames = new Set<string>();

  for (const cat of defs) {
    const matched = repos
      .filter((r) => cat.repos.includes(r.name))
      // README 순서대로 정렬 (카테고리 정의 순서)
      .sort((a, b) => cat.repos.indexOf(a.name) - cat.repos.indexOf(b.name));
    for (const r of matched) usedNames.add(r.name);
    if (matched.length > 0) {
      groups.push({ category: cat, repos: matched });
    }
  }

  const others = repos
    .filter((r) => !usedNames.has(r.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (others.length > 0) {
    groups.push({
      category: {
        name: "Other",
        emoji: "📦",
        color: "#888888",
        repos: [],
      },
      repos: others,
    });
  }

  return groups;
}

/**
 * 카테고리 이름 정규화 (매칭용).
 * "API & Communication" / "api & communication " / "api-communication" 다 같은 키로.
 */
function normalizeCategoryName(s: string): string {
  return s.toLowerCase().replace(/[\s&\-_]+/g, "").trim();
}

/**
 * 레포 이름 정규화 (매칭용).
 * "-deep-dive" suffix는 학습 자료에서 흔하므로 옵셔널 처리:
 * - "architecture-patterns-deep-dive" (GitHub repo / JSON)
 * - "architecture-patterns" (사용자가 카테고리 폴더에 줄여서 둔 디렉토리)
 * 둘 다 동일 ID로 매칭됨.
 */
export function normalizeRepoName(s: string): string {
  return s.toLowerCase().replace(/-deep-dive$/, "").trim();
}

/**
 * Local 로드맵의 path에서 카테고리 추출.
 * 사용자의 폴더가 카테고리 단위로 정리되어 있다면 (예: iq-dev-lab),
 * roadmap_id의 첫 segment가 카테고리.
 *
 * org가 주어지면 그 조직 카테고리 정의와 매핑 시도 → emoji/color 활용.
 * 매핑 안 되면 첫 segment 이름 그대로, 1-level path면 "Uncategorized".
 */
const UNCATEGORIZED: CategoryDef = {
  name: "Topics",
  emoji: "🗂",
  color: "#9ca3af",
  repos: [],
};

export async function categorizeLocalRoadmap(
  org: string | null,
  roadmapId: string,
): Promise<CategoryDef> {
  const segments = roadmapId.split("/").map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) return UNCATEGORIZED;

  const defs = org ? await getOrgCategories(org) : null;
  const firstSeg = segments[0]!;

  if (defs) {
    // 1) 첫 segment가 카테고리 이름인 케이스 (예: "java core/jvm-deep-dive/...")
    const normalized = normalizeCategoryName(firstSeg);
    const byName = defs.find(
      (c) => normalizeCategoryName(c.name) === normalized,
    );
    if (byName) return byName;

    // 2) 첫 segment가 레포 이름인 케이스 (예: "jvm-deep-dive/..." — 평탄 클론).
    //    JSON의 카테고리 repos[]에서 역검색. -deep-dive suffix는 옵셔널.
    const segNorm = normalizeRepoName(firstSeg);
    for (const cat of defs) {
      if (cat.repos.some((r) => normalizeRepoName(r) === segNorm)) return cat;
    }
  }

  // 3) 매칭 실패 — 1 segment뿐이면 Topics, 2+ segment면 첫 segment를 카테고리로
  if (segments.length < 2) return UNCATEGORIZED;
  return {
    name: firstSeg,
    emoji: "📁",
    color: "#888888",
    repos: [],
  };
}

/**
 * Local 로드맵들을 카테고리별로 그룹화. 카테고리 정의 순서 우선,
 * 정의 없으면 alphabetical, "Uncategorized"는 마지막.
 */
export async function groupLocalRoadmapsByCategory<
  T extends { id: string; name: string },
>(
  org: string | null,
  roadmaps: T[],
): Promise<Array<{ category: CategoryDef; roadmaps: T[] }>> {
  const buckets = new Map<
    string,
    { category: CategoryDef; roadmaps: T[] }
  >();

  for (const r of roadmaps) {
    const cat = await categorizeLocalRoadmap(org, r.id);
    const existing = buckets.get(cat.name);
    if (existing) {
      existing.roadmaps.push(r);
    } else {
      buckets.set(cat.name, { category: cat, roadmaps: [r] });
    }
  }

  // 카테고리 정의 순서대로 정렬, 정의 없는 건 뒤로, Uncategorized는 맨 뒤
  const defs = org ? await getOrgCategories(org) : null;
  const order = new Map<string, number>();
  if (defs) {
    defs.forEach((c, i) => order.set(c.name, i));
  }

  const result = Array.from(buckets.values());
  result.sort((a, b) => {
    const aIsUncat = a.category.name === "Uncategorized";
    const bIsUncat = b.category.name === "Uncategorized";
    if (aIsUncat && !bIsUncat) return 1;
    if (!aIsUncat && bIsUncat) return -1;

    const ia = order.get(a.category.name);
    const ib = order.get(b.category.name);
    if (ia !== undefined && ib !== undefined) return ia - ib;
    if (ia !== undefined) return -1;
    if (ib !== undefined) return 1;
    return a.category.name.localeCompare(b.category.name);
  });

  // 각 그룹 내부 로드맵은 alphabetical
  for (const g of result) {
    g.roadmaps.sort((a, b) => a.name.localeCompare(b.name));
  }

  return result;
}
