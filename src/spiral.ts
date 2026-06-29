import type { Chapter, Roadmap } from "./roadmap.js";
import type { SpiralNote } from "./vault.js";
import { noteBelongsToRoadmap, noteMatchesChapter } from "./vault.js";
import { completeOnce, type ClaudeClient } from "./claude.js";
import { safeJsonParse } from "./text-utils.js";

export interface SpiralSuggestion {
  recommendedChapterId: string | null;
  rationale: string;
  related: SpiralNote[];
  mode: "first-time" | "deeper-layer" | "next-chapter" | "cross-link";
}

const SUGGEST_SYSTEM = `You analyze a learner's roadmap and their past spiral-buddy notes, then suggest what to study next.

You output STRICT JSON only, no prose, no markdown fences, matching this shape:
{
  "recommendedChapterId": string | null,
  "mode": "first-time" | "deeper-layer" | "next-chapter" | "cross-link",
  "rationale": string,
  "relatedChapterIds": string[]
}

Principles:
- If no prior notes exist → mode "first-time", pick the earliest chapter.
- If the user has notes on a topic at depth 1 and seems uncertain about parts of it → mode "deeper-layer", recommend the SAME chapter again (deeper).
- If the user has solid depth-1 notes on previous chapters → mode "next-chapter", advance.
- If two distant chapters connect to recent learning → mode "cross-link".
- Choose recommendedChapterId from the provided list. Return null only if nothing fits.
- "relatedChapterIds" must reference items from the provided notes.
- Keep rationale under 280 chars, written in Korean if the notes are Korean, else English.`;

export async function suggestNext(
  client: ClaudeClient,
  roadmap: Roadmap,
  chapters: Chapter[],
  allNotes: SpiralNote[],
): Promise<SpiralSuggestion> {
  // 이 로드맵에 속하는 노트만 추리기
  const notes = allNotes.filter((n) =>
    noteBelongsToRoadmap(n, { roadmapId: roadmap.id, roadmapName: roadmap.name }),
  );

  if (chapters.length === 0) {
    return {
      recommendedChapterId: null,
      rationale: "No chapters found in roadmap.",
      related: [],
      mode: "first-time",
    };
  }

  if (notes.length === 0) {
    const first = chapters[0]!;
    return {
      recommendedChapterId: first.id,
      rationale: `${roadmap.name} 로드맵의 이전 학습 기록이 없어. 첫 챕터부터 시작하자.`,
      related: [],
      mode: "first-time",
    };
  }

  const chapterIndex = chapters
    .map((c) => `- id: "${c.id}" · title: "${c.title}"`)
    .join("\n");

  const noteIndex = notes
    .slice(0, 30)
    .map(
      (n) =>
        `- chapter_id: "${n.chapterId ?? "?"}" · topic: "${n.topic}" · depth: ${n.depth} · date: ${n.date} · summary: ${n.summary || "(none)"}`,
    )
    .join("\n");

  const userMsg = `# Roadmap: ${roadmap.name}
Chapters:
${chapterIndex}

# Past spiral-buddy notes for this roadmap (newest first)
${noteIndex}

Suggest what the learner should study next. Return JSON only.`;

  const { text } = await completeOnce(client, {
    system: SUGGEST_SYSTEM,
    messages: [{ role: "user", content: userMsg }],
    maxTokens: 1024,
  });

  const parsed = safeJsonParse(text);
  const recommendedId =
    typeof parsed?.recommendedChapterId === "string"
      ? parsed.recommendedChapterId
      : null;
  const mode = isMode(parsed?.mode) ? parsed.mode : "next-chapter";
  const rationale =
    typeof parsed?.rationale === "string" ? parsed.rationale : "(no rationale)";
  const relatedIds: string[] = Array.isArray(parsed?.relatedChapterIds)
    ? (parsed.relatedChapterIds as unknown[]).filter(
        (x): x is string => typeof x === "string",
      )
    : [];

  // 관련 노트: relatedChapterIds에 포함된 것 + 추천된 챕터의 노트
  const chaptersById = new Map(chapters.map((c) => [c.id, c]));
  const related = notes.filter((n) => {
    if (
      recommendedId &&
      noteMatchesChapter(n, {
        roadmapId: roadmap.id,
        roadmapName: roadmap.name,
        chapterId: recommendedId,
        chapterTitle: chaptersById.get(recommendedId)?.title,
      })
    ) {
      return true;
    }
    return relatedIds.some((cid) =>
      noteMatchesChapter(n, {
        roadmapId: roadmap.id,
        roadmapName: roadmap.name,
        chapterId: cid,
        chapterTitle: chaptersById.get(cid)?.title,
      }),
    );
  });

  return { recommendedChapterId: recommendedId, rationale, related, mode };
}

function isMode(v: unknown): v is SpiralSuggestion["mode"] {
  return (
    v === "first-time" ||
    v === "deeper-layer" ||
    v === "next-chapter" ||
    v === "cross-link"
  );
}
