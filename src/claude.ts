import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "./config.js";

export type ClaudeMessage = Anthropic.MessageParam;

/**
 * LLM 프로바이더 (v0.6 멀티 LLM):
 *  - "anthropic": Anthropic SDK 직접 (기본, 기존 동작)
 *  - "openai-compatible": OpenAI chat/completions 호환 엔드포인트 —
 *    GPT·Gemini·Kimi·Qwen·GLM 등이 전부 이 형식을 제공한다.
 */
export type LlmProvider = "anthropic" | "openai-compatible";

export interface ClaudeClient {
  raw: Anthropic;
  config: Config;
  /** 미지정 시 "anthropic" (기존 코드/테스트 하위호환). */
  provider?: LlmProvider;
  /** openai-compatible 전용 — 예: https://api.openai.com/v1 */
  baseUrl?: string | null;
}

export function createClient(config: Config): ClaudeClient {
  // openai-compatible이어도 raw는 생성해 둔다(생성 자체는 네트워크 없음) —
  // 타입/테스트 하위호환을 위해 필드 형태를 바꾸지 않는 게 안전.
  const raw = new Anthropic({ apiKey: config.apiKey });
  return {
    raw,
    config,
    provider: config.llmProvider ?? "anthropic",
    baseUrl: config.llmBaseUrl ?? null,
  };
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

// ──────────────────────────────────────────────────────────
// OpenAI-호환 어댑터 (fetch 기반, 의존성 0)
// GPT·Gemini·Kimi·Qwen·GLM 등의 chat/completions 엔드포인트.
// ──────────────────────────────────────────────────────────

/** ClaudeMessage(content: string | blocks[]) → OpenAI 메시지(content: string). */
function toOpenAiMessages(
  system: string,
  messages: ClaudeMessage[],
): Array<{ role: string; content: string }> {
  const out: Array<{ role: string; content: string }> = [
    { role: "system", content: system },
  ];
  for (const m of messages) {
    const content =
      typeof m.content === "string"
        ? m.content
        : m.content
            .map((b) => ("text" in b && typeof b.text === "string" ? b.text : ""))
            .filter(Boolean)
            .join("\n");
    out.push({ role: m.role, content });
  }
  return out;
}

/** 프로바이더 에러 → isTransientApiError/friendlyApiErrorMessage가 이해하는 형태로. */
async function openAiHttpError(res: Response): Promise<Error> {
  let detail = "";
  let errType: string | undefined;
  try {
    const body = (await res.json()) as {
      error?: { message?: string; type?: string; code?: string };
    };
    detail = body?.error?.message ?? "";
    errType = body?.error?.type ?? body?.error?.code;
  } catch {
    // body 없음/비JSON — status만으로
  }
  const e = new Error(
    detail || `LLM API 오류 (HTTP ${res.status})`,
  ) as Error & { status?: number; type?: string };
  e.status = res.status;
  if (res.status === 401 || res.status === 403) e.type = "authentication_error";
  else if (res.status === 404) e.type = "not_found_error";
  else if (res.status === 429) e.type = "rate_limit_error";
  else if (errType) e.type = errType;
  return e;
}

/**
 * chat/completions 요청 1회. stream=true면 SSE를 파싱해 onText로 흘림.
 * max_tokens를 거부하는 신형 OpenAI 모델(max_completion_tokens 요구)은
 * 에러 메시지를 보고 파라미터명을 바꿔 1회 재시도.
 */
async function openAiChatOnce(
  client: ClaudeClient,
  args: {
    system: string;
    messages: ClaudeMessage[];
    onText?: (chunk: string) => void | Promise<void>;
    model?: string;
    maxTokens?: number;
  },
  stream: boolean,
  onTextStarted?: () => void,
): Promise<{ text: string; usage: { input: number; output: number } }> {
  const base = (client.baseUrl ?? "").replace(/\/+$/, "");
  if (!base) {
    throw new Error(
      "LLM base URL이 설정되지 않았습니다. 설정에서 프로바이더/주소를 확인해 주세요.",
    );
  }
  const url = `${base}/chat/completions`;
  const maxTokens = args.maxTokens ?? client.config.maxTokens;

  const doFetch = async (tokenParam: "max_tokens" | "max_completion_tokens") => {
    const body: Record<string, unknown> = {
      model: args.model ?? client.config.model,
      messages: toOpenAiMessages(args.system, args.messages),
      stream,
      [tokenParam]: maxTokens,
    };
    if (stream) body.stream_options = { include_usage: true };
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${client.config.apiKey}`,
      },
      body: JSON.stringify(body),
    });
  };

  let res = await doFetch("max_tokens");
  if (!res.ok) {
    // 신형 OpenAI 모델: max_tokens 거부 → max_completion_tokens로 재시도
    const errText = await res.clone().text().catch(() => "");
    if (res.status === 400 && errText.includes("max_completion_tokens")) {
      res = await doFetch("max_completion_tokens");
    }
  }
  if (!res.ok) throw await openAiHttpError(res);

  // ── non-stream ──
  if (!stream) {
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      text: data.choices?.[0]?.message?.content ?? "",
      usage: {
        input: data.usage?.prompt_tokens ?? 0,
        output: data.usage?.completion_tokens ?? 0,
      },
    };
  }

  // ── SSE stream ──
  if (!res.body) throw new Error("LLM 응답 스트림이 비어 있습니다.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let fullText = "";
  let usage = { input: 0, output: 0 };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    // SSE 프레임은 개행 단위 — 마지막 불완전 라인은 buf에 남김
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const j = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string | null } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
        };
        const chunk = j.choices?.[0]?.delta?.content;
        if (chunk) {
          fullText += chunk;
          onTextStarted?.();
          if (args.onText) {
            const r = args.onText(chunk);
            if (r && typeof (r as Promise<void>).catch === "function") {
              (r as Promise<void>).catch((err) =>
                console.error("onText error:", err),
              );
            }
          }
        }
        if (j.usage) {
          usage = {
            input: j.usage.prompt_tokens ?? 0,
            output: j.usage.completion_tokens ?? 0,
          };
        }
      } catch {
        // 불완전/비JSON 프레임 — skip (keep-alive 등)
      }
    }
  }
  return { text: fullText, usage };
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

      // OpenAI-호환 프로바이더 분기 — retry/no-retry 의미는 Anthropic 경로와 동일:
      // 텍스트가 이미 흘러나간 후의 에러는 재시도하지 않음(중복 방지).
      if (client.provider === "openai-compatible") {
        try {
          return await openAiChatOnce(client, args, true, () => {
            textStarted = true;
          });
        } catch (err) {
          if (textStarted) {
            const e = new Error(friendlyApiErrorMessage(err));
            (e as Error & { _noRetry?: boolean })._noRetry = true;
            throw e;
          }
          throw err;
        }
      }

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
      if (client.provider === "openai-compatible") {
        return openAiChatOnce(client, args, false);
      }

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
