# 🌀 iq-spiral-buddy

> Spiral learning companion that bridges Claude and Obsidian.
> 로컬 웹앱 + Claude Desktop MCP 동시 제공.

학습 로드맵을 기반으로 Claude와 Socratic 학습 세션을 진행하고, 그 결과를 옵시디언에 **나선형 구조로 자동 축적**하는 도구. `pnpm dev` 치면 브라우저가 자동으로 열리고, 다음 세션엔 이전 노트가 자동 컨텍스트로 들어가서 "어디까지 했더라"를 매번 다시 만들 필요가 없다.

```
📁 Local 로드맵 + 📚 GitHub Curated 레포 → Claude 학습 세션 → 8섹션 노트 → Obsidian
```

## 무엇이 다른가

옵시디언 + AI 도구는 이미 많다. spiral-buddy의 차별점:

1. **로드맵 주도** — vault 안에서 채팅하는 게 아니라, 외부 학습 커리큘럼(`SPIRAL_ROADMAP_ROOT`의 폴더 트리, 또는 GitHub 조직의 public 레포)을 1급 시민으로 다룬다. "오늘 뭐 배울까"를 도구가 제안한다.
2. **나선형 감지(Spiral detection)** — 새 세션 시작 시 이전 노트를 스캔해 같은 챕터를 더 깊게 갈지(`deeper-layer`), 새 진도 나갈지(`next-chapter`), 멀리 떨어진 챕터를 연결할지(`cross-link`) Claude가 판단한다.
3. **세션 후 구조화** — 대화 로그를 통째로 저장하는 게 아니라, 8-섹션 템플릿(요약 / 핵심 개념 / 직관·비유 / 짚고 넘어간 예제 / 헷갈렸던 지점 / 이전 학습과의 연결 / 다음에 볼 것)에 맞춰 Claude가 정리한다. 누락된 섹션은 자동 보충.
4. **README가 학습 순서의 source-of-truth** — 챕터 파일에 번호 없어도 OK. 컨테이너 README의 `(./childdir/...md)` 마크다운 링크 등장 순서가 sub-roadmap 학습 순서가 된다. 카테고리 순서는 `data/curated-categories.json`이 결정.
5. **두 가지 source 공존** — 사용자의 로컬 디렉토리(Local) + GitHub 조직 큐레이션(Curated, default: `iq-dev-lab`의 38+개 deep-dive 레포). on-demand 클론으로 디스크 절약.
6. **두 가지 진입점** — 로컬 웹앱(streaming 채팅 UI + 검색 + 진도 시각화 + 학습 캘린더)과 Claude Desktop MCP(9개 도구). 같은 노트 vault 공유.

## Status

✅ **Phase 2.4 — UX & Productivity**

Phase 2.3 stable 위에 학습 흐름 마찰을 줄이는 큰 묶음 추가:

- 🔍 **Cmd+K 통합 검색** — 로드맵·챕터·노트 substring 매칭, 키보드 네비, 결과 클릭으로 즉시 점프
- 📖 **챕터 재진입** — visited 챕터에 호버 시 책 아이콘 → Obsidian으로 기존 노트 열기 (depth별)
- 🗑 **노트 삭제 + 복구** — depth별 / 챕터 전체 / 로드맵 전체 단위. vault의 `spiral-buddy/.trash/`로 이동(비파괴), 사이드바 휴지통 UI에서 복구. 30일+ 자동 영구 삭제
- 📊 **학습 활동 캘린더** — GitHub식 365일 contribution graph + streak + depth 분포
- 📏 **사이드바 너비 드래그** — 드래그 핸들, 더블클릭으로 기본값 복원, localStorage 저장
- 🎯 **README 기반 정렬** — 컨테이너 README가 sub-roadmap 학습 순서를 정의. 카테고리도 JSON 정의 순서로
- 🏠 **앱 첫 진입 마찰 제거** — 마지막 로드맵 → 가장 최근 학습 로드맵 자동 복원 + 가장 최근 챕터로 자동 스크롤
- 🔢 **챕터·sub-roadmap 번호 표시** + **사이드바 progress bar** — 진도 한눈에
- 🤖 **MCP 도구 9개** — 기존 7 + `spiral_delete_notes` + `spiral_search`

상세 design docs: [docs/phase-1.5-dynamic-roadmaps.md](docs/phase-1.5-dynamic-roadmaps.md), [docs/phase-2-curated.md](docs/phase-2-curated.md)

## 설치

### 방법 A — 데스크탑 앱 (권장)

[Releases](https://github.com/iq-agent-lab/iq-spiral-buddy/releases) 페이지에서 본인 OS용 파일 다운로드:

- **macOS**: `Spiral Buddy-<version>-arm64.dmg` (Apple Silicon) 또는 `-x64.dmg` (Intel)
- **Windows**: `Spiral Buddy Setup <version>.exe`
- **Linux**: `Spiral Buddy-<version>.AppImage`

첫 실행 시 setup wizard가 뜨고 **API 키**와 **Obsidian Vault 경로** 두 개만 입력하면 끝. vault는 흔한 경로(`~/Documents/Obsidian Vault`, iCloud `~/Library/Mobile Documents/iCloud~md~obsidian/Documents` 등)에서 자동 감지 시도. 학습 자료 디렉토리는 (1) 본인 경로 직접 지정 / (2) **"📥 iq-dev-lab 38개 자동 다운로드" 버튼 한 번에 받기** / (3) 비우고 Curated만 사용 — 셋 다 가능.

### ⚠️ macOS — "손상됨" 경고가 뜬다면

```
'Spiral Buddy'은(는) 손상되었기 때문에 열 수 없습니다.
```

코드 사인/공증 없이 배포해서 **macOS Gatekeeper가 quarantine 속성 때문에 차단**한 거야 (실제로 손상된 게 아님). 터미널에서 한 줄 실행하면 풀림:

```bash
# 1. dmg 마운트 + .app을 Applications로 끌어 놓은 뒤
xattr -cr "/Applications/Spiral Buddy.app"

# 또는 dmg를 마운트하기 전에 dmg 자체의 quarantine을 제거
xattr -d com.apple.quarantine ~/Downloads/Spiral-Buddy-*.dmg
```

이후 정상적으로 실행됨. 정식 해결은 Apple Developer ID 발급 + notarization인데 비용/시간 들어가서 미뤘음. **친구·동료에게 공유할 땐 위 명령어도 함께 알려주세요.**

> Windows는 SmartScreen 경고가 뜨면 **"추가 정보" → "실행"** 클릭. 코드는 모두 공개됨.

### 방법 B — 소스에서 실행 (개발자 / 커스터마이즈)

```bash
git clone https://github.com/iq-agent-lab/iq-spiral-buddy
cd iq-spiral-buddy
pnpm install
cp .env.example .env
# .env 편집: ANTHROPIC_API_KEY, SPIRAL_VAULT_PATH 두 개만 필수
# SPIRAL_ROADMAP_ROOT는 빈 칸으로 둬도 OK — iq-dev-lab의 38+개 학습 레포가 디폴트로 노출됨
pnpm dev           # 브라우저 모드 (자동으로 http://localhost:3737 오픈)
# 또는
pnpm electron:dev  # Electron 데스크탑 앱 모드 (개발용)
```

요구사항(방법 B): Node.js 20+, pnpm 11+, [Anthropic API 키](https://console.anthropic.com/), [Obsidian](https://obsidian.md/) vault, `git` (Curated 클론용).

### 직접 빌드 (선택)

```bash
pnpm electron:build         # 현재 OS용 dmg/exe/AppImage 빌드 → release/
pnpm electron:build:mac     # macOS만 (arm64 + x64)
pnpm electron:build:win     # Windows만
pnpm electron:build:linux   # Linux만
```

자동 배포: `v0.4.0` 같은 태그를 push하면 [`.github/workflows/release.yml`](.github/workflows/release.yml)이 3개 OS에서 빌드 후 GitHub Releases에 자동 업로드.

### 첫 사용자 흐름 (5분 안에)

1. 좌측 사이드바 → **📚 Curated · 받기 가능 보기** 토글 클릭
2. iq-dev-lab의 38개 레포가 9개 카테고리(☕ Java Core, 🍃 Spring Ecosystem, 🗄️ Database, …)로 묶여 표시됨 (정의된 학습 순서대로)
3. 카테고리 클릭해서 펼치고 관심 가는 레포의 **📥 받기** 클릭 → on-demand `git clone --depth=1` (10-30초)
4. 클론 완료 → sub-roadmap 학습 순서가 README 기반으로 자동 정렬. 1번 챕터부터 시작 권장
5. 챕터 클릭 → Claude가 Socratic 질문으로 학습 시작
6. 대화 끝나면 **End & Save** → 8섹션 노트가 Obsidian에 자동 저장 (단계별 SSE 진행 카드)
7. 다음에 켤 때 자동으로 가장 최근 학습 챕터로 스크롤

## 사이드바 구조

```
🌀 spiral buddy
   [모델 ▼  Sonnet 4.6  (balanced)]
─────────────
ROADMAP
   [📁 transaction-mvcc       2/7 ▼]
─────────────
🧭 SUGGESTION (이 로드맵 기준)
─────────────
CHAPTERS
   1. ACID                    d2  📖 🗑     ← hover시 노트 열기/삭제
   2. Isolation                              ← 노트 없으면 아이콘 없음
   ...
─────────────
PAST SESSIONS (이 로드맵)
   d1 · 2026-05-13 · ACID
   ...
─────────────
[📊 학습 활동] [🗑 휴지통 (3)]               ← 사이드바 하단 (휴지통은 비어있으면 숨김)
```

**로드맵 셀렉터 펼치면** 3-level 계층:
- **📁 Local · 9 카테고리 (JSON 정의 순서) · 38 레포 · 286 로드맵**
  - ▼ ☕ Java Core (7 레포)
    - ▼ 📦 spring-core-deep-dive (8 sub-roadmap, README 학습 순서)
      - 1. ioc-container          d1 3/6 ━━━━━━░░  ← 진도 bar
      - 2. dependency-injection      0/7 ░░░░░░░░
      - 3. bean-lifecycle         d1 2/7 ━━━░░░░░
      - ...
- **📚 Curated · iq-dev-lab (받은 거만)**
- **▶ 받기 가능 보기 (남은 거)**

active 로드맵의 카테고리/레포는 자동으로 펼친 상태로 시작. 사이드바 우측 가장자리를 **드래그**하면 너비 조절(200~600px), **더블클릭**으로 기본값(280px) 복원.

## 키보드 단축키

| 단축키 | 동작 |
|---|---|
| `Cmd+K` / `Ctrl+K` | 검색 모달 (로드맵·챕터·노트 substring + 키보드 네비) |
| `Cmd+B` / `Ctrl+B` | 사이드바 토글 (집중 모드) |
| `↑` `↓` | (검색 모달 안에서) 결과 이동 |
| `Enter` | (검색 모달 안에서) 선택 항목 활성화 |
| `ESC` | 모달 닫기 (검색·휴지통·학습 활동·세션 인터럽트) |

검색 결과의 종류별 동작:
- **로드맵** 선택 → 해당 로드맵으로 전환 + 사이드바 자동 펼침 + 가장 최근 학습 챕터로 스크롤
- **챕터** 선택 → 로드맵 전환 + 그 챕터로 새 세션 (세션 중이면 인터럽트 다이얼로그)
- **노트** 선택 → Obsidian deep-link로 바로 열림

## 환경변수

| 변수 | 설명 | 기본값 |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude API 키 (웹앱 전용 — MCP는 Claude Desktop 자체 인증 사용) | **(필수)** |
| `SPIRAL_VAULT_PATH` | 옵시디언 vault 루트 또는 그 하위 폴더 (`.obsidian/` 자동 탐지) | **(필수)** |
| `SPIRAL_ROADMAP_ROOT` | 로컬 로드맵 root. 미설정이면 Curated만 사용 | (선택) |
| `SPIRAL_ROADMAP_PATH` | (legacy) 단일 로드맵만 강제 지정 | (선택) |
| `SPIRAL_CURATED_ORG` | Curated source의 GitHub 조직 이름 | `iq-dev-lab` |
| `SPIRAL_DISABLE_CURATED` | `1`로 설정하면 Curated source 꺼짐 (Local만) | (off) |
| `SPIRAL_GITHUB_TOKEN` | GitHub API 인증. unauth 60req/hr → auth 5000req/hr | (선택) |
| `SPIRAL_VAULT_NAME` | 옵시디언 vault 이름 (폴더명과 다를 때만) | 자동 탐지 |
| `SPIRAL_MODEL` | 기본 Claude 모델 (UI에서 변경 가능) | `claude-sonnet-4-6` |
| `SPIRAL_MAX_TOKENS` | 응답당 최대 토큰 | `4096` |
| `PORT` | 웹서버 포트 | `3737` |
| `NO_OPEN` | `1`로 설정하면 브라우저 자동 오픈 안 함 | (off) |

## 로드맵 자동 탐지 + README 기반 정렬

### 탐지 규칙

`SPIRAL_ROADMAP_ROOT` 아래에서:
- **로드맵 = README.md를 제외한 `.md` 파일이 2개 이상 직접 들어있는 디렉토리**
- 최대 깊이 6단계까지 재귀 탐색
- 로드맵으로 인식된 디렉토리 안은 더 탐색하지 않음 (sub-section 오인 방지)

```
iq-dev-lab/                              ← root
├── spring ecosystem/                    ← 카테고리 (.md 없으면 통과)
│   └── spring-core-deep-dive/           ← 레포 (.md 없으면 통과) + README.md
│       ├── ioc-container/               ← 여기 .md 2개+ → 로드맵
│       │   ├── 01-beanfactory.md
│       │   └── 02-applicationcontext.md
│       └── dependency-injection/        ← 또 다른 로드맵
│           ├── 01-constructor.md
│           └── 02-field-injection.md
└── redis-deep-dive/                     ← 로드맵
    ├── 01-data-structures.md
    └── ...
```

### sub-roadmap 순서: README가 결정

같은 컨테이너 안에 sub-roadmap이 여러 개 있을 때 (`spring-core-deep-dive/ioc-container`, `dependency-injection`, `aop`, …), 알파벳 정렬이 학습 순서랑 안 맞는 경우가 많음.

해결: **컨테이너의 `README.md`를 파싱**해서 `(./<childdir>/...md)` 형식의 마크다운 링크 등장 순서를 학습 순서로 사용. iq-dev-lab의 README들은 모두 이 패턴(빠른 시작 배지 + 학습 지도 표)을 따르므로 100% 매칭됨.

```markdown
<!-- spring-core-deep-dive/README.md -->
## 🚀 빠른 시작
[![IoC](...)](./ioc-container/01-beanfactory.md)               ← 1번
[![DI](...)](./dependency-injection/01-constructor.md)         ← 2번
[![Lifecycle](...)](./bean-lifecycle/01-bean-creation.md)      ← 3번
[![AOP](...)](./aop/01-jdk-proxy-vs-cglib.md)                  ← 4번
```

README가 없거나 매칭 안 되는 컨테이너는 알파벳 fallback. 정렬 결과는 `scripts/verify-readme-sort.ts`로 확인 가능.

### 카테고리 순서: JSON이 결정

`data/curated-categories.json`이 카테고리 순서 단일 진실:

```json
{
  "iq-dev-lab": {
    "categories": [
      { "name": "Java Core",         "emoji": "☕", "repos": [...] },
      { "name": "Spring Ecosystem",  "emoji": "🍃", "repos": [...] },
      { "name": "Architecture & Design", ... },
      ...
    ]
  }
}
```

서버가 `/api/roadmaps` 응답을 이 순서로 정렬해서 보내므로 사이드바 최상위가 학습 흐름 순. 정의에 없는 카테고리는 끝으로.

## 챕터 파일명 규칙

번호 prefix가 있는 게 권장이지만, 없어도 `naturalCompare`로 알파벳+숫자 자연 정렬됨. 권장 패턴:

```
01-acid.md
02-isolation.md
10-locking.md   ← 자연 정렬에서 "02" 뒤
```

대안 형식도 OK (e.g. `Arrays-01-기본.md`, `Arrays-02-정렬.md`). 첫 H1이 노트의 title이 됨.

## Curated source (GitHub 큐레이션)

기본값으로 `iq-dev-lab` 조직의 public 레포를 학습 자료로 노출. 다른 사람도 spiral-buddy를 clone만 하면 즉시 학습 시작 가능.

특징:
- **목록만 GitHub API로** (1시간 캐시) → API 요청 절약
- **레포는 사용자 클릭 시점에만 클론** (`git clone --depth=1`) → 디스크 절약
- archived/fork/private/0byte/meta(.github, *.github.io) 자동 제외
- 한 레포가 여러 sub-roadmap을 가질 수 있음 (sub-directory별로)
- `iq-dev-lab`의 38개 레포가 9개 카테고리로 자동 매핑 (`data/curated-categories.json`)

다른 조직 학습 자료 만들고 싶으면:
```bash
# .env
SPIRAL_CURATED_ORG=your-org
```

화이트리스트 카테고리 매핑 추가는 `data/curated-categories.json`에 추가하면 됨 (없어도 단일 'All' 카테고리로 fallback).

## 노트 출력 (Obsidian)

저장 위치: `<vault>/spiral-buddy/`

파일명: `<날짜>-<chapter-basename>-d<depth>.md`
- 예: `2026-05-14-01-bean-creation-process-d1.md`
- `chapter_id`의 basename을 활용해 짧고 깔끔하게
- 같은 챕터 같은 날 두 번 학습하면 `-2`, `-3` suffix 자동 추가
- 본문 첫 줄에 `# ${title}` H1 자동 삽입 — Obsidian preview/sidebar에서 제목 명확

```yaml
---
title: "ACID"
topic: "ACID"
date: 2026-05-13
depth: 2
chapter_id: "01-acid.md"
roadmap: "transaction-mvcc"
roadmap_id: "spring ecosystem/spring-core-deep-dive/transaction-mvcc"
tags: ["transaction", "isolation", "acid"]
summary: "트랜잭션의 4가지 속성과 isolation level이 실제 동시성 이슈에 어떻게 매핑되는지."
related:
  - "[[2026-05-01-01-mvcc-d1]]"
generator: iq-spiral-buddy
---

# ACID

## 한 줄 요약
...
```

8섹션 헤딩 중 누락된 게 있으면 `_이번 세션에서 다루지 않음._` 한 줄로 자동 보충 + UI에 경고.

`roadmap_id`는 글로벌 unique 식별자(root-relative path). `chapter_id`는 roadmap 내부 path. 두 값의 튜플이 글로벌 챕터 식별.

옛 스키마(`roadmap_id` 없음) 노트와도 호환 매칭 — basename + suffix 룰로 진도 계산에 포함.

## 노트 관리 (삭제 · 복구 · 자동 청소)

학습이 누적되면 정리도 중요. 모든 삭제는 **비파괴적**(rename to `.trash/`):

### 삭제 방법

| 위치 | 트리거 | 범위 |
|---|---|---|
| 챕터 행 hover → 🗑 | 클릭 → 팝오버 | 그 챕터의 d1만 / d2만 / 전체 초기화 |
| 챕터 d 배지 (e.g. `d1`) | 클릭 → 팝오버 | (위와 동일) |
| 사이드바 sub-roadmap 행 → 🗑 | 클릭 → 팝오버 | 그 sub-roadmap의 d1만 / d2만 / 전체 초기화 |
| 사이드바 sub-roadmap d 배지 | 클릭 → 팝오버 | (위와 동일) |
| Claude Desktop MCP | `spiral_delete_notes` 도구 | 챕터·로드맵·depth 자유 조합 |

"전체 초기화" 액션은 한 번 confirm 다이얼로그.

### 복구

사이드바 하단의 **🗑 휴지통 (N)** 버튼 (비어있을 때 숨김) → 모달:
- 삭제된 노트 목록 (제목, depth, 로드맵·챕터, 삭제 시각)
- 각 항목에 **↩ 복구** 버튼 → 클릭 한 번에 `.trash/`에서 `spiral-buddy/`로 즉시 복원
- 같은 이름 파일이 이미 있으면 `-restored2` suffix

### 자동 청소

서버 시작 시 `spiral-buddy/.trash/` 안에서 mtime이 30일 초과한 파일을 영구 삭제(`fs.unlink`). 콘솔에 `.trash cleanup: N stale notes removed` 출력 (0이면 출력 없음).

## 학습 활동 (Contribution Graph)

사이드바 하단의 **📊 학습 활동** 버튼 → 모달:
- 최근 365일 GitHub식 그리드 (요일 × 주 × 노트 수에 따른 색조 4단계)
- 통계: 총 노트 수, 활동일, 현재 연속(streak), 최장 연속, depth별 분포
- API: `GET /api/activity?days=365`

## MCP 서버 (Claude Desktop)

웹앱 외에 Claude Desktop에서 자연어로 spiral-buddy 사용 가능. 9개 도구:

```json
// Claude Desktop config
{
  "mcpServers": {
    "iq-spiral-buddy": {
      "command": "pnpm",
      "args": ["--dir", "/path/to/iq-spiral-buddy", "mcp"],
      "env": {
        "ANTHROPIC_API_KEY": "...",
        "SPIRAL_VAULT_PATH": "/path/to/Obsidian Vault",
        "SPIRAL_ROADMAP_ROOT": "/path/to/iq-dev-lab"
      }
    }
  }
}
```

### 등록된 도구

| 도구 | 용도 |
|---|---|
| `spiral_list_roadmaps` | Local + Curated 통합 표시. `include_available=true`로 미설치 큐레이션 레포도 |
| `spiral_install_curated` | GitHub 조직 레포 on-demand 클론 |
| `spiral_list_chapters` | 특정 로드맵의 챕터 + 학습 진도 |
| `spiral_get_chapter_context` | 챕터 본문 + 이전 노트 (세션 시작용) |
| `spiral_list_notes` | 과거 노트 인덱스 (로드맵별 필터) |
| `spiral_read_note` | 특정 노트 본문 읽기 |
| `spiral_save_note` | 8섹션 구조화 노트 저장 (누락 자동 보충) |
| `spiral_delete_notes` ✨ | 챕터·로드맵·depth 단위 노트를 `.trash/`로 이동 (복구 가능) |
| `spiral_search` ✨ | 로드맵·챕터·노트 substring 통합 검색, 마크다운 표 응답 |

모든 도구 응답은 풍부한 마크다운 표/리스트로 반환되어 Claude Desktop이 가공 없이 그대로 보여줌.

자연어 사용 예시:
> "spiral-buddy로 학습할 만한 로드맵 뭐 있어?"
→ `spiral_list_roadmaps` → 표 출력

> "transaction-mvcc 로드맵의 ACID 챕터 deeper-layer로 가자"
→ `spiral_list_chapters` → `spiral_get_chapter_context` → 학습 대화 → `spiral_save_note`

> "어디서 transaction isolation 봤지?"
→ `spiral_search` → 로드맵·챕터·노트 표

> "spring-core의 aop 챕터 d2 노트 다 지워줘"
→ `spiral_delete_notes(roadmap_id=spring-core-..., chapter_id=aop/..., depth=2)`

> "redis-deep-dive 받아서 시작하자"
→ `spiral_install_curated` → `spiral_list_chapters` → …

## 웹앱 핵심 UX

- **세션 인터럽트 처리** — 학습 중 다른 챕터로 이동하려 하면 3-way modal: **저장하고 이동** / **폐기하고 이동** / **취소**.
- **End 진행 시각화** — 노트 저장이 SSE로 3단계(대화 분석 → 노트 작성 → vault 저장) 표시. 완료 후 카드 안에 요약 + 옵시디언에서 열기 버튼.
- **사이드바 토글 + 너비 조절** — `Cmd+B`로 숨김(집중 모드), 우측 가장자리 드래그로 너비 조절(200~600px), 더블클릭으로 기본값 복원.
- **모델 선택** — 헤더 드롭다운으로 세션 시작 전 모델 선택. tier 뱃지(highest/high/balanced/fast).
- **계층 사이드바** — Category(JSON 순서) → Repo → Sub-roadmap(README 순서) 3-level. active 로드맵의 cat/repo는 자동 펼침 (사용자가 닫으면 그 의도 유지).
- **챕터 행 컨트롤** — visited 챕터 hover시 우측에 📖(노트 열기) + 🗑(삭제) 두 아이콘 등장. 메인 클릭은 새 세션 시작.
- **자동 새로고침** — 노트 삭제·복구 시 챕터 목록 + 사이드바 진도 + 휴지통 뱃지가 한 번에 동기화.
- **자동 진입** — 앱 첫 진입 시 (lastId → mostRecent → first) 우선순위로 로드맵 결정, 가장 최근 학습 챕터로 자동 스크롤.
- **No-cache 정책** — 정적 파일 응답에 `Cache-Control: no-store` — 코드 갱신 시 강제 새로고침 없이 즉시 반영.
- **페이지 닫기 경고** — 세션 중 탭 닫으면 `beforeunload` 경고로 손실 방지.

## API 요약

| 경로 | 메서드 | 용도 |
|---|---|---|
| `/api/config`, `/api/models` | GET | 메타 |
| `/api/roadmaps` | GET | 모든 로드맵 + 진도 (카테고리 순서 적용) |
| `/api/chapters?roadmap_id=...` | GET | 챕터 + depths + noteLinks |
| `/api/history?roadmap_id=...` | GET | 노트 히스토리 |
| `/api/search?q=...` | GET | 로드맵·챕터·노트 substring 검색 |
| `/api/notes` | DELETE | 챕터·로드맵·depth 단위 노트 삭제 |
| `/api/trash` | GET | 휴지통 목록 |
| `/api/trash/restore` | POST | 휴지통에서 복구 |
| `/api/activity?days=365` | GET | 학습 활동 (날짜별 노트 수 + depth 분포) |
| `/api/curated/{available, install, refresh, ...}` | GET/POST | Curated source |
| `/api/session/{start, message, end, cancel}` | POST | 세션 lifecycle (SSE) |
| `/api/suggest?roadmap_id=...` | GET | 다음 챕터 추천 (deeper/next/cross-link) |

## 아키텍처

```
┌─────────────────────────────────────────────────────────┐
│  Browser (vanilla JS · ES module · marked · hljs)      │
│   ↕ fetch + SSE                                         │
│  Hono server on localhost:3737                          │
│   ├ /api/{config, models, roadmaps, chapters, history}  │
│   ├ /api/{search, activity, notes, trash}               │
│   ├ /api/curated/{available, install, refresh, …}       │
│   ├ /api/session/{start, message, end, cancel}          │
│   └ static client (no-cache, no build step)             │
│   ↕ in-process                                          │
│  roadmap.ts      → discoverRoadmaps + README sortKey    │
│  curated.ts      → GitHub API + on-demand git clone     │
│  categories.ts   → org → categories (JSON 정의 순서)     │
│  vault.ts        → 노트 R/W + .trash 이동/복구/청소      │
│  spiral.ts       → Claude judges next chapter           │
│  note-writer.ts  → 8섹션 구조화 + 누락 자동 보충         │
│  session-store.ts → in-memory session map               │
│  claude.ts       → Anthropic SDK wrapper (model 분기)    │
│                                                          │
│  mcp.ts (별도 entry) ───────────► Claude Desktop        │
│   stdio · 9 tools · markdown-first responses            │
└─────────────────────────────────────────────────────────┘
```

빌드 파이프라인 없음. 클라이언트는 ES 모듈을 브라우저가 직접 로드. tsx가 서버 TS를 그 자리에서 실행. dev 도구라 정적 파일은 `Cache-Control: no-store`.

## 디렉토리 구조

```
src/
  ├ config.ts          ─ 환경변수 + Config 인터페이스
  ├ roadmap.ts         ─ discoverRoadmaps, sortKey (README 기반), loadRoadmapChapters
  ├ vault.ts           ─ 노트 R/W, 휴지통 이동/복구/청소, listSpiralNotes
  ├ note-writer.ts     ─ 8섹션 구조화, 누락 자동 보충
  ├ spiral.ts          ─ Claude suggest next chapter
  ├ session-store.ts   ─ in-memory 세션 map
  ├ claude.ts          ─ Anthropic SDK wrapper
  ├ curated.ts         ─ GitHub 조직 레포 on-demand clone
  ├ categories.ts      ─ org → 카테고리 매핑 + 순서
  ├ routes.ts          ─ Hono API routes (검색·활동·휴지통 포함)
  ├ server.ts          ─ 진입점 (웹앱)
  └ mcp.ts             ─ MCP 서버 진입점 (9개 도구)

client/                ─ 브라우저 SPA (vanilla JS + ESM)
  ├ index.html         ─ 사이드바, topbar, 검색·휴지통·활동 모달
  ├ app.js             ─ 상태 + 렌더 + 모달 + 키보드 단축키
  └ styles.css         ─ 다크 테마, progress bar, 활동 그리드 등

scripts/
  ├ verify-readme-sort.ts ─ README 기반 정렬 dry-run 검증
  └ test-phase-*.ts       ─ 통합 테스트

data/
  └ curated-categories.json ─ iq-dev-lab 9개 카테고리 + 학습 순서

docs/                  ─ phase별 spec
```

## 로드맵 (도구의)

- [x] Phase 0 — CLI 프로토타입 (폐기)
- [x] Phase 0.5 — 로컬 웹앱 MVP
- [x] Phase 1 — MCP 서버 + Claude Desktop 통합
- [x] Phase 1.5 — 동적 로드맵 + MCP 마크다운 응답
- [x] Phase 2 — Curated GitHub source
- [x] Phase 2.1 — 카테고리 분류 + 메타 레포 제외
- [x] Phase 2.2 — 디자인 리뉴얼 (브랜드, 모델 선택, End SSE)
- [x] Phase 2.3 — UX 다듬기 (사이드바 토글, 세션 인터럽트, 3-level 계층)
- [x] **Phase 2.4 — Productivity (검색·삭제·복구·활동·README 정렬) ← 현재**
- [ ] (검토 중) C2 — 옛 노트 스키마 일괄 migration 도구
- [ ] (검토 중) C3 — 핵심 함수 단위 테스트 (sortKey, trash, noteMatchesChapter)
- [ ] (검토 중) 노트 본문 풀텍스트 검색 (현재는 첫 1000자만)
- [ ] (보류) Notion 지원

## 다음에 고민할 것들

[docs/next-steps.md](docs/next-steps.md) 참조.

## 라이선스

MIT
