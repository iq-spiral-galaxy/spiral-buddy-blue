import { completeOnce, type ClaudeClient, type ClaudeMessage } from "./claude.js";
import type { Chapter } from "./roadmap.js";
import type { SpiralNote, NewNote } from "./vault.js";
import type { LookupEntry } from "./session-store.js";

const STRUCTURE_SYSTEM = `You convert a learning conversation into a structured Obsidian note.

Output STRICT JSON only (no prose, no markdown fences):
{
  "summary": string,
  "tags": string[],
  "body": string
}

The "body" must follow this exact structure with these EXACT headings:

## 한 줄 요약
(2-3 lines max)

## 핵심 개념
(bullet list of the core concepts the learner engaged with this session)

## 직관 / 비유
(the analogies or mental models that landed for the learner — pulled from the actual conversation)

## 짚고 넘어간 예제
(concrete examples discussed — code snippets if any, formatted in fenced blocks)

## 헷갈렸던 / 확인이 필요한 지점
(things the learner got wrong, hesitated on, or asked twice — be specific, this is the most valuable section)

## 이전 학습과의 연결
(how this builds on or connects to prior spiral-buddy notes — reference them as [[note-title]] if relevant)

## 다음에 볼 것
(specific, actionable next steps — what to revisit, what to push deeper, what blocks this unblocks)

Rules:
- Write in the SAME LANGUAGE as the conversation (likely Korean).
- Be ruthlessly concrete. Quote the learner's own framings when possible.
- Don't fabricate content that wasn't in the conversation.
- If a section has nothing real to put in it, write a single italicized line like "_이번 세션에서 다루지 않음._".
- Tags should reflect topic, not meta ("redis-memory", "cow-semantics", not "learning", "study").
- **Summary**: write a clean topical summary. Do NOT start with the chapter number (e.g., write "Fixtures & SetUp 첫 스파이럴…" not "05. Fixtures & SetUp 첫 스파이럴…"). The chapter title is recorded separately.`;

/** 8섹션 헤딩 — save_note 검증/보충 시 사용 */
export const REQUIRED_SECTIONS = [
  "한 줄 요약",
  "핵심 개념",
  "직관 / 비유",
  "짚고 넘어간 예제",
  "헷갈렸던 / 확인이 필요한 지점",
  "이전 학습과의 연결",
  "다음에 볼 것",
] as const;

export interface SectionValidation {
  missing: string[];
  /** 누락된 섹션이 placeholder로 채워진 최종 body */
  patchedBody: string;
}

/**
 * body가 8섹션 헤딩을 모두 포함하는지 검사.
 * 누락된 섹션은 body 끝에 placeholder로 자동 보충.
 */
export function validateAndPatchSections(body: string): SectionValidation {
  const missing: string[] = [];
  const lines = body.split("\n");
  const presentHeadings = new Set<string>();

  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) presentHeadings.add(m[1]!.trim());
  }

  for (const section of REQUIRED_SECTIONS) {
    if (!presentHeadings.has(section)) missing.push(section);
  }

  if (missing.length === 0) return { missing, patchedBody: body };

  const patchSuffix = missing
    .map((s) => `\n## ${s}\n_이번 세션에서 다루지 않음._\n`)
    .join("");
  const patchedBody = body.trimEnd() + "\n" + patchSuffix;
  return { missing, patchedBody };
}

/**
 * "05. Fixtures & SetUp" → "Fixtures & SetUp" (leading number prefix 제거).
 * summary나 표시용 토픽에서 자연스럽게 사용.
 */
export function stripChapterNumberPrefix(s: string): string {
  return s.replace(/^\s*\d+[.\-_:]\s+/, "").trim();
}

/**
 * 챕터의 roadmapId(예: "unit-testing/anatomy-of-good-tests")를 분해해
 *   { repo, roadmap } 반환. 슬래시가 없으면 repo는 null, roadmap은 통째로.
 */
export function splitRepoAndRoadmap(roadmapId: string): { repo: string | null; roadmap: string } {
  const parts = roadmapId.split("/").filter(Boolean);
  if (parts.length <= 1) return { repo: null, roadmap: parts[0] ?? roadmapId };
  // 첫 segment = repo, 나머지 = roadmap path
  return { repo: parts[0]!, roadmap: parts.slice(1).join("/") };
}

/**
 * Lookup 기록을 마크다운 collapsible 섹션으로 변환.
 * Obsidian/GitHub 모두에서 동작하는 <details> + <summary> 형태.
 */
export function renderLookupsSection(lookups: LookupEntry[]): string {
  if (!lookups || lookups.length === 0) return "";
  const depthLabel = (d: string) =>
    d === "concise" ? "간결" : d === "deep" ? "깊이" : "중간";
  const items = lookups
    .map((l) => {
      const q = l.query.replace(/\n/g, " ").trim();
      const body = l.response.trim();
      return `<details>
<summary><strong>${escapeHtml(q)}</strong> · <em>${depthLabel(l.depth)}</em></summary>

${body}

</details>`;
    })
    .join("\n\n");
  return `\n\n## 🔍 학습 중 찾아본 표현 (${lookups.length})\n\n${items}\n`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function generateNote(
  client: ClaudeClient,
  args: {
    chapter: Chapter;
    transcript: ClaudeMessage[];
    related: SpiralNote[];
    depth: number;
    lookups?: LookupEntry[];
  },
): Promise<NewNote> {
  const transcriptText = args.transcript
    .map((m) => {
      const role = m.role === "user" ? "Learner" : "Claude";
      const content =
        typeof m.content === "string"
          ? m.content
          : m.content
              .filter((b) => b.type === "text")
              .map((b) => (b as { text: string }).text)
              .join("\n");
      return `### ${role}\n${content}`;
    })
    .join("\n\n");

  const relatedText = args.related.length
    ? args.related
        .map(
          (n) =>
            `- [[${n.relativePath.replace(/\.md$/, "")}]] (depth ${n.depth}): ${n.summary}`,
        )
        .join("\n")
    : "(none)";

  const userMsg = `# Chapter being learned
Roadmap: ${args.chapter.roadmapName} (${args.chapter.roadmapId})
Title: ${args.chapter.title}
Chapter id: ${args.chapter.id}

# Chapter source content (excerpt)
${truncate(args.chapter.content, 4000)}

# Related previous notes
${relatedText}

# Session transcript
${transcriptText}

Now produce the structured note JSON.`;

  const { text } = await completeOnce(client, {
    system: STRUCTURE_SYSTEM,
    messages: [{ role: "user", content: userMsg }],
    maxTokens: 4096,
  });

  const lookupsSection = renderLookupsSection(args.lookups ?? []);

  const { repo, roadmap } = splitRepoAndRoadmap(args.chapter.roadmapId);

  const parsed = safeJsonParse(text);
  if (!parsed) {
    return {
      topic: args.chapter.title,
      chapterId: args.chapter.id,
      roadmapId: args.chapter.roadmapId,
      roadmapName: args.chapter.roadmapName,
      repo,
      roadmap,
      depth: args.depth,
      tags: ["fallback"],
      summary: "Auto-structuring failed; raw transcript saved.",
      body: `> ⚠ Note structuring failed. Raw transcript below.\n\n${transcriptText}${lookupsSection}`,
      relatedNotePaths: args.related.map((r) => r.filePath),
    };
  }

  const rawBody =
    typeof parsed.body === "string"
      ? parsed.body
      : "(note body generation failed)";
  const { patchedBody } = validateAndPatchSections(rawBody);
  const bodyWithLookups = patchedBody + lookupsSection;

  const rawSummary =
    typeof parsed.summary === "string" ? parsed.summary : "(no summary)";
  // 모델이 무시하고 "05. Foo" 처럼 prefix를 넣은 경우 한 번 더 정리
  const cleanSummary = stripChapterNumberPrefix(rawSummary);

  return {
    topic: args.chapter.title,
    chapterId: args.chapter.id,
    roadmapId: args.chapter.roadmapId,
    roadmapName: args.chapter.roadmapName,
    repo,
    roadmap,
    depth: args.depth,
    tags: Array.isArray(parsed.tags)
      ? (parsed.tags as unknown[]).filter(
          (x): x is string => typeof x === "string",
        )
      : [],
    summary: cleanSummary,
    body: bodyWithLookups,
    relatedNotePaths: args.related.map((r) => r.filePath),
  };
}

function safeJsonParse(s: string): Record<string, unknown> | null {
  try {
    const cleaned = s
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n\n... (truncated, ${s.length - max} more chars)`;
}
