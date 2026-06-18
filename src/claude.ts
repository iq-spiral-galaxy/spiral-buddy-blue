import { spawn } from "node:child_process";
import type { Config } from "./config.js";

// claude -p 서브프로세스 기반 클라이언트.
// Claude Code의 구독 OAuth 자격증명을 그대로 물려받아 실행되므로
// ANTHROPIC_API_KEY 불필요.

export type ClaudeMessage = {
  role: "user" | "assistant";
  content:
    | string
    | Array<{
        type: string;
        text?: string;
        cache_control?: unknown;
      }>;
};

export interface ClaudeClient {
  config: Config;
}

export function createClient(config: Config): ClaudeClient {
  return { config };
}

// content 블록 배열에서 텍스트만 이어붙임. cache_control 힌트는 무시.
function extractText(content: ClaudeMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter(
      (b): b is { type: "text"; text: string } =>
        b.type === "text" && typeof b.text === "string",
    )
    .map((b) => b.text)
    .join("\n");
}

// system + 다중 턴 메시지 배열을 claude -p 에 넘길 단일 프롬프트로 평탄화.
// 마지막 항목은 항상 user 턴이어야 함(routes.ts 구조상 보장됨).
function buildFlatPrompt(system: string, messages: ClaudeMessage[]): string {
  const parts: string[] = [];

  if (messages.length === 1) {
    // 단일 턴 — 시스템 프롬프트를 --system-prompt 로 분리해서 넘기므로
    // 여기선 user 메시지만.
    return extractText(messages[0]!.content);
  }

  // 멀티 턴 — 시스템 컨텍스트 + 대화 이력 전체를 하나의 프롬프트에 포함.
  // system 파라미터는 --system-prompt 로 따로 전달하므로 여기선 생략.
  for (const msg of messages) {
    const text = extractText(msg.content);
    if (msg.role === "user") {
      parts.push(`Human: ${text}`);
    } else {
      parts.push(`Assistant: ${text}`);
    }
  }
  return parts.join("\n\n");
}

export function isTransientApiError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const msg =
    typeof (err as Record<string, unknown>).message === "string"
      ? ((err as Record<string, unknown>).message as string).toLowerCase()
      : "";
  return (
    msg.includes("overloaded") ||
    msg.includes("rate limit") ||
    msg.includes("service unavailable") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("socket hang up")
  );
}

export function friendlyApiErrorMessage(err: unknown): string {
  if (!err) return "알 수 없는 오류";
  const msg =
    typeof (err as Record<string, unknown>).message === "string"
      ? ((err as Record<string, unknown>).message as string)
      : String(err);
  if (msg.includes("ENOENT") || msg.includes("Failed to spawn")) {
    return "Claude Code CLI를 찾을 수 없습니다. `claude` 명령이 PATH에 있는지, `claude` 로그인이 되어 있는지 확인해 주세요.";
  }
  if (msg.includes("overloaded") || msg.includes("529")) {
    return "Claude가 일시적으로 과부하 상태입니다. 잠시 후 다시 시도해 주세요.";
  }
  if (msg.includes("rate limit")) {
    return "요청이 잠시 많이 몰렸습니다(rate limit). 잠시 후 다시 시도해 주세요.";
  }
  return msg;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: { maxAttempts?: number; onRetry?: (n: number, err: unknown) => void },
): Promise<T> {
  const maxAttempts = opts?.maxAttempts ?? 3;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts || !isTransientApiError(err)) {
        throw err;
      }
      const baseMs = [1500, 4000, 9000][attempt - 1] ?? 9000;
      const wait = baseMs + Math.floor(Math.random() * 500);
      opts?.onRetry?.(attempt, err);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

// claude -p를 서브프로세스로 실행하고 stdout을 스트리밍으로 소비.
// --output-format stream-json: 이벤트가 줄 단위 JSON으로 출력됨.
// 텍스트 청크는 onText 콜백으로, 최종 결과는 Promise 반환.
async function runClaudeProcess(args: {
  system: string;
  messages: ClaudeMessage[];
  model: string;
  onText?: (chunk: string) => void | Promise<void>;
}): Promise<{ text: string; usage: { input: number; output: number } }> {
  const prompt = buildFlatPrompt(args.system, args.messages);
  const isSingleTurn = args.messages.length === 1;

  const cliArgs: string[] = [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--model",
    args.model,
    "--max-turns",
    "1",
  ];

  // 단일 턴일 때만 --system-prompt 로 시스템 분리.
  // 멀티 턴은 buildFlatPrompt 내부에서 대화 이력에 포함시킴.
  if (isSingleTurn && args.system) {
    cliArgs.push("--system-prompt", args.system);
  }

  return new Promise((resolve, reject) => {
    const child = spawn("claude", cliArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      windowsHide: true,
    });

    let fullText = "";
    let buffer = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let stderrBuf = "";

    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const ev = JSON.parse(trimmed) as Record<string, unknown>;
          handleEvent(ev);
        } catch {
          // 비-JSON 줄은 그대로 텍스트로 처리 (--output-format text fallback)
          if (trimmed) {
            fullText += trimmed + "\n";
            if (args.onText) {
              const r = args.onText(trimmed + "\n");
              if (r instanceof Promise) r.catch(console.error);
            }
          }
        }
      }
    });

    function handleEvent(ev: Record<string, unknown>) {
      // stream-json 이벤트 종류:
      //   {"type":"system","subtype":"init",...}
      //   {"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}}
      //   {"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
      //   {"type":"result","subtype":"success","result":"...","input_tokens":N,"output_tokens":N}
      if (
        ev.type === "content_block_delta" &&
        typeof ev.delta === "object" &&
        ev.delta !== null
      ) {
        const delta = ev.delta as Record<string, unknown>;
        if (delta.type === "text_delta" && typeof delta.text === "string") {
          fullText += delta.text;
          if (args.onText) {
            const r = args.onText(delta.text);
            if (r instanceof Promise) r.catch(console.error);
          }
        }
      } else if (
        ev.type === "assistant" &&
        typeof ev.message === "object" &&
        ev.message !== null
      ) {
        // Non-streaming 또는 final-message 이벤트
        const msg = ev.message as Record<string, unknown>;
        const content = Array.isArray(msg.content) ? msg.content : [];
        for (const block of content as Array<Record<string, unknown>>) {
          if (block.type === "text" && typeof block.text === "string") {
            // 이미 delta로 수집 중이면 중복 방지
            if (!fullText) {
              fullText += block.text;
              if (args.onText) {
                const r = args.onText(block.text);
                if (r instanceof Promise) r.catch(console.error);
              }
            }
          }
        }
      } else if (ev.type === "result") {
        if (typeof ev.input_tokens === "number") inputTokens = ev.input_tokens;
        if (typeof ev.output_tokens === "number") outputTokens = ev.output_tokens;
        // result.result가 있고 fullText가 아직 비어있으면 사용 (fallback)
        if (!fullText && typeof ev.result === "string") {
          fullText = ev.result;
          if (args.onText && ev.result) {
            const r = args.onText(ev.result);
            if (r instanceof Promise) r.catch(console.error);
          }
        }
      }
    }

    child.stderr.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString("utf8");
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        reject(
          new Error(
            "Failed to spawn claude: `claude` not found in PATH. " +
              "Claude Code CLI가 설치되어 있는지 확인하세요.",
          ),
        );
      } else {
        reject(new Error(`Failed to spawn claude: ${err.message}`));
      }
    });

    child.on("close", (code) => {
      // 남은 buffer 처리
      if (buffer.trim()) {
        try {
          const ev = JSON.parse(buffer.trim()) as Record<string, unknown>;
          handleEvent(ev);
        } catch {
          if (buffer.trim()) fullText += buffer.trim();
        }
      }

      if (code !== 0 && !fullText) {
        const hint = stderrBuf.trim()
          ? `\nstderr: ${stderrBuf.trim().slice(0, 300)}`
          : "";
        reject(
          new Error(
            `claude process exited with code ${code}.${hint}\n` +
              "`claude` 로그인 상태를 확인하세요: claude /login",
          ),
        );
        return;
      }

      resolve({ text: fullText, usage: { input: inputTokens, output: outputTokens } });
    });
  });
}

/** Streams an assistant turn. onText fires per text chunk. */
export async function streamTurn(
  client: ClaudeClient,
  args: {
    system: string;
    messages: ClaudeMessage[];
    onText?: (chunk: string) => void | Promise<void>;
    model?: string;
    maxTokens?: number;
  },
): Promise<{ text: string; usage: { input: number; output: number } }> {
  return withRetry(
    () =>
      runClaudeProcess({
        system: args.system,
        messages: args.messages,
        model: args.model ?? client.config.model,
        onText: args.onText,
      }),
    {
      onRetry: (n, err) =>
        console.warn(
          `[streamTurn] transient error, retry ${n}: ${(err as Error)?.message ?? String(err)}`,
        ),
    },
  );
}

/** Non-streaming single-shot completion. */
export async function completeOnce(
  client: ClaudeClient,
  args: {
    system: string;
    messages: ClaudeMessage[];
    maxTokens?: number;
    model?: string;
  },
): Promise<{ text: string; usage: { input: number; output: number } }> {
  return withRetry(
    () =>
      runClaudeProcess({
        system: args.system,
        messages: args.messages,
        model: args.model ?? client.config.model,
      }),
    {
      onRetry: (n, err) =>
        console.warn(
          `[completeOnce] transient error, retry ${n}: ${(err as Error)?.message ?? String(err)}`,
        ),
    },
  );
}
