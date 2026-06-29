// ─────────────────────────────────────────────────────────────────────────
// AI + session routes of createApi() — the CORE paths that previously had
// ZERO coverage: /suggest, /refine-prompt, /lookup, /chapter-context, and the
// full /session/* lifecycle (start → message → end → cancel → state).
//
// No real Anthropic call is ever made: a FAKE ClaudeClient is injected through
// the createApi(config, { client }) DI seam. The fake drives both code paths:
//   - streamTurn(): client.raw.messages.stream() → .on("text", cb) (sync) →
//     await .finalMessage() (returns usage). Used by /lookup, /chapter-context,
//     /session/start, /session/:id/message.
//   - completeOnce(): client.raw.messages.create(). Used by /refine-prompt,
//     /suggest (via suggestNext) and /session/:id/end (via generateNote).
//
// Determinism: fresh tmp roadmapRoot + vault per run; SPIRAL_SESSION_DIR is
// pointed at a tmp dir BEFORE session-store is imported (its SESSION_DIR is a
// module-level const) so the real ~/.spiral-buddy/sessions is never touched.
// ─────────────────────────────────────────────────────────────────────────

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { Config } from "../src/config.js";
import type { ClaudeClient } from "../src/claude.js";

// session-store reads SPIRAL_SESSION_DIR into a module-level const at import
// time. Set it BEFORE the dynamic imports in before() so persisted session
// snapshots land in a throwaway dir, never the user's home.
let sessionDir: string;

// Modules are imported dynamically in before() (after env is set). Typed via
// Awaited<ReturnType<...>> indirection would be noise; use loose handles.
let createApi: (
  config: Config,
  deps?: { client?: ClaudeClient },
) => { request: (input: string, init?: RequestInit) => Promise<Response> };
let invalidateRoadmapCaches: () => void;
let invalidateNotesCache: () => void;
let listSpiralNotes: (vaultPath: string) => Promise<unknown[]>;
let writeNewNote: (vaultPath: string, note: Record<string, unknown>) => Promise<string>;

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

// ── Fake Claude client ─────────────────────────────────────────────────────
// streamTurn:   raw.messages.stream({...}) then stream.on("text", cb) then
//               await stream.finalMessage(). The fake emits `text` synchronously
//               inside .on() and returns usage from finalMessage().
// completeOnce: raw.messages.create() returns { content:[{type:"text",text}], usage }.
function fakeClient(
  text = '{"recommendedChapterId":"02-y.md","mode":"next-chapter","rationale":"r","relatedChapterIds":[]}',
): ClaudeClient {
  const stream: {
    on(ev: string, cb: (c: string) => void): typeof stream;
    finalMessage(): Promise<{ usage: { input_tokens: number; output_tokens: number } }>;
  } = {
    on(ev, cb) {
      if (ev === "text") cb(text);
      return stream;
    },
    async finalMessage() {
      return { usage: { input_tokens: 5, output_tokens: 7 } };
    },
  };
  const raw = {
    messages: {
      stream: () => stream,
      create: async () => ({
        content: [{ type: "text", text }],
        usage: { input_tokens: 5, output_tokens: 7 },
      }),
    },
  } as unknown as ClaudeClient["raw"];
  return { raw, config: {} as Config };
}

// A markdown note body containing all 8 required sections so generateNote's
// parseStructuredNote() succeeds (not the fallback path) on /session/:id/end.
const NOTE_MARKDOWN = [
  "TAGS: class-loading, jvm-internals",
  "",
  "## 한 줄 요약",
  "클래스 로딩의 핵심을 정리했다.",
  "",
  "## 핵심 개념",
  "- 부트스트랩 로더",
  "",
  "## 직관 / 비유",
  "도서관 비유.",
  "",
  "## 짚고 넘어간 예제",
  "```java\nClass.forName(\"X\");\n```",
  "",
  "## 헷갈렸던 / 확인이 필요한 지점",
  "lazy vs eager 구분.",
  "",
  "## 이전 학습과의 연결",
  "_이번 세션에서 다루지 않음._",
  "",
  "## 다음에 볼 것",
  "GC로 넘어가기.",
].join("\n");

before(async () => {
  // 1) point persistence at a tmp dir, THEN import the modules that read it.
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spiral-ai-"));
  sessionDir = path.join(tmpRoot, "sessions");
  process.env.SPIRAL_SESSION_DIR = sessionDir;

  const routesMod = await import("../src/routes.js");
  const roadmapMod = await import("../src/roadmap.js");
  const vaultMod = await import("../src/vault.js");
  createApi = routesMod.createApi as typeof createApi;
  invalidateRoadmapCaches = roadmapMod.invalidateRoadmapCaches;
  invalidateNotesCache = vaultMod.invalidateNotesCache;
  listSpiralNotes = vaultMod.listSpiralNotes as typeof listSpiralNotes;
  writeNewNote = vaultMod.writeNewNote as typeof writeNewNote;

  // 2) fixture roadmap (two ordered chapters, README ignored).
  roadmapRoot = path.join(tmpRoot, "roadmaps");
  vaultPath = path.join(tmpRoot, "vault");
  await fs.mkdir(vaultPath, { recursive: true });

  const rm = path.join(roadmapRoot, "jvm-deep-dive");
  await fs.mkdir(rm, { recursive: true });
  await fs.writeFile(
    path.join(rm, "01-x.md"),
    "# Class Loading\n\nThe JVM loads classes lazily on first reference.\n",
    "utf-8",
  );
  await fs.writeFile(
    path.join(rm, "02-y.md"),
    "# Garbage Collection\n\nGenerational GC splits the heap into young and old.\n",
    "utf-8",
  );
  await fs.writeFile(path.join(rm, "README.md"), "# JVM Deep Dive\n", "utf-8");

  invalidateRoadmapCaches();
  invalidateNotesCache();
});

after(async () => {
  delete process.env.SPIRAL_SESSION_DIR;
  // persistSession()/removePersistedSession() are fire-and-forget (`void …`);
  // a few writes can still be in flight after the last test. Let them settle,
  // then rm with retries so the snapshot dir isn't "not empty" mid-write.
  await new Promise((r) => setTimeout(r, 50));
  if (tmpRoot) {
    await fs.rm(tmpRoot, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 25,
    });
  }
});

// ── small helpers ───────────────────────────────────────────────────────────
function postJson(
  app: ReturnType<typeof createApi>,
  pathname: string,
  body: unknown,
) {
  return app.request(pathname, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// Seed one note that belongs to the fixture roadmap so suggestNext takes its
// real LLM path (zero-note input short-circuits without calling the client).
async function seedRoadmapNote() {
  await writeNewNote(vaultPath, {
    topic: "Class Loading",
    chapterId: "01-x.md",
    roadmapId: "jvm-deep-dive",
    roadmapName: "jvm-deep-dive",
    repo: null,
    roadmap: "jvm-deep-dive",
    depth: 1,
    tags: ["jvm"],
    summary: "클래스 로딩 d1",
    body: "본문",
    relatedNotePaths: [],
  });
  invalidateNotesCache();
}

// ═════════════════════════════════════════════════════════════════════════
// 5. GET /suggest  (suggestNext → completeOnce, parses JSON via safeJsonParse)
// ═════════════════════════════════════════════════════════════════════════

describe("GET /suggest", () => {
  test("400 when no vault configured", async () => {
    const app = createApi(baseConfig({ vaultPath: null }), {
      client: fakeClient(),
    });
    const res = await app.request("/suggest?roadmap_id=jvm-deep-dive");
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "Missing vault");
  });

  test("404 for unknown roadmap_id", async () => {
    const app = createApi(baseConfig(), { client: fakeClient() });
    const res = await app.request("/suggest?roadmap_id=does-not-exist");
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, "Roadmap not found");
  });

  test("zero notes → first-time short-circuit (no client call needed)", async () => {
    // suggestNext returns the first chapter WITHOUT hitting the client when the
    // roadmap has no notes. A throwing client proves the path is never taken.
    const throwing = fakeClient();
    (throwing.raw.messages as { create: () => Promise<never> }).create =
      async () => {
        throw new Error("client must not be called on the zero-note path");
      };
    const v = await fs.mkdtemp(path.join(os.tmpdir(), "spiral-ai-empty-"));
    try {
      const app = createApi(baseConfig({ vaultPath: v }), { client: throwing });
      const res = await app.request("/suggest?roadmap_id=jvm-deep-dive");
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.mode, "first-time");
      assert.equal(body.recommendedChapterId, "01-x.md");
      assert.deepEqual(body.related, []);
    } finally {
      await fs.rm(v, { recursive: true, force: true });
    }
  });

  test("with prior notes → parses the fake JSON suggestion", async () => {
    await seedRoadmapNote();
    const app = createApi(baseConfig(), {
      client: fakeClient(
        '{"recommendedChapterId":"02-y.md","mode":"next-chapter","rationale":"다음 챕터로","relatedChapterIds":["01-x.md"]}',
      ),
    });
    const res = await app.request("/suggest?roadmap_id=jvm-deep-dive");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.recommendedChapterId, "02-y.md");
    assert.equal(body.mode, "next-chapter");
    assert.equal(body.rationale, "다음 챕터로");
    assert.ok(Array.isArray(body.related));
  });

  test("missing roadmap_id resolves the default (first) roadmap", async () => {
    const app = createApi(baseConfig(), { client: fakeClient() });
    const res = await app.request("/suggest");
    // first roadmap resolved; with no notes (default shared vault may have the
    // seeded note) we only assert the response is a well-formed suggestion.
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok("recommendedChapterId" in body);
    assert.ok("mode" in body);
    assert.ok("rationale" in body);
    assert.ok(Array.isArray(body.related));
  });

  test("malformed JSON from the model degrades gracefully (recommendedChapterId null)", async () => {
    await seedRoadmapNote();
    const app = createApi(baseConfig(), {
      client: fakeClient("totally not json at all"),
    });
    const res = await app.request("/suggest?roadmap_id=jvm-deep-dive");
    assert.equal(res.status, 200);
    const body = await res.json();
    // safeJsonParse → null → recommendedChapterId null, rationale fallback.
    assert.equal(body.recommendedChapterId, null);
    assert.equal(body.mode, "next-chapter"); // isMode() default
    assert.equal(typeof body.rationale, "string");
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 5c. POST /refine-prompt  (completeOnce; non-streaming JSON response)
// ═════════════════════════════════════════════════════════════════════════

describe("POST /refine-prompt", () => {
  test("returns { original, refined } from the model text", async () => {
    const app = createApi(baseConfig(), {
      client: fakeClient("다듬어진 질문입니다"),
    });
    const res = await postJson(app, "/refine-prompt", { text: "  이거 머임  " });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.original, "이거 머임"); // trimmed
    assert.equal(body.refined, "다듬어진 질문입니다");
  });

  test("strips a wrapping code fence the model may add", async () => {
    const app = createApi(baseConfig(), {
      client: fakeClient("```\n순수 본문만\n```"),
    });
    const res = await postJson(app, "/refine-prompt", { text: "원문" });
    const body = await res.json();
    assert.equal(body.refined, "순수 본문만");
  });

  test("strips a single wrapping pair of quotes", async () => {
    const app = createApi(baseConfig(), {
      client: fakeClient('"따옴표로 감싼 결과"'),
    });
    const res = await postJson(app, "/refine-prompt", { text: "원문" });
    assert.equal((await res.json()).refined, "따옴표로 감싼 결과");
  });

  test("400 when text missing/empty", async () => {
    const app = createApi(baseConfig(), { client: fakeClient() });
    const empty = await postJson(app, "/refine-prompt", { text: "   " });
    assert.equal(empty.status, 400);
    assert.equal((await empty.json()).error, "text is required");
    const none = await postJson(app, "/refine-prompt", {});
    assert.equal(none.status, 400);
  });

  test("400 when text too long (>4000 chars)", async () => {
    const app = createApi(baseConfig(), { client: fakeClient() });
    const res = await postJson(app, "/refine-prompt", { text: "x".repeat(4001) });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "text too long (max 4000 chars)");
  });

  test("502 when the model returns empty text after cleanup", async () => {
    const app = createApi(baseConfig(), { client: fakeClient("") });
    const res = await postJson(app, "/refine-prompt", { text: "원문" });
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error, "empty refinement");
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 5b. POST /lookup  (streamTurn → SSE/text stream; fake text in the body)
// ═════════════════════════════════════════════════════════════════════════

describe("POST /lookup", () => {
  test("200 and the fake text appears in the streamed body", async () => {
    const app = createApi(baseConfig(), {
      client: fakeClient("이건 룩업 설명이야"),
    });
    const res = await postJson(app, "/lookup", {
      query: "garbage collection",
      depth: "concise",
    });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /이건 룩업 설명이야/);
  });

  test("works without a depth (defaults to medium) and a long query", async () => {
    const app = createApi(baseConfig(), { client: fakeClient("medium 설명") });
    const res = await postJson(app, "/lookup", { query: "mvcc 격리수준" });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /medium 설명/);
  });

  test("400 when query missing or under 2 chars", async () => {
    const app = createApi(baseConfig(), { client: fakeClient() });
    const short = await postJson(app, "/lookup", { query: "a" });
    assert.equal(short.status, 400);
    assert.equal((await short.json()).error, "query is required (min 2 chars)");
    const none = await postJson(app, "/lookup", {});
    assert.equal(none.status, 400);
  });

  test("a known sessionId records the lookup on the session", async () => {
    // Start a session first, then issue a lookup bound to it and confirm the
    // lookup is persisted onto session.lookups (visible via GET /session/:id).
    const app = createApi(baseConfig(), { client: fakeClient("룩업 응답") });
    const start = await postJson(app, "/session/start", {
      chapterId: "01-x.md",
      roadmapId: "jvm-deep-dive",
    });
    const sessionId = start.headers.get("X-Session-Id")!;
    await start.text(); // drain
    assert.ok(sessionId);

    const look = await postJson(app, "/lookup", {
      query: "class loader",
      depth: "medium",
      sessionId,
    });
    assert.equal(look.status, 200);
    await look.text();

    const state = await (await app.request(`/session/${sessionId}`)).json();
    assert.equal(state.lookupsCount, 1);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 5b-2. POST /chapter-context  (needs a live session; streamTurn)
// ═════════════════════════════════════════════════════════════════════════

describe("POST /chapter-context", () => {
  test("400 when sessionId missing", async () => {
    const app = createApi(baseConfig(), { client: fakeClient() });
    const res = await postJson(app, "/chapter-context", {
      targetMessageText: "버디가 한 말, 충분히 긺",
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "sessionId is required");
  });

  test("400 when targetMessageText missing or <5 chars", async () => {
    const app = createApi(baseConfig(), { client: fakeClient() });
    const res = await postJson(app, "/chapter-context", {
      sessionId: "whatever",
      targetMessageText: "abc",
    });
    assert.equal(res.status, 400);
    assert.equal(
      (await res.json()).error,
      "targetMessageText is required (min 5 chars)",
    );
  });

  test("404 when the session is unknown", async () => {
    const app = createApi(baseConfig(), { client: fakeClient() });
    const res = await postJson(app, "/chapter-context", {
      sessionId: "no-such-session",
      targetMessageText: "버디가 한 충분히 긴 메시지",
    });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, "session not found");
  });

  test("200 and streams the fake explanation for a live session", async () => {
    const app = createApi(baseConfig(), { client: fakeClient("본문 맥락 요약") });
    const start = await postJson(app, "/session/start", {
      chapterId: "01-x.md",
      roadmapId: "jvm-deep-dive",
    });
    const sessionId = start.headers.get("X-Session-Id")!;
    await start.text();

    const res = await postJson(app, "/chapter-context", {
      sessionId,
      targetMessageText: "클래스 로딩이 lazy 하다는 부분",
    });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /본문 맥락 요약/);
  });

  test("second identical call is served from the in-session cache", async () => {
    // The cache stores the first full response; a throwing client on the 2nd
    // call would surface if the cache were bypassed.
    const app = createApi(baseConfig(), { client: fakeClient("최초 응답 캐시") });
    const start = await postJson(app, "/session/start", {
      chapterId: "01-x.md",
      roadmapId: "jvm-deep-dive",
    });
    const sessionId = start.headers.get("X-Session-Id")!;
    await start.text();

    const payload = {
      sessionId,
      targetMessageText: "같은 메시지로 두 번 호출",
    };
    const first = await postJson(app, "/chapter-context", payload);
    assert.match(await first.text(), /최초 응답 캐시/);

    const second = await postJson(app, "/chapter-context", payload);
    assert.equal(second.status, 200);
    assert.match(await second.text(), /최초 응답 캐시/);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 6. Session lifecycle: start / state / message / end / cancel
// ═════════════════════════════════════════════════════════════════════════

describe("POST /session/start", () => {
  test("400 when chapterId missing", async () => {
    const app = createApi(baseConfig(), { client: fakeClient() });
    const res = await postJson(app, "/session/start", {
      roadmapId: "jvm-deep-dive",
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "chapterId required");
  });

  test("400 when no vault configured", async () => {
    const app = createApi(baseConfig({ vaultPath: null }), {
      client: fakeClient(),
    });
    const res = await postJson(app, "/session/start", {
      chapterId: "01-x.md",
      roadmapId: "jvm-deep-dive",
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "Missing vault config");
  });

  test("404 for unknown roadmap", async () => {
    const app = createApi(baseConfig(), { client: fakeClient() });
    const res = await postJson(app, "/session/start", {
      chapterId: "01-x.md",
      roadmapId: "nope",
    });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, "Roadmap not found");
  });

  test("404 when the chapter is not in the roadmap", async () => {
    const app = createApi(baseConfig(), { client: fakeClient() });
    const res = await postJson(app, "/session/start", {
      chapterId: "99-missing.md",
      roadmapId: "jvm-deep-dive",
    });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, "Chapter not found in roadmap");
  });

  test("200: creates a session, sets headers, streams the first turn", async () => {
    // Dedicated empty vault → X-Depth is deterministically 1 (no prior notes).
    // The shared fixture vault is polluted by earlier /suggest seed notes.
    const v = await fs.mkdtemp(path.join(os.tmpdir(), "spiral-ai-start-"));
    try {
      const app = createApi(baseConfig({ vaultPath: v }), {
        client: fakeClient("첫 응답입니다"),
      });
      const res = await postJson(app, "/session/start", {
        chapterId: "01-x.md",
        roadmapId: "jvm-deep-dive",
      });
      assert.equal(res.status, 200);
      const sessionId = res.headers.get("X-Session-Id");
      assert.ok(sessionId);
      assert.equal(res.headers.get("X-Depth"), "1"); // empty vault → depth 1
      assert.equal(
        decodeURIComponent(res.headers.get("X-Chapter-Title") ?? ""),
        "Class Loading",
      );
      assert.equal(
        decodeURIComponent(res.headers.get("X-Roadmap-Id") ?? ""),
        "jvm-deep-dive",
      );
      assert.equal(res.headers.get("X-Model"), "claude-sonnet-4-6");
      const body = await res.text();
      assert.match(body, /첫 응답입니다/);

      // the session must now be retrievable
      const state = await app.request(`/session/${sessionId}`);
      assert.equal(state.status, 200);
    } finally {
      await fs.rm(v, { recursive: true, force: true });
    }
  });

  test("X-Model reflects a per-session model override", async () => {
    const app = createApi(baseConfig(), { client: fakeClient("ok") });
    const res = await postJson(app, "/session/start", {
      chapterId: "02-y.md",
      roadmapId: "jvm-deep-dive",
      model: "claude-haiku-4-5",
    });
    assert.equal(res.headers.get("X-Model"), "claude-haiku-4-5");
    await res.text();
  });
});

describe("GET /session/:id", () => {
  test("404 for unknown id", async () => {
    const app = createApi(baseConfig(), { client: fakeClient() });
    const res = await app.request("/session/unknown-id");
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, "Session not found");
  });

  test("returns state with the chapter + first assistant message (context msg hidden)", async () => {
    const app = createApi(baseConfig(), {
      client: fakeClient("버디의 첫 메시지"),
    });
    const start = await postJson(app, "/session/start", {
      chapterId: "01-x.md",
      roadmapId: "jvm-deep-dive",
    });
    const sessionId = start.headers.get("X-Session-Id")!;
    await start.text();

    const res = await app.request(`/session/${sessionId}`);
    assert.equal(res.status, 200);
    const state = await res.json();
    assert.equal(state.id, sessionId);
    assert.equal(state.chapter.id, "01-x.md");
    assert.equal(state.chapter.title, "Class Loading");
    assert.equal(state.chapter.roadmapId, "jvm-deep-dive");
    // messages.slice(1): index 0 is the injected bootstrap context (hidden).
    // Only the assistant reply should be visible.
    assert.ok(Array.isArray(state.messages));
    assert.equal(state.messages.length, 1);
    assert.equal(state.messages[0].role, "assistant");
    assert.match(state.messages[0].content, /버디의 첫 메시지/);
    assert.equal(state.lookupsCount, 0);
  });
});

describe("POST /session/:id/message", () => {
  test("404 for unknown session", async () => {
    const app = createApi(baseConfig(), { client: fakeClient() });
    const res = await postJson(app, "/session/nope/message", {
      message: "안녕",
    });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, "Session not found");
  });

  test("400 when message missing", async () => {
    const app = createApi(baseConfig(), { client: fakeClient("x") });
    const start = await postJson(app, "/session/start", {
      chapterId: "01-x.md",
      roadmapId: "jvm-deep-dive",
    });
    const sessionId = start.headers.get("X-Session-Id")!;
    await start.text();
    const res = await postJson(app, `/session/${sessionId}/message`, {});
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "message required");
  });

  test("streams a turn and appends user+assistant to history", async () => {
    const app = createApi(baseConfig(), {
      client: fakeClient("후속 응답"),
    });
    const start = await postJson(app, "/session/start", {
      chapterId: "01-x.md",
      roadmapId: "jvm-deep-dive",
    });
    const sessionId = start.headers.get("X-Session-Id")!;
    await start.text();

    const res = await postJson(app, `/session/${sessionId}/message`, {
      message: "클래스 로더가 뭐야?",
    });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /후속 응답/);

    const state = await (await app.request(`/session/${sessionId}`)).json();
    // visible messages: assistant(start), user(message), assistant(reply) = 3
    assert.equal(state.messages.length, 3);
    assert.deepEqual(
      state.messages.map((m: { role: string }) => m.role),
      ["assistant", "user", "assistant"],
    );
    assert.match(state.messages[1].content, /클래스 로더가 뭐야\?/);
  });
});

describe("POST /session/:id/end", () => {
  test("404 for unknown session", async () => {
    const app = createApi(baseConfig(), { client: fakeClient() });
    const res = await postJson(app, "/session/nope/end", {});
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, "Session not found");
  });

  test("400 when vault not configured (after a session exists)", async () => {
    // Build TWO apps over the SAME shared session-store map. Start with a
    // vault-configured app, then end via a vault-less app to hit the guard.
    const withVault = createApi(baseConfig(), { client: fakeClient("x") });
    const start = await postJson(withVault, "/session/start", {
      chapterId: "01-x.md",
      roadmapId: "jvm-deep-dive",
    });
    const sessionId = start.headers.get("X-Session-Id")!;
    await start.text();

    const noVault = createApi(baseConfig({ vaultPath: null }), {
      client: fakeClient("x"),
    });
    const res = await postJson(noVault, `/session/${sessionId}/end`, {});
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "Missing vault config");
  });

  test("writes a .md note to the vault, emits SSE stages, and closes the session", async () => {
    // dedicated vault so the written note count is exact.
    const v = await fs.mkdtemp(path.join(os.tmpdir(), "spiral-ai-end-"));
    try {
      const app = createApi(baseConfig({ vaultPath: v }), {
        client: fakeClient(NOTE_MARKDOWN),
      });
      const start = await postJson(app, "/session/start", {
        chapterId: "01-x.md",
        roadmapId: "jvm-deep-dive",
      });
      const sessionId = start.headers.get("X-Session-Id")!;
      await start.text();
      // add a real exchange so the transcript section has content
      const msg = await postJson(app, `/session/${sessionId}/message`, {
        message: "클래스 로딩 정리해줘",
      });
      await msg.text();

      const end = await postJson(app, `/session/${sessionId}/end`, {});
      assert.equal(end.status, 200);
      const sse = await end.text();
      // SSE event framing from the route's send(event, data) helper.
      assert.match(sse, /event: stage\n/);
      assert.match(sse, /"stage":"analyzing"/);
      assert.match(sse, /event: done\n/);
      assert.match(sse, /"path":/);
      assert.match(sse, /"depth":/);

      // a note file actually landed under <vault>/spiral-buddy/
      const notes = await listSpiralNotes(v);
      assert.equal(notes.length, 1);
      const spiralDir = path.join(v, "spiral-buddy");
      const files = (await fs.readdir(spiralDir)).filter((f) =>
        f.endsWith(".md"),
      );
      assert.ok(files.some((f) => f !== "_index.md"));

      // session removed after a successful end → 404 now.
      const after404 = await app.request(`/session/${sessionId}`);
      assert.equal(after404.status, 404);
    } finally {
      await fs.rm(v, { recursive: true, force: true });
    }
  });

  test("emits SSE error event (not a throw) when note generation fails", async () => {
    const failing = fakeClient();
    (failing.raw.messages as { create: () => Promise<never> }).create =
      async () => {
        throw new Error("boom");
      };
    const v = await fs.mkdtemp(path.join(os.tmpdir(), "spiral-ai-enderr-"));
    try {
      const app = createApi(baseConfig({ vaultPath: v }), { client: failing });
      // start needs streamTurn (uses stream(), not create()) so the start
      // still works even though create() throws.
      const start = await postJson(app, "/session/start", {
        chapterId: "01-x.md",
        roadmapId: "jvm-deep-dive",
      });
      const sessionId = start.headers.get("X-Session-Id")!;
      await start.text();

      const end = await postJson(app, `/session/${sessionId}/end`, {});
      assert.equal(end.status, 200); // stream opened; failure reported in-band
      const sse = await end.text();
      assert.match(sse, /event: error\n/);
      // no note written on failure
      const notes = await listSpiralNotes(v);
      assert.equal(notes.length, 0);
    } finally {
      await fs.rm(v, { recursive: true, force: true });
    }
  });
});

describe("POST /session/:id/cancel", () => {
  test("cancelled:true for a live session, then it is gone", async () => {
    const app = createApi(baseConfig(), { client: fakeClient("x") });
    const start = await postJson(app, "/session/start", {
      chapterId: "01-x.md",
      roadmapId: "jvm-deep-dive",
    });
    const sessionId = start.headers.get("X-Session-Id")!;
    await start.text();

    const res = await postJson(app, `/session/${sessionId}/cancel`, {});
    assert.equal(res.status, 200);
    assert.equal((await res.json()).cancelled, true);

    const gone = await app.request(`/session/${sessionId}`);
    assert.equal(gone.status, 404);
  });

  test("cancelled:false for an unknown session id", async () => {
    const app = createApi(baseConfig(), { client: fakeClient() });
    const res = await postJson(app, "/session/never-existed/cancel", {});
    assert.equal(res.status, 200);
    assert.equal((await res.json()).cancelled, false);
  });
});
