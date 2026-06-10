/**
 * v0.5.76 — 초경량 TTL 캐시.
 *
 * 매 API 요청마다 vault 전체 glob+read, 로드맵 트리 재귀 탐색을 반복하던
 * 핫패스(listSpiralNotes / discoverRoadmaps / loadRoadmapChapters)에 씌움.
 * 노트가 쌓일수록 (스파이럴 학습 특성상 계속 쌓임) 선형으로 느려지던
 * 요청 비용을 TTL 윈도우 안에서 O(1)로.
 *
 * 동시 호출 dedup: 같은 key의 동시 miss는 한 loader만 실행하고 공유
 * (사이드바 로드 시 /roadmaps + /chapters가 거의 동시에 notes를 찾는 패턴).
 */

interface Entry<T> {
  value: T;
  at: number;
}

export interface TtlCache<T> {
  get(key: string, loader: () => Promise<T>): Promise<T>;
  /** key 생략 시 전체 비움 */
  invalidate(key?: string): void;
}

export function createTtlCache<T>(ttlMs: number): TtlCache<T> {
  const entries = new Map<string, Entry<T>>();
  const inflight = new Map<string, Promise<T>>();

  return {
    async get(key: string, loader: () => Promise<T>): Promise<T> {
      const hit = entries.get(key);
      if (hit && Date.now() - hit.at < ttlMs) return hit.value;

      const pending = inflight.get(key);
      if (pending) return pending;

      const p = (async () => {
        try {
          const value = await loader();
          entries.set(key, { value, at: Date.now() });
          return value;
        } finally {
          inflight.delete(key);
        }
      })();
      inflight.set(key, p);
      return p;
    },
    invalidate(key?: string) {
      if (key === undefined) entries.clear();
      else entries.delete(key);
    },
  };
}
