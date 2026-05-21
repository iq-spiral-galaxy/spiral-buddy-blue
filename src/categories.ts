/**
 * Curated 레포의 카테고리 매핑.
 * data/curated-categories.json에서 조직별 분류 정보를 읽는다.
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
  "curated-categories.json",
);

export interface CategoryDef {
  name: string;
  emoji: string;
  color: string;
  repos: string[];
}

interface OrgCategoriesEntry {
  categories: CategoryDef[];
}

let _cache: Record<string, OrgCategoriesEntry> | null = null;

async function load(): Promise<Record<string, OrgCategoriesEntry>> {
  if (_cache) return _cache;
  try {
    const raw = await fs.readFile(DATA_FILE, "utf-8");
    _cache = JSON.parse(raw);
  } catch {
    _cache = {};
  }
  return _cache!;
}

/**
 * 특정 org에 정의된 카테고리들. 정의 안 됐으면 null.
 */
export async function getOrgCategories(
  org: string,
): Promise<CategoryDef[] | null> {
  const all = await load();
  return all[org]?.categories ?? null;
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
