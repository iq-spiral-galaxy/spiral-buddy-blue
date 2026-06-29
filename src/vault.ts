import fs from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";
import matter from "gray-matter";
import { createTtlCache } from "./ttl-cache.js";

export interface SpiralNote {
  filePath: string;
  relativePath: string;
  title: string;
  topic: string;
  chapterId: string | null;
  /** v0.5.22+ frontmatter `chapter:`. 옛 노트면 title/topic에서 fallback. */
  chapter: string;
  /** 신규 스키마: roadmap의 root-relative path. 옛 노트는 null. */
  roadmapId: string | null;
  /** roadmap basename (표시용). 옛 노트도 보유. */
  roadmapName: string | null;
  /** v0.5.22+: 상위 레포 (옛 노트는 roadmapId에서 추출). */
  repo: string | null;
  date: string;
  depth: number;
  tags: string[];
  summary: string;
  body: string;
}

// 노트 저장 위치 (vault 안의 sub-dir). workspace별로 다른 폴더 사용 가능.
// env로 주입 가능: 기본 "spiral-buddy", 다른 방은 "spiral-buddy-<id>" 등.
const SPIRAL_DIR = process.env.SPIRAL_VAULT_SUBDIR?.trim() || "spiral-buddy";
const TRASH_DIR = ".trash";

// v0.5.76 — 매 API 요청(/roadmaps, /chapters, /activity, /history, /search)
// 마다 vault 전체를 glob+read하던 비용 제거. 노트 변경은 이 프로세스가
// 직접 수행(writeNewNote/moveNotesToTrash/restoreFromTrash)하므로 그때
// invalidate. 외부에서 vault를 고치는 경우는 30초 TTL이 안전망.
const notesCache = createTtlCache<SpiralNote[]>(30_000);

export function invalidateNotesCache(): void {
  notesCache.invalidate();
}

export async function listSpiralNotes(
  vaultPath: string,
): Promise<SpiralNote[]> {
  const cached = await notesCache.get(vaultPath, () =>
    listSpiralNotesUncached(vaultPath),
  );
  // 호출자가 sort 등으로 배열을 mutate해도 캐시가 오염되지 않게 shallow copy
  return [...cached];
}

async function listSpiralNotesUncached(
  vaultPath: string,
): Promise<SpiralNote[]> {
  const spiralRoot = path.join(vaultPath, SPIRAL_DIR);
  try {
    await fs.access(spiralRoot);
  } catch {
    return [];
  }

  const files = await glob("**/*.md", {
    cwd: spiralRoot,
    ignore: ["_index.md", `${TRASH_DIR}/**`],
    nodir: true,
  });

  const notes: SpiralNote[] = [];
  for (const rel of files) {
    const abs = path.join(spiralRoot, rel);
    const note = await readNote(abs, rel);
    if (note) notes.push(note);
  }
  // date desc, 동일 날짜는 relativePath로 안정 정렬(결정성).
  notes.sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      a.relativePath.localeCompare(b.relativePath),
  );
  return notes;
}

/**
 * 노트의 frontmatter만 빠르게 파싱한다. 파일 전체를 읽지 않고 앞부분(16KB)만 읽음.
 *
 * v0.5.100+에서 노트 본문에 전체 대화 transcript가 들어가 노트가 수십~수백 KB로
 * 커졌는데, listSpiralNotes가 모든 노트를 fs.readFile로 전부 읽고 matter()로
 * 파싱하면서 cold-start(앱 실행 시 첫 /api/roadmaps)가 느려졌음 — 사이드바가
 * 장시간 "loading…"에 머무는 회귀. frontmatter는 맨 앞 작은 YAML 블록이라
 * 앞부분만 읽어도 동일하게 파싱된다(본문 transcript는 어차피 안 씀).
 */
async function readFrontmatter(filePath: string) {
  const HEAD = 16384; // frontmatter는 보통 <1KB — 넉넉한 상한
  const fh = await fs.open(filePath, "r");
  try {
    const buf = Buffer.alloc(HEAD);
    const { bytesRead } = await fh.read(buf, 0, HEAD, 0);
    let head = buf.subarray(0, bytesRead).toString("utf-8");
    // 안전장치: head가 꽉 찼는데(파일이 16KB↑) 닫는 `---`가 안 보이면 frontmatter가
    // 16KB를 넘는 비정상 케이스 → 전체를 읽어 폴백(정상 노트에선 발생 안 함).
    if (bytesRead === HEAD && !/\n---[ \t]*(\r?\n|$)/.test(head.slice(3))) {
      head = await fs.readFile(filePath, "utf-8");
    }
    return matter(head);
  } finally {
    await fh.close();
  }
}

async function readNote(
  abs: string,
  relativePath: string,
): Promise<SpiralNote | null> {
  try {
    const parsed = await readFrontmatter(abs);
    const fm = parsed.data as Record<string, unknown>;
    // 새 스키마 (v0.5.22+): chapter, repo, roadmap 우선. 옛 스키마 (title/topic/chapter_id/roadmap_id) 호환.
    const newChapter = (fm.chapter as string | undefined) ?? null;
    const newRepo = (fm.repo as string | undefined) ?? null;
    const newRoadmap = (fm.roadmap as string | undefined) ?? null;

    const titleFm = (fm.title as string | undefined) ?? null;
    const topicFm = (fm.topic as string | undefined) ?? null;
    const fallbackName = path.basename(abs, ".md");

    // 옛 노트의 roadmap_id (예: "unit-testing/anatomy-of-good-tests")에서 repo 추출 (fallback)
    const oldRoadmapId = (fm.roadmap_id as string | undefined) ?? null;
    let inferredRepo = newRepo;
    let inferredRoadmapName = newRoadmap;
    if (!inferredRepo && oldRoadmapId && oldRoadmapId.includes("/")) {
      const parts = oldRoadmapId.split("/").filter(Boolean);
      if (parts.length > 1) {
        inferredRepo = parts[0] ?? null;
        if (!inferredRoadmapName) {
          inferredRoadmapName = parts.slice(1).join("/");
        }
      }
    }

    return {
      filePath: abs,
      relativePath,
      title: titleFm ?? newChapter ?? topicFm ?? fallbackName,
      topic: topicFm ?? newChapter ?? titleFm ?? fallbackName,
      chapter: newChapter ?? titleFm ?? topicFm ?? fallbackName,
      chapterId: (fm.chapter_id as string | undefined) ?? null,
      roadmapId: oldRoadmapId,
      roadmapName: inferredRoadmapName ?? (fm.roadmap as string | undefined) ?? null,
      repo: inferredRepo ?? null,
      date: formatDate(fm.date),
      depth: typeof fm.depth === "number" ? fm.depth : 1,
      tags: Array.isArray(fm.tags) ? (fm.tags as string[]) : [],
      summary: (fm.summary as string | undefined) ?? "",
      body: parsed.content.trim(),
    };
  } catch {
    return null;
  }
}

/**
 * 노트 한 개의 frontmatter + 본문 "전체"를 읽는다.
 * listSpiralNotes/readNote는 성능을 위해 앞 16KB만 읽어 본문이 잘리므로
 * (긴 transcript 포함 노트), 본문 전체가 필요한 경우(과거 대화 다시보기)엔 이걸 쓴다.
 *
 * 보안: relativePath는 vault의 spiral 디렉토리(spiralRoot) 기준 상대경로여야 하며,
 * 디렉토리 밖으로 탈출(../ 등)하거나 .md가 아니면 null을 반환한다.
 */
export async function readFullNote(
  vaultPath: string,
  relativePath: string,
): Promise<{ data: Record<string, unknown>; body: string } | null> {
  const spiralRoot = path.resolve(vaultPath, SPIRAL_DIR);
  const abs = path.resolve(spiralRoot, relativePath);
  if (abs !== spiralRoot && !abs.startsWith(spiralRoot + path.sep)) return null;
  if (!abs.toLowerCase().endsWith(".md")) return null;
  try {
    const raw = await fs.readFile(abs, "utf-8");
    const parsed = matter(raw);
    return {
      data: parsed.data as Record<string, unknown>,
      body: parsed.content,
    };
  } catch {
    return null;
  }
}

export interface NewNote {
  /** 챕터 표시명 (예: "05. Fixtures & SetUp") — frontmatter `chapter:`로 기록 */
  topic: string;
  /** 원본 챕터 파일 경로 (예: "05-fixtures-and-setup.md") — 매칭 fallback용 */
  chapterId: string | null;
  /** roadmap root-relative path (예: "unit-testing/anatomy-of-good-tests") */
  roadmapId: string | null;
  roadmapName: string | null;
  /** 상위 레포 (roadmapId 첫 segment, 예: "unit-testing"). flat이면 null. */
  repo: string | null;
  /** 레포 내 roadmap path (예: "anatomy-of-good-tests"). flat이면 roadmapId와 동일. */
  roadmap: string;
  depth: number;
  tags: string[];
  summary: string;
  body: string;
  relatedNotePaths: string[];
}

export async function writeNewNote(
  vaultPath: string,
  note: NewNote,
): Promise<string> {
  const spiralRoot = path.join(vaultPath, SPIRAL_DIR);
  await fs.mkdir(spiralRoot, { recursive: true });

  const date = new Date().toISOString().slice(0, 10);

  // 파일명: 사람 친화적 — 챕터 제목에서 "05. " 같은 prefix 빼고, " d{depth}" 붙임.
  //   "05. Fixtures & SetUp" + depth=1 → "Fixtures & SetUp d1.md"
  //   "test-doubles-taxonomy" + depth=2 → "test-doubles-taxonomy d2.md"
  // 날짜 prefix 제거 (사용자 요청). 같은 챕터·depth 충돌 시 counter suffix.
  const cleanTopic = stripLeadingChapterNumber(note.topic);
  const safeName = sanitizeFileName(cleanTopic);
  let fileName = `${safeName} d${note.depth}.md`;
  let counter = 2;
  while (await fileExists(path.join(spiralRoot, fileName))) {
    fileName = `${safeName} d${note.depth} (${counter}).md`;
    counter++;
    if (counter > 99) {
      throw new Error(
        `Cannot find unique file name for ${safeName} d${note.depth}`,
      );
    }
  }
  const filePath = path.join(spiralRoot, fileName);

  const relatedBasenames = note.relatedNotePaths.map((p) =>
    path.basename(p, ".md"),
  );

  // Frontmatter 순서 — 사용자 요청: repo → roadmap → chapter → depth → 그 외.
  // title/topic/chapter_id/roadmap_id/generator는 제거. 옛 노트와의 매칭은 readNote가 호환.
  const frontmatter = [
    "---",
    note.repo ? `repo: "${escapeYaml(note.repo)}"` : null,
    `roadmap: "${escapeYaml(note.roadmap)}"`,
    `chapter: "${escapeYaml(note.topic)}"`,
    `depth: ${note.depth}`,
    `date: ${date}`,
    `tags: [${note.tags.map((t) => `"${escapeYaml(t)}"`).join(", ")}]`,
    `summary: "${escapeYaml(note.summary)}"`,
    relatedBasenames.length
      ? `related:\n${relatedBasenames.map((b) => `  - "[[${b}]]"`).join("\n")}`
      : null,
    "---",
  ]
    .filter(Boolean)
    .join("\n");

  // 본문 위에 H1 자동 추가 — 챕터 제목 그대로 (숫자 prefix 포함)
  const content = `${frontmatter}\n\n# ${note.topic}\n\n${note.body}\n`;
  await fs.writeFile(filePath, content, "utf-8");

  await updateIndex(spiralRoot, fileName, note);

  // v0.5.76 — 새 노트가 바로 진도/depth에 반영되게
  invalidateNotesCache();

  return filePath;
}

/** "05. Fixtures & SetUp" / "05-fixtures-and-setup" → 숫자 prefix 제거 */
function stripLeadingChapterNumber(s: string): string {
  return s.replace(/^\s*\d+[.\-_:]\s*/, "").trim();
}

/** OS 안전 파일명 — 금지문자만 치환, 공백/대소문자/`&`는 그대로 유지 */
function sanitizeFileName(s: string): string {
  return s
    .replace(/[\/\\:*?"<>|]/g, "-") // 운영체제 금지문자
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function updateIndex(
  spiralRoot: string,
  newFileName: string,
  note: NewNote,
): Promise<void> {
  const indexPath = path.join(spiralRoot, "_index.md");
  const date = new Date().toISOString().slice(0, 10);
  const line = `- ${date} · **${note.topic}** (depth ${note.depth}) → [[${path.basename(newFileName, ".md")}]]`;

  let existing = "";
  try {
    existing = await fs.readFile(indexPath, "utf-8");
  } catch {
    existing = [
      "---",
      "title: spiral-buddy index",
      "generator: iq-spiral-buddy",
      "---",
      "",
      "# Sessions",
      "",
    ].join("\n");
  }

  const updated = existing.replace(/(# Sessions\n+)/, `$1${line}\n`);
  const finalContent = updated.includes(line) ? updated : `${existing}\n${line}\n`;
  await fs.writeFile(indexPath, finalContent, "utf-8");
}

function escapeYaml(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * YAML date 값을 YYYY-MM-DD 형식 문자열로 변환.
 * gray-matter는 ISO 형식 date를 Date 객체로 자동 파싱하므로
 * Date 객체 / 문자열 / undefined 셋 다 처리해야 함.
 */
function formatDate(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === "string" && v.length > 0) {
    return v.slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
}

/**
 * 노트가 특정 (roadmapId, chapterId, chapterTitle) 챕터를 가리키는지 판단.
 *
 * 매칭 단계 (앞부터 시도):
 *   1. 옛 스키마: note.roadmapId + note.chapterId (정확 매칭)
 *   2. v0.5.22+: note.repo + note.roadmapName + note.chapter (제목 매칭)
 *   3. 옛 스키마 fallback: roadmapName 같고 chapterId 끝나거나 같음
 *   4. 마지막 fallback: chapter 제목이 chapterTitle과 같음 + roadmapName 일치
 */
export function noteMatchesChapter(
  note: SpiralNote,
  target: { roadmapId: string; roadmapName: string; chapterId: string; chapterTitle?: string },
): boolean {
  // 1. roadmap_id + chapter_id 정확
  if (note.roadmapId) {
    if (note.roadmapId === target.roadmapId && note.chapterId === target.chapterId) {
      return true;
    }
  }

  // 2. 신 스키마: roadmap 이름 + chapter(제목) 매칭
  if (target.chapterTitle && note.chapter) {
    const roadmapMatches =
      note.roadmapName === target.roadmapName ||
      note.roadmapId === target.roadmapId;
    if (roadmapMatches && note.chapter === target.chapterTitle) {
      return true;
    }
  }

  // 3. 옛 스키마 fallback (roadmap_id 없거나 다름)
  if (note.roadmapName === target.roadmapName && note.chapterId) {
    if (
      note.chapterId === target.chapterId ||
      note.chapterId.endsWith(`/${target.chapterId}`) ||
      note.chapterId === `${target.roadmapName}/${target.chapterId}`
    ) {
      return true;
    }
  }

  return false;
}

/**
 * 노트가 특정 roadmap에 속하는지 판단.
 */
export function noteBelongsToRoadmap(
  note: SpiralNote,
  target: { roadmapId: string; roadmapName: string },
): boolean {
  if (note.roadmapId) {
    return note.roadmapId === target.roadmapId;
  }
  return note.roadmapName === target.roadmapName;
}

/**
 * 노트들을 vault의 spiral-buddy/.trash/로 이동.
 * fs.unlink 대신 rename을 써서 사용자가 vault에서 직접 복구 가능.
 * 파일명 충돌 시 timestamp prefix로 회피.
 *
 * @returns 이동된 파일 경로 목록 (원본 → trash)
 */
export async function moveNotesToTrash(
  vaultPath: string,
  notes: SpiralNote[],
): Promise<{ from: string; to: string }[]> {
  if (notes.length === 0) return [];
  const trashDir = path.join(vaultPath, SPIRAL_DIR, TRASH_DIR);
  await fs.mkdir(trashDir, { recursive: true });

  const ts = new Date()
    .toISOString()
    .replace(/[:T]/g, "-")
    .replace(/\..+$/, "");

  const moved: { from: string; to: string }[] = [];
  for (const note of notes) {
    const basename = path.basename(note.filePath);
    let dest = path.join(trashDir, `${ts}__${basename}`);
    let counter = 2;
    while (await exists(dest)) {
      dest = path.join(trashDir, `${ts}__${counter}__${basename}`);
      counter++;
    }
    await fs.rename(note.filePath, dest);
    moved.push({ from: note.filePath, to: dest });
  }
  // v0.5.76 — 삭제된 노트가 진도에서 바로 빠지게
  if (moved.length > 0) invalidateNotesCache();
  return moved;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export interface TrashEntry {
  fileName: string;
  /** trash 안 절대 경로 */
  filePath: string;
  /** trash에 들어간 시각 (mtime) */
  trashedAt: string;
  /** prefix 제거된 원래 파일명 (복구 대상) */
  originalName: string;
  /** 노트 frontmatter에서 추출. 못 읽으면 null */
  title: string | null;
  topic: string | null;
  chapterId: string | null;
  roadmapName: string | null;
  depth: number | null;
  date: string | null;
}

/**
 * .trash/ 안의 노트들을 메타데이터와 함께 나열. 최근 삭제 순.
 */
export async function listTrash(vaultPath: string): Promise<TrashEntry[]> {
  const trashDir = path.join(vaultPath, SPIRAL_DIR, TRASH_DIR);
  try {
    await fs.access(trashDir);
  } catch {
    return [];
  }
  const entries = await fs
    .readdir(trashDir, { withFileTypes: true })
    .catch(() => []);
  const out: TrashEntry[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
    const filePath = path.join(trashDir, entry.name);
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat) continue;
    // moveNotesToTrash가 붙인 prefix(`YYYY-MM-DD-HH-MM-SS__` 또는 `..__N__`)를 제거해 원래 이름 얻기
    const originalName = entry.name.replace(/^[\d-]{19}(?:__\d+)?__/, "");

    let title: string | null = null;
    let topic: string | null = null;
    let chapterId: string | null = null;
    let roadmapName: string | null = null;
    let depth: number | null = null;
    let date: string | null = null;
    try {
      const parsed = await readFrontmatter(filePath);
      const fm = parsed.data as Record<string, unknown>;
      title = (fm.title as string | undefined) ?? null;
      topic = (fm.topic as string | undefined) ?? null;
      chapterId = (fm.chapter_id as string | undefined) ?? null;
      roadmapName = (fm.roadmap as string | undefined) ?? null;
      depth = typeof fm.depth === "number" ? fm.depth : null;
      date = formatDate(fm.date);
    } catch {
      /* 파싱 실패는 무시 — 기본 메타만 반환 */
    }

    out.push({
      fileName: entry.name,
      filePath,
      trashedAt: stat.mtime.toISOString(),
      originalName,
      title,
      topic,
      chapterId,
      roadmapName,
      depth,
      date,
    });
  }
  out.sort((a, b) => b.trashedAt.localeCompare(a.trashedAt));
  return out;
}

/**
 * .trash/ 안 파일을 spiral-buddy/로 되돌린다.
 * 동일 이름이 이미 있으면 카운터 prefix 부여.
 *
 * @returns 복구된 파일의 새 경로
 */
export async function restoreFromTrash(
  vaultPath: string,
  fileName: string,
): Promise<string> {
  const trashDir = path.join(vaultPath, SPIRAL_DIR, TRASH_DIR);
  const src = path.join(trashDir, fileName);
  await fs.access(src); // 없으면 throw
  const originalName = fileName.replace(/^[\d-]{19}(?:__\d+)?__/, "");
  const spiralRoot = path.join(vaultPath, SPIRAL_DIR);
  let dest = path.join(spiralRoot, originalName);
  let counter = 2;
  while (await exists(dest)) {
    const ext = path.extname(originalName);
    const base = path.basename(originalName, ext);
    dest = path.join(spiralRoot, `${base}-restored${counter}${ext}`);
    counter++;
  }
  await fs.rename(src, dest);
  // v0.5.76 — 복구된 노트가 진도에 바로 반영되게
  invalidateNotesCache();
  return dest;
}

/**
 * spiral-buddy/.trash/ 안에서 mtime이 maxAgeDays보다 오래된 파일 영구 삭제.
 * 서버 시작 시 한 번 호출. 실패해도 서버 시작은 막지 않는다.
 *
 * @returns 삭제된 파일 수
 */
export async function cleanupTrash(
  vaultPath: string,
  maxAgeDays = 30,
): Promise<number> {
  const trashDir = path.join(vaultPath, SPIRAL_DIR, TRASH_DIR);
  try {
    await fs.access(trashDir);
  } catch {
    return 0;
  }
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let deleted = 0;
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(trashDir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const filePath = path.join(trashDir, entry.name);
    try {
      const stat = await fs.stat(filePath);
      if (stat.mtimeMs < cutoff) {
        await fs.unlink(filePath);
        deleted++;
      }
    } catch {
      /* skip — 권한 또는 race */
    }
  }
  return deleted;
}
