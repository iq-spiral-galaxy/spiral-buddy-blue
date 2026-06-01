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
- Reference the chapter source content when grounding facts. Don't make things up.
- If a related previous note covers something, surface it: "지난번에 [[topic]]에서 다뤘던 X 기억나? 그게 여기서 어떻게 적용될 것 같아?"
- Your responses are rendered as markdown — use code fences with language tags, headings, lists, and bold freely. Code is syntax-highlighted.
- Keep responses focused. 3-6 short paragraphs per turn is usually right. Long lectures are a smell.
- Match the learner's language (Korean unless they switch).`;

export interface LookupEntry {
  query: string;
  depth: "concise" | "medium" | "deep";
  response: string;
  at: number;
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

  return `오늘의 학습 세션을 시작하자. 컨텍스트는 아래.

# 챕터 (depth ${depth})
**${chapter.title}**

## 챕터 본문
${truncate(chapter.content, 6000)}

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
  return `${s.slice(0, max)}\n\n... (truncated)`;
}
