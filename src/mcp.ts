/**
 * iq-spiral-buddy MCP server (Phase 2)
 *
 * Claude Desktop에서 spiral-buddy의 로드맵/노트/vault를 도구로 사용 가능.
 * stdio 전송 — stdout은 MCP 프로토콜 채널이므로 console.log 사용 금지.
 *
 * Phase 2 변경점:
 * - Curated source 지원 (GitHub 조직 public 레포)
 * - spiral_install_curated 신규: on-demand 레포 클론
 * - spiral_list_roadmaps가 Local + Curated 통합 표시
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import path from "node:path";
import fs from "node:fs/promises";

import { loadConfig } from "./config.js";
import {
  discoverRoadmaps,
  findRoadmap,
  loadRoadmapChapters,
  type Roadmap,
} from "./roadmap.js";
import {
  listSpiralNotes,
  moveNotesToTrash,
  noteBelongsToRoadmap,
  noteMatchesChapter,
  writeNewNote,
} from "./vault.js";
import {
  validateAndPatchSections,
  REQUIRED_SECTIONS,
} from "./note-writer.js";
import {
  listCuratedRepos,
  installCuratedRepo,
  discoverCuratedRoadmaps,
} from "./curated.js";

async function main() {
  const config = loadConfig();

  if (!config.vaultPath) {
    process.stderr.write(
      "[iq-spiral-buddy MCP] fatal: SPIRAL_VAULT_PATH must be set\n",
    );
    process.exit(1);
  }
  if (!config.roadmapRoot && !config.curatedOrg) {
    process.stderr.write(
      "[iq-spiral-buddy MCP] fatal: SPIRAL_ROADMAP_ROOT or SPIRAL_CURATED_ORG must be set\n",
    );
    process.exit(1);
  }

  const vaultPath = config.vaultPath;

  // ─────────────────────────────────────────────────────
  // 헬퍼: Local + Curated 통합 로드맵 (설치된 것만)
  // ─────────────────────────────────────────────────────
  async function getInstalledRoadmaps(): Promise<Roadmap[]> {
    const out: Roadmap[] = [];
    if (config.roadmapRoot) {
      const local = await discoverRoadmaps(config.roadmapRoot);
      const filtered = config.pinnedRoadmapPath
        ? local.filter((r) => r.absolutePath === config.pinnedRoadmapPath)
        : local;
      for (const r of filtered) out.push({ ...r, source: "local" });
    }
    if (config.curatedOrg) {
      const curated = await discoverCuratedRoadmaps(config.curatedOrg);
      for (const r of curated) out.push({ ...r, source: "curated" });
    }
    return out;
  }

  async function resolveRoadmapByIdOrName(
    idOrName: string,
  ): Promise<Roadmap | null> {
    // Curated id
    if (idOrName.startsWith("curated:") && config.curatedOrg) {
      const curated = await discoverCuratedRoadmaps(config.curatedOrg);
      const m = curated.find((r) => r.id === idOrName);
      if (m) return { ...m, source: "curated" };
      return null;
    }
    // Local
    if (config.roadmapRoot) {
      const found = await findRoadmap(config.roadmapRoot, idOrName);
      if (found) return { ...found, source: "local" };
    }
    // basename fallback (양쪽)
    const all = await getInstalledRoadmaps();
    return all.find((r) => r.name === idOrName) ?? null;
  }

  const server = new McpServer({
    name: "iq-spiral-buddy",
    version: "0.3.0",
  });

  // ─────────────────────────────────────────────────────
  // 1. spiral_list_roadmaps (신규)
  // ─────────────────────────────────────────────────────
  server.registerTool(
    "spiral_list_roadmaps",
    {
      title: "사용 가능한 모든 로드맵과 학습 진도",
      description:
        "사용 가능한 모든 학습 로드맵을 두 가지 소스에서 통합 반환합니다:\n" +
        "1. **Local** — SPIRAL_ROADMAP_ROOT 아래에서 자동 탐지된 로드맵 (사용자의 로컬 자료)\n" +
        "2. **Curated** — GitHub 조직(예: iq-dev-lab)의 public 레포 중 이미 설치된 것\n\n" +
        "어떤 로드맵으로 학습할지 사용자가 정하지 않았다면 이 도구를 먼저 호출하고 결과를 마크다운 표 그대로 보여주세요. " +
        "Curated 레포 중 아직 설치되지 않은 것을 보려면 `include_available=true`로 호출하세요 — 사용자가 '받기/install' 의사를 표하면 `spiral_install_curated`로 클론할 수 있습니다. " +
        "각 로드맵의 id는 후속 도구의 roadmap_id 인자로 사용합니다. " +
        "응답은 가공하지 말고 그대로 출력하거나 짧은 인삿말과 함께 인용하세요.",
      inputSchema: {
        include_available: z
          .boolean()
          .optional()
          .describe(
            "true면 아직 설치되지 않은 Curated 레포도 함께 표시 (GitHub API 호출)",
          ),
      },
    },
    async ({ include_available }) => {
      const roadmaps = await getInstalledRoadmaps();
      const notes = await listSpiralNotes(vaultPath);

      const lines: string[] = [];

      // Local
      const local = roadmaps.filter((r) => r.source === "local");
      if (local.length > 0) {
        lines.push(`### 📁 Local 로드맵 (${local.length}개)\n`);
        lines.push("| 로드맵 | 챕터 | 학습 | 최대 depth | 마지막 학습 |");
        lines.push("|---|---:|---:|---:|---|");
        for (const r of local) {
          appendRow(lines, r, notes);
        }
        lines.push("");
      }

      // Curated (installed)
      const curated = roadmaps.filter((r) => r.source === "curated");
      if (curated.length > 0) {
        lines.push(
          `### 📚 Curated 설치됨 (${config.curatedOrg}, ${curated.length}개)\n`,
        );
        lines.push("| 로드맵 | 챕터 | 학습 | 최대 depth | 마지막 학습 |");
        lines.push("|---|---:|---:|---:|---|");
        for (const r of curated) {
          appendRow(lines, r, notes);
        }
        lines.push("");
      }

      // Curated available (optional)
      if (include_available && config.curatedOrg) {
        try {
          const repos = await listCuratedRepos({
            org: config.curatedOrg,
            token: config.githubToken ?? undefined,
          });
          const notInstalled = repos.filter((r) => !r.installed);
          if (notInstalled.length > 0) {
            lines.push(
              `### 📦 Curated 받기 가능 (${config.curatedOrg}, ${notInstalled.length}개)\n`,
            );
            lines.push("| 레포 | description | ⭐ | 마지막 push |");
            lines.push("|---|---|---:|---|");
            for (const repo of notInstalled.slice(0, 50)) {
              const desc = (repo.description ?? "").replace(/\|/g, "\\|").slice(0, 60);
              const dateStr = repo.pushedAt.slice(0, 10);
              lines.push(`| \`${repo.name}\` | ${desc} | ${repo.stars} | ${dateStr} |`);
            }
            lines.push("");
            lines.push(
              "_위 레포로 학습하려면 `spiral_install_curated`로 먼저 받으세요 (`repo_name`만 인자로)._",
            );
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          lines.push(`⚠️ Curated available 조회 실패: ${msg}`);
        }
      }

      if (lines.length === 0) {
        lines.push(
          "**아직 사용 가능한 로드맵이 없습니다.**\n\n" +
            (config.roadmapRoot
              ? `Local root \`${config.roadmapRoot}\`에 .md 2개+ 디렉토리가 없음.\n`
              : "SPIRAL_ROADMAP_ROOT 미설정.\n") +
            (config.curatedOrg
              ? `Curated org \`${config.curatedOrg}\`에서 받은 레포 없음. \`include_available=true\`로 조회하세요.`
              : "SPIRAL_DISABLE_CURATED=1로 Curated 끔."),
        );
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };

      // local helper
      function appendRow(
        lines: string[],
        r: Roadmap,
        notes: import("./vault.js").SpiralNote[],
      ) {
        const roadmapNotes = notes.filter((n) =>
          noteBelongsToRoadmap(n, { roadmapId: r.id, roadmapName: r.name }),
        );
        const visited = new Set(
          roadmapNotes.map((n) => n.chapterId).filter(Boolean),
        ).size;
        const maxDepth = roadmapNotes.reduce((m, n) => Math.max(m, n.depth), 0);
        const lastDate = roadmapNotes.reduce(
          (latest: string | null, n) =>
            !latest || n.date > latest ? n.date : latest,
          null,
        );
        const progress = `${visited}/${r.chapterCount}`;
        const depthStr = maxDepth > 0 ? `d${maxDepth}` : "—";
        const dateStr = lastDate ?? "—";
        lines.push(
          `| \`${r.id}\` | ${r.chapterCount} | ${progress} | ${depthStr} | ${dateStr} |`,
        );
      }
    },
  );

  // ─────────────────────────────────────────────────────
  // 1-b. spiral_install_curated (신규 — on-demand 클론)
  // ─────────────────────────────────────────────────────
  if (config.curatedOrg) {
    const org = config.curatedOrg;
    server.registerTool(
      "spiral_install_curated",
      {
        title: "Curated 레포 클론 (on-demand)",
        description:
          `GitHub 조직 \`${org}\`의 public 레포를 로컬 캐시(.cache/curated/)에 git clone합니다. ` +
          "이미 설치된 레포면 알림만 반환. 클론 후엔 `spiral_list_roadmaps`로 새 로드맵이 보입니다. " +
          "사용자가 'redis 로드맵으로 학습하자' 같이 명시한 레포를 처음 사용할 때 호출하세요. " +
          "shallow clone(--depth=1)이라 빠르고 디스크 절약됩니다.",
        inputSchema: {
          repo_name: z
            .string()
            .describe(
              `${org}의 레포 이름 (예: 'redis-deep-dive'). spiral_list_roadmaps에 include_available=true로 호출해 정확한 이름 확인.`,
            ),
        },
      },
      async ({ repo_name }) => {
        try {
          const result = await installCuratedRepo({ org, repoName: repo_name });
          if (result.alreadyInstalled) {
            return {
              content: [
                {
                  type: "text",
                  text: `ℹ️ \`${org}/${repo_name}\`는 이미 설치되어 있습니다.\n\n경로: \`${result.cachePath}\`\n\nspiral_list_chapters로 챕터를 확인하세요.`,
                },
              ],
            };
          }
          // 설치 직후 로드맵 ID 추출 시도
          const curated = await discoverCuratedRoadmaps(org);
          const newOnes = curated.filter((r) =>
            r.id.startsWith(`curated:${org}/${repo_name}`),
          );
          const lines: string[] = [];
          lines.push(`✓ **\`${org}/${repo_name}\` 설치 완료**\n`);
          lines.push(`경로: \`${result.cachePath}\`\n`);
          if (newOnes.length === 1) {
            lines.push(
              `발견된 로드맵: \`${newOnes[0]!.id}\` (${newOnes[0]!.chapterCount} 챕터)`,
            );
          } else if (newOnes.length > 1) {
            lines.push(`발견된 sub-로드맵 ${newOnes.length}개:`);
            for (const r of newOnes) {
              lines.push(`- \`${r.id}\` (${r.chapterCount} 챕터)`);
            }
          } else {
            lines.push(
              "⚠️ 클론은 됐지만 학습용 로드맵 형식(.md 2개+ 디렉토리)을 찾지 못했습니다.",
            );
          }
          lines.push("");
          lines.push(
            "이제 `spiral_list_chapters({roadmap_id: ...})`로 챕터를 보고 학습을 시작할 수 있습니다.",
          );
          return { content: [{ type: "text", text: lines.join("\n") }] };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text", text: `❌ 설치 실패: ${msg}` }],
            isError: true,
          };
        }
      },
    );
  }

  // ─────────────────────────────────────────────────────
  // 2. spiral_list_chapters (로드맵 인자 추가)
  // ─────────────────────────────────────────────────────
  server.registerTool(
    "spiral_list_chapters",
    {
      title: "특정 로드맵의 챕터와 학습 진도",
      description:
        "지정된 로드맵의 모든 챕터를 학습 진도(visit count, max depth, last date)와 함께 반환합니다. " +
        "spiral 학습 세션을 시작하기 전 호출하세요. " +
        "어느 챕터를 깊게(deeper-layer) 갈지, 새 챕터(next-chapter)로 진도 나갈지, 멀리 떨어진 챕터를 연결할지(cross-link) 판단하는 근거가 됩니다. " +
        "응답은 마크다운 표 — 사용자에게 그대로 보여주거나 짧은 해설과 함께 인용하세요.",
      inputSchema: {
        roadmap_id: z
          .string()
          .describe(
            "spiral_list_roadmaps에서 얻은 로드맵 id (예: 'transaction-mvcc' 또는 'spring ecosystem/spring-core-deep-dive/transaction-mvcc')",
          ),
      },
    },
    async ({ roadmap_id }) => {
      const roadmap = await resolveRoadmapByIdOrName(roadmap_id);
      if (!roadmap) {
        const all = await getInstalledRoadmaps();
        return {
          content: [
            {
              type: "text",
              text:
                `로드맵을 찾을 수 없습니다: \`${roadmap_id}\`\n\n` +
                `사용 가능한 로드맵 id:\n` +
                all.map((r) => `- \`${r.id}\``).join("\n") +
                `\n\nspiral_list_roadmaps를 호출해 정확한 id를 확인하세요.`,
            },
          ],
          isError: true,
        };
      }

      const chapters = await loadRoadmapChapters(roadmap);
      const notes = await listSpiralNotes(vaultPath);

      const lines: string[] = [];
      lines.push(`📖 **로드맵: ${roadmap.name}** (\`${roadmap.id}\`)\n`);
      lines.push("| # | 챕터 | 진도 | 마지막 학습 |");
      lines.push("|---:|---|---|---|");

      for (const ch of chapters) {
        const matching = notes.filter((n) =>
          noteMatchesChapter(n, {
            roadmapId: roadmap.id,
            roadmapName: roadmap.name,
            chapterId: ch.id,
          }),
        );
        const maxDepth = matching.reduce((m, n) => Math.max(m, n.depth), 0);
        const lastDate = matching.reduce(
          (latest: string | null, n) =>
            !latest || n.date > latest ? n.date : latest,
          null,
        );
        const progressStr =
          maxDepth > 0
            ? `**d${maxDepth}** (${matching.length}회)`
            : "_미학습_";
        const dateStr = lastDate ?? "—";
        lines.push(
          `| ${ch.order + 1} | ${ch.title} | ${progressStr} | ${dateStr} |`,
        );
      }

      // chapter_id 인자로 사용해야 하므로 별도로 안내
      lines.push("");
      lines.push("**챕터 ID (`spiral_get_chapter_context` 호출용)**:");
      for (const ch of chapters) {
        lines.push(`- \`${ch.id}\` — ${ch.title}`);
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );

  // ─────────────────────────────────────────────────────
  // 3. spiral_get_chapter_context
  // ─────────────────────────────────────────────────────
  server.registerTool(
    "spiral_get_chapter_context",
    {
      title: "챕터 본문 + 이전 학습 노트 (세션 시작용)",
      description:
        "특정 챕터에 대한 학습 세션을 시작하기 직전 호출하세요. " +
        "챕터 원문과 이 챕터에 대한 이전 spiral-buddy 노트들을 함께 반환합니다. " +
        "응답에 포함된 `nextDepth` 값이 이번 세션의 depth — 1이면 첫 학습, 2 이상이면 spiral 복귀 세션입니다. " +
        "이전 노트의 '헷갈렸던 / 확인이 필요한 지점' 섹션이 이번 세션의 진입점입니다.",
      inputSchema: {
        roadmap_id: z.string().describe("로드맵 id"),
        chapter_id: z
          .string()
          .describe(
            "spiral_list_chapters에서 얻은 챕터 id (예: '01-acid.md')",
          ),
      },
    },
    async ({ roadmap_id, chapter_id }) => {
      const roadmap = await resolveRoadmapByIdOrName(roadmap_id);
      if (!roadmap) {
        return {
          content: [
            { type: "text", text: `로드맵을 찾을 수 없습니다: ${roadmap_id}` },
          ],
          isError: true,
        };
      }
      const chapters = await loadRoadmapChapters(roadmap);
      const chapter = chapters.find((c) => c.id === chapter_id);
      if (!chapter) {
        return {
          content: [
            {
              type: "text",
              text: `챕터를 찾을 수 없습니다: ${chapter_id}\n로드맵 \`${roadmap.id}\`의 spiral_list_chapters를 다시 호출해 정확한 chapter_id를 확인하세요.`,
            },
          ],
          isError: true,
        };
      }
      const notes = await listSpiralNotes(vaultPath);
      const priorOnSame = notes.filter((n) =>
        noteMatchesChapter(n, {
          roadmapId: roadmap.id,
          roadmapName: roadmap.name,
          chapterId: chapter.id,
        }),
      );
      const nextDepth = priorOnSame.length + 1;
      const priorNotes = priorOnSame.slice(0, 5);

      const lines: string[] = [];
      lines.push(`# 🌀 ${chapter.title}`);
      lines.push(
        `**Roadmap**: ${roadmap.name} · **Chapter**: \`${chapter.id}\` · **Next depth**: \`${nextDepth}\``,
      );
      lines.push("");

      if (nextDepth === 1) {
        lines.push(
          "**처음 다루는 챕터** — 학습자의 직관부터 묻는 Socratic 질문으로 시작하세요. 본문을 통째로 설명하지 말고, 개념 하나에 질문 하나 식으로 진행하세요.",
        );
      } else {
        lines.push(
          `**Depth ${nextDepth} 복귀** — 아래 이전 노트의 '헷갈렸던 / 확인이 필요한 지점'을 진입점으로 삼으세요. 학습자가 이전 세션에서 막혔던 곳부터 다시 찔러봐야 합니다.`,
        );
      }

      lines.push("");
      lines.push("## 챕터 본문");
      lines.push("```markdown");
      lines.push(chapter.content.slice(0, 6000));
      if (chapter.content.length > 6000) {
        lines.push(`\n... (truncated, ${chapter.content.length - 6000} more chars)`);
      }
      lines.push("```");
      lines.push("");

      lines.push(`## 이전 노트 (${priorNotes.length}개)`);
      if (priorNotes.length === 0) {
        lines.push("_(이 챕터에 대한 이전 학습 기록 없음)_");
      } else {
        for (const n of priorNotes) {
          lines.push(`### depth ${n.depth} · ${n.date}`);
          lines.push(`**Summary**: ${n.summary || "(none)"}`);
          if (n.tags.length > 0) {
            lines.push(`**Tags**: ${n.tags.map((t) => `\`${t}\``).join(", ")}`);
          }
          lines.push("");
          lines.push(n.body.slice(0, 1200));
          if (n.body.length > 1200) lines.push("\n_... (이하 생략)_");
          lines.push("");
        }
      }

      lines.push("---");
      lines.push(
        `**다음 단계**: 학습 대화를 진행하세요. 마무리 시점에 \`spiral_save_note\` 도구를 호출해 8섹션 구조의 노트로 저장합니다. 그 때 \`roadmap_id="${roadmap.id}"\`, \`chapter_id="${chapter.id}"\`, \`depth=${nextDepth}\`로 전달하세요.`,
      );

      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );

  // ─────────────────────────────────────────────────────
  // 4. spiral_list_notes
  // ─────────────────────────────────────────────────────
  server.registerTool(
    "spiral_list_notes",
    {
      title: "이전 spiral-buddy 노트 인덱스",
      description:
        "vault에 저장된 spiral-buddy 노트들의 메타데이터를 최신순으로 반환합니다. " +
        "본문은 포함되지 않습니다 — 본문이 필요하면 spiral_read_note 호출. " +
        "특정 로드맵으로만 필터링하려면 roadmap_id 지정.",
      inputSchema: {
        roadmap_id: z
          .string()
          .optional()
          .describe("특정 로드맵 id로 필터링 (선택)"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("반환할 최대 노트 수 (기본 20)"),
      },
    },
    async ({ roadmap_id, limit }) => {
      let notes = await listSpiralNotes(vaultPath);

      let scopeLabel = "전체 vault";
      if (roadmap_id) {
        const roadmap = await resolveRoadmapByIdOrName(roadmap_id);
        if (roadmap) {
          notes = notes.filter((n) =>
            noteBelongsToRoadmap(n, {
              roadmapId: roadmap.id,
              roadmapName: roadmap.name,
            }),
          );
          scopeLabel = `로드맵 \`${roadmap.id}\``;
        }
      }

      const lim = limit ?? 20;
      const sliced = notes.slice(0, lim);

      const lines: string[] = [];
      lines.push(
        `📝 **노트 인덱스** — ${scopeLabel} · ${notes.length}개 (표시 ${sliced.length}개)\n`,
      );
      if (sliced.length === 0) {
        lines.push("_아직 저장된 노트가 없습니다._");
      } else {
        lines.push("| 날짜 | depth | 주제 | 로드맵 | 요약 |");
        lines.push("|---|---:|---|---|---|");
        for (const n of sliced) {
          const safeTopic = n.topic.replace(/\|/g, "\\|");
          const safeSummary = (n.summary || "").replace(/\|/g, "\\|");
          lines.push(
            `| ${n.date} | d${n.depth} | ${safeTopic} | ${n.roadmapName ?? "?"} | ${safeSummary} |`,
          );
        }
        lines.push("");
        lines.push("**Read paths** (`spiral_read_note` 인자):");
        for (const n of sliced) {
          lines.push(`- \`${n.relativePath}\``);
        }
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );

  // ─────────────────────────────────────────────────────
  // 5. spiral_read_note
  // ─────────────────────────────────────────────────────
  server.registerTool(
    "spiral_read_note",
    {
      title: "spiral-buddy 노트 본문 읽기",
      description:
        "특정 spiral-buddy 노트의 전체 본문(frontmatter 포함)을 반환합니다. " +
        "spiral_list_notes에서 얻은 relativePath를 그대로 넘기세요. " +
        "cross-link 추론 시 관련 노트의 '핵심 개념', '헷갈렸던 지점' 섹션을 직접 확인하는 용도.",
      inputSchema: {
        relative_path: z
          .string()
          .describe("spiral_list_notes에서 얻은 relativePath"),
      },
    },
    async ({ relative_path }) => {
      const filePath = path.join(vaultPath, "spiral-buddy", relative_path);
      try {
        const content = await fs.readFile(filePath, "utf-8");
        return { content: [{ type: "text", text: content }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "unknown";
        return {
          content: [{ type: "text", text: `노트를 읽을 수 없습니다: ${msg}` }],
          isError: true,
        };
      }
    },
  );

  // ─────────────────────────────────────────────────────
  // 6. spiral_save_note (roadmap_id 추가 + 8섹션 검증)
  // ─────────────────────────────────────────────────────
  server.registerTool(
    "spiral_save_note",
    {
      title: "학습 세션을 8섹션 구조의 노트로 vault에 저장",
      description:
        "학습 세션 마무리 시 호출하세요. body는 다음 정확한 8개 섹션 헤딩을 반드시 포함해야 합니다:\n\n" +
        REQUIRED_SECTIONS.map((s) => `## ${s}`).join("\n") +
        "\n\n세션과 같은 언어로 작성하세요 (보통 한국어). " +
        "'헷갈렸던 / 확인이 필요한 지점' 섹션이 핵심 — 다음 spiral 세션의 진입점이므로 학습자가 실제로 헤맸던 부분을 구체적으로 기록하세요. " +
        "각 섹션에 진짜로 다룬 내용이 없으면 `_이번 세션에서 다루지 않음._` 한 줄로 처리. " +
        "tags는 주제 태그만 (예: 'spring-ioc') — 'study', 'learning' 같은 메타 태그 금지. " +
        "누락된 헤딩이 있으면 자동 보충되지만 가급적 모두 채우세요.",
      inputSchema: {
        roadmap_id: z.string().describe("spiral_list_roadmaps에서 얻은 로드맵 id"),
        chapter_id: z
          .string()
          .describe("spiral_list_chapters에서 얻은 챕터 id"),
        topic: z.string().describe("노트 주제 (보통 챕터 제목)"),
        depth: z
          .number()
          .int()
          .min(1)
          .describe("이번 세션의 depth (spiral_get_chapter_context의 nextDepth)"),
        tags: z.array(z.string()).describe("주제 태그 배열"),
        summary: z.string().describe("2-3문장 요약"),
        body: z.string().describe("8섹션 구조의 노트 본문 (마크다운)"),
        related_note_paths: z
          .array(z.string())
          .optional()
          .describe("이전 관련 노트들의 relativePath (선택)"),
      },
    },
    async ({
      roadmap_id,
      chapter_id,
      topic,
      depth,
      tags,
      summary,
      body,
      related_note_paths,
    }) => {
      const roadmap = await resolveRoadmapByIdOrName(roadmap_id);
      if (!roadmap) {
        return {
          content: [
            { type: "text", text: `로드맵을 찾을 수 없습니다: ${roadmap_id}` },
          ],
          isError: true,
        };
      }

      // 8섹션 검증 + 자동 보충
      const { missing, patchedBody } = validateAndPatchSections(body);

      const relatedAbs = (related_note_paths ?? []).map((rp) =>
        path.join(vaultPath, "spiral-buddy", rp),
      );

      // roadmap.id (예: "unit-testing/anatomy-of-good-tests") → repo + roadmap path
      const roadmapParts = roadmap.id.split("/").filter(Boolean);
      const repo = roadmapParts.length > 1 ? roadmapParts[0]! : null;
      const roadmapPath =
        roadmapParts.length > 1 ? roadmapParts.slice(1).join("/") : roadmap.id;

      const writtenPath = await writeNewNote(vaultPath, {
        topic,
        chapterId: chapter_id,
        roadmapId: roadmap.id,
        roadmapName: roadmap.name,
        repo,
        roadmap: roadmapPath,
        depth,
        tags,
        summary,
        body: patchedBody,
        relatedNotePaths: relatedAbs,
      });

      const lines: string[] = [];
      lines.push("✓ **노트 저장 완료**");
      lines.push("");
      lines.push(`- **경로**: \`${writtenPath}\``);
      lines.push(
        `- **로드맵**: ${roadmap.name} · **챕터**: \`${chapter_id}\` · **depth**: ${depth}`,
      );
      if (missing.length > 0) {
        lines.push("");
        lines.push(
          `⚠️ **누락된 섹션 자동 보충됨**: ${missing.map((s) => `\`${s}\``).join(", ")}`,
        );
        lines.push(
          `다음 세션에선 이 섹션들을 의식적으로 채워보면 노트 품질이 개선됩니다.`,
        );
      }
      lines.push("");
      lines.push(
        `다음 spiral 세션 시 이 노트가 depth ${depth + 1}의 prior context로 자동 포함됩니다.`,
      );

      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );

  // ─────────────────────────────────────────────────────
  // 7. spiral_delete_notes — 챕터 또는 로드맵 노트를 .trash로 이동
  // ─────────────────────────────────────────────────────
  server.registerTool(
    "spiral_delete_notes",
    {
      title: "학습 노트 삭제 (vault의 .trash/로 이동, 복구 가능)",
      description:
        "특정 챕터 또는 로드맵의 노트를 vault의 spiral-buddy/.trash/로 이동합니다. fs.unlink가 아니라 rename이라 사용자가 직접 복구 가능합니다. " +
        "범위 결정:\n" +
        "- chapter_id 있으면: 그 챕터만\n" +
        "- chapter_id 없으면: roadmap의 모든 챕터\n" +
        "- depth 있으면: 해당 depth만 추가 필터\n\n" +
        "위험한 액션이므로 사용자가 명시적으로 요청한 경우에만 사용하세요. " +
        "삭제 전에 어떤 노트가 영향받는지 spiral_list_notes로 확인을 권장합니다.",
      inputSchema: {
        roadmap_id: z.string().describe("대상 로드맵 id"),
        chapter_id: z
          .string()
          .optional()
          .describe("특정 챕터만 삭제할 경우 그 id (생략 시 로드맵 전체)"),
        depth: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("특정 depth만 삭제 (예: 2면 d2 노트만)"),
      },
    },
    async ({ roadmap_id, chapter_id, depth }) => {
      const roadmap = await resolveRoadmapByIdOrName(roadmap_id);
      if (!roadmap) {
        return {
          content: [
            { type: "text", text: `로드맵을 찾을 수 없습니다: ${roadmap_id}` },
          ],
          isError: true,
        };
      }
      const all = await listSpiralNotes(vaultPath);
      const target = all.filter((n) => {
        if (chapter_id) {
          if (
            !noteMatchesChapter(n, {
              roadmapId: roadmap.id,
              roadmapName: roadmap.name,
              chapterId: chapter_id,
            })
          ) {
            return false;
          }
        } else {
          if (
            !noteBelongsToRoadmap(n, {
              roadmapId: roadmap.id,
              roadmapName: roadmap.name,
            })
          ) {
            return false;
          }
        }
        if (depth !== undefined) return n.depth === depth;
        return true;
      });

      if (target.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `삭제 대상 노트가 없습니다 (roadmap=${roadmap.name}${chapter_id ? `, chapter=${chapter_id}` : ""}${depth !== undefined ? `, depth=${depth}` : ""}).`,
            },
          ],
        };
      }

      const moved = await moveNotesToTrash(vaultPath, target);
      const lines: string[] = [];
      lines.push(`✓ **${moved.length}개 노트를 .trash/로 이동했습니다**`);
      lines.push("");
      lines.push(`- **로드맵**: ${roadmap.name}`);
      if (chapter_id) lines.push(`- **챕터**: \`${chapter_id}\``);
      if (depth !== undefined) lines.push(`- **depth 필터**: d${depth}`);
      lines.push("");
      lines.push("복구하려면 웹앱(사이드바 휴지통) 또는 vault에서 직접 옮기세요. mtime 30일 초과 시 영구 삭제됩니다.");
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );

  // ─────────────────────────────────────────────────────
  // 8. spiral_search — 로드맵·챕터·노트 통합 검색
  // ─────────────────────────────────────────────────────
  server.registerTool(
    "spiral_search",
    {
      title: "로드맵·챕터·노트 통합 검색 (substring)",
      description:
        "키워드로 로드맵 이름, 챕터 제목, 노트 본문을 검색합니다. " +
        "사용자가 '어디서 X 봤지?' 또는 '이 주제 관련 자료 찾아줘'라고 할 때 사용하세요. " +
        "대소문자 무시. 결과는 카테고리별 마크다운 표로 반환됩니다. " +
        "각 항목의 id는 후속 도구(spiral_get_chapter_context 등)의 인자로 사용 가능합니다.",
      inputSchema: {
        query: z.string().min(2).describe("검색어 (최소 2글자)"),
      },
    },
    async ({ query }) => {
      const q = query.trim().toLowerCase();
      if (q.length < 2) {
        return {
          content: [{ type: "text", text: "검색어는 최소 2글자 이상이어야 합니다." }],
          isError: true,
        };
      }
      const roadmaps = await getInstalledRoadmaps();
      const notes = await listSpiralNotes(vaultPath);

      const rmMatches = roadmaps.filter(
        (r) =>
          r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q),
      );
      const noteMatches = notes.filter((n) => {
        const head = n.body.slice(0, 1000).toLowerCase();
        return (
          n.title.toLowerCase().includes(q) ||
          n.topic.toLowerCase().includes(q) ||
          head.includes(q)
        );
      });
      // 챕터 검색 — 매칭된 로드맵 + 노트의 로드맵 안만 (성능)
      const candidateMap = new Map<string, Roadmap>();
      for (const r of rmMatches) candidateMap.set(r.id, r);
      for (const n of noteMatches) {
        if (n.roadmapId) {
          const r = roadmaps.find((x) => x.id === n.roadmapId);
          if (r) candidateMap.set(r.id, r);
        }
      }
      const chapterMatches: Array<{
        roadmapName: string;
        chapterId: string;
        title: string;
      }> = [];
      for (const r of candidateMap.values()) {
        const chapters = await loadRoadmapChapters(r);
        for (const ch of chapters) {
          if (
            ch.title.toLowerCase().includes(q) ||
            ch.id.toLowerCase().includes(q)
          ) {
            chapterMatches.push({
              roadmapName: r.name,
              chapterId: ch.id,
              title: ch.title,
            });
            if (chapterMatches.length >= 20) break;
          }
        }
        if (chapterMatches.length >= 20) break;
      }

      const lines: string[] = [];
      lines.push(`# 검색 결과 — \`${query}\``);
      lines.push("");
      lines.push(
        `로드맵 ${rmMatches.length}개 · 챕터 ${chapterMatches.length}개 · 노트 ${noteMatches.length}개`,
      );
      lines.push("");

      if (rmMatches.length > 0) {
        lines.push("## 📕 로드맵");
        lines.push("| 이름 | id |");
        lines.push("|---|---|");
        for (const r of rmMatches.slice(0, 15)) {
          lines.push(`| ${r.name} | \`${r.id}\` |`);
        }
        lines.push("");
      }
      if (chapterMatches.length > 0) {
        lines.push("## 🔖 챕터");
        lines.push("| 제목 | 로드맵 | chapter_id |");
        lines.push("|---|---|---|");
        for (const c of chapterMatches) {
          lines.push(`| ${c.title} | ${c.roadmapName} | \`${c.chapterId}\` |`);
        }
        lines.push("");
      }
      if (noteMatches.length > 0) {
        lines.push("## 📝 노트");
        lines.push("| 제목 | depth | 날짜 | 로드맵 | 챕터 |");
        lines.push("|---|---:|---|---|---|");
        for (const n of noteMatches.slice(0, 15)) {
          lines.push(
            `| ${n.title || n.topic} | d${n.depth} | ${n.date} | ${n.roadmapName ?? "?"} | \`${n.chapterId ?? "?"}\` |`,
          );
        }
        lines.push("");
      }
      if (rmMatches.length === 0 && chapterMatches.length === 0 && noteMatches.length === 0) {
        lines.push("_매칭 없음._");
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );

  // ─────────────────────────────────────────────────────
  // 시작
  // ─────────────────────────────────────────────────────
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const roadmaps = await getInstalledRoadmaps();
  const local = roadmaps.filter((r) => r.source === "local").length;
  const curated = roadmaps.filter((r) => r.source === "curated").length;
  process.stderr.write(
    `[iq-spiral-buddy MCP] connected (v0.3.0)\n` +
      `  roadmap root: ${config.roadmapRoot ?? "(unset)"}\n` +
      `  curated org:  ${config.curatedOrg ?? "(disabled)"}\n` +
      `  vault:        ${vaultPath}\n` +
      `  installed:    ${roadmaps.length} roadmaps (local: ${local}, curated: ${curated})\n`,
  );
}

main().catch((err) => {
  process.stderr.write(
    `[iq-spiral-buddy MCP] fatal: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
