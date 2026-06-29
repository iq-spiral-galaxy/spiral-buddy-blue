import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createApi } from "../src/routes.js";
import type { Config } from "../src/config.js";
import { invalidateRoadmapCaches } from "../src/roadmap.js";
import { invalidateNotesCache } from "../src/vault.js";

// ─────────────────────────────────────────────────────────────────────────
// These tests pin the HTTP surface of createApi() — the contract the upcoming
// createApi split must preserve. We avoid any route that calls the Anthropic
// API (/lookup, /chapter-context, /suggest, /refine-prompt, /session/*,
// /chapter-preview cache-miss). Those are intentionally NOT covered here.
//
// Determinism: roadmapRoot points at a fresh tmp dir, vaultPath at a fresh
// empty tmp vault. curatedOrg defaults to null in the base config so curated
// routes return the disabled-org 400 and /roadmaps does no curated FS scan.
// ─────────────────────────────────────────────────────────────────────────

let tmpRoot: string;
let roadmapRoot: string;
let vaultPath: string;

function baseConfig(overrides: Partial<Config> = {}): Config {
  return {
    apiKey: "sk-ant-dummy-key-not-used",
    model: "claude-sonnet-4-6",
    maxTokens: 4096,
    roadmapRoot,
    pinnedRoadmapPath: null,
    curatedOrg: null,
    githubToken: null,
    vaultPath,
    vaultName: "TestVault",
    obsidianVaultRoot: null,
    ...overrides,
  };
}

before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spiral-routes-"));
  roadmapRoot = path.join(tmpRoot, "roadmaps");
  vaultPath = path.join(tmpRoot, "vault");
  await fs.mkdir(vaultPath, { recursive: true });

  // One fake roadmap with two ordered chapter files (>= MIN_CHAPTERS).
  const rm = path.join(roadmapRoot, "jvm-deep-dive");
  await fs.mkdir(rm, { recursive: true });
  await fs.writeFile(
    path.join(rm, "01-x.md"),
    "# Class Loading\n\nThe JVM loads classes lazily on first reference. This is the bootstrap phase.\n",
    "utf-8",
  );
  await fs.writeFile(
    path.join(rm, "02-y.md"),
    "# Garbage Collection\n\nGenerational GC splits the heap into young and old regions.\n",
    "utf-8",
  );
  // README.md must be ignored as a chapter.
  await fs.writeFile(path.join(rm, "README.md"), "# JVM Deep Dive\n", "utf-8");

  // Invalidate module-level TTL caches so a previous run's tmp dir state
  // (different abs paths, so unlikely, but be safe) cannot leak.
  invalidateRoadmapCaches();
  invalidateNotesCache();
});

after(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("GET /config", () => {
  test("returns the public config shape", async () => {
    const app = createApi(baseConfig());
    const res = await app.request("/config");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, {
      roadmapRoot,
      vaultPath,
      vaultName: "TestVault",
      model: "claude-sonnet-4-6",
      curatedOrg: null,
    });
  });

  test("does NOT leak the apiKey or other secrets", async () => {
    const app = createApi(baseConfig({ githubToken: "ghp_secret" }));
    const res = await app.request("/config");
    const body = await res.json();
    assert.equal("apiKey" in body, false);
    assert.equal("githubToken" in body, false);
    assert.equal("maxTokens" in body, false);
  });

  test("reflects curatedOrg when enabled", async () => {
    const app = createApi(baseConfig({ curatedOrg: "iq-dev-lab" }));
    const res = await app.request("/config");
    const body = await res.json();
    assert.equal(body.curatedOrg, "iq-dev-lab");
  });
});

describe("GET /models", () => {
  test("returns default + a non-empty model list with stable ids", async () => {
    const app = createApi(baseConfig({ model: "claude-opus-4-7" }));
    const res = await app.request("/models");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.default, "claude-opus-4-7"); // mirrors config.model
    assert.ok(Array.isArray(body.models));
    assert.ok(body.models.length >= 1);
    for (const m of body.models) {
      assert.equal(typeof m.id, "string");
      assert.equal(typeof m.label, "string");
      assert.equal(typeof m.tier, "string");
      assert.equal(typeof m.description, "string");
    }
    const ids = body.models.map((m: { id: string }) => m.id);
    assert.ok(ids.includes("claude-sonnet-4-6"));
    assert.ok(ids.includes("claude-haiku-4-5"));
  });
});

describe("GET /roadmaps", () => {
  test("returns an array with the enriched per-roadmap shape", async () => {
    const app = createApi(baseConfig());
    const res = await app.request("/roadmaps");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 1);

    const r = body[0];
    assert.equal(r.id, "jvm-deep-dive");
    assert.equal(r.name, "jvm-deep-dive");
    assert.equal(r.source, "local");
    assert.equal(r.chapterCount, 2); // README excluded
    assert.equal(r.visitedChapters, 0); // empty vault
    assert.equal(r.totalNotes, 0);
    assert.equal(r.maxDepth, 0);
    assert.deepEqual(r.depths, []);
    assert.equal(r.lastDate, null);
    // PINNED BEHAVIOR (subtle): even with curatedOrg=null, enrichRoadmap calls
    // categorizeLocalRoadmap(null, id) which NEVER returns null — a single-segment
    // local id falls through to the UNCATEGORIZED default ("Topics"). So `category`
    // is populated. `domain` stays null (gated on config.curatedOrg). `hierarchy`
    // is set because the category branch runs (repos:[] => not flat => 1-seg else).
    assert.deepEqual(r.category, {
      name: "Topics",
      emoji: "🗂",
      color: "#9ca3af",
    });
    assert.equal(r.domain, null);
    assert.deepEqual(r.hierarchy, { repo: "jvm-deep-dive", sub: null });
  });

  test("every roadmap object exposes id/name/chapterCount/visitedChapters", async () => {
    const app = createApi(baseConfig());
    const res = await app.request("/roadmaps");
    const body = await res.json();
    for (const r of body) {
      assert.equal(typeof r.id, "string");
      assert.equal(typeof r.name, "string");
      assert.equal(typeof r.chapterCount, "number");
      assert.equal(typeof r.visitedChapters, "number");
    }
  });

  test("empty roadmapRoot dir yields an empty array (still 200, not the 400 guard)", async () => {
    const emptyRoot = path.join(tmpRoot, "empty-root");
    await fs.mkdir(emptyRoot, { recursive: true });
    invalidateRoadmapCaches();
    const app = createApi(baseConfig({ roadmapRoot: emptyRoot }));
    const res = await app.request("/roadmaps");
    // roadmapRoot is set (truthy), so the 400 guard (no root + no org) does
    // not fire even though there are zero roadmaps.
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, []);
    invalidateRoadmapCaches();
  });

  test("400 when neither roadmapRoot nor curatedOrg configured", async () => {
    const app = createApi(baseConfig({ roadmapRoot: null, curatedOrg: null }));
    const res = await app.request("/roadmaps");
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(typeof body.error, "string");
  });
});

describe("GET /chapters", () => {
  test("returns ordered chapters with the per-chapter shape", async () => {
    const app = createApi(baseConfig());
    const res = await app.request("/chapters?roadmap_id=jvm-deep-dive");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.roadmapId, "jvm-deep-dive");
    assert.equal(body.roadmapName, "jvm-deep-dive");
    assert.ok(Array.isArray(body.chapters));
    assert.equal(body.chapters.length, 2);

    const [a, b] = body.chapters;
    // natural sort keeps 01-x before 02-y; order is the array index
    assert.equal(a.id, "01-x.md");
    assert.equal(a.order, 0);
    assert.equal(a.title, "Class Loading"); // from first H1
    assert.equal(b.id, "02-y.md");
    assert.equal(b.order, 1);
    assert.equal(b.title, "Garbage Collection");

    // per-chapter note-derived fields on empty vault
    assert.equal(a.visitCount, 0);
    assert.equal(a.maxDepth, 0);
    assert.deepEqual(a.depths, []);
    assert.deepEqual(a.noteLinks, []);
    assert.equal(a.lastDate, null);
    assert.equal(a.aiCardReady, false);
    assert.equal(typeof a.preview, "string");
    assert.ok(a.preview.length > 0);
  });

  test("404 for unknown roadmap_id", async () => {
    const app = createApi(baseConfig());
    const res = await app.request("/chapters?roadmap_id=does-not-exist");
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, "Roadmap not found");
  });

  test("missing roadmap_id resolves to the first (default) roadmap", async () => {
    const app = createApi(baseConfig());
    const res = await app.request("/chapters");
    // resolveRoadmap(null) returns the first installed roadmap
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.roadmapId, "jvm-deep-dive");
  });
});

describe("GET /search", () => {
  test("short query (<2 chars) returns empty buckets without scanning", async () => {
    const app = createApi(baseConfig());
    const res = await app.request("/search?q=a");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { roadmaps: [], chapters: [], notes: [] });
  });

  test("missing q param treated as empty -> empty buckets", async () => {
    const app = createApi(baseConfig());
    const res = await app.request("/search");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { roadmaps: [], chapters: [], notes: [] });
  });

  test("matches roadmap by name and surfaces its chapters", async () => {
    const app = createApi(baseConfig());
    const res = await app.request("/search?q=jvm");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.roadmaps.length, 1);
    assert.equal(body.roadmaps[0].id, "jvm-deep-dive");
    assert.equal(body.roadmaps[0].name, "jvm-deep-dive");
    assert.equal(body.roadmaps[0].path, "jvm-deep-dive");
    assert.equal(body.roadmaps[0].source, "local");
    assert.deepEqual(body.notes, []); // empty vault
  });

  test("matches chapter by title within a matched roadmap", async () => {
    const app = createApi(baseConfig());
    // "garbage" only appears in chapter 02 title, not the roadmap name —
    // but the roadmap is reached via... actually the roadmap won't match
    // "garbage". So chapter search only runs over candidate roadmaps
    // (matched roadmaps + roadmaps with matching notes). With no name match
    // and no notes, there are zero candidate roadmaps -> no chapter hits.
    const res = await app.request("/search?q=garbage");
    const body = await res.json();
    assert.deepEqual(body.roadmaps, []);
    assert.deepEqual(body.chapters, []);
  });

  test("query matching both roadmap name and a chapter id yields chapter hits", async () => {
    const app = createApi(baseConfig());
    // "deep" matches roadmap name "jvm-deep-dive" -> roadmap becomes a
    // candidate -> its chapters are scanned. Chapter ids/titles don't
    // contain "deep", so chapters stays empty, but roadmap matches.
    const res = await app.request("/search?q=deep");
    const body = await res.json();
    assert.equal(body.roadmaps.length, 1);
    assert.equal(body.roadmaps[0].id, "jvm-deep-dive");
  });
});

describe("GET /trash", () => {
  test("400 when no vault configured", async () => {
    const app = createApi(baseConfig({ vaultPath: null }));
    const res = await app.request("/trash");
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "No vault configured");
  });

  test("empty array when vault has no trash dir", async () => {
    const app = createApi(baseConfig());
    const res = await app.request("/trash");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, []);
  });
});

describe("GET /history", () => {
  test("400 when no vault configured", async () => {
    const app = createApi(baseConfig({ vaultPath: null }));
    const res = await app.request("/history");
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "No vault configured");
  });

  test("empty array on a fresh vault", async () => {
    const app = createApi(baseConfig());
    const res = await app.request("/history");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, []);
  });

  test("UNKNOWN roadmap_id filters out everything (no full-vault leak)", async () => {
    // v0.5.114 fix: 미지 roadmap_id로 필터 요청 시 빈 결과여야 함.
    // (옛 버전은 resolveRoadmap null → 필터 스킵 → 전체 노트 누출.)
    // 공유 vault 오염 방지를 위해 이 테스트만의 임시 vault 사용.
    const { writeNewNote } = await import("../src/vault.js");
    const v = await fs.mkdtemp(path.join(os.tmpdir(), "spiral-hist-"));
    try {
      await writeNewNote(v, {
        topic: "Chapter One",
        chapterId: "01-x.md",
        roadmapId: "jvm-deep-dive/foo",
        roadmapName: "foo",
        repo: "jvm-deep-dive",
        roadmap: "foo",
        depth: 1,
        tags: [],
        summary: "",
        body: "b",
        relatedNotePaths: [],
      });
      const app = createApi(baseConfig({ vaultPath: v }));
      const all = await (await app.request("/history")).json();
      assert.equal(all.length, 1); // 필터 없으면 노트가 보임
      const res = await app.request("/history?roadmap_id=nope");
      assert.equal(res.status, 200);
      const filtered = await res.json();
      assert.deepEqual(filtered, []); // 미지 id → 빈 결과 (노트 누출 X)
    } finally {
      await fs.rm(v, { recursive: true, force: true });
    }
  });
});

describe("GET /activity", () => {
  test("empty vault: zeros and a clamped days value", async () => {
    const app = createApi(baseConfig());
    const res = await app.request("/activity");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.days, 365); // default
    assert.deepEqual(body.byDate, {});
    assert.equal(body.total, 0);
  });

  test("days param is clamped to [1, 730]", async () => {
    const app = createApi(baseConfig());
    const tooBig = await (await app.request("/activity?days=9999")).json();
    assert.equal(tooBig.days, 730);
    const tooSmall = await (await app.request("/activity?days=0")).json();
    assert.equal(tooSmall.days, 1);
  });

  test("no-vault config returns the default activity stub (200)", async () => {
    const app = createApi(baseConfig({ vaultPath: null }));
    const res = await app.request("/activity");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.days, 365);
    assert.equal(body.total, 0);
  });
});

describe("POST /curated/install — body & org guards (no network)", () => {
  test("400 'curated source disabled' when curatedOrg is null", async () => {
    const app = createApi(baseConfig({ curatedOrg: null }));
    const res = await app.request("/curated/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo_name: "anything" }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "curated source disabled");
  });

  test("400 'repo_name required' when org enabled but body empty", async () => {
    const app = createApi(baseConfig({ curatedOrg: "iq-dev-lab" }));
    const res = await app.request("/curated/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "repo_name required");
  });

  test("400 'repo_name required' when org enabled but body is invalid JSON", async () => {
    const app = createApi(baseConfig({ curatedOrg: "iq-dev-lab" }));
    const res = await app.request("/curated/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json{",
    });
    // body parse fails -> null -> repo_name guard fires (still before network)
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "repo_name required");
  });

  test("disabled-org guard fires before repo_name guard (empty body, org null)", async () => {
    const app = createApi(baseConfig({ curatedOrg: null }));
    const res = await app.request("/curated/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "curated source disabled");
  });
});

describe("GET /curated/available — disabled-org guard", () => {
  test("400 when curatedOrg null", async () => {
    const app = createApi(baseConfig({ curatedOrg: null }));
    const res = await app.request("/curated/available");
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "curated source disabled");
  });
});

describe("unknown route", () => {
  test("404 for an undefined path", async () => {
    const app = createApi(baseConfig());
    const res = await app.request("/totally-not-a-route");
    assert.equal(res.status, 404);
  });
});
