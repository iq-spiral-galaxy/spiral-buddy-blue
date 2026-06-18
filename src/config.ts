import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import os from "node:os";
import fs from "node:fs";

const __envDirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__envDirname, "../.env") });

export type AuthMode = "oauth" | "apikey";

export interface Config {
  authMode: AuthMode;
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

function findObsidianVaultRoot(startPath: string | null): string | null {
  if (!startPath) return null;
  let dir = startPath;
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, ".obsidian"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** ~/.claude/.credentials.json 에서 OAuth 계정 정보를 읽는다. */
export function readClaudeOAuthInfo(): {
  loggedIn: boolean;
  subscriptionType?: string;
  expired?: boolean;
} {
  try {
    const credPath = path.join(os.homedir(), ".claude", ".credentials.json");
    const raw = fs.readFileSync(credPath, "utf8");
    const cred = JSON.parse(raw) as Record<string, unknown>;
    const oauth = cred?.claudeAiOauth as Record<string, unknown> | undefined;
    if (!oauth?.accessToken) return { loggedIn: false };
    const expired =
      typeof oauth.expiresAt === "number" ? Date.now() > oauth.expiresAt : false;
    return {
      loggedIn: true,
      subscriptionType:
        typeof oauth.subscriptionType === "string"
          ? oauth.subscriptionType
          : undefined,
      expired,
    };
  } catch {
    return { loggedIn: false };
  }
}

export function loadConfig(): Config {
  // SPIRAL_AUTH_MODE=apikey 이면 ANTHROPIC_API_KEY 필수.
  // 기본(미설정 또는 oauth)은 claude -p 서브프로세스 사용.
  const rawMode = (process.env.SPIRAL_AUTH_MODE ?? "oauth").toLowerCase();
  const authMode: AuthMode = rawMode === "apikey" ? "apikey" : "oauth";

  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";

  if (authMode === "apikey" && !apiKey) {
    throw new Error(
      "SPIRAL_AUTH_MODE=apikey 이지만 ANTHROPIC_API_KEY가 설정되지 않았습니다.",
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

  const curatedDisabled = process.env.SPIRAL_DISABLE_CURATED === "1";
  const curatedOrg = curatedDisabled
    ? null
    : process.env.SPIRAL_CURATED_ORG?.trim() || "iq-dev-lab";
  const githubToken = process.env.SPIRAL_GITHUB_TOKEN?.trim() || null;

  return {
    authMode,
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
