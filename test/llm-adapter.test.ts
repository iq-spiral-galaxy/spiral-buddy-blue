// v0.6 멀티 LLM — OpenAI-호환 어댑터 단위 테스트 (fake fetch, 네트워크 0)
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  streamTurn,
  completeOnce,
  isTransientApiError,
  friendlyApiErrorMessage,
  type ClaudeClient,
} from "../src/claude.js";
import type { Config } from "../src/config.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function oaClient(over: Partial<Config> = {}): ClaudeClient {
  return {
    raw: null as never, // openai-compatible 경로는 raw 미사용
    config: {
      apiKey: "sk-test",
      model: "gpt-x",
      maxTokens: 4096,
      llmProvider: "openai-compatible",
      llmBaseUrl: "https://fake.example/v1",
      ...over,
    } as Config,
    provider: "openai-compatible",
    baseUrl: (over.llmBaseUrl as string) ?? "https://fake.example/v1",
  };
}

function sseResponse(frames: string[], status = 200): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream({
    start(c) {
      for (const f of frames) c.enqueue(enc.encode(f));
      c.close();
    },
  });
  return new Response(body, { status });
}

const MSGS = [{ role: "user" as const, content: "질문" }];

describe("openai-compatible: streamTurn", () => {
  test("SSE delta를 이어붙이고 usage를 매핑한다 (+onText per chunk)", async () => {
    const calls: string[] = [];
    globalThis.fetch = async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"안"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"녕"}}]}\n',
        'data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":7}}\n\n',
        "data: [DONE]\n\n",
      ]);
    const r = await streamTurn(oaClient(), {
      system: "s",
      messages: MSGS,
      onText: (c) => void calls.push(c),
    });
    assert.equal(r.text, "안녕");
    assert.deepEqual(calls, ["안", "녕"]);
    assert.deepEqual(r.usage, { input: 11, output: 7 });
  });

  test("청크 경계가 프레임 중간에 걸려도 정확히 파싱", async () => {
    const whole =
      'data: {"choices":[{"delta":{"content":"가나다"}}]}\n' +
      'data: {"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":2}}\n' +
      "data: [DONE]\n";
    // 홀수 지점에서 쪼개 스트림 2청크로
    const cut = 37;
    globalThis.fetch = async () => sseResponse([whole.slice(0, cut), whole.slice(cut)]);
    const r = await streamTurn(oaClient(), { system: "s", messages: MSGS });
    assert.equal(r.text, "가나다");
    assert.deepEqual(r.usage, { input: 1, output: 2 });
  });

  test("keep-alive/비JSON 라인은 무시", async () => {
    globalThis.fetch = async () =>
      sseResponse([
        ": keep-alive\n\n",
        "event: ping\n\n",
        'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
        "data: [DONE]\n\n",
      ]);
    const r = await streamTurn(oaClient(), { system: "s", messages: MSGS });
    assert.equal(r.text, "ok");
  });

  test("요청 body: system이 첫 메시지 + 블록 content 평탄화 + max_tokens", async () => {
    let captured: Record<string, unknown> | null = null;
    globalThis.fetch = async (_url, init) => {
      captured = JSON.parse(String(init?.body));
      return sseResponse(["data: [DONE]\n\n"]);
    };
    await streamTurn(oaClient(), {
      system: "시스템!",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "블록1" },
            { type: "text", text: "블록2" },
          ],
        },
      ],
    });
    const msgs = (captured as { messages: Array<{ role: string; content: string }> })
      .messages;
    assert.deepEqual(msgs[0], { role: "system", content: "시스템!" });
    assert.deepEqual(msgs[1], { role: "user", content: "블록1\n블록2" });
    assert.equal((captured as { model?: string }).model, "gpt-x");
    assert.equal((captured as { max_tokens?: number }).max_tokens, 4096);
    assert.equal((captured as { stream?: boolean }).stream, true);
  });

  test("400 max_completion_tokens 요구 시 파라미터명 바꿔 1회 재시도", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    let n = 0;
    globalThis.fetch = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      n++;
      if (n === 1) {
        return new Response(
          JSON.stringify({
            error: { message: "Use 'max_completion_tokens' instead of 'max_tokens'" },
          }),
          { status: 400 },
        );
      }
      return sseResponse([
        'data: {"choices":[{"delta":{"content":"재시도ok"}}]}\n\n',
        "data: [DONE]\n\n",
      ]);
    };
    const r = await streamTurn(oaClient(), { system: "s", messages: MSGS });
    assert.equal(r.text, "재시도ok");
    assert.equal(n, 2);
    assert.ok("max_tokens" in bodies[0]!);
    assert.ok("max_completion_tokens" in bodies[1]!);
    assert.ok(!("max_tokens" in bodies[1]!));
  });

  test("401 → authentication_error로 매핑 (friendly 메시지에 'API 키')", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: { message: "bad key" } }), {
        status: 401,
      });
    await assert.rejects(
      streamTurn(oaClient(), { system: "s", messages: MSGS }),
      (err: Error & { status?: number; type?: string }) => {
        assert.equal(err.status, 401);
        assert.equal(err.type, "authentication_error");
        assert.ok(friendlyApiErrorMessage(err).includes("API 키"));
        return true;
      },
    );
  });

  test("baseUrl 미설정 → 명확한 에러", async () => {
    const c = oaClient();
    c.baseUrl = null;
    await assert.rejects(
      streamTurn(c, { system: "s", messages: MSGS }),
      /base URL/i,
    );
  });

  test("500은 transient로 분류된다 (retry 대상)", () => {
    assert.equal(isTransientApiError({ status: 500 }), true);
    assert.equal(isTransientApiError({ status: 429, type: "rate_limit_error" }), true);
    assert.equal(isTransientApiError({ status: 401 }), false);
  });
});

describe("openai-compatible: completeOnce", () => {
  test("non-stream 응답의 content + usage 매핑", async () => {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.stream, false);
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "단답" } }],
          usage: { prompt_tokens: 3, completion_tokens: 4 },
        }),
        { status: 200 },
      );
    };
    const r = await completeOnce(oaClient(), { system: "s", messages: MSGS });
    assert.equal(r.text, "단답");
    assert.deepEqual(r.usage, { input: 3, output: 4 });
  });

  test("model/maxTokens 인자 override가 body에 반영", async () => {
    let captured: Record<string, unknown> | null = null;
    globalThis.fetch = async (_url, init) => {
      captured = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "x" } }] }),
        { status: 200 },
      );
    };
    await completeOnce(oaClient(), {
      system: "s",
      messages: MSGS,
      model: "override-model",
      maxTokens: 123,
    });
    assert.equal((captured as { model?: string }).model, "override-model");
    assert.equal((captured as { max_tokens?: number }).max_tokens, 123);
  });

  test("usage 없는 응답은 0으로", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "y" } }] }), {
        status: 200,
      });
    const r = await completeOnce(oaClient(), { system: "s", messages: MSGS });
    assert.deepEqual(r.usage, { input: 0, output: 0 });
  });
});
