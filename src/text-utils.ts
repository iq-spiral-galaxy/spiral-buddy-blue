// 서버 공통 텍스트 유틸 (5색 공유)

/**
 * LLM 출력에서 JSON 객체를 견고하게 추출. (spiral.ts / note-writer.ts 공통)
 *
 * 견고화(v0.5.114): 옛 버전은 코드펜스가 문자열 맨 앞에 있고 뒤에 prose가
 * 없을 때만 동작 → "Here you go: ```json…``` thanks!" 류 응답이 파싱 실패해
 * "자동 구조화 실패"의 한 원인이었음. 이제 순서대로 시도:
 *   1) 전체(trim)  2) ```json…``` 펜스 안쪽(앞뒤 prose 무시)  3) 첫 {…} 블록
 * 그리고 결과가 **non-null 객체**일 때만 반환(숫자/문자열/배열은 거부 → null).
 */
export function safeJsonParse(s: string): Record<string, unknown> | null {
  if (!s) return null;
  const trimmed = s.trim();
  const candidates: string[] = [trimmed];
  const fenceInner = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  if (fenceInner !== undefined) candidates.push(fenceInner.trim());
  const obj = trimmed.match(/\{[\s\S]*\}/);
  if (obj) candidates.push(obj[0]);
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // 다음 후보 시도
    }
  }
  return null;
}
