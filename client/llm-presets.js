// v0.6 멀티 LLM — 프로바이더 프리셋 목록.
// 설정 모달의 "AI 프로바이더" 섹션에서 사용.
//
// 주의: exampleModel은 예시일 뿐, 사용자가 자유롭게 수정 가능.
// baseUrl === null 이면 anthropic 네이티브 (SPIRAL_LLM_* env를 아예 안 씀 — 기존 동작).
// baseUrl === "" 이면 커스텀 (사용자가 직접 입력).

export const LLM_PRESETS = [
  {
    id: "anthropic",
    label: "Claude (Anthropic) — 기본·권장",
    baseUrl: null,
    exampleModel: "claude-sonnet-4-6",
    hint: "기본값입니다. 위의 Anthropic API Key와 기본 모델 설정을 그대로 사용합니다. 키 발급: console.anthropic.com",
  },
  {
    id: "openai",
    label: "OpenAI (GPT)",
    baseUrl: "https://api.openai.com/v1",
    exampleModel: "gpt-5.1",
    hint: "키 발급: platform.openai.com → API keys. 모델명은 예시이며 자유롭게 수정할 수 있습니다.",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    exampleModel: "gemini-2.5-pro",
    hint: "키 발급: aistudio.google.com → Get API key. OpenAI 호환 엔드포인트를 사용합니다.",
  },
  {
    id: "kimi",
    label: "Kimi (Moonshot)",
    baseUrl: "https://api.moonshot.ai/v1",
    exampleModel: "kimi-k2-turbo-preview",
    hint: "키 발급: platform.moonshot.ai → API Keys.",
  },
  {
    id: "qwen",
    label: "Qwen (Alibaba)",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    exampleModel: "qwen3-max",
    hint: "키 발급: Alibaba Cloud Model Studio (dashscope) → API-KEY 관리.",
  },
  {
    id: "glm",
    label: "GLM (Z.ai)",
    baseUrl: "https://api.z.ai/api/paas/v4",
    exampleModel: "glm-4.6",
    hint: "키 발급: z.ai → API Keys.",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    exampleModel: "deepseek-chat",
    hint: "키 발급: platform.deepseek.com → API Keys. 추론 특화는 deepseek-reasoner.",
  },
  {
    id: "mistral",
    label: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    exampleModel: "mistral-large-latest",
    hint: "키 발급: console.mistral.ai → API Keys.",
  },
  {
    id: "minimax",
    label: "MiniMax",
    baseUrl: "https://api.minimax.io/v1",
    exampleModel: "MiniMax-M2",
    hint: "키 발급: platform.minimax.io → API Keys. (중국 본토 계정은 base URL을 api.minimaxi.com으로 변경)",
  },
  {
    id: "custom",
    label: "커스텀 (OpenAI-호환)",
    baseUrl: "",
    exampleModel: "",
    hint: "OpenAI 호환 API를 제공하는 어떤 서비스든 사용할 수 있습니다 (예: OpenRouter, Ollama, LM Studio, vLLM). Base URL·모델명·키를 직접 입력하세요.",
  },
];
