import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "./config.js";

export type ClaudeMessage = Anthropic.MessageParam;

export interface ClaudeClient {
  raw: Anthropic;
  config: Config;
}

export function createClient(config: Config): ClaudeClient {
  const raw = new Anthropic({ apiKey: config.apiKey });
  return { raw, config };
}

/**
 * Anthropic API의 일시적 에러인지 판단:
 *   - 529 overloaded_error: 클로드가 일시적으로 과부하 (자주 발생 — 30분 후 보통 회복)
 *   - 503 service unavailable
 *   - 502 bad gateway
 *   - 5xx 일반
 *   - ECONNRESET, ETIMEDOUT 등 네트워크
 */
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
  ) {
    return true;
  }
  const msg = typeof e.message === "string" ? e.message.toLowerCase() : "";
  if (
    msg.includes("overloaded") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("socket hang up")
  ) {
    return true;
  }
  return false;
}

/**
 * Anthropic 에러 객체에서 사람이 읽을 만한 메시지를 추출.
 * 너무 긴 JSON 통째로 보여주는 대신, 의미 있는 한 줄로.
 */
export function friendlyApiErrorMessage(err: unknown): string {
  if (!err) return "알 수 없는 오류";
  const e = err as Record<string, unknown>;
  const errType =
    (e.error as { type?: string } | undefined)?.type ??
    (e.type as string | undefined);
  if (errType === "overloaded_error") {
    return "Claude API가 일시적으로 과부하 상태입니다. 잠시 후 다시 시도하거나, 설정에서 다른 모델로 변경해 보세요.";
  }
  if (errType === "rate_limit_error") {
    return "요청이 잠시 많이 몰렸습니다(rate limit). 잠시 후 다시 시도해 주세요.";
  }
  if (errType === "authentication_error") {
    return "API 키 인증이 실패했습니다. 설정에서 키를 확인해 주세요.";
  }
  if (errType === "permission_error") {
    return "이 모델에 대한 권한이 없습니다. 다른 모델로 시도해 보세요.";
  }
  if (errType === "not_found_error") {
    return "모델을 찾을 수 없습니다. 설정에서 다른 모델로 바꿔 주세요.";
  }
  if (e.message && typeof e.message === "string") {
    // JSON 노이즈 제거: "{...}" 로 시작하는 긴 메시지면 status/타입만 추출
    if (e.message.startsWith("{") || e.message.startsWith("[")) {
      const status = typeof e.status === "number" ? e.status : null;
      return status
        ? `Claude API 오류 (HTTP ${status}). 잠시 후 다시 시도해 주세요.`
        : "Claude API 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
    }
    return e.message;
  }
  return "Claude API 오류가 발생했습니다.";
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
      // exponential backoff with jitter: 1.5s, 4s, 9s (각 +0~500ms 랜덤)
      const baseMs = [1500, 4000, 9000][attempt - 1] ?? 9000;
      const wait = baseMs + Math.floor(Math.random() * 500);
      opts?.onRetry?.(attempt, err);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

/** Streams an assistant turn. onText fires per text chunk (sync or async).
 *  과부하/일시적 에러 시 stream 시작 전이면 retry. 일단 텍스트가 흘러나간 후 에러나면 retry하지 않음.
 */
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
  const { system, messages, onText } = args;

  return withRetry(
    async () => {
      let fullText = "";
      let textStarted = false;
      const stream = client.raw.messages.stream({
        model: args.model ?? client.config.model,
        max_tokens: args.maxTokens ?? client.config.maxTokens,
        system,
        messages,
      });

      stream.on("text", (chunk) => {
        fullText += chunk;
        textStarted = true;
        if (onText) {
          const result = onText(chunk);
          if (result && typeof (result as Promise<void>).catch === "function") {
            (result as Promise<void>).catch((err) =>
              console.error("onText error:", err),
            );
          }
        }
      });

      try {
        const finalMessage = await stream.finalMessage();
        return {
          text: fullText,
          usage: {
            input: finalMessage.usage.input_tokens,
            output: finalMessage.usage.output_tokens,
          },
        };
      } catch (err) {
        // 텍스트가 이미 클라이언트로 흘러나간 후 에러나면 재시도해도 중복만 발생함.
        // 그 경우 retry signal을 주지 말고 throw — 외부 catch에서 에러 메시지 출력.
        if (textStarted) {
          const e = new Error(friendlyApiErrorMessage(err));
          (e as Error & { _noRetry?: boolean })._noRetry = true;
          throw e;
        }
        throw err;
      }
    },
    {
      onRetry: (n, err) =>
        console.warn(
          `[streamTurn] transient error, retry ${n}: ${
            (err as Error)?.message ?? String(err)
          }`,
        ),
    },
  );
}

/** Non-streaming single-shot completion. 일시적 에러 시 자동 재시도. */
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
    async () => {
      const response = await client.raw.messages.create({
        model: args.model ?? client.config.model,
        max_tokens: args.maxTokens ?? client.config.maxTokens,
        system: args.system,
        messages: args.messages,
      });

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");

      return {
        text,
        usage: {
          input: response.usage.input_tokens,
          output: response.usage.output_tokens,
        },
      };
    },
    {
      onRetry: (n, err) =>
        console.warn(
          `[completeOnce] transient error, retry ${n}: ${
            (err as Error)?.message ?? String(err)
          }`,
        ),
    },
  );
}
