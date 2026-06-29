import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { safeJsonParse } from "../src/text-utils.js";
import {
  normalizeRepoName,
  reposInDomain,
  groupReposByCategory,
  findDomainForCategory,
  categorizeLocalRoadmap,
  getOrgCategories,
  getOrgDomains,
  type DomainDef,
} from "../src/categories.js";
import { parseCuratedId, isMetaRepo } from "../src/curated.js";
import { createTtlCache } from "../src/ttl-cache.js";

// ───────────────────────────────────────────────
// text-utils: safeJsonParse
// ───────────────────────────────────────────────
describe("safeJsonParse", () => {
  test("parses plain unfenced JSON object", () => {
    assert.deepEqual(safeJsonParse('{"a":1,"b":"x"}'), { a: 1, b: "x" });
  });

  test("strips a ```json fence and parses", () => {
    const input = '```json\n{"chapter":"foo","depth":2}\n```';
    assert.deepEqual(safeJsonParse(input), { chapter: "foo", depth: 2 });
  });

  test("strips a bare ``` fence (no json language tag) and parses", () => {
    const input = '```\n{"ok":true}\n```';
    assert.deepEqual(safeJsonParse(input), { ok: true });
  });

  // PIN: the leading-fence regex is anchored at ^, and .trim() runs AFTER the
  // two .replace() calls. So whitespace BEFORE the opening fence prevents the
  // fence from being stripped → JSON.parse of the fenced string throws → null.
  // (An upcoming refactor that trims first would change this to succeed.)
  test("leading whitespace before opening fence is NOT stripped → null", () => {
    const input = '   \n```json\n{"x":[1,2,3]}\n```   \n';
    assert.equal(safeJsonParse(input), null);
  });

  test("trailing whitespace after closing fence IS tolerated", () => {
    const input = '```json\n{"x":[1,2,3]}\n```   \n';
    assert.deepEqual(safeJsonParse(input), { x: [1, 2, 3] });
  });

  test("is case-insensitive on the JSON fence tag", () => {
    const input = '```JSON\n{"k":1}\n```';
    assert.deepEqual(safeJsonParse(input), { k: 1 });
  });

  test("returns null on garbage / non-JSON", () => {
    assert.equal(safeJsonParse("not json at all"), null);
  });

  test("returns null on empty string", () => {
    assert.equal(safeJsonParse(""), null);
  });

  test("returns null on truncated/invalid JSON inside a fence", () => {
    assert.equal(safeJsonParse('```json\n{"a":1,\n```'), null);
  });

  // PIN: the function's return type is "object | null" but JSON.parse of a
  // primitive does NOT throw — so a bare number/string/array is returned as-is.
  // This documents current (loose) behavior an upcoming refactor must be aware of.
  test("non-object JSON: bare number is returned (not coerced to null)", () => {
    assert.equal(safeJsonParse("42"), 42 as unknown as null);
  });

  test("non-object JSON: bare quoted string is returned as-is", () => {
    assert.equal(safeJsonParse('"hello"'), "hello" as unknown as null);
  });

  test("non-object JSON: array is returned as-is", () => {
    assert.deepEqual(safeJsonParse("[1,2,3]"), [1, 2, 3] as unknown as Record<string, unknown>);
  });

  test("JSON null literal parses to null", () => {
    assert.equal(safeJsonParse("null"), null);
  });

  // PIN: regex only strips a single leading fence and single trailing fence.
  // Trailing prose after the closing fence breaks the parse → null.
  test("text after closing fence is not stripped → null", () => {
    assert.equal(safeJsonParse('```json\n{"a":1}\n```\nthanks!'), null);
  });

  test("leading prose before fence is not stripped → null", () => {
    assert.equal(safeJsonParse('Here you go:\n```json\n{"a":1}\n```'), null);
  });
});

// ───────────────────────────────────────────────
// categories: pure normalizers
// ───────────────────────────────────────────────
describe("normalizeRepoName", () => {
  test("lowercases and strips trailing -deep-dive suffix", () => {
    assert.equal(normalizeRepoName("Architecture-Patterns-Deep-Dive"), "architecture-patterns");
  });

  test("repo without suffix is just lowercased + trimmed", () => {
    assert.equal(normalizeRepoName("  Redis  "), "redis");
  });

  test("only strips -deep-dive at the END (not mid-string)", () => {
    assert.equal(normalizeRepoName("deep-dive-into-go"), "deep-dive-into-go");
  });

  test("strips exactly one trailing -deep-dive", () => {
    // suffix regex anchored to end; only the final occurrence removed
    assert.equal(normalizeRepoName("foo-deep-dive-deep-dive"), "foo-deep-dive");
  });

  test("two repo spellings normalize to the same id", () => {
    assert.equal(
      normalizeRepoName("jvm-deep-dive"),
      normalizeRepoName("JVM"),
    );
  });
});

// ───────────────────────────────────────────────
// curated: parseCuratedId
// ───────────────────────────────────────────────
describe("parseCuratedId", () => {
  test("returns null for ids without curated: prefix", () => {
    assert.equal(parseCuratedId("local:foo/bar"), null);
    assert.equal(parseCuratedId("just-a-roadmap"), null);
  });

  test("returns null when there is no slash after the org", () => {
    assert.equal(parseCuratedId("curated:iq-dev-lab"), null);
  });

  test("org/repo with no sub-path → empty subPath", () => {
    assert.deepEqual(parseCuratedId("curated:iq-dev-lab/redis-deep-dive"), {
      org: "iq-dev-lab",
      repoName: "redis-deep-dive",
      subPath: "",
    });
  });

  test("org/repo/sub/path → subPath keeps remaining segments", () => {
    assert.deepEqual(
      parseCuratedId("curated:iq-dev-lab/spring-core-deep-dive/ioc-container/01-beanfactory"),
      {
        org: "iq-dev-lab",
        repoName: "spring-core-deep-dive",
        subPath: "ioc-container/01-beanfactory",
      },
    );
  });

  test("single-level subPath", () => {
    assert.deepEqual(parseCuratedId("curated:org/repo/sub"), {
      org: "org",
      repoName: "repo",
      subPath: "sub",
    });
  });
});

describe("isMetaRepo", () => {
  test(".github org profile is meta", () => {
    assert.equal(isMetaRepo(".github"), true);
  });
  test(".github-private is meta", () => {
    assert.equal(isMetaRepo(".github-private"), true);
  });
  test("*.github.io pages site is meta (case-insensitive)", () => {
    assert.equal(isMetaRepo("iq-dev-lab.github.io"), true);
    assert.equal(isMetaRepo("Foo.GitHub.IO"), true);
  });
  test("normal learning repo is not meta", () => {
    assert.equal(isMetaRepo("redis-deep-dive"), false);
  });
});

// ───────────────────────────────────────────────
// categories: data-dependent + grouping (uses real curated-domains.json)
// ───────────────────────────────────────────────
describe("reposInDomain", () => {
  test("flattens repos across all categories of a domain", () => {
    const domain: DomainDef = {
      id: "d",
      name: "D",
      emoji: "x",
      color: "#000",
      order: 1,
      categories: [
        { name: "C1", emoji: "a", color: "#1", repos: ["r1", "r2"] },
        { name: "C2", emoji: "b", color: "#2", repos: ["r3"] },
      ],
    };
    assert.deepEqual(reposInDomain(domain), ["r1", "r2", "r3"]);
  });

  test("domain with no repos → empty array", () => {
    const domain: DomainDef = {
      id: "d",
      name: "D",
      emoji: "x",
      color: "#000",
      order: 1,
      categories: [{ name: "C", emoji: "a", color: "#1", repos: [] }],
    };
    assert.deepEqual(reposInDomain(domain), []);
  });
});

describe("getOrgCategories / getOrgDomains (real data)", () => {
  test("unknown org → null categories", async () => {
    assert.equal(await getOrgCategories("no-such-org"), null);
  });

  test("unknown org → null domains", async () => {
    assert.equal(await getOrgDomains("no-such-org"), null);
  });

  test("iq-dev-lab domains are sorted by order ascending", async () => {
    const domains = await getOrgDomains("iq-dev-lab");
    assert.ok(domains && domains.length > 0);
    const orders = domains!.map((d) => d.order);
    const sorted = [...orders].sort((a, b) => a - b);
    assert.deepEqual(orders, sorted);
    // Foundations (order 1) comes first per the data file
    assert.equal(domains![0]!.name, "Foundations");
  });

  test("getOrgCategories flattens domains in domain-order", async () => {
    const cats = await getOrgCategories("iq-dev-lab");
    assert.ok(cats && cats.length > 0);
    // First category belongs to the first (lowest-order) domain
    assert.equal(cats![0]!.name, "Foundations");
  });
});

describe("findDomainForCategory (real data)", () => {
  test("finds the owning domain by exact category name", async () => {
    const d = await findDomainForCategory("iq-dev-lab", "Foundations");
    assert.ok(d);
    assert.equal(d!.id, "foundations");
  });

  test("category name matching is normalized (spaces/&/case)", async () => {
    // "Languages & Runtimes" should match a normalized variant
    const d = await findDomainForCategory("iq-dev-lab", "languages&runtimes");
    assert.ok(d);
    assert.equal(d!.name, "Languages & Runtimes");
  });

  test("unknown category → null", async () => {
    assert.equal(await findDomainForCategory("iq-dev-lab", "Nonexistent Cat"), null);
  });

  test("unknown org → null", async () => {
    assert.equal(await findDomainForCategory("no-org", "Foundations"), null);
  });
});

describe("groupReposByCategory", () => {
  test("unknown org → single 'All' group, alphabetically sorted", async () => {
    const repos = [{ name: "zeta" }, { name: "alpha" }, { name: "mid" }];
    const groups = await groupReposByCategory("no-such-org", repos);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.category.name, "All");
    assert.deepEqual(groups[0]!.repos.map((r) => r.name), ["alpha", "mid", "zeta"]);
  });

  test("known org: matched repos grouped by category in defined order", async () => {
    // computer-architecture-deep-dive is the FIRST repo in Foundations
    const repos = [
      { name: "compiler-deep-dive" },
      { name: "computer-architecture-deep-dive" },
    ];
    const groups = await groupReposByCategory("iq-dev-lab", repos);
    const found = groups.find((g) => g.category.name === "Foundations");
    assert.ok(found, "Foundations group should exist");
    // ordering follows cat.repos index, not input order:
    // computer-architecture-deep-dive (idx0) before compiler-deep-dive (idx1)
    assert.deepEqual(found!.repos.map((r) => r.name), [
      "computer-architecture-deep-dive",
      "compiler-deep-dive",
    ]);
  });

  test("unmapped repos collected into an 'Other' group", async () => {
    const repos = [
      { name: "computer-architecture-deep-dive" },
      { name: "totally-unknown-repo" },
      { name: "another-unknown" },
    ];
    const groups = await groupReposByCategory("iq-dev-lab", repos);
    const other = groups.find((g) => g.category.name === "Other");
    assert.ok(other, "Other group should exist");
    // Other is alpha-sorted
    assert.deepEqual(other!.repos.map((r) => r.name), [
      "another-unknown",
      "totally-unknown-repo",
    ]);
  });

  test("only categories with matched repos are emitted (no empty groups)", async () => {
    const repos = [{ name: "computer-architecture-deep-dive" }];
    const groups = await groupReposByCategory("iq-dev-lab", repos);
    // Just the one Foundations group, no empties from other categories
    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.category.name, "Foundations");
    assert.ok(groups.every((g) => g.repos.length > 0));
  });

  test("empty repo list on known org → no groups", async () => {
    const groups = await groupReposByCategory("iq-dev-lab", []);
    assert.deepEqual(groups, []);
  });
});

describe("categorizeLocalRoadmap", () => {
  test("empty roadmapId → Topics (UNCATEGORIZED)", async () => {
    const c = await categorizeLocalRoadmap("iq-dev-lab", "");
    assert.equal(c.name, "Topics");
    assert.equal(c.emoji, "🗂");
  });

  test("single segment, no org → Topics", async () => {
    const c = await categorizeLocalRoadmap(null, "some-roadmap");
    assert.equal(c.name, "Topics");
  });

  test("first segment matches a category name → that category def", async () => {
    const c = await categorizeLocalRoadmap("iq-dev-lab", "Foundations/anything/01-x");
    assert.equal(c.name, "Foundations");
    // real category def has its own emoji/color (not the generic 📁)
    assert.notEqual(c.emoji, "📁");
  });

  test("first segment matches a repo name → owning category def", async () => {
    // computer-architecture-deep-dive lives under Foundations
    const c = await categorizeLocalRoadmap(
      "iq-dev-lab",
      "computer-architecture-deep-dive/sub/01-x",
    );
    assert.equal(c.name, "Foundations");
  });

  test("repo match honors -deep-dive optional suffix", async () => {
    const c = await categorizeLocalRoadmap(
      "iq-dev-lab",
      "computer-architecture/sub/01-x",
    );
    assert.equal(c.name, "Foundations");
  });

  test("no match + 2+ segments → first segment as ad-hoc category (📁)", async () => {
    const c = await categorizeLocalRoadmap("iq-dev-lab", "mystery-topic/sub-x");
    assert.equal(c.name, "mystery-topic");
    assert.equal(c.emoji, "📁");
  });

  test("no match + single segment → Topics", async () => {
    const c = await categorizeLocalRoadmap("iq-dev-lab", "mystery-topic");
    assert.equal(c.name, "Topics");
  });

  test("null org with 2+ segments → first segment as ad-hoc category", async () => {
    const c = await categorizeLocalRoadmap(null, "weird/path/here");
    assert.equal(c.name, "weird");
    assert.equal(c.emoji, "📁");
  });
});

// ───────────────────────────────────────────────
// ttl-cache
// ───────────────────────────────────────────────
describe("createTtlCache", () => {
  test("first get runs loader; second get within TTL is a cache hit", async () => {
    const cache = createTtlCache<number>(10_000);
    let calls = 0;
    const loader = async () => {
      calls += 1;
      return 42;
    };
    assert.equal(await cache.get("k", loader), 42);
    assert.equal(await cache.get("k", loader), 42);
    assert.equal(calls, 1, "loader should run only once within TTL");
  });

  test("different keys load independently", async () => {
    const cache = createTtlCache<string>(10_000);
    assert.equal(await cache.get("a", async () => "A"), "A");
    assert.equal(await cache.get("b", async () => "B"), "B");
    // a still cached
    assert.equal(await cache.get("a", async () => "SHOULD_NOT_RUN"), "A");
  });

  test("expired entry (ttl=0) re-runs the loader", async () => {
    const cache = createTtlCache<number>(0);
    let calls = 0;
    const loader = async () => {
      calls += 1;
      return calls;
    };
    const first = await cache.get("k", loader);
    const second = await cache.get("k", loader);
    // with ttlMs=0, Date.now()-at < 0 is always false → always miss
    assert.equal(first, 1);
    assert.equal(second, 2);
    assert.equal(calls, 2);
  });

  test("invalidate(key) forces a reload for that key only", async () => {
    const cache = createTtlCache<number>(10_000);
    let calls = 0;
    const loader = async () => {
      calls += 1;
      return calls;
    };
    await cache.get("k", loader); // calls=1
    cache.invalidate("k");
    const v = await cache.get("k", loader); // calls=2
    assert.equal(v, 2);
    assert.equal(calls, 2);
  });

  test("invalidate() with no key clears everything", async () => {
    const cache = createTtlCache<number>(10_000);
    let aCalls = 0;
    let bCalls = 0;
    await cache.get("a", async () => (++aCalls, 1));
    await cache.get("b", async () => (++bCalls, 1));
    cache.invalidate(); // clear all
    await cache.get("a", async () => (++aCalls, 1));
    await cache.get("b", async () => (++bCalls, 1));
    assert.equal(aCalls, 2);
    assert.equal(bCalls, 2);
  });

  test("concurrent misses for same key share one loader (dedup)", async () => {
    const cache = createTtlCache<number>(10_000);
    let calls = 0;
    let resolveLoader: (v: number) => void;
    const loader = () =>
      new Promise<number>((res) => {
        calls += 1;
        resolveLoader = res;
      });
    const p1 = cache.get("k", loader);
    const p2 = cache.get("k", loader);
    resolveLoader!(7);
    const [a, b] = await Promise.all([p1, p2]);
    assert.equal(a, 7);
    assert.equal(b, 7);
    assert.equal(calls, 1, "only one loader invocation for concurrent misses");
  });

  test("loader rejection: inflight is cleared so a retry re-runs loader", async () => {
    const cache = createTtlCache<number>(10_000);
    let calls = 0;
    const failOnce = async () => {
      calls += 1;
      if (calls === 1) throw new Error("boom");
      return 99;
    };
    await assert.rejects(() => cache.get("k", failOnce), /boom/);
    // after rejection, no value cached + inflight cleared → retry works
    const v = await cache.get("k", failOnce);
    assert.equal(v, 99);
    assert.equal(calls, 2);
  });
});
