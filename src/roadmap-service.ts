// 로드맵 해석 서비스 — routes.ts / mcp.ts 공통.
// "설치된 로드맵 목록"과 "id/name → 로드맵" 해석을 한 곳에서 관리해
// 두 표면(HTTP, MCP)의 로직 drift를 막는다. (이전엔 양쪽에 거의 동일 복붙)

import type { Config } from "./config.js";
import {
  discoverRoadmaps,
  findRoadmap,
  type Roadmap,
} from "./roadmap.js";
import { discoverCuratedRoadmaps } from "./curated.js";

/**
 * 사용 가능한 로드맵 목록 — Local + Curated 모두 (설치된 것만).
 * - Local: SPIRAL_ROADMAP_ROOT 아래 discoverRoadmaps (pinnedRoadmapPath 시 단일)
 * - Curated: .cache/curated/<org>/ 에 설치된 레포
 */
export async function getInstalledRoadmaps(config: Config): Promise<Roadmap[]> {
  const out: Roadmap[] = [];

  if (config.roadmapRoot) {
    const local = await discoverRoadmaps(config.roadmapRoot);
    const filtered = config.pinnedRoadmapPath
      ? local.filter((r) => r.absolutePath === config.pinnedRoadmapPath)
      : local;
    for (const r of filtered) out.push({ ...r, source: "local" });
  }

  if (config.curatedOrg) {
    const curated = await discoverCuratedRoadmaps(config.curatedOrg);
    for (const r of curated) out.push({ ...r, source: "curated" });
  }

  return out;
}

/**
 * roadmap id/name → 로드맵. local + curated 둘 다.
 * roadmapId가 null이면 첫 로드맵 반환(HTTP의 "기본 로드맵" 동작).
 * MCP는 항상 non-null string을 넘기므로 null 분기에 닿지 않음.
 * 정확 일치 → curated id → local findRoadmap → basename(name) fallback.
 */
export async function resolveRoadmap(
  config: Config,
  roadmapId: string | null,
): Promise<Roadmap | null> {
  if (!roadmapId) {
    const all = await getInstalledRoadmaps(config);
    return all[0] ?? null;
  }

  if (roadmapId.startsWith("curated:") && config.curatedOrg) {
    const all = await discoverCuratedRoadmaps(config.curatedOrg);
    const match = all.find((r) => r.id === roadmapId);
    if (match) return { ...match, source: "curated" };
    return null;
  }

  if (config.roadmapRoot) {
    const local = await findRoadmap(config.roadmapRoot, roadmapId);
    if (local) return { ...local, source: "local" };
  }

  const all = await getInstalledRoadmaps(config);
  return all.find((r) => r.name === roadmapId) ?? null;
}
