import { completeOnce, type ClaudeClient, type ClaudeMessage } from "./claude.js";
import type { Chapter } from "./roadmap.js";
import type { SpiralNote, NewNote } from "./vault.js";
import type { LookupEntry } from "./session-store.js";

const STRUCTURE_SYSTEM = `You convert a learning conversation into a structured Obsidian note.

Output PLAIN MARKDOWN — NOT JSON. Do not wrap the note in a JSON object, and do not wrap the whole thing in code fences. Write the note as real markdown directly.

Start with ONE tags line (3-6 topical tags, comma-separated, no '#'), then a blank line:

TAGS: redis-memory, cow-semantics, fork-internals

Then the note body, using this exact structure with these EXACT headings (in this order):

## 한 줄 요약
(2-3 lines max — this section also serves as the note summary)

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
- Output everything as real markdown directly — NEVER as a JSON string, never escaped, never wrapped in fences. Code examples go in normal triple-backtick fenced blocks inside the relevant section.
- Write in the SAME LANGUAGE as the conversation (likely Korean).
- Be ruthlessly concrete. Quote the learner's own framings when possible.
- Don't fabricate content that wasn't in the conversation.
- If a section has nothing real to put in it, write a single italicized line like "_이번 세션에서 다루지 않음._".
- Tags should reflect topic, not meta ("redis-memory", "cow-semantics", not "learning", "study").
- The "## 한 줄 요약" section doubles as the note summary. Do NOT start it with the chapter number (write "Fixtures & SetUp 첫 스파이럴…" not "05. Fixtures & SetUp 첫 스파이럴…"). The chapter title is recorded separately.`;

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

Now produce the structured note in the markdown format described above (TAGS line first, then the sections). Output markdown only — no JSON, no surrounding fences.`;

  // 16000 — 8섹션을 모두 채우면 길어질 수 있어 여유를 둔다. (마크다운 직접 출력
  // 방식이라 설령 여기서 잘려도 부분 마크다운이 그대로 유효 → validateAndPatchSections가
  // 누락 섹션만 채워 graceful하게 degrade됨. 옛 JSON 방식은 잘리면 통째로 fallback이었음.)
  const { text } = await completeOnce(client, {
    system: STRUCTURE_SYSTEM,
    messages: [{ role: "user", content: userMsg }],
    maxTokens: 16000,
  });

  const lookupsSection = renderLookupsSection(args.lookups ?? []);

  const { repo, roadmap } = splitRepoAndRoadmap(args.chapter.roadmapId);

  const parsed = parseStructuredNote(text);
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
      // 구조화(8섹션)는 실패했어도 대화 원문은 "전체 대화" 토글로 보기 좋게 보존.
      // (옛 동작은 transcript를 flat하게 + Learner/Claude 라벨로 덤프 → 첫 컨텍스트
      //  블록까지 쏟아져 가독성이 나빴음. renderTranscriptSection이 컨텍스트 제외 +
      //  나/버디 라벨 + 접이식 callout으로 처리.)
      body: `> [!warning] 자동 구조화에 실패했어요 — 8섹션 정리는 생략됐지만, 아래 **💬 전체 대화** 토글에서 원문을 그대로 볼 수 있어요.${lookupsSection}${renderTranscriptSection(args.transcript)}`,
      relatedNotePaths: args.related.map((r) => r.filePath),
    };
  }

  const { patchedBody } = validateAndPatchSections(parsed.body);
  const bodyWithLookups =
    patchedBody + lookupsSection + renderTranscriptSection(args.transcript);

  // summary = '## 한 줄 요약' 섹션. 모델이 "05. Foo" prefix를 넣었으면 정리하고,
  // 비어 있으면 챕터 제목으로 폴백.
  const cleanSummary =
    stripChapterNumberPrefix(parsed.summary) || args.chapter.title;

  return {
    topic: args.chapter.title,
    chapterId: args.chapter.id,
    roadmapId: args.chapter.roadmapId,
    roadmapName: args.chapter.roadmapName,
    repo,
    roadmap,
    depth: args.depth,
    tags: parsed.tags,
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

/**
 * 구조화 출력 파서 — 모델이 마크다운을 그대로 출력하게 하고 그것을 파싱한다.
 *
 * 왜 JSON이 아니라 마크다운인가:
 *   옛 방식은 8섹션 마크다운 본문(코드블록·따옴표·줄바꿈 포함)을 JSON 문자열
 *   필드에 넣게 시켰다. 모델이 그 큰 문자열의 escaping(\n, \", \\)을 완벽히
 *   못 하거나 maxTokens에서 잘리면 JSON.parse가 실패 → "자동 구조화 실패"
 *   fallback으로 빠졌다(간헐적). 마크다운을 그대로 받으면:
 *     1) escaping 자체가 없으니 그 원인이 원천 차단되고,
 *     2) 잘려도 부분 마크다운은 여전히 유효 → validateAndPatchSections가
 *        누락 섹션만 채워 graceful하게 degrade된다.
 *   tags만 짧은 'TAGS:' 헤더로 받는다(짧고 맨 위 → 거의 안 잘림/안 깨짐).
 *
 * 호환: 모델이 옛 습관대로 JSON으로 응답해도 그 경로로 수용한다.
 *
 * 반환 null = 섹션(## …)이 하나도 없는 진짜 실패 → 호출부가 fallback 처리.
 */
function parseStructuredNote(
  text: string,
): { tags: string[]; summary: string; body: string } | null {
  let s = text.trim();

  // (호환) 옛 방식대로 JSON으로 응답한 경우 — body가 들어있으면 그대로 수용
  if (s.startsWith("{")) {
    const j = safeJsonParse(s);
    if (j && typeof j.body === "string") {
      return {
        tags: Array.isArray(j.tags)
          ? (j.tags as unknown[]).filter(
              (x): x is string => typeof x === "string",
            )
          : [],
        summary:
          typeof j.summary === "string" && j.summary.trim()
            ? j.summary
            : extractSection(j.body, "한 줄 요약"),
        body: j.body,
      };
    }
    // JSON처럼 보였지만 파싱 실패 → 아래 마크다운 파서로 폴스루
  }

  // 모델이 전체를 ```markdown … ``` 펜스로 감쌌으면 제거
  s = s
    .replace(/^```(?:markdown|md)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();

  const lines = s.split("\n");
  const firstHeadingIdx = lines.findIndex((l) => /^##\s+/.test(l));
  if (firstHeadingIdx === -1) return null; // 섹션 자체가 없음 → 진짜 실패

  const header = lines.slice(0, firstHeadingIdx).join("\n");
  const body = lines.slice(firstHeadingIdx).join("\n").trim();

  // TAGS: a, b, c  (헤더 우선, 없으면 전체에서 한 번 더)
  const tagsMatch =
    header.match(/^[ \t>*-]*TAGS[ \t]*[:：][ \t]*(.+)$/im) ??
    s.match(/^[ \t>*-]*TAGS[ \t]*[:：][ \t]*(.+)$/im);
  const tags = tagsMatch
    ? tagsMatch[1]!
        .split(/[,，]/)
        .map((t) => t.trim().replace(/^#/, ""))
        .filter(Boolean)
    : [];

  const summary = extractSection(body, "한 줄 요약");

  return { tags, summary, body };
}

/** body에서 '## <heading>' 섹션 본문을 한 줄로 추출(요약용). 없으면 "". */
function extractSection(body: string, heading: string): string {
  const lines = body.split("\n");
  const esc = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const start = lines.findIndex((l) =>
    new RegExp(`^##\\s+${esc}\\s*$`).test(l),
  );
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s+/.test(l));
  const sectionLines = end === -1 ? rest : rest.slice(0, end);
  return sectionLines.join(" ").replace(/\s+/g, " ").trim();
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n\n... (truncated, ${s.length - max} more chars)`;
}
