# Phase 2 — Curated Roadmap Source

## 동기

Phase 1.5까지의 한계:
- `SPIRAL_ROADMAP_ROOT`는 로컬 디렉토리만 지원
- spiral-buddy를 다른 사람이 깃클론해서 받으면 학습 자료가 0개 — 본인 자료를 직접 만들거나 어디서 받아야 함
- iq-dev-lab의 38+개 deep-dive 시리즈 같이 잘 큐레이션된 학습 자료가 "공식 디폴트"로 제공되지 않음

목표:
1. spiral-buddy 깃클론만으로 즉시 학습 시작 가능 (iq-dev-lab의 38개 레포 디폴트 노출)
2. 사용자가 자기 로컬 자료도 함께 쓸 수 있음 (`SPIRAL_ROADMAP_ROOT` 유지)
3. GitHub API rate limit / 디스크 절약을 위해 on-demand clone

## 두 가지 source 공존

| Source | 출처 | 상태 머신 | 위치 |
|---|---|---|---|
| **Local** | `SPIRAL_ROADMAP_ROOT` 아래 디렉토리 | 항상 installed | 사용자 지정 경로 |
| **Curated** | GitHub 조직 (`SPIRAL_CURATED_ORG`, 기본 `iq-dev-lab`) public 레포 | available → installed | `.cache/curated/<org>/<repo>/` |

식별자 충돌 방지:
- Local: root-relative path 그대로 (예: `redis-deep-dive`, `spring ecosystem/spring-core-deep-dive/transaction-mvcc`)
- Curated: `curated:<org>/<repo>[/<sub-path>]` prefix (예: `curated:iq-dev-lab/redis-deep-dive`)

## On-demand clone 정책

GitHub API는 unauth 60 req/hr, auth 5000 req/hr. 38개 레포 매번 클론하면 디스크/시간 낭비.

전략:
1. **목록만 미리** — `listCuratedRepos`는 GitHub `/orgs/{org}/repos` API 1회 호출 (조직당 100개까지 1 페이지). archived/fork/private/0byte 자동 필터.
2. **레포 자체는 클릭 시 클론** — `installCuratedRepo`가 `git clone --depth=1` 실행.
3. **API 응답 1시간 캐시** — `.cache/curated-meta.json`. 명시적 `?refresh=1`로 강제 갱신.

git clone 구현은 `child_process.spawn("git", ...)`. 추가 의존성 없음. 사용자 환경에 git 있다고 가정 (개발 도구라 안전한 가정).

## 캐시 위치

`<package>/.cache/curated/<org>/<repo>/`

선택 근거:
- `~/.cache/` 표준도 고려했지만, 패키지 내부 `.cache/`가 더 찾기 쉽고 단순
- 이미 `.gitignore`에 `.cache/` 추가되어 있음 (기존부터)
- 패키지 삭제 시 캐시도 같이 정리됨 (불필요한 흔적 안 남음)

## 환경변수

```
SPIRAL_CURATED_ORG=iq-dev-lab     # 기본값
SPIRAL_DISABLE_CURATED=1          # curated 완전 끄기
SPIRAL_GITHUB_TOKEN=ghp_xxx       # 선택, rate limit 60→5000
```

기본값으로 `iq-dev-lab` 고정. 다른 조직 큐레이션 학습 자료 만들고 싶으면 자기 조직 이름 넣으면 됨.

## API

### GET `/api/roadmaps`
Local + Curated 설치된 것만 통합 반환. 각 항목에 `source: "local" | "curated"`.

### GET `/api/curated/available?refresh=1`
GitHub API → 조직의 public 레포 목록. `installed: boolean` 포함. refresh=1이면 캐시 무효화.

### POST `/api/curated/install`
```json
{ "repo_name": "redis-deep-dive" }
```
on-demand `git clone --depth=1`. 이미 설치돼 있으면 `alreadyInstalled: true`.

### POST `/api/curated/refresh`
설치된 레포에 `git pull --ff-only`.

### POST `/api/curated/uninstall`
캐시 디렉토리 삭제. 메타 갱신은 자동.

## MCP 도구 (Phase 2: 6 → 7개)

| 도구 | 변경 |
|---|---|
| `spiral_list_roadmaps` | **확장** — `include_available: boolean` 인자로 미설치 큐레이션 레포도 함께 표시 |
| `spiral_install_curated` | **신규** — on-demand 클론 (`repo_name` 인자) |
| `spiral_list_chapters` | 변동 없음, `curated:` prefix 받음 |
| `spiral_get_chapter_context` | 변동 없음 |
| `spiral_list_notes` | 변동 없음 |
| `spiral_read_note` | 변동 없음 |
| `spiral_save_note` | 변동 없음 |

MCP에서의 자연스러운 흐름:
```
사용자: "spiral-buddy로 학습할 만한 거 뭐 있어?"
→ Claude: spiral_list_roadmaps({include_available: true})
→ 마크다운 표 3개 섹션 출력:
   - 📁 Local (3개)
   - 📚 Curated 설치됨 (1개)
   - 📦 Curated 받기 가능 (38개)

사용자: "redis-deep-dive 받아서 시작하자"
→ Claude: spiral_install_curated({repo_name: "redis-deep-dive"})
→ 클론 완료 → roadmap_id 안내
→ Claude: spiral_list_chapters({roadmap_id: "curated:iq-dev-lab/redis-deep-dive"})
→ spiral_get_chapter_context → 학습 대화 → spiral_save_note
```

## 웹앱 UX

사이드바 로드맵 셀렉터를 세 그룹으로:

```
ROADMAP
[ 📁 transaction-mvcc  2/7  ▼ ]
─ 드롭다운 ─
  📁 Local (3)
    - redis-deep-dive             0/3
    - ioc-container                0/2
    - transaction-mvcc       d2   2/7
  📚 Curated · iq-dev-lab (1)
    - test-redis                   0/2
  ▶ 받기 가능 보기 (38)            ← 토글
    [클릭]
  ▼ 받기 가능 숨기기
  총 38개 받기 가능 · 새로고침
    redis-deep-dive (Markdown · ⭐ 12)
      Redis 깊이 파고들기 (37챕터)        [📥 받기]
    kafka-deep-dive (Markdown · ⭐ 8)
      Kafka 깊이 파고들기 (37챕터)        [📥 받기]
    ...
```

설치 버튼 클릭 시:
1. POST `/api/curated/install` (수초~30초)
2. 성공 시 자동으로 그 레포의 첫 sub-roadmap을 active로 설정
3. 챕터/노트/추천 모두 갱신
4. status bar에 ✓ 메시지 3초 노출

## 첫 사용자 경험

```bash
git clone https://github.com/iq-spiral-galaxy/spiral-buddy-blue
cd iq-spiral-buddy
pnpm install
cp .env.example .env
# ANTHROPIC_API_KEY와 SPIRAL_VAULT_PATH만 채움. SPIRAL_ROADMAP_ROOT는 빈 채로 OK.
pnpm dev
```

부팅 즉시:
1. 사이드바에 "받기 가능 보기 (38)" 토글
2. 클릭하면 GitHub API 1회 호출 → 38개 레포 + description + ⭐ 표시
3. 관심 가는 레포 "📥 받기" 클릭 → 10-30초 후 학습 시작 가능

## 검증 시나리오

### 시나리오 1: `SPIRAL_DISABLE_CURATED=1`
- `/api/curated/available` → HTTP 400 `curated source disabled`
- 사이드바 셀렉터에 "Local" 섹션만 노출
- MCP `spiral_install_curated` 도구 등록 안 됨

### 시나리오 2: GitHub API rate limit
- `listCuratedRepos`가 403 받으면 명확한 에러 메시지 (reset 시각 포함)
- `SPIRAL_GITHUB_TOKEN` 안내

### 시나리오 3: archived/fork 레포 필터
- iq-dev-lab에 archived 또는 fork 레포가 있어도 목록에서 자동 제외
- 빈 레포 (size=0) 도 제외

### 시나리오 4: sub-roadmap 발견
- 한 레포 안에 `ioc-container/`, `transaction-mvcc/` 같이 sub-roadmap이 있으면 각각 별도 로드맵으로 노출
- id: `curated:iq-dev-lab/spring-deep-dive/ioc-container`

### 시나리오 5: 옛 노트 호환
- Phase 1.5의 옛 스키마 노트들이 Local/Curated 어느 쪽 챕터와도 정확히 매칭 (basename + suffix 룰)

## 다음 (Phase 3 후보)

- 토픽/언어 기반 큐레이션 필터 (지금은 모든 public repo가 후보)
- 빌트인 화이트리스트 메타 파일 (`data/curated-roadmaps.json`) — 관리자가 큐레이션
- 캐시 자동 갱신 정책 (지금은 명시적 refresh만)
- 여러 조직 동시 큐레이션 (현재 단일 `SPIRAL_CURATED_ORG`)
- Tauri standalone 또는 옵시디언 플러그인
- MCP `spiral_refresh_curated`, `spiral_uninstall_curated` 도구
