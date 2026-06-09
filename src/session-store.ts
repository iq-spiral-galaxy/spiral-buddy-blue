import { randomUUID } from "node:crypto";
import type { Chapter } from "./roadmap.js";
import type { SpiralNote } from "./vault.js";
import type { ClaudeMessage } from "./claude.js";

export const SESSION_SYSTEM = `You are spiral-buddy, a Socratic learning companion in a local web app.

Your job is to help the learner build deep, durable understanding of one topic per session through spiral learning — revisiting concepts at increasing depth across sessions.

Behavior:
- Open by acknowledging where they are in the spiral: first time on this topic, deeper layer, or building on a related earlier note. Be brief.
- Lead with a question that probes their current intuition. Don't lecture upfront.
- When they answer, identify both what's solid and what's vague/wrong. Name it explicitly but kindly.
- Use concrete examples and analogies. If you give an explanation, follow it with a check question.
- When the learner seems confident, push to a harder case or an edge.
- When confused, slow down: smaller concept, simpler example, then re-test.
- If a related previous note covers something, surface it: "지난번에 [[topic]]에서 다뤘던 X 기억나? 그게 여기서 어떻게 적용될 것 같아?"
- Your responses are rendered as markdown — use code fences with language tags, headings, lists, and bold freely. Code is syntax-highlighted.
- Keep responses focused. 3-6 short paragraphs per turn is usually right. Long lectures are a smell.
- Match the learner's language (Korean unless they switch).

Source content discipline (v0.5.58):
- The chapter source content provided in the initial context may be TRUNCATED (marked with "(truncated)"). If you reference something that lies beyond what you can see, say so honestly: "본문에서 직접 확인 못 한 부분이지만 일반적으로..." Don't fabricate quotes from the truncated portion.
- PREFER paraphrase over direct quotation. Use a direct quote (verbatim, surrounded by quotation marks or a markdown blockquote) ONLY when you have the exact text in front of you and it is genuinely useful. When uncertain, paraphrase: "이 챕터는 대략 X를 다뤄" instead of "이 챕터에서 '...' 라고 한다".
- If the chapter source is thin/sparse (e.g., only README headings), say so up front: "이 챕터의 본문 자료가 짧아서 일반적 지식 기반으로 진행할게" — then proceed without inventing source-specific details.
- When asked for a specific line/quote you don't actually have, admit it rather than guess: "본문에서 그 구절은 내가 안 보고 있어. 학습자가 직접 본문 참고하면서 알려줄래?"`;

export interface LookupEntry {
  query: string;
  depth: "concise" | "medium" | "deep";
  response: string;
  at: number;
  /** 사용자가 키워드 옆에 같이 던진 추가 질문 (없으면 undefined). */
  userQuestion?: string;
}

export interface ActiveSession {
  id: string;
  chapter: Chapter;
  depth: number;
  related: SpiralNote[];
  messages: ClaudeMessage[];
  startedAt: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  /** 이번 세션에서 사용할 모델 id. 없으면 config.model 사용. */
  model?: string;
  /** 이번 세션 진행 중 사용자가 Look-up 한 표현들 (간결/중간/깊이) */
  lookups: LookupEntry[];
  /**
   * v0.5.58 — 챕터 본문 맥락 요약 캐시.
   * key: hash(sessionId + targetMessageText + selectionText)
   * value: 완성된 응답 텍스트 (재호출 시 즉시 반환)
   */
  chapterContextCache?: Map<string, string>;
}

const sessions = new Map<string, ActiveSession>();

export function createSession(args: {
  chapter: Chapter;
  depth: number;
  related: SpiralNote[];
  model?: string;
}): ActiveSession {
  const session: ActiveSession = {
    id: randomUUID(),
    chapter: args.chapter,
    depth: args.depth,
    related: args.related,
    messages: [],
    startedAt: Date.now(),
    totalInputTokens: 0,
    totalOutputTokens: 0,
    model: args.model,
    lookups: [],
  };
  sessions.set(session.id, session);
  return session;
}

export function getSession(id: string): ActiveSession | undefined {
  return sessions.get(id);
}

export function deleteSession(id: string): boolean {
  return sessions.delete(id);
}

export function buildInitialContext(
  chapter: Chapter,
  related: SpiralNote[],
  depth: number,
): string {
  const relatedBlock = related.length
    ? related
        .map(
          (n) =>
            `### ${n.topic} (depth ${n.depth}, ${n.date})
Summary: ${n.summary || "(none)"}
Excerpt: ${n.body.slice(0, 800)}`,
        )
        .join("\n\n")
    : "(no prior notes on this or related topics)";

  // v0.5.58 — truncation 상태와 본문 부실 여부를 모델에 명시.
  const fullLen = (chapter.content ?? "").length;
  const isTruncated = fullLen > 6000;
  const isThin = fullLen < 300; // README 헤더만 있는 등 거의 빈 챕터
  const contentNote = isTruncated
    ? `\n\n⚠️ 본문이 ${fullLen}자라 6000자에서 잘림. 잘린 뒤 부분은 보지 못함 — 인용 보수적으로.`
    : isThin
      ? `\n\n⚠️ 본문이 ${fullLen}자로 매우 짧음 (README 수준). 일반 지식 기반으로 진행하고 그 사실을 첫 메시지에 명시해줘.`
      : "";

  return `오늘의 학습 세션을 시작하자. 컨텍스트는 아래.

# 챕터 (depth ${depth})
**${chapter.title}**

## 챕터 본문
${truncate(chapter.content, 6000)}${contentNote}

# 관련된 이전 학습 노트
${relatedBlock}

# 세션 가이드
- depth가 1이면 처음 다루는 주제. 직관부터 시작.
- depth가 2 이상이면 나선형 복귀. 이전 노트에서 흐릿했던 지점부터 찔러봐.
- 첫 메시지는 짧게, 질문 위주로 시작.

이제 시작해줘.`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n\n... (truncated — 본문 ${s.length}자 중 6000자만 보임)`;
}
