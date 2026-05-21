import { Hono } from "hono";
import { streamText } from "hono/streaming";
import path from "node:path";

import type { Config } from "./config.js";
import { createClient, streamTurn } from "./claude.js";
import {
  discoverRoadmaps,
  findRoadmap,
  loadRoadmapChapters,
  type Roadmap,
} from "./roadmap.js";
import {
  listSpiralNotes,
  listTrash,
  moveNotesToTrash,
  noteBelongsToRoadmap,
  noteMatchesChapter,
  restoreFromTrash,
  writeNewNote,
} from "./vault.js";
import { suggestNext } from "./spiral.js";
import { generateNote } from "./note-writer.js";
import {
  SESSION_SYSTEM,
  buildInitialContext,
  createSession,
  getSession,
  deleteSession,
} from "./session-store.js";
import {
  listCuratedRepos,
  installCuratedRepo,
  refreshCuratedRepo,
  uninstallCuratedRepo,
  discoverCuratedRoadmaps,
  parseCuratedId,
  type CuratedRepoInfo,
} from "./curated.js";
import {
  groupReposByCategory,
  categorizeLocalRoadmap,
  getOrgCategories,
  normalizeRepoName,
} from "./categories.js";

export function createApi(config: Config) {
  const app = new Hono();
  const client = createClient(config);

  // ─────────────────────────────────────────────────────
  // 헬퍼
  // ─────────────────────────────────────────────────────

  const vaultSubDir = process.env.SPIRAL_VAULT_SUBDIR?.trim() || "spiral-buddy";
  function obsidianUri(fileNameOrPath: string): string | null {
    if (!config.vaultName || !config.vaultPath) return null;
    const absPath = path.isAbsolute(fileNameOrPath)
      ? fileNameOrPath
      : path.join(config.vaultPath, vaultSubDir, fileNameOrPath);
    const root = config.obsidianVaultRoot ?? config.vaultPath;
    const relativeToVault = path.relative(root, absPath).replace(/\.md$/, "");
    return `obsidian://open?vault=${encodeURIComponent(config.vaultName)}&file=${encodeURIComponent(relativeToVault)}`;
  }

  /**
   * 사용 가능한 로드맵 목록 — Local + Curated 모두.
   *
   * - Local: SPIRAL_ROADMAP_ROOT 아래에서 discoverRoadmaps
   * - Curated: .cache/curated/<org>/ 에 이미 설치된 레포에서 discoverCuratedRoadmaps
   *   (아직 설치 안 된 큐레이션 레포는 /api/curated/available에서 별도 노출)
   */
  async function getInstalledRoadmaps(): Promise<Roadmap[]> {
    const out: Roadmap[] = [];

    if (config.roadmapRoot) {
      const local = await discoverRoadmaps(config.roadmapRoot);
      const filteredLocal = config.pinnedRoadmapPath
        ? local.filter((r) => r.absolutePath === config.pinnedRoadmapPath)
        : local;
      for (const r of filteredLocal) {
        out.push({ ...r, source: "local" });
      }
    }

    if (config.curatedOrg) {
      const curated = await discoverCuratedRoadmaps(config.curatedOrg);
      for (const r of curated) {
        out.push({ ...r, source: "curated" });
      }
    }

    return out;
  }

  /**
   * roadmap_id로 로드맵 찾기. local + curated 둘 다 처리.
   */
  async function resolveRoadmap(
    roadmapId: string | null,
  ): Promise<Roadmap | null> {
    if (!roadmapId) {
      const all = await getInstalledRoadmaps();
      return all[0] ?? null;
    }

    // Curated id ("curated:org/repo[/sub]")
    if (roadmapId.startsWith("curated:") && config.curatedOrg) {
      const all = await discoverCuratedRoadmaps(config.curatedOrg);
      const match = all.find((r) => r.id === roadmapId);
      if (match) return { ...match, source: "curated" };
      return null;
    }

    // Local
    if (config.roadmapRoot) {
      const local = await findRoadmap(config.roadmapRoot, roadmapId);
      if (local) return { ...local, source: "local" };
    }

    // basename fallback across both sources
    const all = await getInstalledRoadmaps();
    return all.find((r) => r.name === roadmapId) ?? null;
  }

  // ─────────────────────────────────────────────────────
  // 1. Config
  // ─────────────────────────────────────────────────────

  app.get("/config", (c) =>
    c.json({
      roadmapRoot: config.roadmapRoot,
      vaultPath: config.vaultPath,
      vaultName: config.vaultName,
      model: config.model,
      curatedOrg: config.curatedOrg,
    }),
  );

  // ─────────────────────────────────────────────────────
  // 1-b. Models (선택 가능한 모델 목록)
  // ─────────────────────────────────────────────────────

  app.get("/models", (c) =>
    c.json({
      default: config.model,
      models: [
        {
          id: "claude-opus-4-7",
          label: "Opus 4.7",
          tier: "highest",
          description: "가장 똑똑함. 깊은 추론·복잡한 학습 대화에 최적",
        },
        {
          id: "claude-opus-4-6",
          label: "Opus 4.6",
          tier: "high",
          description: "균형형. 비싸지만 학습 품질 높음",
        },
        {
          id: "claude-sonnet-4-6",
          label: "Sonnet 4.6",
          tier: "balanced",
          description: "추천 기본값. 빠르고 충분히 똑똑함",
        },
        {
          id: "claude-haiku-4-5",
          label: "Haiku 4.5",
          tier: "fast",
          description: "가장 빠름. 가벼운 질의·진도 빠른 학습용",
        },
      ],
    }),
  );

  // ─────────────────────────────────────────────────────
  // 2. Roadmaps (Local + Curated 설치된 것들)
  // ─────────────────────────────────────────────────────

  app.get("/roadmaps", async (c) => {
    const roadmaps = await getInstalledRoadmaps();
    if (roadmaps.length === 0 && !config.curatedOrg && !config.roadmapRoot) {
      return c.json(
        {
          error:
            "SPIRAL_ROADMAP_ROOT 또는 SPIRAL_CURATED_ORG 중 하나는 설정해야 합니다",
        },
        400,
      );
    }
    const notes = config.vaultPath ? await listSpiralNotes(config.vaultPath) : [];

    const enriched = await Promise.all(
      roadmaps.map(async (r) => {
          const roadmapNotes = notes.filter((n) =>
            noteBelongsToRoadmap(n, { roadmapId: r.id, roadmapName: r.name }),
          );
          const visitedChapters = new Set(
            roadmapNotes.map((n) => n.chapterId).filter(Boolean),
          );
          const maxDepth = roadmapNotes.reduce(
            (m, n) => Math.max(m, n.depth),
            0,
          );
          const depths = [...new Set(roadmapNotes.map((n) => n.depth))].sort(
            (a, b) => a - b,
          );
          const lastDate = roadmapNotes.reduce(
            (latest: string | null, n) =>
              !latest || n.date > latest ? n.date : latest,
            null,
          );
          // Local 로드맵은 path 기반 분류
          const category =
            r.source === "local"
              ? await categorizeLocalRoadmap(config.curatedOrg, r.id)
              : null;

          // 사이드바 트리(category → repo → sub-roadmap)에 쓸 hierarchy 정보.
          // 두 가지 구조를 모두 지원:
          //   a) 계층:   "java core/jvm-deep-dive/class-loading"  (사용자가 카테고리 폴더로 정리)
          //   b) 평탄:   "jvm-deep-dive/class-loading"           (자동 다운로드 결과)
          // category.repos 안에 첫 segment가 들어있으면 (b), 아니면 (a).
          let hierarchy: { repo: string; sub: string | null } | null = null;
          if (r.source === "local" && category) {
            const segs = r.id.split("/").map((s) => s.trim()).filter(Boolean);
            const seg0Norm = normalizeRepoName(segs[0] ?? "");
            const isFlat = category.repos.some(
              (rp) => normalizeRepoName(rp) === seg0Norm,
            );
            if (isFlat) {
              hierarchy = {
                repo: segs[0] ?? r.name,
                sub: segs.slice(1).join("/") || null,
              };
            } else if (segs.length >= 3) {
              hierarchy = {
                repo: segs[1]!,
                sub: segs.slice(2).join("/") || null,
              };
            } else if (segs.length === 2) {
              hierarchy = { repo: segs[1]!, sub: null };
            } else {
              hierarchy = { repo: segs[0] ?? r.name, sub: null };
            }
          }
          return {
            id: r.id,
            name: r.name,
            source: r.source ?? "local",
            chapterCount: r.chapterCount,
            visitedChapters: visitedChapters.size,
            totalNotes: roadmapNotes.length,
            maxDepth,
            depths,
            lastDate,
            category: category
              ? {
                  name: category.name,
                  emoji: category.emoji,
                  color: category.color,
                }
              : null,
            hierarchy,
          };
        }),
      );

    // 3단계 정렬:
    //   1. 카테고리 순서 (JSON categories 배열 인덱스)
    //   2. 카테고리 안 repo 순서 (JSON repos 배열 인덱스 — 학습 흐름)
    //   3. 같은 repo 안 sub-roadmap 순서 (Array.sort는 stable이라 sortKey/README 순서 유지)
    const catDefs = config.curatedOrg
      ? await getOrgCategories(config.curatedOrg)
      : null;
    if (catDefs) {
      const catOrder = new Map<string, number>();
      // "<category>::<repo>" → index
      const repoOrder = new Map<string, number>();
      catDefs.forEach((c, i) => {
        catOrder.set(c.name, i);
        c.repos.forEach((repo, j) => {
          // normalize 적용 — JSON에 "-deep-dive" suffix, 디렉토리에 없을 수 있음
          repoOrder.set(`${c.name}::${normalizeRepoName(repo)}`, j);
        });
      });
      const repoOf = (r: typeof enriched[number]) =>
        r.hierarchy?.repo ?? null;
      enriched.sort((a, b) => {
        const ai = a.category ? catOrder.get(a.category.name) ?? Infinity : Infinity;
        const bi = b.category ? catOrder.get(b.category.name) ?? Infinity : Infinity;
        if (ai !== bi) return ai - bi;
        // 같은 카테고리 안 — repo 순서
        const aRepo = repoOf(a);
        const bRepo = repoOf(b);
        if (a.category && aRepo && bRepo) {
          const ari =
            repoOrder.get(`${a.category.name}::${normalizeRepoName(aRepo)}`) ??
            Infinity;
          const bri =
            repoOrder.get(`${a.category.name}::${normalizeRepoName(bRepo)}`) ??
            Infinity;
          if (ari !== bri) return ari - bri;
        }
        return 0; // 같은 repo 내에서는 sortKey 순서 유지 (stable)
      });
    }

    return c.json(enriched);
  });

  // ─────────────────────────────────────────────────────
  // 2-b. Curated repos (available + installed)
  // ─────────────────────────────────────────────────────

  app.get("/curated/available", async (c) => {
    if (!config.curatedOrg) {
      return c.json({ error: "curated source disabled" }, 400);
    }
    const force = c.req.query("refresh") === "1";
    try {
      const repos = await listCuratedRepos({
        org: config.curatedOrg,
        token: config.githubToken ?? undefined,
        forceRefresh: force,
      });
      const groups = await groupReposByCategory(config.curatedOrg, repos);
      return c.json({
        org: config.curatedOrg,
        repos,
        groups: groups.map((g) => ({
          name: g.category.name,
          emoji: g.category.emoji,
          color: g.category.color,
          repos: g.repos,
        })),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 502);
    }
  });

  app.post("/curated/install", async (c) => {
    if (!config.curatedOrg) {
      return c.json({ error: "curated source disabled" }, 400);
    }
    const body = await c.req
      .json<{ repo_name: string; org?: string }>()
      .catch(() => null);
    if (!body?.repo_name) {
      return c.json({ error: "repo_name required" }, 400);
    }
    const org = body.org ?? config.curatedOrg;
    try {
      const result = await installCuratedRepo({
        org,
        repoName: body.repo_name,
      });
      return c.json({
        installed: true,
        alreadyInstalled: result.alreadyInstalled,
        cachePath: result.cachePath,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 500);
    }
  });

  app.post("/curated/refresh", async (c) => {
    if (!config.curatedOrg) {
      return c.json({ error: "curated source disabled" }, 400);
    }
    const body = await c.req
      .json<{ repo_name: string; org?: string }>()
      .catch(() => null);
    if (!body?.repo_name) {
      return c.json({ error: "repo_name required" }, 400);
    }
    const org = body.org ?? config.curatedOrg;
    try {
      await refreshCuratedRepo({ org, repoName: body.repo_name });
      return c.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 500);
    }
  });

  app.post("/curated/uninstall", async (c) => {
    if (!config.curatedOrg) {
      return c.json({ error: "curated source disabled" }, 400);
    }
    const body = await c.req
      .json<{ repo_name: string; org?: string }>()
      .catch(() => null);
    if (!body?.repo_name) {
      return c.json({ error: "repo_name required" }, 400);
    }
    const org = body.org ?? config.curatedOrg;
    try {
      await uninstallCuratedRepo({ org, repoName: body.repo_name });
      return c.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 500);
    }
  });

  // ─────────────────────────────────────────────────────
  // 3. Chapters (로드맵별)
  // ─────────────────────────────────────────────────────

  app.get("/chapters", async (c) => {
    const roadmapId = c.req.query("roadmap_id") ?? null;
    const roadmap = await resolveRoadmap(roadmapId);
    if (!roadmap) {
      return c.json({ error: "Roadmap not found" }, 404);
    }

    const chapters = await loadRoadmapChapters(roadmap);
    const notes = config.vaultPath ? await listSpiralNotes(config.vaultPath) : [];

    return c.json({
      roadmapId: roadmap.id,
      roadmapName: roadmap.name,
      chapters: chapters.map((ch) => {
        const matchingNotes = notes.filter((n) =>
          noteMatchesChapter(n, {
            roadmapId: roadmap.id,
            roadmapName: roadmap.name,
            chapterId: ch.id,
          }),
        );
        const maxDepth = matchingNotes.reduce(
          (m, n) => Math.max(m, n.depth),
          0,
        );
        const lastDate = matchingNotes.reduce(
          (latest: string | null, n) =>
            !latest || n.date > latest ? n.date : latest,
          null,
        );
        const depths = [...new Set(matchingNotes.map((n) => n.depth))].sort(
          (a, b) => a - b,
        );
        // depth별 가장 최근 노트의 obsidian deep-link (같은 depth 여러 개면 최신만)
        const noteLinks = depths
          .map((d) => {
            const sameDepth = matchingNotes
              .filter((n) => n.depth === d)
              .sort((a, b) => b.date.localeCompare(a.date));
            const note = sameDepth[0];
            if (!note) return null;
            const url = obsidianUri(note.filePath);
            if (!url) return null;
            return { depth: d, url, date: note.date };
          })
          .filter((x): x is { depth: number; url: string; date: string } => !!x);
        return {
          id: ch.id,
          title: ch.title,
          order: ch.order,
          visitCount: matchingNotes.length,
          maxDepth,
          depths,
          noteLinks,
          lastDate,
        };
      }),
    });
  });

  // ─────────────────────────────────────────────────────
  // 3a. 검색 — 로드맵 + 노트 + 매칭된 로드맵의 챕터
  // ─────────────────────────────────────────────────────

  app.get("/search", async (c) => {
    const raw = (c.req.query("q") ?? "").trim();
    if (raw.length < 2) {
      return c.json({ roadmaps: [], chapters: [], notes: [] });
    }
    const q = raw.toLowerCase();

    const roadmaps = await getInstalledRoadmaps();
    const notes = config.vaultPath
      ? await listSpiralNotes(config.vaultPath)
      : [];

    // 1) 로드맵 매칭 (name, id)
    const roadmapMatches = roadmaps
      .filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.id.toLowerCase().includes(q),
      )
      .slice(0, 15)
      .map((r) => ({
        id: r.id,
        name: r.name,
        path: r.id,
        source: r.source ?? "local",
      }));

    // 2) 노트 매칭 (title, topic, body 첫 1000자)
    const noteMatches = notes
      .filter((n) => {
        const head = n.body.slice(0, 1000).toLowerCase();
        return (
          n.title.toLowerCase().includes(q) ||
          n.topic.toLowerCase().includes(q) ||
          head.includes(q)
        );
      })
      .slice(0, 10)
      .map((n) => ({
        title: n.title,
        topic: n.topic,
        depth: n.depth,
        date: n.date,
        chapterId: n.chapterId,
        roadmapId: n.roadmapId,
        roadmapName: n.roadmapName,
        obsidianUrl: obsidianUri(n.filePath),
      }));

    // 3) 챕터 매칭 — 매칭된 로드맵 + 노트가 있는 로드맵 안에서만 (성능)
    const candidateRoadmaps = new Map<string, Roadmap>();
    for (const r of roadmapMatches.map((rm) => roadmaps.find((r2) => r2.id === rm.id))) {
      if (r) candidateRoadmaps.set(r.id, r);
    }
    for (const n of noteMatches) {
      if (n.roadmapId) {
        const r = roadmaps.find((r2) => r2.id === n.roadmapId);
        if (r) candidateRoadmaps.set(r.id, r);
      }
    }
    const chapterMatches: Array<{
      roadmapId: string;
      roadmapName: string;
      chapterId: string;
      title: string;
    }> = [];
    for (const r of candidateRoadmaps.values()) {
      const chapters = await loadRoadmapChapters(r);
      for (const ch of chapters) {
        if (
          ch.title.toLowerCase().includes(q) ||
          ch.id.toLowerCase().includes(q)
        ) {
          chapterMatches.push({
            roadmapId: r.id,
            roadmapName: r.name,
            chapterId: ch.id,
            title: ch.title,
          });
          if (chapterMatches.length >= 15) break;
        }
      }
      if (chapterMatches.length >= 15) break;
    }

    return c.json({
      roadmaps: roadmapMatches,
      chapters: chapterMatches,
      notes: noteMatches,
    });
  });

  // ─────────────────────────────────────────────────────
  // 3b. 노트 삭제 (챕터 전체 or 특정 depth만, vault의 .trash/로 이동)
  // ─────────────────────────────────────────────────────

  app.delete("/notes", async (c) => {
    if (!config.vaultPath) {
      return c.json({ error: "No vault configured" }, 400);
    }
    const body = await c.req
      .json<{
        roadmapId: string;
        chapterId?: string | null;
        depth?: number | null;
      }>()
      .catch(() => null);
    if (!body?.roadmapId) {
      return c.json({ error: "roadmapId required" }, 400);
    }

    const roadmap = await resolveRoadmap(body.roadmapId);
    if (!roadmap) {
      return c.json({ error: "Roadmap not found" }, 404);
    }

    const all = await listSpiralNotes(config.vaultPath);
    const target = all.filter((n) => {
      // chapterId 있으면 챕터 단위, 없으면 roadmap 전체
      if (body.chapterId) {
        if (
          !noteMatchesChapter(n, {
            roadmapId: roadmap.id,
            roadmapName: roadmap.name,
            chapterId: body.chapterId,
          })
        ) {
          return false;
        }
      } else {
        if (
          !noteBelongsToRoadmap(n, {
            roadmapId: roadmap.id,
            roadmapName: roadmap.name,
          })
        ) {
          return false;
        }
      }
      if (body.depth !== undefined && body.depth !== null) {
        return n.depth === body.depth;
      }
      return true;
    });

    const moved = await moveNotesToTrash(config.vaultPath, target);
    return c.json({ deleted: moved.length });
  });

  // ─────────────────────────────────────────────────────
  // 3d. 학습 활동 — 날짜별 노트 수 (contribution graph용)
  // ─────────────────────────────────────────────────────

  app.get("/activity", async (c) => {
    if (!config.vaultPath) {
      return c.json({ days: 365, byDate: {}, total: 0 });
    }
    const days = Math.max(
      1,
      Math.min(730, Number(c.req.query("days") ?? 365)),
    );
    const notes = await listSpiralNotes(config.vaultPath);
    const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
    const byDate: Record<string, number> = {};
    for (const n of notes) {
      if (!n.date) continue;
      // date는 "YYYY-MM-DD" 형식
      const t = Date.parse(n.date);
      if (Number.isNaN(t) || t < cutoffMs) continue;
      byDate[n.date] = (byDate[n.date] ?? 0) + 1;
    }
    // depth별 / 카테고리별 통계도 함께
    const byDepth: Record<number, number> = {};
    for (const n of notes) {
      byDepth[n.depth] = (byDepth[n.depth] ?? 0) + 1;
    }
    return c.json({
      days,
      byDate,
      byDepth,
      total: notes.length,
    });
  });

  // ─────────────────────────────────────────────────────
  // 3c. 휴지통 — 목록 + 복구
  // ─────────────────────────────────────────────────────

  app.get("/trash", async (c) => {
    if (!config.vaultPath) {
      return c.json({ error: "No vault configured" }, 400);
    }
    const entries = await listTrash(config.vaultPath);
    return c.json(entries);
  });

  app.post("/trash/restore", async (c) => {
    if (!config.vaultPath) {
      return c.json({ error: "No vault configured" }, 400);
    }
    const body = await c.req
      .json<{ fileName: string }>()
      .catch(() => null);
    if (!body?.fileName) {
      return c.json({ error: "fileName required" }, 400);
    }
    // 보안: fileName에 path traversal 차단
    if (body.fileName.includes("/") || body.fileName.includes("\\")) {
      return c.json({ error: "invalid fileName" }, 400);
    }
    try {
      const restored = await restoreFromTrash(config.vaultPath, body.fileName);
      return c.json({ restoredTo: restored });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "restore failed" },
        500,
      );
    }
  });

  // ─────────────────────────────────────────────────────
  // 4. History (전체 or 로드맵별 필터링)
  // ─────────────────────────────────────────────────────

  app.get("/history", async (c) => {
    if (!config.vaultPath) {
      return c.json({ error: "No vault configured" }, 400);
    }
    const roadmapId = c.req.query("roadmap_id");
    let notes = await listSpiralNotes(config.vaultPath);

    if (roadmapId) {
      const roadmap = await resolveRoadmap(roadmapId);
      if (roadmap) {
        notes = notes.filter((n) =>
          noteBelongsToRoadmap(n, {
            roadmapId: roadmap.id,
            roadmapName: roadmap.name,
          }),
        );
      }
    }

    return c.json(
      notes.map((n) => ({
        title: n.title,
        topic: n.topic,
        chapterId: n.chapterId,
        roadmapId: n.roadmapId,
        roadmapName: n.roadmapName,
        date: n.date,
        depth: n.depth,
        summary: n.summary,
        relativePath: n.relativePath,
        obsidianUri: obsidianUri(n.relativePath),
      })),
    );
  });

  // ─────────────────────────────────────────────────────
  // 5. Suggest (로드맵별)
  // ─────────────────────────────────────────────────────

  app.get("/suggest", async (c) => {
    if (!config.vaultPath) {
      return c.json({ error: "Missing vault" }, 400);
    }
    const roadmapId = c.req.query("roadmap_id") ?? null;
    const roadmap = await resolveRoadmap(roadmapId);
    if (!roadmap) {
      return c.json({ error: "Roadmap not found" }, 404);
    }
    const chapters = await loadRoadmapChapters(roadmap);
    const notes = await listSpiralNotes(config.vaultPath);
    const suggestion = await suggestNext(client, roadmap, chapters, notes);
    return c.json(suggestion);
  });

  // ─────────────────────────────────────────────────────
  // 6. Session lifecycle
  // ─────────────────────────────────────────────────────

  app.post("/session/start", async (c) => {
    const body = await c.req
      .json<{ chapterId: string; roadmapId?: string; model?: string }>()
      .catch(() => null);
    if (!body?.chapterId) {
      return c.json({ error: "chapterId required" }, 400);
    }
    if (!config.vaultPath) {
      return c.json({ error: "Missing vault config" }, 400);
    }

    const roadmap = await resolveRoadmap(body.roadmapId ?? null);
    if (!roadmap) {
      return c.json({ error: "Roadmap not found" }, 404);
    }

    const chapters = await loadRoadmapChapters(roadmap);
    const chapter = chapters.find((ch) => ch.id === body.chapterId);
    if (!chapter) {
      return c.json({ error: "Chapter not found in roadmap" }, 404);
    }

    const allNotes = await listSpiralNotes(config.vaultPath);
    const priorOnSame = allNotes.filter((n) =>
      noteMatchesChapter(n, {
        roadmapId: roadmap.id,
        roadmapName: roadmap.name,
        chapterId: chapter.id,
      }),
    );
    const depth = priorOnSame.length + 1;
    const related = priorOnSame.slice(0, 5);

    const session = createSession({
      chapter,
      depth,
      related,
      model: body.model,
    });

    const initialContext = buildInitialContext(chapter, related, depth);
    session.messages.push({ role: "user", content: initialContext });

    c.header("X-Session-Id", session.id);
    c.header("X-Depth", String(depth));
    c.header("X-Chapter-Title", encodeURIComponent(chapter.title));
    c.header("X-Roadmap-Id", encodeURIComponent(roadmap.id));
    c.header("X-Roadmap-Name", encodeURIComponent(roadmap.name));
    c.header("X-Related-Count", String(related.length));
    c.header("X-Model", session.model ?? config.model);

    return streamText(c, async (stream) => {
      try {
        const { text, usage } = await streamTurn(client, {
          system: SESSION_SYSTEM,
          messages: session.messages,
          model: session.model,
          onText: (chunk) => {
            stream.write(chunk).catch(() => {});
          },
        });
        session.messages.push({ role: "assistant", content: text });
        session.totalInputTokens += usage.input;
        session.totalOutputTokens += usage.output;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown";
        await stream.write(`\n\n[Error: ${msg}]`);
      }
    });
  });

  app.post("/session/:id/message", async (c) => {
    const session = getSession(c.req.param("id"));
    if (!session) return c.json({ error: "Session not found" }, 404);
    const body = await c.req.json<{ message: string }>().catch(() => null);
    if (!body?.message) return c.json({ error: "message required" }, 400);

    session.messages.push({ role: "user", content: body.message });

    return streamText(c, async (stream) => {
      try {
        const { text, usage } = await streamTurn(client, {
          system: SESSION_SYSTEM,
          messages: session.messages,
          model: session.model,
          onText: (chunk) => {
            stream.write(chunk).catch(() => {});
          },
        });
        session.messages.push({ role: "assistant", content: text });
        session.totalInputTokens += usage.input;
        session.totalOutputTokens += usage.output;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown";
        await stream.write(`\n\n[Error: ${msg}]`);
      }
    });
  });

  app.post("/session/:id/end", async (c) => {
    const session = getSession(c.req.param("id"));
    if (!session) return c.json({ error: "Session not found" }, 404);
    if (!config.vaultPath) {
      return c.json({ error: "Missing vault config" }, 400);
    }
    const vaultPath = config.vaultPath;

    // SSE로 진행 단계 전송
    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");
    c.header("X-Accel-Buffering", "no");

    return streamText(c, async (stream) => {
      function send(event: string, data: Record<string, unknown>) {
        return stream.write(
          `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
        );
      }
      try {
        await send("stage", {
          stage: "analyzing",
          label: "대화 분석 중",
          detail: `${session.messages.length} 메시지를 8섹션 구조로 정리`,
        });

        const note = await generateNote(client, {
          chapter: session.chapter,
          transcript: session.messages,
          related: session.related,
          depth: session.depth,
        });

        await send("stage", {
          stage: "writing",
          label: "노트 파일 작성",
          detail: `${note.topic} (depth ${session.depth})`,
        });

        const writtenPath = await writeNewNote(vaultPath, note);

        await send("stage", {
          stage: "saving",
          label: "Obsidian vault에 저장",
          detail: path.basename(writtenPath),
        });

        const elapsedMs = Date.now() - session.startedAt;
        const result = {
          path: writtenPath,
          relativePath: path.basename(writtenPath),
          obsidianUri: obsidianUri(writtenPath),
          elapsedMs,
          inputTokens: session.totalInputTokens,
          outputTokens: session.totalOutputTokens,
          depth: session.depth,
          topic: note.topic,
          summary: note.summary,
          tagsCount: note.tags.length,
          bodyChars: note.body.length,
          roadmapName: session.chapter.roadmapName,
          roadmapId: session.chapter.roadmapId,
        };

        deleteSession(session.id);

        await send("done", result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown";
        await send("error", { message: msg });
      }
    });
  });

  app.post("/session/:id/cancel", (c) => {
    const ok = deleteSession(c.req.param("id"));
    return c.json({ cancelled: ok });
  });

  return app;
}
