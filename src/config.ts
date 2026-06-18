import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import os from "node:os";
import fs from "node:fs";

// .env를 cwd가 아니라 패키지 루트에서 로드.
// Claude Desktop이 MCP 서버를 임의의 cwd에서 spawn하더라도 동작하도록.
const __envDirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__envDirname, "../.env") });

export interface Config {
  // OAuth 모드에서는 사용 안 함. 빈 문자열이면 claude -p 서브프로세스 경로 사용.
  apiKey: string;
  model: string;
  maxTokens: number;
  roadmapRoot: string | null;
  pinnedRoadmapPath: string | null;
  curatedOrg: string | null;
  githubToken: string | null;
  vaultPath: string | null;
  vaultName: string | null;
  obsidianVaultRoot: string | null;
}

function expand(p: string | undefined | null): string | null {
  if (!p) return null;
  let resolved = p;
  if (resolved.startsWith("~")) {
    resolved = path.join(os.homedir(), resolved.slice(1));
  }
  return path.resolve(resolved);
}

/**
 * 옵시디언 vault 루트 자동 탐지. `.obsidian` 디렉토리가 있는 곳을
 * 시작 경로에서부터 위로 올라가며 찾는다.
 */
function findObsidianVaultRoot(startPath: string | null): string | null {
  if (!startPath) return null;
  let dir = startPath;
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, ".obsidian"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function loadConfig(): Config {
  // OAuth 모드: API 키 없이 claude -p 서브프로세스로 실행.
  // ANTHROPIC_API_KEY가 있으면 경고만 출력 (무시해도 무방).
  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
  if (apiKey) {
    console.warn(
      "[spiral-buddy-oauth] ANTHROPIC_API_KEY가 설정되어 있지만 이 빌드는 Claude Code OAuth를 사용합니다. API 키는 무시됩니다.",
    );
  }

  const explicitRoot = expand(process.env.SPIRAL_ROADMAP_ROOT);
  const legacyPath = expand(process.env.SPIRAL_ROADMAP_PATH);
  const vaultPath = expand(process.env.SPIRAL_VAULT_PATH);

  let roadmapRoot: string | null = null;
  let pinnedRoadmapPath: string | null = null;

  if (explicitRoot) {
    if (!fs.existsSync(explicitRoot)) {
      throw new Error(`Roadmap root does not exist: ${explicitRoot}`);
    }
    roadmapRoot = explicitRoot;
  } else if (legacyPath) {
    // backward compat: 단일 로드맵 경로가 주어지면 그 부모를 root로, 자신은 pinned로
    if (!fs.existsSync(legacyPath)) {
      throw new Error(`Roadmap path does not exist: ${legacyPath}`);
    }
    roadmapRoot = path.dirname(legacyPath);
    pinnedRoadmapPath = legacyPath;
  }

  if (vaultPath && !fs.existsSync(vaultPath)) {
    throw new Error(`Vault path does not exist: ${vaultPath}`);
  }

  const obsidianVaultRoot = findObsidianVaultRoot(vaultPath);

  const vaultName = process.env.SPIRAL_VAULT_NAME
    ? process.env.SPIRAL_VAULT_NAME
    : obsidianVaultRoot
      ? path.basename(obsidianVaultRoot)
      : vaultPath
        ? path.basename(vaultPath)
        : null;

  // Curated source
  const curatedDisabled = process.env.SPIRAL_DISABLE_CURATED === "1";
  const curatedOrg = curatedDisabled
    ? null
    : process.env.SPIRAL_CURATED_ORG?.trim() || "iq-dev-lab";
  const githubToken = process.env.SPIRAL_GITHUB_TOKEN?.trim() || null;

  return {
    apiKey,
    model: process.env.SPIRAL_MODEL ?? "claude-sonnet-4-6",
    maxTokens: Number.parseInt(process.env.SPIRAL_MAX_TOKENS ?? "4096", 10),
    roadmapRoot,
    pinnedRoadmapPath,
    curatedOrg,
    githubToken,
    vaultPath,
    vaultName,
    obsidianVaultRoot,
  };
}
