import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  writeNewNote,
  listSpiralNotes,
  invalidateNotesCache,
  noteBelongsToRoadmap,
  noteMatchesChapter,
  type SpiralNote,
  type NewNote,
} from "../src/vault.js";
import {
  discoverRoadmaps,
  findRoadmap,
  loadRoadmapChapters,
  invalidateRoadmapCaches,
  type Roadmap,
} from "../src/roadmap.js";
import {
  getInstalledRoadmaps,
  resolveRoadmap,
} from "../src/roadmap-service.js";
import type { Config } from "../src/config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// tmp dir helpers — every test that touches the FS uses a fresh, unique dir
// so the 30s/60s TTL caches keyed by path can't bleed across tests.
// ---------------------------------------------------------------------------

const tmpDirs: string[] = [];

async function mkTmp(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `sb-${prefix}-`));
  tmpDirs.push(dir);
  return dir;
}

after(async () => {
  for (const d of tmpDirs) {
    await fs.rm(d, { recursive: true, force: true }).catch(() => {});
  }
});

// A SpiralNote factory for the pure matcher functions (no FS needed).
function makeNote(overrides: Partial<SpiralNote> = {}): SpiralNote {
  return {
    filePath: "/x/y.md",
    relativePath: "y.md",
    title: "T",
    topic: "T",
    chapterId: null,
    chapter: "T",
    roadmapId: null,
    roadmapName: null,
    repo: null,
    date: "2026-01-01",
    depth: 1,
    tags: [],
    summary: "",
    body: "",
    ...overrides,
  };
}

function baseNewNote(overrides: Partial<NewNote> = {}): NewNote {
  return {
    topic: "Some Chapter",
    chapterId: "01-some-chapter.md",
    roadmapId: "repo/some-roadmap",
    roadmapName: "some-roadmap",
    repo: "repo",
    roadmap: "some-roadmap",
    depth: 1,
    tags: [],
    summary: "",
    body: "Body text.",
    relatedNotePaths: [],
    ...overrides,
  };
}

// ===========================================================================
// vault.ts — sanitizeFileName (tested via writeNewNote's produced filename)
//   forbidden chars → "-", spaces collapsed but KEPT, case kept, "&" kept.
// ===========================================================================

describe("vault: sanitizeFileName (via writeNewNote filename)", () => {
  test("keeps spaces, case, and ampersand; appends d<depth>", async () => {
    const vault = await mkTmp("san1");
    const fp = await writeNewNote(
      vault,
      baseNewNote({ topic: "Fixtures & SetUp", depth: 1 }),
    );
    assert.equal(path.basename(fp), "Fixtures & SetUp d1.md");
  });

  test("replaces OS-forbidden chars / \\ : * ? \" < > | with -", async () => {
    const vault = await mkTmp("san2");
    const fp = await writeNewNote(
      vault,
      baseNewNote({ topic: 'a/b\\c:d*e?f"g<h>i|j', depth: 2 }),
    );
    // each forbidden char -> "-"
    assert.equal(path.basename(fp), "a-b-c-d-e-f-g-h-i-j d2.md");
  });

  test("collapses runs of whitespace into a single space", async () => {
    const vault = await mkTmp("san3");
    const fp = await writeNewNote(
      vault,
      baseNewNote({ topic: "foo   \t  bar", depth: 1 }),
    );
    assert.equal(path.basename(fp), "foo bar d1.md");
  });

  test("strips a leading numeric chapter prefix from the filename (not the H1/frontmatter)", async () => {
    const vault = await mkTmp("san4");
    const fp = await writeNewNote(
      vault,
      baseNewNote({ topic: "05. Fixtures & SetUp", depth: 1 }),
    );
    // stripLeadingChapterNumber removes "05. " for the FILE NAME
    assert.equal(path.basename(fp), "Fixtures & SetUp d1.md");
    // ...but the H1 and frontmatter `chapter:` keep the original topic
    const raw = await fs.readFile(fp, "utf-8");
    assert.match(raw, /^# 05\. Fixtures & SetUp$/m);
    assert.match(raw, /chapter: "05\. Fixtures & SetUp"/);
  });

  test("counter suffix on collision: same topic+depth → ' (2)'", async () => {
    const vault = await mkTmp("san5");
    const fp1 = await writeNewNote(vault, baseNewNote({ topic: "Dup", depth: 1 }));
    const fp2 = await writeNewNote(vault, baseNewNote({ topic: "Dup", depth: 1 }));
    assert.equal(path.basename(fp1), "Dup d1.md");
    assert.equal(path.basename(fp2), "Dup d1 (2).md");
  });

  test("stripLeadingChapterNumber handles dash/underscore/colon separators", async () => {
    const vault = await mkTmp("san6");
    const cases: Array<[string, string]> = [
      ["01-bean-creation", "bean-creation d1.md"],
      ["02_proxy", "proxy d1.md"],
      ["3: aop", "aop d1.md"],
    ];
    for (const [topic, expected] of cases) {
      const fp = await writeNewNote(vault, baseNewNote({ topic, depth: 1 }));
      assert.equal(path.basename(fp), expected);
    }
  });
});

// ===========================================================================
// vault.ts — escapeYaml (tested via writeNewNote frontmatter)
//   backslash → \\, double-quote → \"
// ===========================================================================

describe("vault: escapeYaml (via writeNewNote frontmatter)", () => {
  test('escapes double-quotes and backslashes in chapter/summary/tags', async () => {
    const vault = await mkTmp("yaml1");
    const fp = await writeNewNote(
      vault,
      baseNewNote({
        topic: 'He said "hi"',
        summary: 'path C:\\dir and a "quote"',
        tags: ['tag "x"', "back\\slash"],
        repo: 'r"epo',
      }),
    );
    const raw = await fs.readFile(fp, "utf-8");
    assert.match(raw, /chapter: "He said \\"hi\\""/);
    assert.match(raw, /summary: "path C:\\\\dir and a \\"quote\\""/);
    assert.match(raw, /tags: \["tag \\"x\\"", "back\\\\slash"\]/);
    assert.match(raw, /repo: "r\\"epo"/);
  });

  test("repo line omitted entirely when repo is null", async () => {
    const vault = await mkTmp("yaml2");
    const fp = await writeNewNote(vault, baseNewNote({ repo: null }));
    const raw = await fs.readFile(fp, "utf-8");
    assert.doesNotMatch(raw, /^repo:/m);
    assert.match(raw, /^roadmap: "some-roadmap"$/m);
  });
});

// ===========================================================================
// vault.ts — listSpiralNotes (tmp dir fixture)
//   reads spiral-buddy/ subdir, parses frontmatter, sorts by date desc,
//   ignores _index.md and .trash/**, supports old + new schema.
// ===========================================================================

describe("vault: listSpiralNotes", () => {
  async function writeRaw(spiralRoot: string, name: string, content: string) {
    await fs.mkdir(spiralRoot, { recursive: true });
    await fs.writeFile(path.join(spiralRoot, name), content, "utf-8");
  }

  test("returns [] when spiral subdir is absent", async () => {
    const vault = await mkTmp("list0");
    invalidateNotesCache();
    const notes = await listSpiralNotes(vault);
    assert.deepEqual(notes, []);
  });

  test("parses new-schema note, ignores _index.md, sorts newest-first", async () => {
    const vault = await mkTmp("list1");
    const spiralRoot = path.join(vault, "spiral-buddy");
    await writeRaw(
      spiralRoot,
      "older d1.md",
      [
        "---",
        'repo: "unit-testing"',
        'roadmap: "anatomy"',
        'chapter: "01. Older"',
        "depth: 1",
        "date: 2026-01-01",
        'tags: ["a", "b"]',
        'summary: "an older note"',
        "---",
        "",
        "# 01. Older",
        "",
        "body older",
      ].join("\n"),
    );
    await writeRaw(
      spiralRoot,
      "newer d2.md",
      [
        "---",
        'repo: "unit-testing"',
        'roadmap: "anatomy"',
        'chapter: "02. Newer"',
        "depth: 2",
        "date: 2026-03-15",
        "---",
        "",
        "# 02. Newer",
        "",
        "body newer",
      ].join("\n"),
    );
    await writeRaw(spiralRoot, "_index.md", "---\ntitle: idx\n---\n# Sessions\n");

    invalidateNotesCache();
    const notes = await listSpiralNotes(vault);
    assert.equal(notes.length, 2, "should ignore _index.md");
    // sorted by date desc
    assert.equal(notes[0]!.chapter, "02. Newer");
    assert.equal(notes[1]!.chapter, "01. Older");

    const newer = notes[0]!;
    assert.equal(newer.repo, "unit-testing");
    assert.equal(newer.roadmapName, "anatomy");
    assert.equal(newer.depth, 2);
    assert.equal(newer.date, "2026-03-15");
    assert.equal(newer.chapterId, null);
    assert.equal(newer.roadmapId, null);

    const older = notes[1]!;
    assert.deepEqual(older.tags, ["a", "b"]);
    assert.equal(older.summary, "an older note");
    // new-schema: title/topic fall back to chapter
    assert.equal(older.title, "01. Older");
    assert.equal(older.topic, "01. Older");
  });

  test("old-schema note: repo + roadmapName inferred from roadmap_id; chapterId preserved", async () => {
    const vault = await mkTmp("list2");
    const spiralRoot = path.join(vault, "spiral-buddy");
    await writeRaw(
      spiralRoot,
      "legacy.md",
      [
        "---",
        "title: Anatomy of Good Tests",
        "topic: good tests",
        "chapter_id: anatomy-of-good-tests.md",
        "roadmap_id: unit-testing/anatomy",
        "depth: 1",
        "date: 2026-02-02",
        "---",
        "",
        "legacy body",
      ].join("\n"),
    );
    invalidateNotesCache();
    const notes = await listSpiralNotes(vault);
    assert.equal(notes.length, 1);
    const n = notes[0]!;
    assert.equal(n.chapterId, "anatomy-of-good-tests.md");
    assert.equal(n.roadmapId, "unit-testing/anatomy");
    assert.equal(n.repo, "unit-testing", "repo inferred from roadmap_id first segment");
    assert.equal(n.roadmapName, "anatomy", "roadmapName inferred from roadmap_id remainder");
    assert.equal(n.title, "Anatomy of Good Tests");
    assert.equal(n.topic, "good tests");
    // chapter falls back to title when no `chapter:` fm
    assert.equal(n.chapter, "Anatomy of Good Tests");
  });

  test("ignores notes inside .trash/", async () => {
    const vault = await mkTmp("list3");
    const spiralRoot = path.join(vault, "spiral-buddy");
    await writeRaw(spiralRoot, "live.md", "---\nchapter: \"Live\"\ndate: 2026-01-01\n---\nbody");
    await writeRaw(
      path.join(spiralRoot, ".trash"),
      "dead.md",
      "---\nchapter: \"Dead\"\ndate: 2026-09-09\n---\nbody",
    );
    invalidateNotesCache();
    const notes = await listSpiralNotes(vault);
    assert.equal(notes.length, 1);
    assert.equal(notes[0]!.chapter, "Live");
  });

  test("missing date defaults to today (bounded: a valid YYYY-MM-DD)", async () => {
    const vault = await mkTmp("list4");
    const spiralRoot = path.join(vault, "spiral-buddy");
    await writeRaw(spiralRoot, "nodate.md", "---\nchapter: \"X\"\n---\nbody");
    invalidateNotesCache();
    const notes = await listSpiralNotes(vault);
    assert.equal(notes.length, 1);
    assert.match(notes[0]!.date, /^\d{4}-\d{2}-\d{2}$/);
  });

  test("returned array is a copy — mutating it does not corrupt the cache", async () => {
    const vault = await mkTmp("list5");
    const spiralRoot = path.join(vault, "spiral-buddy");
    await writeRaw(spiralRoot, "a.md", "---\nchapter: \"A\"\ndate: 2026-01-01\n---\nx");
    invalidateNotesCache();
    const first = await listSpiralNotes(vault);
    assert.equal(first.length, 1);
    first.push(makeNote()); // mutate the returned array
    const second = await listSpiralNotes(vault);
    assert.equal(second.length, 1, "cache must be unaffected by caller mutation");
  });
});

// ===========================================================================
// vault.ts — noteBelongsToRoadmap
// ===========================================================================

describe("vault: noteBelongsToRoadmap", () => {
  test("matches by roadmapId when note has one (exact)", () => {
    const n = makeNote({ roadmapId: "repo/rm", roadmapName: "rm" });
    assert.equal(
      noteBelongsToRoadmap(n, { roadmapId: "repo/rm", roadmapName: "rm" }),
      true,
    );
    assert.equal(
      noteBelongsToRoadmap(n, { roadmapId: "repo/other", roadmapName: "rm" }),
      false,
      "roadmapId present → name is NOT consulted",
    );
  });

  test("falls back to roadmapName when note has no roadmapId", () => {
    const n = makeNote({ roadmapId: null, roadmapName: "rm" });
    assert.equal(
      noteBelongsToRoadmap(n, { roadmapId: "anything", roadmapName: "rm" }),
      true,
    );
    assert.equal(
      noteBelongsToRoadmap(n, { roadmapId: "anything", roadmapName: "nope" }),
      false,
    );
  });
});

// ===========================================================================
// vault.ts — noteMatchesChapter (incl. v0.5.47 chapterTitle || chapter fallback)
// ===========================================================================

describe("vault: noteMatchesChapter", () => {
  const target = {
    roadmapId: "repo/rm",
    roadmapName: "rm",
    chapterId: "01-acid.md",
    chapterTitle: "01. ACID",
  };

  test("stage 1: exact roadmapId + chapterId", () => {
    const n = makeNote({ roadmapId: "repo/rm", chapterId: "01-acid.md" });
    assert.equal(noteMatchesChapter(n, target), true);
  });

  test("stage 1 negative: roadmapId matches but chapterId differs falls through (no other signal) → false", () => {
    const n = makeNote({
      roadmapId: "repo/rm",
      chapterId: "99-other.md",
      chapter: "unrelated",
      roadmapName: "rm",
    });
    assert.equal(noteMatchesChapter(n, target), false);
  });

  test("stage 2: new schema — roadmapName + chapter title match", () => {
    const n = makeNote({
      roadmapId: null,
      roadmapName: "rm",
      chapter: "01. ACID",
    });
    assert.equal(noteMatchesChapter(n, target), true);
  });

  test("stage 2: roadmapId equality also satisfies the roadmapMatches branch", () => {
    const n = makeNote({
      roadmapId: "repo/rm",
      roadmapName: "different-name",
      chapter: "01. ACID",
      chapterId: null,
    });
    assert.equal(noteMatchesChapter(n, target), true);
  });

  test("stage 2 needs target.chapterTitle — without it, title-only match is impossible", () => {
    const n = makeNote({ roadmapId: null, roadmapName: "rm", chapter: "01. ACID" });
    const noTitle = { roadmapId: "repo/rm", roadmapName: "rm", chapterId: "zzz.md" };
    assert.equal(noteMatchesChapter(n, noTitle), false);
  });

  test("stage 3: old-schema fallback — roadmapName eq + chapterId endsWith /target", () => {
    const n = makeNote({
      roadmapId: null,
      roadmapName: "rm",
      chapterId: "some/path/01-acid.md",
      chapter: "whatever",
    });
    assert.equal(noteMatchesChapter(n, target), true);
  });

  test("stage 3: old-schema fallback — chapterId === roadmapName/chapterId", () => {
    const n = makeNote({
      roadmapId: null,
      roadmapName: "rm",
      chapterId: "rm/01-acid.md",
    });
    assert.equal(noteMatchesChapter(n, target), true);
  });

  test("no match at all → false", () => {
    const n = makeNote({
      roadmapId: "x/y",
      roadmapName: "y",
      chapterId: "nope.md",
      chapter: "nope",
    });
    assert.equal(noteMatchesChapter(n, target), false);
  });
});

// ===========================================================================
// roadmap.ts — naturalCompare + stripChapterPrefix (via loadRoadmapChapters)
//   and discoverRoadmaps / findRoadmap on a tmp roadmap fixture.
// ===========================================================================

describe("roadmap: discoverRoadmaps + loadRoadmapChapters fixture", () => {
  // build tmp/<repo>/01-foo.md, 02-bar.md ... with content
  async function buildRoadmapRepo(): Promise<{ root: string; repo: string }> {
    const root = await mkTmp("rm");
    const repo = path.join(root, "my-deep-dive");
    await fs.mkdir(repo, { recursive: true });
    const files: Array<[string, string]> = [
      ["01-foo.md", "# 01 Foo\n\nFoo content paragraph here.\n"],
      ["02-bar.md", "---\ntitle: Chapter 2 Bar Title\n---\n\nBar body.\n"],
      ["10-baz.md", "# Baz\n\nBaz body.\n"],
      ["README.md", "# Repo readme\n\nshould be excluded as a chapter\n"],
    ];
    for (const [name, content] of files) {
      await fs.writeFile(path.join(repo, name), content, "utf-8");
    }
    return { root, repo };
  }

  test("discoverRoadmaps finds the repo with chapterCount excluding README", async () => {
    const { root } = await buildRoadmapRepo();
    invalidateRoadmapCaches();
    const roadmaps = await discoverRoadmaps(root);
    assert.equal(roadmaps.length, 1);
    const rm = roadmaps[0]!;
    assert.equal(rm.name, "my-deep-dive");
    assert.equal(rm.id, "my-deep-dive");
    assert.equal(rm.chapterCount, 3, "README.md excluded from chapter count");
  });

  test("discoverRoadmaps returns [] for a non-directory / missing root", async () => {
    invalidateRoadmapCaches();
    const r = await discoverRoadmaps(path.join(os.tmpdir(), "sb-does-not-exist-xyz"));
    assert.deepEqual(r, []);
  });

  test("loadRoadmapChapters: naturalCompare numeric sort (10 after 2, not lexical)", async () => {
    const { root } = await buildRoadmapRepo();
    invalidateRoadmapCaches();
    const [rm] = await discoverRoadmaps(root);
    const chapters = await loadRoadmapChapters(rm!);
    assert.deepEqual(
      chapters.map((c) => c.id),
      ["01-foo.md", "02-bar.md", "10-baz.md"],
      "numeric natural sort: 10 sorts after 2",
    );
    // order field is the sorted index
    assert.deepEqual(chapters.map((c) => c.order), [0, 1, 2]);
  });

  test("loadRoadmapChapters: title from frontmatter > first H1 > basename; chapter prefix stripped", async () => {
    const { root } = await buildRoadmapRepo();
    invalidateRoadmapCaches();
    const [rm] = await discoverRoadmaps(root);
    const chapters = await loadRoadmapChapters(rm!);
    const byId = new Map(chapters.map((c) => [c.id, c]));
    // 02 has frontmatter title "Chapter 2 Bar Title" → "Chapter 2" prefix stripped
    assert.equal(byId.get("02-bar.md")!.title, "Bar Title");
    // 01 has no fm title → first H1 "01 Foo" (no Chapter/Ch prefix, kept as-is)
    assert.equal(byId.get("01-foo.md")!.title, "01 Foo");
    // 10 H1 "Baz"
    assert.equal(byId.get("10-baz.md")!.title, "Baz");
  });

  test("loadRoadmapChapters: chapter carries roadmapId/roadmapName + preview", async () => {
    const { root } = await buildRoadmapRepo();
    invalidateRoadmapCaches();
    const [rm] = await discoverRoadmaps(root);
    const chapters = await loadRoadmapChapters(rm!);
    const foo = chapters.find((c) => c.id === "01-foo.md")!;
    assert.equal(foo.roadmapId, rm!.id);
    assert.equal(foo.roadmapName, rm!.name);
    assert.equal(foo.preview, "Foo content paragraph here.");
  });

  test("stripChapterPrefix: 'Chapter01 -', 'Ch1:' removed but 'Chrome' kept", async () => {
    const root = await mkTmp("rmprefix");
    const repo = path.join(root, "prefixes");
    await fs.mkdir(repo, { recursive: true });
    await fs.writeFile(path.join(repo, "a.md"), "# Chapter 1 - Intro\n\nx\n");
    await fs.writeFile(path.join(repo, "b.md"), "# Ch2: Deep Dive\n\ny\n");
    await fs.writeFile(path.join(repo, "c.md"), "# Chrome internals\n\nz\n");
    invalidateRoadmapCaches();
    const [rm] = await discoverRoadmaps(root);
    const chapters = await loadRoadmapChapters(rm!);
    const byId = new Map(chapters.map((c) => [c.id, c.title]));
    assert.equal(byId.get("a.md"), "Intro");
    assert.equal(byId.get("b.md"), "Deep Dive");
    assert.equal(byId.get("c.md"), "Chrome internals", "'Ch' not followed by digit is untouched");
  });

  test("findRoadmap: exact id match, then basename(name) fallback, else null", async () => {
    const { root } = await buildRoadmapRepo();
    invalidateRoadmapCaches();
    const exact = await findRoadmap(root, "my-deep-dive");
    assert.ok(exact);
    assert.equal(exact!.name, "my-deep-dive");
    // name fallback (id and name happen to be equal here at top level, so
    // verify the null path explicitly)
    const none = await findRoadmap(root, "totally-unknown");
    assert.equal(none, null);
  });

  test("nested roadmap: id is POSIX-joined relative path, name is basename", async () => {
    const root = await mkTmp("rmnested");
    const sub = path.join(root, "container", "inner-rm");
    await fs.mkdir(sub, { recursive: true });
    await fs.writeFile(path.join(sub, "01-a.md"), "# A\n\na\n");
    await fs.writeFile(path.join(sub, "02-b.md"), "# B\n\nb\n");
    invalidateRoadmapCaches();
    const roadmaps = await discoverRoadmaps(root);
    assert.equal(roadmaps.length, 1);
    assert.equal(roadmaps[0]!.id, "container/inner-rm");
    assert.equal(roadmaps[0]!.name, "inner-rm");
    // findRoadmap basename fallback: search by "inner-rm" (the name, not full id)
    invalidateRoadmapCaches();
    const byName = await findRoadmap(root, "inner-rm");
    assert.ok(byName);
    assert.equal(byName!.id, "container/inner-rm");
  });
});

// ===========================================================================
// roadmap-service.ts — getInstalledRoadmaps + resolveRoadmap
//   fabricated Config: roadmapRoot=tmpdir, curatedOrg=null (no network).
// ===========================================================================

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    apiKey: "test",
    model: "claude-test",
    maxTokens: 4096,
    roadmapRoot: null,
    pinnedRoadmapPath: null,
    curatedOrg: null,
    githubToken: null,
    vaultPath: null,
    vaultName: null,
    obsidianVaultRoot: null,
    ...overrides,
  };
}

describe("roadmap-service: getInstalledRoadmaps + resolveRoadmap", () => {
  async function buildTwoRoadmaps(): Promise<string> {
    const root = await mkTmp("svc");
    for (const name of ["alpha-rm", "beta-rm"]) {
      const repo = path.join(root, name);
      await fs.mkdir(repo, { recursive: true });
      await fs.writeFile(path.join(repo, "01-x.md"), "# X\n\nx\n");
      await fs.writeFile(path.join(repo, "02-y.md"), "# Y\n\ny\n");
    }
    return root;
  }

  test("getInstalledRoadmaps tags local roadmaps with source:'local'", async () => {
    const root = await buildTwoRoadmaps();
    invalidateRoadmapCaches();
    const cfg = makeConfig({ roadmapRoot: root });
    const rms = await getInstalledRoadmaps(cfg);
    assert.equal(rms.length, 2);
    assert.ok(rms.every((r) => r.source === "local"));
    assert.deepEqual(rms.map((r) => r.name).sort(), ["alpha-rm", "beta-rm"]);
  });

  test("getInstalledRoadmaps respects pinnedRoadmapPath (single roadmap)", async () => {
    const root = await buildTwoRoadmaps();
    invalidateRoadmapCaches();
    const pinned = path.join(root, "beta-rm");
    const cfg = makeConfig({ roadmapRoot: root, pinnedRoadmapPath: pinned });
    const rms = await getInstalledRoadmaps(cfg);
    assert.equal(rms.length, 1);
    assert.equal(rms[0]!.name, "beta-rm");
  });

  test("getInstalledRoadmaps returns [] when no roadmapRoot and no curatedOrg", async () => {
    const rms = await getInstalledRoadmaps(makeConfig());
    assert.deepEqual(rms, []);
  });

  test("resolveRoadmap: null id → first installed roadmap", async () => {
    const root = await buildTwoRoadmaps();
    invalidateRoadmapCaches();
    const cfg = makeConfig({ roadmapRoot: root });
    const r = await resolveRoadmap(cfg, null);
    assert.ok(r);
    // discoverRoadmaps sorts by sortKey (alpha before beta)
    assert.equal(r!.name, "alpha-rm");
  });

  test("resolveRoadmap: exact id match", async () => {
    const root = await buildTwoRoadmaps();
    invalidateRoadmapCaches();
    const cfg = makeConfig({ roadmapRoot: root });
    const r = await resolveRoadmap(cfg, "beta-rm");
    assert.ok(r);
    assert.equal(r!.id, "beta-rm");
    assert.equal(r!.source, "local");
  });

  test("resolveRoadmap: basename(name) fallback for nested roadmap", async () => {
    const root = await mkTmp("svcnested");
    const sub = path.join(root, "cont", "deep-rm");
    await fs.mkdir(sub, { recursive: true });
    await fs.writeFile(path.join(sub, "01-a.md"), "# A\n\na\n");
    await fs.writeFile(path.join(sub, "02-b.md"), "# B\n\nb\n");
    invalidateRoadmapCaches();
    const cfg = makeConfig({ roadmapRoot: root });
    // findRoadmap inside resolveRoadmap does exact id (fails) then name match
    const r = await resolveRoadmap(cfg, "deep-rm");
    assert.ok(r);
    assert.equal(r!.id, "cont/deep-rm");
    assert.equal(r!.source, "local");
  });

  test("resolveRoadmap: unknown id → null", async () => {
    const root = await buildTwoRoadmaps();
    invalidateRoadmapCaches();
    const cfg = makeConfig({ roadmapRoot: root });
    const r = await resolveRoadmap(cfg, "no-such-roadmap");
    assert.equal(r, null);
  });

  test("resolveRoadmap: curated: prefix branch resolves from cache dir", async () => {
    // Build a fake curated cache under the package's .cache/curated/<org>/<repo>
    const org = `test-org-${process.pid}-${Date.now()}`;
    const orgDir = path.join(PKG_ROOT, ".cache", "curated", org);
    const repoDir = path.join(orgDir, "fake-repo");
    await fs.mkdir(repoDir, { recursive: true });
    await fs.writeFile(path.join(repoDir, "01-a.md"), "# A\n\na\n");
    await fs.writeFile(path.join(repoDir, "02-b.md"), "# B\n\nb\n");
    try {
      invalidateRoadmapCaches();
      const cfg = makeConfig({ curatedOrg: org });
      const expectedId = `curated:${org}/fake-repo`;
      const r = await resolveRoadmap(cfg, expectedId);
      assert.ok(r, "curated roadmap should resolve");
      assert.equal(r!.id, expectedId);
      assert.equal(r!.source, "curated");
      // a curated id that doesn't exist → null (curatedOrg set)
      const miss = await resolveRoadmap(cfg, `curated:${org}/nope`);
      assert.equal(miss, null);
    } finally {
      await fs.rm(orgDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  test("resolveRoadmap: curated: prefix but curatedOrg null → falls through to null", async () => {
    const cfg = makeConfig({ curatedOrg: null, roadmapRoot: null });
    const r = await resolveRoadmap(cfg, "curated:whatever/repo");
    assert.equal(r, null);
  });
});
