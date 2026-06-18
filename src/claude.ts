import { spawn } from "node:child_process";
import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "./config.js";

// authMode에 따라 두 가지 전략을 지원:
//   "oauth"  → claude -p 서브프로세스 (Claude Code 구독 OAuth 사용)
//   "apikey" → @anthropic-ai/sdk 직접 호출 (ANTHROPIC_API_KEY 필요)

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
  // apikey 모드에서만 존재
  _sdk?: Anthropic;
}

export function createClient(config: Config): ClaudeClient {
  if (config.authMode === "apikey") {
    return { config, _sdk: new Anthropic({ apiKey: config.apiKey }) };
  }
  return { config };
}

// ─── 공통 유틸 ────────────────────────────────────────────────

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

export function isTransientApiError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;
  const status = typeof e.status === "number" ? e.status : null;
  if (status === 529 || status === 503 || status === 502 || status === 504) return true;
  if (status && status >= 500) return true;
  const errType =
    (e.error as { type?: string } | undefined)?.type ??
    (e.type as string | undefined);
  if (
    errType === "overloaded_error" ||
    errType === "rate_limit_error" ||
    errType === "api_error"
  ) return true;
  const msg = typeof e.message === "string" ? e.message.toLowerCase() : "";
  return (
    msg.includes("overloaded") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("socket hang up") ||
    msg.includes("rate limit") ||
    msg.includes("service unavailable")
  );
}

export function friendlyApiErrorMessage(err: unknown): string {
  if (!err) return "알 수 없는 오류";
  const e = err as Record<string, unknown>;
  const errType =
    (e.error as { type?: string } | undefined)?.type ??
    (e.type as string | undefined);
  if (errType === "overloaded_error")
    return "Claude API가 일시적으로 과부하 상태입니다. 잠시 후 다시 시도해 주세요.";
  if (errType === "rate_limit_error")
    return "요청이 잠시 많이 몰렸습니다(rate limit). 잠시 후 다시 시도해 주세요.";
  if (errType === "authentication_error")
    return "API 키 인증이 실패했습니다. 설정에서 키를 확인해 주세요.";
  if (errType === "permission_error")
    return "이 모델에 대한 권한이 없습니다. 다른 모델로 시도해 보세요.";
  if (errType === "not_found_error")
    return "모델을 찾을 수 없습니다. 설정에서 다른 모델로 바꿔 주세요.";
  const msg = typeof e.message === "string" ? e.message : String(err);
  if (msg.includes("ENOENT") || msg.includes("Failed to spawn"))
    return "Claude Code CLI를 찾을 수 없습니다. `claude` 명령이 PATH에 있는지, `claude` 로그인이 되어 있는지 확인해 주세요.";
  if (msg.startsWith("{") || msg.startsWith("[")) {
    const status = typeof e.status === "number" ? e.status : null;
    return status
      ? `Claude API 오류 (HTTP ${status}). 잠시 후 다시 시도해 주세요.`
      : "Claude API 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
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
      if (attempt >= maxAttempts || !isTransientApiError(err)) throw err;
      const baseMs = [1500, 4000, 9000][attempt - 1] ?? 9000;
      const wait = baseMs + Math.floor(Math.random() * 500);
      opts?.onRetry?.(attempt, err);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

// ─── apikey 모드 (Anthropic SDK) ──────────────────────────────

async function sdkStreamTurn(
  sdk: Anthropic,
  config: Config,
  args: {
    system: string;
    messages: ClaudeMessage[];
    onText?: (chunk: string) => void | Promise<void>;
    model?: string;
    maxTokens?: number;
  },
): Promise<{ text: string; usage: { input: number; output: number } }> {
  return withRetry(
    async () => {
      let fullText = "";
      let textStarted = false;
      const stream = sdk.messages.stream({
        model: args.model ?? config.model,
        max_tokens: args.maxTokens ?? config.maxTokens,
        system: args.system,
        messages: args.messages as Anthropic.MessageParam[],
      });
      stream.on("text", (chunk) => {
        fullText += chunk;
        textStarted = true;
        if (args.onText) {
          const r = args.onText(chunk);
          if (r instanceof Promise) r.catch((e) => console.error("onText error:", e));
        }
      });
      try {
        const final = await stream.finalMessage();
        return {
          text: fullText,
          usage: { input: final.usage.input_tokens, output: final.usage.output_tokens },
        };
      } catch (err) {
        if (textStarted) {
          const e = new Error(friendlyApiErrorMessage(err));
          (e as Error & { _noRetry?: boolean })._noRetry = true;
          throw e;
        }
        throw err;
      }
    },
    { onRetry: (n, e) => console.warn(`[sdkStreamTurn] retry ${n}: ${(e as Error)?.message}`) },
  );
}

async function sdkCompleteOnce(
  sdk: Anthropic,
  config: Config,
  args: {
    system: string;
    messages: ClaudeMessage[];
    maxTokens?: number;
    model?: string;
  },
): Promise<{ text: string; usage: { input: number; output: number } }> {
  return withRetry(
    async () => {
      const res = await sdk.messages.create({
        model: args.model ?? config.model,
        max_tokens: args.maxTokens ?? config.maxTokens,
        system: args.system,
        messages: args.messages as Anthropic.MessageParam[],
      });
      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      return {
        text,
        usage: { input: res.usage.input_tokens, output: res.usage.output_tokens },
      };
    },
    { onRetry: (n, e) => console.warn(`[sdkCompleteOnce] retry ${n}: ${(e as Error)?.message}`) },
  );
}

// ─── oauth 모드 (claude -p 서브프로세스) ──────────────────────

function buildFlatPrompt(messages: ClaudeMessage[]): string {
  if (messages.length === 1) return extractText(messages[0]!.content);
  return messages
    .map((m) => `${m.role === "user" ? "Human" : "Assistant"}: ${extractText(m.content)}`)
    .join("\n\n");
}

async function subprocessRun(args: {
  system: string;
  messages: ClaudeMessage[];
  model: string;
  onText?: (chunk: string) => void | Promise<void>;
}): Promise<{ text: string; usage: { input: number; output: number } }> {
  const prompt = buildFlatPrompt(args.messages);
  const isSingleTurn = args.messages.length === 1;

  const cliArgs: string[] = [
    "-p", prompt,
    "--output-format", "stream-json",
    "--model", args.model,
    "--max-turns", "1",
    "--verbose",
  ];
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

    function handleEvent(ev: Record<string, unknown>) {
      if (ev.type === "content_block_delta") {
        const delta = ev.delta as Record<string, unknown> | undefined;
        if (delta?.type === "text_delta" && typeof delta.text === "string") {
          fullText += delta.text;
          if (args.onText) {
            const r = args.onText(delta.text);
            if (r instanceof Promise) r.catch(console.error);
          }
        }
      } else if (ev.type === "assistant") {
        const msg = ev.message as Record<string, unknown> | undefined;
        const content = Array.isArray(msg?.content) ? msg!.content : [];
        if (!fullText) {
          for (const block of content as Array<Record<string, unknown>>) {
            if (block.type === "text" && typeof block.text === "string") {
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
        if (!fullText && typeof ev.result === "string" && ev.result) {
          fullText = ev.result;
          if (args.onText) {
            const r = args.onText(ev.result);
            if (r instanceof Promise) r.catch(console.error);
          }
        }
      }
    }

    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        try {
          handleEvent(JSON.parse(t) as Record<string, unknown>);
        } catch {
          if (t && !t.startsWith("{")) {
            fullText += t + "\n";
            if (args.onText) {
              const r = args.onText(t + "\n");
              if (r instanceof Promise) r.catch(console.error);
            }
          }
        }
      }
    });

    child.stderr.on("data", (c: Buffer) => { stderrBuf += c.toString("utf8"); });

    child.on("error", (err: NodeJS.ErrnoException) => {
      reject(new Error(
        err.code === "ENOENT"
          ? "Failed to spawn claude: `claude` not found in PATH."
          : `Failed to spawn claude: ${err.message}`,
      ));
    });

    child.on("close", (code) => {
      if (buffer.trim()) {
        try { handleEvent(JSON.parse(buffer.trim()) as Record<string, unknown>); } catch { /* ignore */ }
      }
      if (code !== 0 && !fullText) {
        const hint = stderrBuf.trim() ? `\nstderr: ${stderrBuf.trim().slice(0, 300)}` : "";
        reject(new Error(
          `claude process exited with code ${code}.${hint}\n\`claude\` 로그인 상태를 확인하세요: claude /login`,
        ));
        return;
      }
      resolve({ text: fullText, usage: { input: inputTokens, output: outputTokens } });
    });
  });
}

// ─── 공개 API ─────────────────────────────────────────────────

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
  if (client.config.authMode === "apikey" && client._sdk) {
    return sdkStreamTurn(client._sdk, client.config, args);
  }
  return withRetry(
    () => subprocessRun({ ...args, model: args.model ?? client.config.model }),
    { onRetry: (n, e) => console.warn(`[streamTurn] retry ${n}: ${(e as Error)?.message}`) },
  );
}

export async function completeOnce(
  client: ClaudeClient,
  args: {
    system: string;
    messages: ClaudeMessage[];
    maxTokens?: number;
    model?: string;
  },
): Promise<{ text: string; usage: { input: number; output: number } }> {
  if (client.config.authMode === "apikey" && client._sdk) {
    return sdkCompleteOnce(client._sdk, client.config, args);
  }
  return withRetry(
    () => subprocessRun({ ...args, model: args.model ?? client.config.model }),
    { onRetry: (n, e) => console.warn(`[completeOnce] retry ${n}: ${(e as Error)?.message}`) },
  );
}
