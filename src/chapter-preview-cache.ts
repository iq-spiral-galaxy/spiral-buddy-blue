/**
 * v0.5.70 — 챕터 AI 미리보기 카드 캐시.
 *
 * 사용자가 사이드바에서 💡 버튼을 누르면 그 챕터의 본문을 Claude(Haiku 4.5)에게
 * 보내 "한 줄 요약 + 핵심 질문 2~3개 + 선수 지식" 형태의 카드를 생성한다.
 * 결과는 vault 안 `spiral-buddy/.preview-cache/<hash>.json`에 저장 — 다음
 * 클릭부터 즉시 표시. 챕터 본문이 바뀌면 contentHash 불일치로 자동 재생성.
 *
 * 명시적 트리거 + 캐시 패턴 — 사용자가 보고 싶은 챕터만 비용 발생, 한 번 생성
 * 후 영구.
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { type ClaudeClient, completeOnce } from "./claude.js";
import type { Chapter } from "./roadmap.js";

// vault.ts의 SPIRAL_DIR과 동일 정책 (workspace별 다른 sub-dir 지원).
const SPIRAL_DIR = process.env.SPIRAL_VAULT_SUBDIR?.trim() || "spiral-buddy";
const PREVIEW_CACHE_DIR = ".preview-cache";

/** Claude로 미리보기 생성할 때 본문 잘림 길이 (안 그러면 너무 길어서 비효율). */
const CHAPTER_CONTENT_FOR_PREVIEW_MAX = 8000;

/** 미리보기 카드에 쓸 기본 모델 — Haiku 4.5 (단순 요약이라 충분, Sonnet 대비 1/3 비용). */
const DEFAULT_PREVIEW_MODEL = "claude-haiku-4-5";

export interface ChapterPreviewCard {
  /** 한 문장 요약 — "이 챕터는 X를 다룬다" */
  summary: string;
  /** 핵심 질문 2~3개 — 이 챕터를 읽으면 답할 수 있게 되는 것 */
  keyQuestions: string[];
  /** 이 챕터를 이해하려면 알아야 할 사전 지식 (없으면 null) */
  prerequisites: string | null;
  /** 생성 당시 챕터 본문의 해시 — 본문 바뀌면 invalidate */
  contentHash: string;
  /** 생성 시점 (ms epoch). LLM ban 변경 없으니 Date.now 사용 OK. */
  generatedAt: number;
  /** 생성에 쓴 모델 id */
  model: string;
}

const PREVIEW_SYSTEM = `너는 학습 자료의 챕터 미리보기 카드를 생성하는 도우미야.

학습자가 챕터에 진입하기 전에 "이 챕터가 내가 공부하려는 내용이 맞나" 빠르게 판단할 수 있도록 짧고 정확한 카드를 만들어. 본문에 없는 내용은 절대 추측하지 마. 본문이 짧거나 모호하면 그에 맞게 짧게 답하고, 모르겠는 부분은 빼.

JSON으로만 응답. 마크다운 코드 펜스도 쓰지 마.

응답 스키마:
{
  "summary": "한 문장. 이 챕터에서 다루는 핵심을 60자 이내로. 예: 'JPA의 Lazy Loading 동작 원리와 N+1 문제'",
  "keyQuestions": ["이 챕터를 읽으면 답할 수 있게 되는 핵심 질문 2~3개. 각 80자 이내", "..."],
  "prerequisites": "이 챕터 이해에 필요한 사전 지식 한 줄. 없거나 자명하면 null"
}

응답 언어는 본문 언어와 맞춤 (한국어 본문 → 한국어 카드).`;

/** chapter content sha256 첫 16자. mtime 대신 content 기반 — 같은 내용 다른 mtime에도 캐시 유효. */
export function computeContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function cacheFilename(roadmapId: string, chapterId: string): string {
  // 파일시스템 안전 + 충돌 방지 → 양쪽 hash로 압축
  const safe = (s: string) =>
    createHash("sha256").update(s).digest("hex").slice(0, 16);
  return `${safe(roadmapId)}__${safe(chapterId)}.json`;
}

function cacheDirFor(vaultPath: string): string {
  return path.join(vaultPath, SPIRAL_DIR, PREVIEW_CACHE_DIR);
}

/**
 * 캐시된 카드 조회. 파일이 없거나 contentHash 불일치면 null 반환.
 * 클라이언트가 챕터 보기 결정 전에 이미 캐시 있는지 빠르게 알 수 있게.
 */
export async function loadCachedPreview(
  vaultPath: string,
  roadmapId: string,
  chapterId: string,
  expectedContentHash: string,
): Promise<ChapterPreviewCard | null> {
  const file = path.join(
    cacheDirFor(vaultPath),
    cacheFilename(roadmapId, chapterId),
  );
  try {
    const raw = await fs.readFile(file, "utf-8");
    const card = JSON.parse(raw) as ChapterPreviewCard;
    if (card.contentHash !== expectedContentHash) return null;
    return card;
  } catch {
    return null;
  }
}

/** 디스크에 카드 저장. 디렉토리 없으면 생성. */
export async function savePreview(
  vaultPath: string,
  roadmapId: string,
  chapterId: string,
  card: ChapterPreviewCard,
): Promise<void> {
  const dir = cacheDirFor(vaultPath);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, cacheFilename(roadmapId, chapterId));
  await fs.writeFile(file, JSON.stringify(card, null, 2), "utf-8");
}

/** 캐시 파일 존재 여부만 빠르게 — content 확인은 안 함 (성능). */
export async function isPreviewCached(
  vaultPath: string,
  roadmapId: string,
  chapterId: string,
): Promise<boolean> {
  const file = path.join(
    cacheDirFor(vaultPath),
    cacheFilename(roadmapId, chapterId),
  );
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Claude로 미리보기 카드 생성. 실패 시 throw — 호출자가 friendly error로 변환.
 *
 * 모델은 Haiku 4.5 기본 — 짧은 요약 task엔 충분하고 Sonnet 대비 1/3 비용.
 * options.model로 override 가능 (예: 사용자 설정 모델).
 */
export async function generatePreview(
  client: ClaudeClient,
  chapter: Chapter,
  options: { model?: string } = {},
): Promise<ChapterPreviewCard> {
  const content = chapter.content ?? "";
  const isTruncated = content.length > CHAPTER_CONTENT_FOR_PREVIEW_MAX;
  const body = isTruncated
    ? `${content.slice(0, CHAPTER_CONTENT_FOR_PREVIEW_MAX)}\n\n... (본문 ${content.length}자 중 앞 ${CHAPTER_CONTENT_FOR_PREVIEW_MAX}자만)`
    : content;

  const userMessage = `# 챕터 제목
${chapter.title}

# 챕터 본문
${body}`;

  const model = options.model ?? DEFAULT_PREVIEW_MODEL;
  const { text } = await completeOnce(client, {
    system: PREVIEW_SYSTEM,
    messages: [{ role: "user", content: userMessage }],
    maxTokens: 800,
    model,
  });

  // 모델이 가끔 코드 펜스 둘러주는 경우 정리
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(
      `미리보기 JSON 파싱 실패: ${(e as Error).message}\n응답 머리: ${text.slice(0, 200)}`,
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("미리보기 응답이 객체가 아님");
  }
  const p = parsed as Record<string, unknown>;

  const summary = String(p.summary ?? "").trim();
  const questionsRaw = Array.isArray(p.keyQuestions) ? p.keyQuestions : [];
  const keyQuestions = questionsRaw
    .map((q) => String(q ?? "").trim())
    .filter((q) => q.length > 0)
    .slice(0, 3);
  const prereqRaw =
    p.prerequisites === null || p.prerequisites === undefined
      ? null
      : String(p.prerequisites).trim();
  const prerequisites =
    prereqRaw && prereqRaw.toLowerCase() !== "null" ? prereqRaw : null;

  if (!summary) {
    throw new Error("미리보기 결과에 summary가 없음");
  }
  if (keyQuestions.length === 0) {
    throw new Error("미리보기 결과에 keyQuestions가 비어있음");
  }

  return {
    summary,
    keyQuestions,
    prerequisites,
    contentHash: computeContentHash(content),
    generatedAt: Date.now(),
    model,
  };
}
