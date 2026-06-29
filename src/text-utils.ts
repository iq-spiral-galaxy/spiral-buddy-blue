// 서버 공통 텍스트 유틸 (5색 공유)

/**
 * LLM 출력에서 ```json … ``` 코드 펜스를 벗기고 JSON.parse.
 * 실패 시 null. (spiral.ts / note-writer.ts 공통 — byte-identical이던 것 통합)
 */
export function safeJsonParse(s: string): Record<string, unknown> | null {
  try {
    const cleaned = s
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}
