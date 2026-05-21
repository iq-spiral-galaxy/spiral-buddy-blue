import fs from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";
import matter from "gray-matter";

export interface SpiralNote {
  filePath: string;
  relativePath: string;
  title: string;
  topic: string;
  chapterId: string | null;
  /** 신규 스키마: roadmap의 root-relative path. 옛 노트는 null. */
  roadmapId: string | null;
  /** roadmap basename (표시용). 옛 노트도 보유. */
  roadmapName: string | null;
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

export async function listSpiralNotes(
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
  notes.sort((a, b) => b.date.localeCompare(a.date));
  return notes;
}

async function readNote(
  abs: string,
  relativePath: string,
): Promise<SpiralNote | null> {
  try {
    const raw = await fs.readFile(abs, "utf-8");
    const parsed = matter(raw);
    const fm = parsed.data as Record<string, unknown>;
    return {
      filePath: abs,
      relativePath,
      title:
        (fm.title as string | undefined) ??
        path.basename(abs, ".md"),
      topic:
        (fm.topic as string | undefined) ??
        (fm.title as string | undefined) ??
        path.basename(abs, ".md"),
      chapterId: (fm.chapter_id as string | undefined) ?? null,
      roadmapId: (fm.roadmap_id as string | undefined) ?? null,
      roadmapName: (fm.roadmap as string | undefined) ?? null,
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

export interface NewNote {
  topic: string;
  chapterId: string | null;
  /** 신규: roadmap root-relative path */
  roadmapId: string | null;
  roadmapName: string | null;
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

  // 파일명: chapter_id basename 우선 (Phase 3 개선분 유지 — 짧고 깔끔한 파일명)
  const baseFromChapter = note.chapterId
    ? path.basename(note.chapterId, ".md")
    : null;
  const slug = baseFromChapter ?? slugify(note.topic);

  // 충돌 방지: suffix
  let fileName = `${date}-${slug}-d${note.depth}.md`;
  let counter = 2;
  while (await fileExists(path.join(spiralRoot, fileName))) {
    fileName = `${date}-${slug}-d${note.depth}-${counter}.md`;
    counter++;
    if (counter > 99) {
      throw new Error(
        `Cannot find unique file name for ${date}-${slug}-d${note.depth}`,
      );
    }
  }
  const filePath = path.join(spiralRoot, fileName);

  const relatedBasenames = note.relatedNotePaths.map((p) =>
    path.basename(p, ".md"),
  );

  const frontmatter = [
    "---",
    `title: "${escapeYaml(note.topic)}"`,
    `topic: "${escapeYaml(note.topic)}"`,
    `date: ${date}`,
    `depth: ${note.depth}`,
    note.chapterId ? `chapter_id: "${escapeYaml(note.chapterId)}"` : null,
    note.roadmapName ? `roadmap: "${escapeYaml(note.roadmapName)}"` : null,
    note.roadmapId ? `roadmap_id: "${escapeYaml(note.roadmapId)}"` : null,
    `tags: [${note.tags.map((t) => `"${escapeYaml(t)}"`).join(", ")}]`,
    `summary: "${escapeYaml(note.summary)}"`,
    relatedBasenames.length
      ? `related:\n${relatedBasenames.map((b) => `  - "[[${b}]]"`).join("\n")}`
      : null,
    "generator: iq-spiral-buddy",
    "---",
  ]
    .filter(Boolean)
    .join("\n");

  // 본문 위에 H1 자동 추가 (Phase 3 개선분 유지)
  const content = `${frontmatter}\n\n# ${note.topic}\n\n${note.body}\n`;
  await fs.writeFile(filePath, content, "utf-8");

  await updateIndex(spiralRoot, fileName, note);

  return filePath;
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

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
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
 * 노트가 특정 (roadmapId, chapterId) 챕터를 가리키는지 판단.
 *
 * - 신규 스키마: 노트가 roadmap_id를 가지고 있으면 정확 매칭
 * - 옛 스키마 (roadmap_id 없음): roadmapName이 같고, 노트의 chapter_id가
 *   대상 chapter_id로 끝나거나 같으면 매칭 (옛 노트는 "ioc-container/01-foo.md" 같이
 *   roadmap 이름이 prefix로 붙어있을 수 있음)
 */
export function noteMatchesChapter(
  note: SpiralNote,
  target: { roadmapId: string; roadmapName: string; chapterId: string },
): boolean {
  if (note.roadmapId) {
    return note.roadmapId === target.roadmapId && note.chapterId === target.chapterId;
  }
  // 옛 스키마 fallback
  if (note.roadmapName !== target.roadmapName) return false;
  if (!note.chapterId) return false;
  return (
    note.chapterId === target.chapterId ||
    note.chapterId.endsWith(`/${target.chapterId}`) ||
    note.chapterId === `${target.roadmapName}/${target.chapterId}`
  );
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
      const raw = await fs.readFile(filePath, "utf-8");
      const parsed = matter(raw);
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
