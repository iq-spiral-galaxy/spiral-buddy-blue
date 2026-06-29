import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  escapeHtml,
  escapeAttr,
  cssEscape,
  truncate,
  _relTime,
} from "../client/util.js";

import {
  STREAM_INACTIVITY_MS,
  createStreamHandle,
  finishStreamHandle,
  abortStreams,
  isIntentionalAbort,
  pumpStream,
  parseSseMessage,
} from "../client/stream.js";

import {
  svgIcon,
  categoryIconHtml,
  repoIconHtml,
  groupIconHtml,
  DEPTH_ICONS,
  CONTEXT_ICON_SVG,
} from "../client/icons.js";

// ───────────────────────────────────────────────────────────────────────────
// util.js — escapeHtml
// ───────────────────────────────────────────────────────────────────────────
describe("util.escapeHtml", () => {
  test("encodes all 5 entities", () => {
    assert.equal(
      escapeHtml(`& < > " '`),
      "&amp; &lt; &gt; &quot; &#39;",
    );
  });

  test("ampersand encoded first so existing encoded text double-escapes (invariant)", () => {
    // Order matters: & is replaced before <, so "&lt;" input becomes "&amp;lt;".
    assert.equal(escapeHtml("&lt;"), "&amp;lt;");
  });

  test("null and undefined return empty string", () => {
    assert.equal(escapeHtml(null), "");
    assert.equal(escapeHtml(undefined), "");
  });

  test("empty string returns empty string", () => {
    assert.equal(escapeHtml(""), "");
  });

  test("coerces non-string values via String()", () => {
    assert.equal(escapeHtml(0), "0");
    assert.equal(escapeHtml(42), "42");
    assert.equal(escapeHtml(false), "false");
  });

  test("plain text passes through unchanged", () => {
    assert.equal(escapeHtml("hello world"), "hello world");
  });

  test("real-world XSS-ish payload is neutralized", () => {
    assert.equal(
      escapeHtml('<img src=x onerror="alert(1)">'),
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
  });

  test("0 is NOT treated as null (== null is false for 0)", () => {
    // s == null only matches null/undefined, not 0.
    assert.notEqual(escapeHtml(0), "");
  });
});

describe("util.escapeAttr", () => {
  test("is an intentional alias of escapeHtml (identical output)", () => {
    const inputs = [`& < > " '`, "&lt;", "", null, 42, "plain"];
    for (const i of inputs) {
      assert.equal(escapeAttr(i as any), escapeHtml(i as any));
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// util.cssEscape — CSS global undefined in node → regex fallback runs
// ───────────────────────────────────────────────────────────────────────────
describe("util.cssEscape (regex fallback path in node)", () => {
  test("CSS global is undefined in this environment", () => {
    assert.equal(typeof (globalThis as any).CSS, "undefined");
  });

  test("alphanumerics, underscore, hyphen pass through unescaped", () => {
    assert.equal(cssEscape("abc-DEF_123"), "abc-DEF_123");
  });

  test("special chars get backslash-escaped", () => {
    assert.equal(cssEscape("a.b"), "a\\.b");
    assert.equal(cssEscape("a:b"), "a\\:b");
    assert.equal(cssEscape("a b"), "a\\ b");
  });

  test("multiple special chars all escaped", () => {
    assert.equal(cssEscape("01-foo.md"), "01-foo\\.md");
  });

  test("coerces non-string via String()", () => {
    assert.equal(cssEscape(123 as any), "123");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// util.truncate
// ───────────────────────────────────────────────────────────────────────────
describe("util.truncate", () => {
  test("string at or under length is returned as-is", () => {
    assert.equal(truncate("hello", 5), "hello");
    assert.equal(truncate("hi", 5), "hi");
  });

  test("string over length gets sliced to n-1 chars + ellipsis", () => {
    // "hello world".slice(0, 5-1) = "hell" + "…"
    assert.equal(truncate("hello world", 5), "hell…");
    assert.equal(truncate("hello world", 5).length, 5);
  });

  test("empty string returns empty string", () => {
    assert.equal(truncate("", 5), "");
  });

  test("falsy input (null/undefined) returns empty string", () => {
    assert.equal(truncate(null as any, 5), "");
    assert.equal(truncate(undefined as any, 5), "");
  });

  test("ellipsis is single char (…) so total length == n on truncation", () => {
    const out = truncate("abcdefghij", 4);
    assert.equal(out, "abc…");
    assert.equal(out.length, 4);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// util._relTime — bucket boundaries via Date.now() - offset
// ───────────────────────────────────────────────────────────────────────────
describe("util._relTime (bucket boundaries)", () => {
  const MIN = 60_000;
  const HR = 60 * MIN;
  const DAY = 24 * HR;

  test("< 1 minute → 방금", () => {
    assert.equal(_relTime(Date.now()), "방금");
    assert.equal(_relTime(Date.now() - 30_000), "방금");
  });

  test("future timestamp (negative diff) → 방금", () => {
    assert.equal(_relTime(Date.now() + 10_000), "방금");
  });

  test("exactly 1 minute → 1분 전", () => {
    assert.equal(_relTime(Date.now() - MIN), "1분 전");
  });

  test("minutes bucket (1..59) → N분 전", () => {
    assert.equal(_relTime(Date.now() - 5 * MIN), "5분 전");
    assert.equal(_relTime(Date.now() - 59 * MIN), "59분 전");
  });

  test("exactly 60 minutes → 1시간 전", () => {
    assert.equal(_relTime(Date.now() - HR), "1시간 전");
  });

  test("hours bucket (1..23) → N시간 전", () => {
    assert.equal(_relTime(Date.now() - 5 * HR), "5시간 전");
    assert.equal(_relTime(Date.now() - 23 * HR), "23시간 전");
  });

  test("exactly 24 hours → 1일 전", () => {
    assert.equal(_relTime(Date.now() - DAY), "1일 전");
  });

  test("days bucket → N일 전", () => {
    assert.equal(_relTime(Date.now() - 10 * DAY), "10일 전");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// stream.js — parseSseMessage
// ───────────────────────────────────────────────────────────────────────────
describe("stream.parseSseMessage", () => {
  test("parses event: and data: into {event, data}", () => {
    const raw = 'event: chunk\ndata: {"text":"hi"}';
    assert.deepEqual(parseSseMessage(raw), {
      event: "chunk",
      data: { text: "hi" },
    });
  });

  test("default event is 'message' when no event: line", () => {
    const raw = 'data: {"a":1}';
    assert.deepEqual(parseSseMessage(raw), { event: "message", data: { a: 1 } });
  });

  test("multi-line data is concatenated then JSON.parsed", () => {
    // Each data: line is trimmed then concatenated (no separator).
    const raw = 'event: x\ndata: {"a":\ndata: 1}';
    assert.deepEqual(parseSseMessage(raw), { event: "x", data: { a: 1 } });
  });

  test("no data line → null", () => {
    assert.equal(parseSseMessage("event: ping"), null);
  });

  test("empty string → null", () => {
    assert.equal(parseSseMessage(""), null);
  });

  test("bad JSON in data → null", () => {
    assert.equal(parseSseMessage("data: not-json"), null);
  });

  test("data with empty value → null (data stays falsy)", () => {
    assert.equal(parseSseMessage("data: "), null);
  });

  test("event value is trimmed", () => {
    const raw = 'event:   spaced   \ndata: 1';
    assert.deepEqual(parseSseMessage(raw), { event: "spaced", data: 1 });
  });

  test("parses JSON primitives (number, string, bool, null)", () => {
    assert.deepEqual(parseSseMessage("data: 42"), { event: "message", data: 42 });
    assert.deepEqual(parseSseMessage('data: "s"'), { event: "message", data: "s" });
    assert.deepEqual(parseSseMessage("data: true"), { event: "message", data: true });
    // data: null → JSON.parse("null") === null, but !data is false for "null" string
    // before parse; after parse data===null is a valid parse → returns {data:null}
    assert.deepEqual(parseSseMessage("data: null"), { event: "message", data: null });
  });

  test("lines not starting with event:/data: are ignored", () => {
    const raw = "id: 7\nretry: 100\ndata: 1";
    assert.deepEqual(parseSseMessage(raw), { event: "message", data: 1 });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// stream.js — isIntentionalAbort
// ───────────────────────────────────────────────────────────────────────────
describe("stream.isIntentionalAbort", () => {
  test("true only when handle.intentional AND err.name === AbortError", () => {
    const handle = { intentional: true };
    const err = { name: "AbortError" };
    assert.equal(isIntentionalAbort(err, handle), true);
  });

  test("false when intentional but not AbortError", () => {
    assert.equal(isIntentionalAbort({ name: "TypeError" }, { intentional: true }), false);
  });

  test("false when AbortError but not intentional", () => {
    assert.equal(isIntentionalAbort({ name: "AbortError" }, { intentional: false }), false);
  });

  test("false (not undefined) with null/undefined handle — coerced via !!", () => {
    assert.equal(isIntentionalAbort({ name: "AbortError" }, null), false);
    assert.equal(isIntentionalAbort({ name: "AbortError" }, undefined), false);
  });

  test("false with null/undefined err", () => {
    assert.equal(isIntentionalAbort(null, { intentional: true }), false);
    assert.equal(isIntentionalAbort(undefined, { intentional: true }), false);
  });

  test("returns a strict boolean (never undefined)", () => {
    assert.strictEqual(isIntentionalAbort(null, null), false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// stream.js — handle registry: create / finish / abort
// ───────────────────────────────────────────────────────────────────────────
describe("stream handle registry", () => {
  test("createStreamHandle returns handle with group, controller, intentional=false", () => {
    const h = createStreamHandle("g1");
    try {
      assert.equal(h.group, "g1");
      assert.equal(h.intentional, false);
      assert.ok(h.controller instanceof AbortController);
      assert.equal(h.controller.signal.aborted, false);
    } finally {
      finishStreamHandle(h);
    }
  });

  test("abortStreams(group) aborts only matching group, sets intentional + aborts controller", () => {
    const a = createStreamHandle("alpha");
    const b = createStreamHandle("beta");

    abortStreams("alpha");

    assert.equal(a.intentional, true);
    assert.equal(a.controller.signal.aborted, true);
    // beta untouched
    assert.equal(b.intentional, false);
    assert.equal(b.controller.signal.aborted, false);

    finishStreamHandle(b);
  });

  test("abortStreams() with no group aborts ALL active streams", () => {
    const a = createStreamHandle("x");
    const b = createStreamHandle("y");

    abortStreams();

    assert.equal(a.controller.signal.aborted, true);
    assert.equal(b.controller.signal.aborted, true);
    assert.equal(a.intentional, true);
    assert.equal(b.intentional, true);
  });

  test("abortStreams removes handles from registry (second abort is a no-op on already-aborted)", () => {
    const a = createStreamHandle("solo");
    abortStreams("solo");
    // After abort, handle was deleted from registry. Re-aborting same group does
    // nothing further; we just assert it doesn't throw and state is stable.
    abortStreams("solo");
    assert.equal(a.controller.signal.aborted, true);
  });

  test("finishStreamHandle removes a handle so later abortStreams() ignores it", () => {
    const a = createStreamHandle("keep");
    finishStreamHandle(a);
    // Not in registry → abortStreams() won't set intentional/abort it.
    abortStreams();
    assert.equal(a.intentional, false);
    assert.equal(a.controller.signal.aborted, false);
  });

  test("isIntentionalAbort integrates with a real aborted handle", () => {
    const h = createStreamHandle("real");
    abortStreams("real");
    const err = { name: "AbortError" };
    assert.equal(isIntentionalAbort(err, h), true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// stream.js — pumpStream
// ───────────────────────────────────────────────────────────────────────────
describe("stream.pumpStream", () => {
  function fakeReader(chunks: Uint8Array[]) {
    let i = 0;
    return {
      read() {
        if (i < chunks.length) {
          return Promise.resolve({ done: false, value: chunks[i++] });
        }
        return Promise.resolve({ done: true, value: undefined });
      },
    };
  }

  test("calls onChunk with decoded text for each chunk, resolves when done", async () => {
    const enc = new TextEncoder();
    const reader = fakeReader([enc.encode("hello "), enc.encode("world")]);
    const handle = createStreamHandle("pump1");
    const out: string[] = [];

    await pumpStream(reader, handle, (t) => out.push(t));

    assert.deepEqual(out, ["hello ", "world"]);
    finishStreamHandle(handle);
  });

  test("zero chunks (immediate done) → onChunk never called, resolves", async () => {
    const reader = fakeReader([]);
    const handle = createStreamHandle("pump2");
    let calls = 0;

    await pumpStream(reader, handle, () => calls++);

    assert.equal(calls, 0);
    finishStreamHandle(handle);
  });

  test("works with a real ReadableStream.getReader()", async () => {
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(enc.encode("abc"));
        controller.enqueue(enc.encode("def"));
        controller.close();
      },
    });
    const reader = stream.getReader();
    const handle = createStreamHandle("pump3");
    const out: string[] = [];

    await pumpStream(reader, handle, (t) => out.push(t));

    assert.deepEqual(out, ["abc", "def"]);
    finishStreamHandle(handle);
  });

  test("decoder streams multi-byte chars split across chunks (UTF-8 boundary)", async () => {
    // "가" = E3-style 3-byte UTF-8 (EAB080). Split it across two chunks.
    const full = new TextEncoder().encode("가"); // 3 bytes
    const reader = fakeReader([full.slice(0, 2), full.slice(2)]);
    const handle = createStreamHandle("pump4");
    let joined = "";

    await pumpStream(reader, handle, (t) => (joined += t));

    assert.equal(joined, "가");
    finishStreamHandle(handle);
  });

  test("propagates a read() rejection (non-timeout error path)", async () => {
    const handle = createStreamHandle("pump5");
    const badReader = {
      read() {
        return Promise.reject(new Error("boom"));
      },
    };
    await assert.rejects(
      () => pumpStream(badReader, handle, () => {}),
      /boom/,
    );
    finishStreamHandle(handle);
  });
});

describe("stream constants", () => {
  test("STREAM_INACTIVITY_MS is 60000", () => {
    assert.equal(STREAM_INACTIVITY_MS, 60_000);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// icons.js — svgIcon
// ───────────────────────────────────────────────────────────────────────────
describe("icons.svgIcon", () => {
  test("known icon embeds its body and wraps in <svg>…</svg>", () => {
    const out = svgIcon("bolt");
    assert.match(out, /^<svg /);
    assert.match(out, /<\/svg>$/);
    assert.ok(out.includes('<path d="M13 2 5 13h6l-1 9 8-12h-6l1-8Z" />'));
  });

  test("unknown icon falls back to folder body", () => {
    const out = svgIcon("totally-not-a-real-icon");
    const folder = svgIcon("folder");
    // both should contain the folder path body
    assert.ok(out.includes('<path d="M3.5 6.5h6l1.8 2H20v8.5'));
    assert.equal(out, folder);
  });

  test("default className is inline-icon", () => {
    assert.ok(svgIcon("bolt").includes('class="inline-icon"'));
  });

  test("custom className is applied", () => {
    assert.ok(svgIcon("bolt", "my-class").includes('class="my-class"'));
  });

  test("includes standard svg attributes (viewBox, stroke, aria-hidden)", () => {
    const out = svgIcon("leaf");
    assert.ok(out.includes('viewBox="0 0 24 24"'));
    assert.ok(out.includes('stroke="currentColor"'));
    assert.ok(out.includes('aria-hidden="true"'));
  });
});

// ───────────────────────────────────────────────────────────────────────────
// icons.js — wrappers
// ───────────────────────────────────────────────────────────────────────────
describe("icons.categoryIconHtml", () => {
  test("maps known category name (case-insensitive) to its icon", () => {
    const out = categoryIconHtml({ name: "Java Core" });
    // "java core" → coffee
    assert.ok(out.includes("M5 8h9v4.5")); // coffee path fragment
    assert.match(out, /^<span class="cat-icon"/);
    assert.ok(out.includes('class="cat-icon-svg"'));
  });

  test("unknown category name → folder icon", () => {
    const out = categoryIconHtml({ name: "nonexistent-domain" });
    assert.ok(out.includes('<path d="M3.5 6.5h6l1.8 2H20v8.5'));
  });

  test("missing name / null category → uncategorized → folder", () => {
    const a = categoryIconHtml({});
    const b = categoryIconHtml(null);
    assert.ok(a.includes('<path d="M3.5 6.5h6l1.8 2H20v8.5'));
    assert.ok(b.includes('<path d="M3.5 6.5h6l1.8 2H20v8.5'));
  });

  test("aliased keys resolve (cross-platform == cross platform)", () => {
    const dash = categoryIconHtml({ name: "cross-platform" });
    const space = categoryIconHtml({ name: "cross platform" });
    // both map to shuffle
    assert.ok(dash.includes('polyline points="16 3 21 3 21 8"'));
    assert.equal(dash, space);
  });
});

describe("icons.repoIconHtml", () => {
  test("wraps repo svg in span.repo-icon", () => {
    const out = repoIconHtml();
    assert.match(out, /^<span class="repo-icon"/);
    assert.ok(out.includes('class="repo-icon-svg"'));
    // repo icon path fragment
    assert.ok(out.includes('<path d="m12 3 7 4-7 4-7-4 7-4Z" />'));
  });
});

describe("icons.groupIconHtml", () => {
  test("wraps named svg in span.group-icon", () => {
    const out = groupIconHtml("database");
    assert.match(out, /^<span class="group-icon"/);
    assert.ok(out.includes('class="group-icon-svg"'));
    assert.ok(out.includes('<ellipse cx="12" cy="5"')); // database fragment
  });

  test("unknown group name falls back to folder", () => {
    const out = groupIconHtml("no-such-icon");
    assert.ok(out.includes('<path d="M3.5 6.5h6l1.8 2H20v8.5'));
  });
});

describe("icons constants", () => {
  test("DEPTH_ICONS has concise/medium/deep svgs", () => {
    for (const k of ["concise", "medium", "deep"] as const) {
      assert.match(DEPTH_ICONS[k], /^<svg /);
      assert.match(DEPTH_ICONS[k], /<\/svg>$/);
    }
  });

  test("CONTEXT_ICON_SVG is a self-contained svg", () => {
    assert.match(CONTEXT_ICON_SVG, /^<svg /);
    assert.match(CONTEXT_ICON_SVG, /<\/svg>$/);
  });
});
