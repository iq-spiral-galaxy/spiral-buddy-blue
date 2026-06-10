/**
 * Curated source — GitHub 조직의 public 레포를 학습 로드맵으로 노출.
 *
 * 동작:
 * 1. GitHub API로 조직의 public 레포 목록 가져오기 (1시간 캐시)
 * 2. 사용자가 특정 레포로 학습 시작 → on-demand git clone to .cache/curated/<org>/<repo>/
 * 3. 클론된 디렉토리는 기존 discoverRoadmaps로 재귀 탐색 (한 레포 안에 sub-roadmap 가능)
 */

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  discoverRoadmaps,
  invalidateRoadmapCaches,
  type Roadmap,
} from "./roadmap.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");
const CACHE_DIR = path.join(PKG_ROOT, ".cache", "curated");
const META_FILE = path.join(PKG_ROOT, ".cache", "curated-meta.json");
const API_CACHE_TTL_MS = 60 * 60 * 1000; // 1시간

export interface CuratedRepoInfo {
  /** GitHub 레포 full name (e.g. "iq-dev-lab/redis-deep-dive") */
  fullName: string;
  /** 짧은 이름 (e.g. "redis-deep-dive") */
  name: string;
  /** 레포 description */
  description: string | null;
  /** 메인 언어 (Markdown이 보통) */
  language: string | null;
  /** stars */
  stars: number;
  /** 마지막 push 날짜 */
  pushedAt: string;
  /** 디스크에 클론되어 있는지 */
  installed: boolean;
  /** 클론된 디렉토리 절대 경로 (installed일 때만) */
  cachePath: string | null;
}

interface CachedApiResponse {
  org: string;
  fetchedAt: number;
  repos: GitHubRepo[];
}

/**
 * organization profile / GitHub Pages 같은 메타 레포는 학습 자료가 아니므로 제외.
 * - `.github` : org profile README
 * - `*.github.io` : GitHub Pages 사이트
 * - `.github-private` : private org profile
 */
export function isMetaRepo(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower === ".github" ||
    lower === ".github-private" ||
    lower.endsWith(".github.io")
  );
}

interface GitHubRepo {
  full_name: string;
  name: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  pushed_at: string;
  archived: boolean;
  private: boolean;
  fork: boolean;
  size: number;
}

// ───────────────────────────────────────────────
// GitHub API: 조직의 public 레포 목록
// ───────────────────────────────────────────────

export async function listCuratedRepos(args: {
  org: string;
  token?: string;
  forceRefresh?: boolean;
}): Promise<CuratedRepoInfo[]> {
  let repos: GitHubRepo[];

  if (!args.forceRefresh) {
    const cached = await readApiCache(args.org);
    if (cached && Date.now() - cached.fetchedAt < API_CACHE_TTL_MS) {
      repos = cached.repos;
    } else {
      repos = await fetchOrgRepos(args.org, args.token);
      await writeApiCache(args.org, repos);
    }
  } else {
    repos = await fetchOrgRepos(args.org, args.token);
    await writeApiCache(args.org, repos);
  }

  // 학습용으로 의미 있는 레포만:
  // - archived/fork/private 제외
  // - 0 bytes 레포 제외 (빈 레포)
  // - meta 레포 제외 (.github = organization profile, *.github.io = GitHub Pages)
  const usable = repos.filter(
    (r) =>
      !r.archived &&
      !r.fork &&
      !r.private &&
      r.size > 0 &&
      !isMetaRepo(r.name),
  );

  return usable.map((r) => {
    const cachePath = repoCachePath(args.org, r.name);
    const installed = fsSync.existsSync(cachePath);
    return {
      fullName: r.full_name,
      name: r.name,
      description: r.description,
      language: r.language,
      stars: r.stargazers_count,
      pushedAt: r.pushed_at,
      installed,
      cachePath: installed ? cachePath : null,
    };
  });
}

async function fetchOrgRepos(
  org: string,
  token: string | undefined,
): Promise<GitHubRepo[]> {
  const all: GitHubRepo[] = [];
  let page = 1;
  // 안전 상한
  while (page <= 10) {
    const url = `https://api.github.com/orgs/${encodeURIComponent(org)}/repos?type=public&per_page=100&page=${page}`;
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "iq-spiral-buddy",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(url, { headers });
    if (!res.ok) {
      if (res.status === 404) {
        throw new Error(`GitHub 조직을 찾을 수 없음: ${org}`);
      }
      if (res.status === 403) {
        const reset = res.headers.get("x-ratelimit-reset");
        throw new Error(
          `GitHub API rate limit. reset: ${reset ? new Date(Number(reset) * 1000).toISOString() : "?"}. SPIRAL_GITHUB_TOKEN 설정으로 5000 req/hr 가능.`,
        );
      }
      throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    }

    const batch = (await res.json()) as GitHubRepo[];
    all.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }
  return all;
}

// ───────────────────────────────────────────────
// Cache I/O
// ───────────────────────────────────────────────

async function readApiCache(org: string): Promise<CachedApiResponse | null> {
  try {
    const raw = await fs.readFile(META_FILE, "utf-8");
    const all = JSON.parse(raw) as Record<string, CachedApiResponse>;
    return all[org] ?? null;
  } catch {
    return null;
  }
}

async function writeApiCache(
  org: string,
  repos: GitHubRepo[],
): Promise<void> {
  await fs.mkdir(path.dirname(META_FILE), { recursive: true });
  let all: Record<string, CachedApiResponse> = {};
  try {
    const raw = await fs.readFile(META_FILE, "utf-8");
    all = JSON.parse(raw);
  } catch {
    // first time
  }
  all[org] = { org, fetchedAt: Date.now(), repos };
  await fs.writeFile(META_FILE, JSON.stringify(all, null, 2), "utf-8");
}

function repoCachePath(org: string, name: string): string {
  return path.join(CACHE_DIR, org, name);
}

// ───────────────────────────────────────────────
// git clone / pull
// ───────────────────────────────────────────────

export async function installCuratedRepo(args: {
  org: string;
  repoName: string;
  /** depth=1 shallow clone (default true) */
  shallow?: boolean;
}): Promise<{ cachePath: string; alreadyInstalled: boolean }> {
  const target = repoCachePath(args.org, args.repoName);
  if (fsSync.existsSync(target)) {
    return { cachePath: target, alreadyInstalled: true };
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  const cloneUrl = `https://github.com/${args.org}/${args.repoName}.git`;
  const cloneArgs = ["clone"];
  if (args.shallow !== false) cloneArgs.push("--depth=1");
  cloneArgs.push(cloneUrl, target);
  await runGit(cloneArgs);
  // v0.5.76 — 새 레포가 즉시 로드맵 목록에 잡히게
  invalidateRoadmapCaches();
  return { cachePath: target, alreadyInstalled: false };
}

export async function refreshCuratedRepo(args: {
  org: string;
  repoName: string;
}): Promise<void> {
  const target = repoCachePath(args.org, args.repoName);
  if (!fsSync.existsSync(target)) {
    throw new Error(`${args.repoName} 아직 설치되지 않음`);
  }
  await runGit(["pull", "--ff-only"], target);
  // v0.5.76 — pull로 챕터가 바뀌었을 수 있음
  invalidateRoadmapCaches();
}

export async function uninstallCuratedRepo(args: {
  org: string;
  repoName: string;
}): Promise<void> {
  const target = repoCachePath(args.org, args.repoName);
  if (fsSync.existsSync(target)) {
    await fs.rm(target, { recursive: true, force: true });
    // v0.5.76 — 삭제된 레포가 목록에서 즉시 빠지게
    invalidateRoadmapCaches();
  }
}

function runGit(args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`git ${args.join(" ")} failed (${code}): ${stderr}`));
    });
  });
}

// ───────────────────────────────────────────────
// Installed curated repo → Roadmap[]
// ───────────────────────────────────────────────

/**
 * 캐시 디렉토리(.cache/curated/<org>/) 아래의 설치된 레포들에서 로드맵 발견.
 * 한 레포가 여러 sub-roadmap을 가질 수 있음 (예: spring-core-deep-dive가 ioc-container, transaction-mvcc 등 포함).
 *
 * roadmap.id에 "curated:<org>/<repo>/" prefix를 붙여 Local 소스와 구분.
 */
export async function discoverCuratedRoadmaps(
  org: string,
): Promise<Roadmap[]> {
  const orgDir = path.join(CACHE_DIR, org);
  if (!fsSync.existsSync(orgDir)) return [];

  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(orgDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const out: Roadmap[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const repoDir = path.join(orgDir, entry.name);
    const inner = await discoverRoadmaps(repoDir);

    if (inner.length === 0) {
      // README와 .md 충분히 없는 레포는 그냥 무시 (학습용 아님)
      continue;
    }

    for (const r of inner) {
      // id 변환: 레포 단독이면 "curated:org/repo", sub-roadmap이면 "curated:org/repo/sub/path"
      const subPath =
        r.id === entry.name || r.id === path.basename(repoDir)
          ? ""
          : `/${r.id}`;
      const prefixedId = `curated:${org}/${entry.name}${subPath}`;
      out.push({
        ...r,
        id: prefixedId,
        absolutePath: r.absolutePath,
      });
    }
  }

  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

/**
 * 큐레이션 로드맵 id ("curated:org/repo/...")에서 repo 이름만 추출.
 * on-demand install 시 어떤 레포를 클론할지 결정하기 위함.
 */
export function parseCuratedId(
  roadmapId: string,
): { org: string; repoName: string; subPath: string } | null {
  if (!roadmapId.startsWith("curated:")) return null;
  const rest = roadmapId.slice("curated:".length);
  const firstSlash = rest.indexOf("/");
  if (firstSlash === -1) return null;
  const org = rest.slice(0, firstSlash);
  const afterOrg = rest.slice(firstSlash + 1);
  // 첫 / 다음이 repo 이름. 그 다음 / 부터는 sub-path.
  const secondSlash = afterOrg.indexOf("/");
  if (secondSlash === -1) {
    return { org, repoName: afterOrg, subPath: "" };
  }
  return {
    org,
    repoName: afterOrg.slice(0, secondSlash),
    subPath: afterOrg.slice(secondSlash + 1),
  };
}

/**
 * 캐시 디렉토리에 설치된 레포 이름들만 빠르게 (디스크 read)
 */
export async function listInstalledRepoNames(org: string): Promise<string[]> {
  const orgDir = path.join(CACHE_DIR, org);
  if (!fsSync.existsSync(orgDir)) return [];
  try {
    const entries = await fs.readdir(orgDir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}
