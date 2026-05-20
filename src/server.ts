import { serve } from "@hono/node-server";
import { Hono } from "hono";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import chalk from "chalk";

// `open` 패키지는 NO_OPEN=1이 아닐 때만 dynamic import.
// 이유: open이 transitive로 wsl-utils 같은 optional dep을 가지는데
// electron-builder가 일부 환경에서 그걸 누락시켜 module 로드 자체가
// 실패함. dynamic import로 만들면 그 코드 path가 실행될 때만 resolve.

import { loadConfig } from "./config.js";
import { createApi } from "./routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.resolve(__dirname, "../client");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/**
 * 서버 시작. Electron main 또는 직접 CLI 양쪽에서 호출 가능.
 */
export async function startServer(): Promise<{ url: string; port: number }> {
  const config = loadConfig();

  const app = new Hono();

  // API
  app.route("/api", createApi(config));

  // Static client (single-file server)
  app.get("*", async (c) => {
    if (c.req.path.startsWith("/api/")) return c.notFound();
    const requestPath = c.req.path === "/" ? "/index.html" : c.req.path;
    const safe = path.normalize(requestPath).replace(/^[/\\]+/, "");
    const filePath = path.join(CLIENT_DIR, safe);
    if (!filePath.startsWith(CLIENT_DIR)) return c.notFound();
    try {
      const content = await fs.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
      return new Response(content, {
        headers: {
          "Content-Type": contentType,
          // 개발 도구 — 코드 갱신이 즉시 보이도록 캐시 비활성화
          "Cache-Control": "no-store, must-revalidate",
        },
      });
    } catch {
      return c.notFound();
    }
  });

  const port = Number(process.env.PORT ?? 3737);
  const url = `http://localhost:${port}`;

  serve({ fetch: app.fetch, port }, async () => {
    console.log();
    console.log(chalk.bold.cyan("  🌀 iq-spiral-buddy"));
    console.log(chalk.gray("  spiral learning · Claude × Obsidian"));
    console.log();
    console.log(
      chalk.gray(`  roadmap root: ${config.roadmapRoot ?? "(unset, Local off)"}`),
    );
    if (config.pinnedRoadmapPath) {
      console.log(
        chalk.gray(
          `  (pinned to single roadmap: ${path.basename(config.pinnedRoadmapPath)})`,
        ),
      );
    } else if (config.roadmapRoot) {
      const { discoverRoadmaps } = await import("./roadmap.js");
      const roadmaps = await discoverRoadmaps(config.roadmapRoot);
      console.log(chalk.gray(`  local roadmaps: ${roadmaps.length}`));
    }
    if (config.curatedOrg) {
      console.log(
        chalk.gray(`  curated org:  ${config.curatedOrg}`),
      );
      const { discoverCuratedRoadmaps, listInstalledRepoNames } = await import(
        "./curated.js"
      );
      const installed = await listInstalledRepoNames(config.curatedOrg);
      const installedRoadmaps = await discoverCuratedRoadmaps(
        config.curatedOrg,
      );
      console.log(
        chalk.gray(
          `  curated installed: ${installed.length} repos, ${installedRoadmaps.length} roadmaps`,
        ),
      );
    } else {
      console.log(chalk.gray("  curated: disabled"));
    }
    console.log(chalk.gray(`  vault:   ${config.vaultPath ?? "(unset)"}`));
    if (
      config.obsidianVaultRoot &&
      config.obsidianVaultRoot !== config.vaultPath
    ) {
      console.log(
        chalk.gray(
          `  obsidian root: ${config.obsidianVaultRoot} (auto-detected via .obsidian/)`,
        ),
      );
    } else if (!config.obsidianVaultRoot && config.vaultPath) {
      console.log(
        chalk.yellow(
          `  ⚠ no .obsidian/ found near vault path — obsidian links may not work`,
        ),
      );
    }
    console.log(chalk.gray(`  vault name: ${config.vaultName ?? "(unset)"}`));
    console.log(chalk.gray(`  model:   ${config.model}`));
    // .trash/ 자동 청소 (30일+ 파일 영구 삭제). 실패해도 서버 시작 막지 않음.
    if (config.vaultPath) {
      const { cleanupTrash } = await import("./vault.js");
      cleanupTrash(config.vaultPath, 30)
        .then((n) => {
          if (n > 0) {
            console.log(
              chalk.gray(`  .trash cleanup: ${n} stale notes removed`),
            );
          }
        })
        .catch(() => {});
    }
    console.log();
    console.log(chalk.green(`  → ${url}`));
    console.log();
  });

  if (process.env.NO_OPEN !== "1") {
    setTimeout(async () => {
      try {
        const { default: open } = await import("open");
        await open(url);
      } catch {
        console.log(chalk.gray(`  (auto-open failed, visit ${url} manually)`));
      }
    }, 500);
  }

  return { url, port };
}

// 이 파일이 직접 실행됐을 때만 자동 시작 (Electron에서 import할 땐 skip)
const isMainModule =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("/server.ts") === true;
if (isMainModule) {
  startServer().catch((err) => {
    console.error(
      chalk.red("\n× Fatal:"),
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  });
}
