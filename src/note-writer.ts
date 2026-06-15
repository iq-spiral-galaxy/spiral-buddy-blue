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
 * Look-up 응답에서 본문 첫 줄의 H1/H2 헤딩을 제거.
 * 모델이 종종 "## Buffer Pool" 같은 헤딩을 응답 맨 위에 다는데,
 * 우리는 이미 callout 제목으로 표제를 보여주므로 중복.
 */
function stripLeadingHeading(body: string): string {
  return body
    .replace(/^#{1,6}\s+.+\n+/, "")
    .replace(/^\*\*[^\n*]+\*\*\s*\n+/, "")
    .trim();
}

/**
 * Look-up 기록을 **Obsidian callout** 형태로 변환.
 *
 * Obsidian의 `<details>`는 reading view에서 안쪽 마크다운을 처리하지 않아
 * 코드/볼드/링크가 raw 텍스트로 보임 (v0.5.29 사용자 제보).
 *   → callout `> [!note]- ...` 형태로 전환:
 *      - markdown이 내부에서 정상 처리됨
 *      - `-` 접미사로 기본 collapsed
 *      - GitHub에서도 callout 자체는 인용 블록으로 가독성 있음
 *
 * concise는 짧으므로 접지 않고 바로 표시(callout `+` 또는 callout 없이 ### 헤딩).
 */
export function renderLookupsSection(lookups: LookupEntry[]): string {
  if (!lookups || lookups.length === 0) return "";
  const depthLabel = (d: string) =>
    d === "concise" ? "간결" : d === "deep" ? "깊이" : "중간";
  const calloutType = (d: string) =>
    d === "concise" ? "tip" : d === "deep" ? "abstract" : "note";

  const items = lookups
    .map((l) => {
      const q = l.query.replace(/\n/g, " ").trim();
      const body = stripLeadingHeading(l.response);
      const fold = l.depth === "concise" ? "+" : "-"; // concise는 펼쳐서, 나머지는 접어서
      // 사용자가 키워드 옆에 던진 추가 질문이 있으면 첫 줄에 표기
      const userQ = l.userQuestion?.trim();
      const questionLine = userQ
        ? `> _Q: ${userQ.replace(/\n/g, " ")}_\n>\n`
        : "";
      // 본문의 각 줄 앞에 `> ` 붙여서 callout 안에 포함
      const indented = body
        .split("\n")
        .map((line) => (line.length ? `> ${line}` : `>`))
        .join("\n");
      return `> [!${calloutType(l.depth)}]${fold} ${q} · _${depthLabel(l.depth)}_\n${questionLine}${indented}`;
    })
    .join("\n\n");
  return `\n\n## 🔍 학습 중 찾아본 표현 (${lookups.length})\n\n${items}\n`;
}

/**
 * 세션 전체 대화를 **접이식 Obsidian callout**으로 변환.
 *
 * 사용자 제보: 구조화 노트만 남고 실제 대화 내용은 사라져 다시 볼 수 없어 아쉽다.
 *   → 전체 대화를 collapsed callout(`> [!quote]-`)로 노트 끝에 보존.
 *     기본 접힘이라 노트를 어지럽히지 않고, 펼치면 대화 전체를 쭉 다시 읽을 수 있음.
 *   (Look-up과 동일하게 `<details>` 대신 callout을 쓰는 이유는 renderLookupsSection
 *    주석 참고 — reading view에서 내부 마크다운/코드/볼드가 정상 처리됨.)
 */
export function renderTranscriptSection(transcript: ClaudeMessage[]): string {
  // 첫 메시지는 초기 컨텍스트 주입 블록 — 실제 대화가 아니므로 제외.
  const msgs = (transcript ?? []).slice(1);
  if (msgs.length === 0) return "";
  const blocks = msgs.map((m) => {
    const who = m.role === "user" ? "🙋 나" : "🤖 버디";
    const content =
      typeof m.content === "string"
        ? m.content
        : m.content
            .filter((b) => b.type === "text")
            .map((b) => (b as { text: string }).text)
            .join("\n");
    // callout 안에 들어가도록 각 줄 앞에 `> ` (빈 줄은 `>`).
    const indented = content
      .split("\n")
      .map((line) => (line.length ? `> ${line}` : ">"))
      .join("\n");
    return `> **${who}**\n${indented}`;
  });
  // 메시지 사이는 callout 내부 빈 줄(`>`)로 구분.
  const inner = blocks.join("\n>\n");
  return `\n\n## 💬 전체 대화\n\n> [!quote]- 펼쳐서 대화 전체 다시 보기 (${msgs.length}개 메시지)\n${inner}\n`;
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

  // 8000 — 챕터 본문/대화 길이가 InnoDB Buffer Pool 같은 케이스에서 8섹션 모두
  // 채우면 4096을 넘기는 경우가 있었음. JSON이 잘리면 safeJsonParse가 실패해
  // fallback path (raw transcript) 로 빠지므로 충분히 여유 둠.
  const { text } = await completeOnce(client, {
    system: STRUCTURE_SYSTEM,
    messages: [{ role: "user", content: userMsg }],
    maxTokens: 8000,
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
  const bodyWithLookups =
    patchedBody + lookupsSection + renderTranscriptSection(args.transcript);

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
