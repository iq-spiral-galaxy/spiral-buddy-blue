import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  parseTranscriptSection,
  renderTranscriptSection,
  validateAndPatchSections,
  stripChapterNumberPrefix,
  splitRepoAndRoadmap,
  renderLookupsSection,
  REQUIRED_SECTIONS,
} from "../src/note-writer.js";
import {
  CHAPTER_CONTENT_MAX,
  buildInitialContext,
  buildInitialContextBlocks,
  createSession,
  getSession,
  deleteSession,
} from "../src/session-store.js";
import type { LookupEntry } from "../src/session-store.js";
import {
  computeContentHash,
  savePreview,
  loadCachedPreview,
  isPreviewCached,
  type ChapterPreviewCard,
} from "../src/chapter-preview-cache.js";
import type { Chapter } from "../src/roadmap.js";
import type { SpiralNote } from "../src/vault.js";
import type { ClaudeMessage } from "../src/claude.js";

// ───────────────────────── helpers ─────────────────────────

function makeChapter(over: Partial<Chapter> = {}): Chapter {
  return {
    id: "01-acid.md",
    roadmapId: "spring/transaction-mvcc",
    roadmapName: "transaction-mvcc",
    title: "ACID & 격리수준",
    filePath: "/abs/spring/transaction-mvcc/01-acid.md",
    content: "ACID는 원자성, 일관성, 격리성, 지속성을 의미한다.",
    frontmatter: {},
    order: 1,
    ...over,
  };
}

function makeNote(over: Partial<SpiralNote> = {}): SpiralNote {
  return {
    topic: "ACID",
    summary: "ACID 요약",
    body: "본문 내용".repeat(50),
    depth: 1,
    date: "2026-01-01",
    relativePath: "spiral-buddy/2026-01-01-acid-d1.md",
    filePath: "/vault/spiral-buddy/2026-01-01-acid-d1.md",
    chapterId: "01-acid.md",
    roadmapId: "spring/transaction-mvcc",
    roadmapName: "transaction-mvcc",
    tags: ["acid"],
    repo: "spring",
    roadmap: "transaction-mvcc",
    ...over,
  } as SpiralNote;
}

// ───────────────────────── note-writer: parseTranscriptSection ─────────────────────────

describe("note-writer / renderTranscriptSection + parseTranscriptSection", () => {
  test("renders an Obsidian quote callout with message count and skips first (context) message", () => {
    const transcript: ClaudeMessage[] = [
      { role: "user", content: "INITIAL CONTEXT BLOCK — should be dropped" },
      { role: "assistant", content: "안녕, 무엇부터 볼까?" },
      { role: "user", content: "ACID부터" },
    ];
    const out = renderTranscriptSection(transcript);
    assert.match(out, /## 💬 전체 대화/);
    // first message excluded → 2 messages reported
    assert.match(out, /펼쳐서 대화 전체 다시 보기 \(2개 메시지\)/);
    assert.match(out, /> \[!quote\]-/);
    // first message text must NOT leak
    assert.ok(!out.includes("INITIAL CONTEXT BLOCK"));
    // labels present
    assert.match(out, /\*\*🤖 버디\*\*/);
    assert.match(out, /\*\*🙋 나\*\*/);
  });

  test("returns empty string when only the context message exists", () => {
    const transcript: ClaudeMessage[] = [
      { role: "user", content: "only context" },
    ];
    assert.equal(renderTranscriptSection(transcript), "");
  });

  test("returns empty string for empty / nullish transcript", () => {
    assert.equal(renderTranscriptSection([]), "");
    assert.equal(
      renderTranscriptSection(undefined as unknown as ClaudeMessage[]),
      "",
    );
  });

  test("flattens array content blocks, keeping only text blocks", () => {
    const transcript: ClaudeMessage[] = [
      { role: "user", content: "context" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "첫 줄" },
          // a non-text block should be ignored
          { type: "tool_use", id: "x", name: "noop", input: {} } as never,
          { type: "text", text: "둘째 줄" },
        ],
      },
    ];
    const out = renderTranscriptSection(transcript);
    assert.match(out, /첫 줄/);
    assert.match(out, /둘째 줄/);
    assert.ok(!out.includes("noop"));
  });

  test("ROUNDTRIP: parseTranscriptSection recovers the rendered messages (invariant for refactor)", () => {
    const transcript: ClaudeMessage[] = [
      { role: "user", content: "context — excluded" },
      { role: "assistant", content: "질문: ACID가 뭐야?\n```sql\nSELECT 1;\n```" },
      { role: "user", content: "원자성은 all-or-nothing 이지" },
      { role: "assistant", content: "맞아.\n\n빈 줄도 보존되나?" },
    ];
    const rendered = renderTranscriptSection(transcript);
    // embed in a realistic note body (transcript section is appended at the very end)
    const body = `## 한 줄 요약\n요약입니다.\n\n## 핵심 개념\n- ACID${rendered}`;
    const parsed = parseTranscriptSection(body);

    assert.equal(parsed.length, 3);
    assert.deepEqual(
      parsed.map((m) => m.role),
      ["assistant", "user", "assistant"],
    );
    assert.equal(parsed[0]!.content, "질문: ACID가 뭐야?\n```sql\nSELECT 1;\n```");
    assert.equal(parsed[1]!.content, "원자성은 all-or-nothing 이지");
    assert.equal(parsed[2]!.content, "맞아.\n\n빈 줄도 보존되나?");
  });

  test("returns [] when no transcript section header present", () => {
    assert.deepEqual(parseTranscriptSection("## 한 줄 요약\n그냥 노트"), []);
  });

  test("returns [] when header present but no quote callout", () => {
    const body = "## 💬 전체 대화\n\n그냥 텍스트, callout 없음";
    assert.deepEqual(parseTranscriptSection(body), []);
  });

  test("uses the LAST occurrence of the header (lastIndexOf)", () => {
    // The literal header string appears earlier in prose, real section is at the end
    const transcript: ClaudeMessage[] = [
      { role: "user", content: "ctx" },
      { role: "assistant", content: "진짜 메시지" },
    ];
    const body = `## 핵심 개념\n- 이 노트의 "## 💬 전체 대화" 라는 문구를 본문에서 언급함${renderTranscriptSection(
      transcript,
    )}`;
    const parsed = parseTranscriptSection(body);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]!.content, "진짜 메시지");
  });

  test("callout parsing stops at the first non-quote line after the callout", () => {
    const transcript: ClaudeMessage[] = [
      { role: "user", content: "ctx" },
      { role: "assistant", content: "메시지 본문" },
    ];
    // append trailing non-quote content after the transcript section
    const body = `start${renderTranscriptSection(transcript)}\n\nTRAILING non-quote line`;
    const parsed = parseTranscriptSection(body);
    assert.equal(parsed.length, 1);
    assert.ok(!parsed[0]!.content.includes("TRAILING"));
  });
});

// ───────────────────────── note-writer: validateAndPatchSections ─────────────────────────

describe("note-writer / validateAndPatchSections", () => {
  test("no missing sections → body unchanged, missing empty", () => {
    const body = REQUIRED_SECTIONS.map((s) => `## ${s}\n내용`).join("\n\n");
    const res = validateAndPatchSections(body);
    assert.deepEqual(res.missing, []);
    assert.equal(res.patchedBody, body);
  });

  test("missing sections are appended as italic placeholder with EXACT suffix shape", () => {
    const body = "## 한 줄 요약\n요약";
    const res = validateAndPatchSections(body);
    // all but the first required section are missing, in order
    assert.deepEqual(res.missing, REQUIRED_SECTIONS.slice(1));
    // each missing section gets a heading + placeholder line
    for (const s of res.missing) {
      assert.match(res.patchedBody, new RegExp(`## ${escapeRe(s)}\\n_이번 세션에서 다루지 않음._`));
    }
    // original content preserved
    assert.match(res.patchedBody, /## 한 줄 요약\n요약/);
  });

  test("heading detection is exact-trim: trailing whitespace tolerated, extra text not", () => {
    // "## 한 줄 요약   " (trailing spaces) counts as present
    const present = `## 한 줄 요약   \n요약`;
    const res = validateAndPatchSections(present);
    assert.ok(!res.missing.includes("한 줄 요약"));

    // "## 한 줄 요약 추가어" does NOT match (heading text differs)
    const notPresent = `## 한 줄 요약 추가어\n요약`;
    const res2 = validateAndPatchSections(notPresent);
    assert.ok(res2.missing.includes("한 줄 요약"));
  });
});

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ───────────────────────── note-writer: stripChapterNumberPrefix ─────────────────────────

describe("note-writer / stripChapterNumberPrefix", () => {
  for (const [input, expected] of [
    ["05. Fixtures & SetUp", "Fixtures & SetUp"],
    ["01- Bean creation", "Bean creation"],
    ["12_ proxy", "proxy"], // separator must be followed by whitespace to strip
    ["12_proxy", "12_proxy"], // no whitespace after "_" → NOT stripped (real behavior)
    ["3: AOP", "AOP"],
    ["  07.  spaced  ", "spaced"],
    ["No prefix here", "No prefix here"],
    ["1.no-space-after-dot", "1.no-space-after-dot"], // requires whitespace after separator
    ["", ""],
  ] as const) {
    test(`"${input}" → "${expected}"`, () => {
      assert.equal(stripChapterNumberPrefix(input), expected);
    });
  }
});

// ───────────────────────── note-writer: splitRepoAndRoadmap ─────────────────────────

describe("note-writer / splitRepoAndRoadmap", () => {
  test("two segments → repo + roadmap", () => {
    assert.deepEqual(splitRepoAndRoadmap("unit-testing/anatomy-of-good-tests"), {
      repo: "unit-testing",
      roadmap: "anatomy-of-good-tests",
    });
  });

  test("three+ segments → first is repo, rest joined", () => {
    assert.deepEqual(splitRepoAndRoadmap("spring/core/transaction"), {
      repo: "spring",
      roadmap: "core/transaction",
    });
  });

  test("single segment → repo null", () => {
    assert.deepEqual(splitRepoAndRoadmap("solo"), {
      repo: null,
      roadmap: "solo",
    });
  });

  test("leading/trailing slashes filtered out", () => {
    assert.deepEqual(splitRepoAndRoadmap("/spring/core/"), {
      repo: "spring",
      roadmap: "core",
    });
  });

  test("empty string → repo null, roadmap is the original", () => {
    assert.deepEqual(splitRepoAndRoadmap(""), { repo: null, roadmap: "" });
  });
});

// ───────────────────────── note-writer: renderLookupsSection ─────────────────────────

describe("note-writer / renderLookupsSection", () => {
  test("empty / nullish → empty string", () => {
    assert.equal(renderLookupsSection([]), "");
    assert.equal(renderLookupsSection(undefined as unknown as LookupEntry[]), "");
  });

  test("concise → tip callout, expanded (+); deep → abstract, collapsed (-)", () => {
    const lookups: LookupEntry[] = [
      { query: "idempotent", depth: "concise", response: "멱등성", at: 1 },
      { query: "saga", depth: "deep", response: "사가 패턴", at: 2 },
      { query: "mvcc", depth: "medium", response: "다중 버전", at: 3 },
    ];
    const out = renderLookupsSection(lookups);
    assert.match(out, /## 🔍 학습 중 찾아본 표현 \(3\)/);
    assert.match(out, /> \[!tip\]\+ idempotent · _간결_/);
    assert.match(out, /> \[!abstract\]- saga · _깊이_/);
    assert.match(out, /> \[!note\]- mvcc · _중간_/);
  });

  test("userQuestion is rendered as an italic Q line; newlines collapsed", () => {
    const lookups: LookupEntry[] = [
      {
        query: "race\ncondition",
        depth: "medium",
        response: "본문\n둘째줄",
        at: 1,
        userQuestion: "이게\n왜 문제야?",
      },
    ];
    const out = renderLookupsSection(lookups);
    // query newlines collapsed to space
    assert.match(out, /race condition · _중간_/);
    // userQuestion rendered, newline collapsed
    assert.match(out, /> _Q: 이게 왜 문제야\?_/);
    // multi-line response indented with "> "
    assert.match(out, /> 본문\n> 둘째줄/);
  });

  test("strips a leading heading from the response body", () => {
    const lookups: LookupEntry[] = [
      {
        query: "buffer pool",
        depth: "medium",
        response: "## Buffer Pool\n실제 내용 시작",
        at: 1,
      },
    ];
    const out = renderLookupsSection(lookups);
    assert.ok(!out.includes("## Buffer Pool"));
    assert.match(out, /> 실제 내용 시작/);
  });
});

// ───────────────────────── session-store: lifecycle ─────────────────────────

describe("session-store / createSession + getSession + deleteSession", () => {
  test("createSession registers a retrievable session with defaults", () => {
    const s = createSession({ chapter: makeChapter(), depth: 2, related: [] });
    assert.equal(typeof s.id, "string");
    assert.ok(s.id.length > 0);
    assert.equal(s.depth, 2);
    assert.deepEqual(s.messages, []);
    assert.deepEqual(s.lookups, []);
    assert.equal(s.totalInputTokens, 0);
    assert.equal(s.totalOutputTokens, 0);
    assert.equal(s.model, undefined);
    assert.ok(s.startedAt > 0);

    const fetched = getSession(s.id);
    assert.equal(fetched, s);
    deleteSession(s.id);
  });

  test("each createSession yields a unique id", () => {
    const a = createSession({ chapter: makeChapter(), depth: 1, related: [] });
    const b = createSession({ chapter: makeChapter(), depth: 1, related: [] });
    assert.notEqual(a.id, b.id);
    deleteSession(a.id);
    deleteSession(b.id);
  });

  test("model is carried through when provided", () => {
    const s = createSession({
      chapter: makeChapter(),
      depth: 1,
      related: [],
      model: "claude-haiku-4-5",
    });
    assert.equal(s.model, "claude-haiku-4-5");
    deleteSession(s.id);
  });

  test("deleteSession removes from map and returns true; second delete false", () => {
    const s = createSession({ chapter: makeChapter(), depth: 1, related: [] });
    assert.equal(deleteSession(s.id), true);
    assert.equal(getSession(s.id), undefined);
    assert.equal(deleteSession(s.id), false);
  });

  test("getSession for unknown id returns undefined", () => {
    assert.equal(getSession("does-not-exist-xyz"), undefined);
  });

  test("mutations on the returned session object persist via getSession (same reference)", () => {
    const s = createSession({ chapter: makeChapter(), depth: 1, related: [] });
    s.totalInputTokens += 42;
    s.messages.push({ role: "user", content: "hi" });
    const again = getSession(s.id)!;
    assert.equal(again.totalInputTokens, 42);
    assert.equal(again.messages.length, 1);
    deleteSession(s.id);
  });
});

// ───────────────────────── session-store: buildInitialContext(Blocks) ─────────────────────────

describe("session-store / buildInitialContext", () => {
  test("includes chapter title, depth, and content", () => {
    const ch = makeChapter({ title: "버퍼 풀", content: "버퍼 풀은 캐시다." });
    const ctx = buildInitialContext(ch, [], 1);
    assert.match(ctx, /# 챕터 \(depth 1\)/);
    assert.match(ctx, /\*\*버퍼 풀\*\*/);
    assert.match(ctx, /버퍼 풀은 캐시다\./);
    assert.match(ctx, /no prior notes/);
  });

  test("renders related notes block", () => {
    const note = makeNote({ topic: "ACID", depth: 1, date: "2026-01-01", summary: "요약" });
    const ctx = buildInitialContext(makeChapter(), [note], 2);
    assert.match(ctx, /### ACID \(depth 1, 2026-01-01\)/);
    assert.match(ctx, /Summary: 요약/);
    assert.ok(!ctx.includes("no prior notes"));
  });

  test("thin content (<300 chars) adds the README-level warning", () => {
    const ctx = buildInitialContext(makeChapter({ content: "짧음" }), [], 1);
    assert.match(ctx, /본문이 \d+자로 매우 짧음/);
  });

  test("over-CHAPTER_CONTENT_MAX content is truncated and flagged", () => {
    const big = "가".repeat(CHAPTER_CONTENT_MAX + 500);
    const ctx = buildInitialContext(makeChapter({ content: big }), [], 1);
    assert.match(ctx, /truncated — 본문/);
    assert.match(ctx, new RegExp(`${CHAPTER_CONTENT_MAX}자만 보임`));
    assert.match(ctx, /잘림\. 잘린 뒤 부분은 보지 못함/);
    // body should not contain the full oversized content
    assert.ok(ctx.length < big.length + 2000);
  });

  test("normal-length content has no truncation/thin warnings", () => {
    const mid = "가".repeat(2000);
    const ctx = buildInitialContext(makeChapter({ content: mid }), [], 1);
    assert.ok(!ctx.includes("truncated"));
    assert.ok(!ctx.includes("매우 짧음"));
  });

  test("buildInitialContextBlocks wraps text in one cache_control ephemeral block matching buildInitialContext", () => {
    const ch = makeChapter();
    const blocks = buildInitialContextBlocks(ch, [], 1);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.type, "text");
    assert.deepEqual(blocks[0]!.cache_control, { type: "ephemeral" });
    assert.equal(blocks[0]!.text, buildInitialContext(ch, [], 1));
  });
});

// ───────────────────────── chapter-preview-cache: computeContentHash ─────────────────────────

describe("chapter-preview-cache / computeContentHash", () => {
  test("deterministic — same input, same 16-char hex", () => {
    const a = computeContentHash("hello world");
    const b = computeContentHash("hello world");
    assert.equal(a, b);
    assert.equal(a.length, 16);
    assert.match(a, /^[0-9a-f]{16}$/);
  });

  test("different input → different hash", () => {
    assert.notEqual(computeContentHash("a"), computeContentHash("b"));
    // even a tiny change flips it
    assert.notEqual(
      computeContentHash("content X"),
      computeContentHash("content X "),
    );
  });

  test("empty string is hashable and stable", () => {
    assert.equal(computeContentHash(""), computeContentHash(""));
    assert.match(computeContentHash(""), /^[0-9a-f]{16}$/);
  });
});

// ───────────────────────── chapter-preview-cache: save/load/isCached ─────────────────────────

describe("chapter-preview-cache / save + load + isPreviewCached (tmp vault)", () => {
  function makeCard(over: Partial<ChapterPreviewCard> = {}): ChapterPreviewCard {
    return {
      summary: "이 챕터는 ACID를 다룬다",
      keyQuestions: ["원자성이란?", "격리수준 종류?"],
      prerequisites: "트랜잭션 기본 개념",
      contentHash: computeContentHash("body"),
      generatedAt: 1700000000000,
      model: "claude-haiku-4-5",
      ...over,
    };
  }

  test("save then load roundtrips when contentHash matches", async () => {
    const vault = await fs.mkdtemp(path.join(os.tmpdir(), "spiral-prev-"));
    try {
      const card = makeCard();
      await savePreview(vault, "spring/tx", "01-acid.md", card);
      const loaded = await loadCachedPreview(
        vault,
        "spring/tx",
        "01-acid.md",
        card.contentHash,
      );
      assert.deepEqual(loaded, card);
    } finally {
      await fs.rm(vault, { recursive: true, force: true });
    }
  });

  test("load returns null when contentHash mismatches (invalidation)", async () => {
    const vault = await fs.mkdtemp(path.join(os.tmpdir(), "spiral-prev-"));
    try {
      const card = makeCard({ contentHash: computeContentHash("old") });
      await savePreview(vault, "spring/tx", "01-acid.md", card);
      const loaded = await loadCachedPreview(
        vault,
        "spring/tx",
        "01-acid.md",
        computeContentHash("new"),
      );
      assert.equal(loaded, null);
    } finally {
      await fs.rm(vault, { recursive: true, force: true });
    }
  });

  test("load returns null when no file exists", async () => {
    const vault = await fs.mkdtemp(path.join(os.tmpdir(), "spiral-prev-"));
    try {
      const loaded = await loadCachedPreview(
        vault,
        "nope/none",
        "x.md",
        "deadbeef",
      );
      assert.equal(loaded, null);
    } finally {
      await fs.rm(vault, { recursive: true, force: true });
    }
  });

  test("isPreviewCached reflects existence regardless of contentHash", async () => {
    const vault = await fs.mkdtemp(path.join(os.tmpdir(), "spiral-prev-"));
    try {
      assert.equal(await isPreviewCached(vault, "spring/tx", "01-acid.md"), false);
      await savePreview(vault, "spring/tx", "01-acid.md", makeCard());
      assert.equal(await isPreviewCached(vault, "spring/tx", "01-acid.md"), true);
      // stale hash still counts as cached (existence-only check)
      const loaded = await loadCachedPreview(
        vault,
        "spring/tx",
        "01-acid.md",
        "totally-different-hash",
      );
      assert.equal(loaded, null);
    } finally {
      await fs.rm(vault, { recursive: true, force: true });
    }
  });

  test("different (roadmapId, chapterId) map to distinct cache files", async () => {
    const vault = await fs.mkdtemp(path.join(os.tmpdir(), "spiral-prev-"));
    try {
      const cardA = makeCard({ summary: "A" });
      const cardB = makeCard({ summary: "B" });
      await savePreview(vault, "r1", "c1.md", cardA);
      await savePreview(vault, "r2", "c2.md", cardB);
      const a = await loadCachedPreview(vault, "r1", "c1.md", cardA.contentHash);
      const b = await loadCachedPreview(vault, "r2", "c2.md", cardB.contentHash);
      assert.equal(a!.summary, "A");
      assert.equal(b!.summary, "B");
    } finally {
      await fs.rm(vault, { recursive: true, force: true });
    }
  });

  test("savePreview creates the .preview-cache directory if absent", async () => {
    const vault = await fs.mkdtemp(path.join(os.tmpdir(), "spiral-prev-"));
    try {
      // vault exists but spiral-buddy/.preview-cache does not yet
      await savePreview(vault, "r", "c.md", makeCard());
      const dir = path.join(vault, "spiral-buddy", ".preview-cache");
      const stat = await fs.stat(dir);
      assert.ok(stat.isDirectory());
    } finally {
      await fs.rm(vault, { recursive: true, force: true });
    }
  });
});
