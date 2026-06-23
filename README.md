# 🌀 Spiral Buddy — 🔵 Blue

> AI 버디와 함께하는 **나선형 학습** 데스크톱 앱 — **개발 학습용 버디**.
> [iq-spiral-galaxy](https://github.com/iq-spiral-galaxy) 패밀리: 🔴 Red(AI/수학) · 🟢 Green(실천적 지혜) · 🔵 Blue(개발)
> 로드맵 따라가며 학습 → 버디(AI)와 Socratic 대화 → **8섹션 구조 노트**로 노트 보관함에 자동 축적 → 다음 세션 진입 시 이전 노트가 컨텍스트로 자동 합류.

<p align="center">
  <a href="https://github.com/iq-spiral-galaxy/spiral-buddy-blue/releases/latest"><img alt="latest release" src="https://img.shields.io/github/v/release/iq-spiral-galaxy/spiral-buddy-blue?display_name=tag&style=flat-square"></a>
  <img alt="platforms" src="https://img.shields.io/badge/macOS%20%C2%B7%20Windows%20%C2%B7%20Linux-supported-blue?style=flat-square">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-green?style=flat-square">
</p>

---

<details>
<summary>⚡ <b>30초 설치 — 한 줄 명령으로 바로 받기</b> &nbsp;(클릭해서 펼치기)</summary>

<br/>

> 💡 **API 호출 X — 어떤 버전인지 신경 X.** 아래 명령들은 GitHub Releases의 고정된 `latest` 별칭 URL을 사용해 다운로드합니다. 시간당 제한(rate-limit) 걸리지 않습니다.

### 🍎 macOS — Apple Silicon (M1/M2/M3/M4)
터미널에 그대로 붙여넣기 — 실행 중이면 자동 종료 → 최신 버전 받기 → 설치 → 재실행까지 한 번에:

```bash
osascript -e 'tell application "Spiral Buddy" to quit' 2>/dev/null; sleep 1; \
cd /tmp && \
curl -fL -o /tmp/spiral.dmg "https://github.com/iq-spiral-galaxy/spiral-buddy-blue/releases/latest/download/Spiral-Buddy-latest-arm64.dmg" && \
MOUNT=$(hdiutil attach -nobrowse /tmp/spiral.dmg | grep -o '/Volumes/.*' | head -1) && \
rm -rf '/Applications/Spiral Buddy.app' && \
cp -R "$MOUNT/Spiral Buddy.app" /Applications/ && \
hdiutil detach -quiet "$MOUNT" && \
xattr -cr '/Applications/Spiral Buddy.app' && \
rm -f /tmp/spiral.dmg && \
open '/Applications/Spiral Buddy.app'
```

### 🍎 macOS — Intel
터미널에 그대로 붙여넣기:

```bash
osascript -e 'tell application "Spiral Buddy" to quit' 2>/dev/null; sleep 1; \
cd /tmp && \
curl -fL -o /tmp/spiral.dmg "https://github.com/iq-spiral-galaxy/spiral-buddy-blue/releases/latest/download/Spiral-Buddy-latest.dmg" && \
MOUNT=$(hdiutil attach -nobrowse /tmp/spiral.dmg | grep -o '/Volumes/.*' | head -1) && \
rm -rf '/Applications/Spiral Buddy.app' && \
cp -R "$MOUNT/Spiral Buddy.app" /Applications/ && \
hdiutil detach -quiet "$MOUNT" && \
xattr -cr '/Applications/Spiral Buddy.app' && \
rm -f /tmp/spiral.dmg && \
open '/Applications/Spiral Buddy.app'
```

### 🪟 Windows (PowerShell)
**PowerShell**(시작 메뉴에서 "PowerShell" 검색) 열고 그대로 붙여넣기 — 실행 중이면 자동 종료 → silent install → 재실행:

```powershell
$ErrorActionPreference = "Stop"
Get-Process "Spiral Buddy" -EA SilentlyContinue | Stop-Process -Force
$exe = "$env:TEMP\spiral-buddy-setup.exe"
Invoke-WebRequest -Uri "https://github.com/iq-spiral-galaxy/spiral-buddy-blue/releases/latest/download/Spiral-Buddy-latest-Setup.exe" -OutFile $exe
Start-Process -FilePath $exe -ArgumentList "/S" -Wait
Remove-Item $exe -Force
$app = "$env:LOCALAPPDATA\Programs\spiral-buddy\Spiral Buddy.exe"
if (Test-Path $app) { Start-Process $app }
```

### 🐧 Linux
```bash
curl -fL -o ~/SpiralBuddy.AppImage "https://github.com/iq-spiral-galaxy/spiral-buddy-blue/releases/latest/download/Spiral-Buddy-latest.AppImage"
chmod +x ~/SpiralBuddy.AppImage
~/SpiralBuddy.AppImage
```

> ⚙️ 앱 안에서도 **설정 > 일반 > "새 버전 사용 가능"** 배너에서 한 번 클릭으로 업데이트 가능 (macOS / Windows).
>
> 첫 실행 시 macOS Gatekeeper 경고("'손상되었기 때문에 열 수 없습니다") — 위 명령의 `xattr -cr`이 해결. 노트·설정·워크스페이스는 vault 또는 `~/Library/Application Support/Spiral Buddy/`에 저장돼서 재설치해도 안 사라집니다.

</details>

---

## ✨ 주요 기능

### 🗺️ 로드맵 + 챕터 학습 흐름
- **로컬 디렉토리** (사용자 폴더 트리) + **GitHub Curated** (`iq-dev-lab` 86개 deep-dive 레포) — 두 source 공존
- **9개 도메인 hierarchy** — Foundations · Frontend · Backend · Android · iOS · Cross Platform · Data Engineering · Languages · Synthesis
- README 안의 마크다운 링크 등장 순서를 sub-roadmap 학습 순서로 사용 (번호 prefix 없어도 OK)
- 멀티 워크스페이스 — 여러 학습 컨텍스트를 한 vault의 별도 폴더로 분리 (이름·경로 중복 자동 차단)

### 🧭 4단 계층 사이드바
**도메인 → 카테고리 → 레포 → sub-roadmap → 챕터** 트리. 깊은 자료도 한눈에:

- **마지막 학습 자동 활성화** — 앱 재진입 시 마지막 챕터에 좌측 accent border + "마지막" 뱃지 + 자동 스크롤
- **인라인 검색** (⌘F) — 도메인·카테고리·레포·sub-roadmap·챕터 5개 필드 동시 매칭. 매칭된 노드 임시 펼침 + 텍스트 하이라이트
- **검색 강조** — idle 상태에서 breathing 애니메이션 + ⌘F 단축키 칩으로 검색 기능 존재 인지
- **레포별 progress bar** + d1/d2/d3 배지

### 💬 버디와의 Socratic 학습 세션
- depth 1 (첫 학습) → depth 2 (복습) → depth 3 (심화) — 같은 챕터를 나선형으로 반복
- 이전 노트가 자동으로 새 세션 컨텍스트에 포함
- **스트리밍 응답** — 실시간 토큰 단위 표시
- **모델 선택** — Sonnet 4.6 (기본·추천) / Opus / Haiku 등
- **세션 Pause / Resume** — 일시정지 후 사이드바 PAUSED 섹션에서 멀티 세션 관리, 클릭으로 컨텍스트 유지하며 재개

### 🔍 Look-up 패널 (사이드 학습)
대화 흐름을 끊지 않고 사이드에서 모르는 표현을 즉시 확인:
- **드래그 + 깊이 선택**: 채팅에서 텍스트 드래그 → 간결 / 중간 / 깊이 / 질문 4가지 응답 옵션
- **질문 추가**: 키워드 + 추가 질문 함께 보내기 (예: `Buffer Pool` + "LRU랑 어떻게 연결돼?")
- **패널 직접 입력**: 우측 하단 composer에서 키워드 + 문맥 직접 입력
- **중복 차단** — 같은 `(키워드, 깊이, 추가 질문)` 조합 재요청 시 새 API 호출 안 함. 기존 카드로 자동 scroll + flash 강조. 토큰 절약 + 카드 중복 방지
- **폭 안전장치** — Look-up 패널이 아무리 넓어져도 chat 컬럼 최소 폭 보장 (topbar 버튼 안 가려짐)
- 카드 자동 펼침/접기 — 새 질문만 펼쳐 시야 깨끗
- 👍/👎 만족도 피드백

### 📝 8섹션 구조 노트
세션 종료 후 버디가 대화 로그를 다음 8섹션으로 정돈:
1. 한 줄 요약
2. 핵심 개념
3. 직관 / 비유
4. 짚고 넘어간 예제
5. 헷갈렸던 / 확인이 필요한 지점
6. 이전 학습과의 연결 (`[[note-title]]` 위키링크)
7. 다음에 볼 것
8. 🔍 학습 중 찾아본 표현 — Look-up 카드들이 callout 블록으로 자동 첨부 (Obsidian 호환)

frontmatter도 정리됨: `repo` → `roadmap` → `chapter` → `depth` → `date` → `tags` → `summary` 순.

### 🎯 깊이 있는 학습 도구
- **Quiz 단계별 난이도** — Quiz 버튼을 누를수록 어려워짐 (개념 확인 → 적용 → 함정·엣지케이스 → 종합 시나리오)
- **✨ 프롬프트 다듬기** — 보내기 전 (또는 보내면서) 거친 질문을 명확한 학습 질문으로 자동 정돈 (`⌘J` / `⌘⇧↵`). 마음에 안 들면 `⌘Z`로 원본 복원
- **Cmd+K 통합 검색** — 로드맵·챕터·노트 한 번에 (vs ⌘F는 사이드바 inline filter)

### 📊 학습 추적
- **활동 캘린더** — 1년치 contribution graph + 5단계 강도 (가볍게/보통/몰입/집중/대규모)
- **Streak 표시** — 연속 학습 일수 + 7일/14일/30일 도달 시 시각 효과 (flame flicker → glow → 골드 펄스)
- **챕터별 진도** — 사이드바에 d1/d2/d3 배지 + 진행도 bar

### 🌗 라이트 / 다크 모드
- 설정에서 토글. 챕터 번호·검색·도메인 헤더까지 모두 두 톤 대응

### 🗑️ 안전한 노트 관리
- 삭제는 `.trash/`로 이동 (즉시 복구 가능)
- 30일 후 자동 청소
- 챕터별 / depth별 / 전체 삭제 옵션

### 🔁 자동 업데이트
- 앱이 GitHub Releases를 폴링해서 새 버전 감지
- **설정 > 일반**에 "v0.5.XX 사용 가능 [받기]" 버튼
- 클릭 시 자동 종료 → 다운로드 → 설치 → 재실행 (macOS / Windows)

### 🛡️ API 오류 자동 복구
- Anthropic API의 일시적 `overloaded_error`는 1.5s → 4s → 9s backoff로 자동 3회 재시도
- 그래도 실패하면 raw JSON 대신 친절한 한국어 메시지로 표시

---

## 📚 iq-dev-lab 학습 자료 — 9개 도메인 / 86개 레포

설정 모달에서 한 번에 받기. 도메인별 또는 역할 프리셋으로 선택 가능 — **이미 받은 레포는 자동 skip (incremental)**.

| Order | 도메인 | 카테고리 / 주요 레포 수 |
|---|---|---|
| 1 | 🪨 **Foundations** | 컴퓨터 구조 · 컴파일러 · 암호 · 분산 시스템 · GPU (5) |
| 2 | 🌐 **Frontend** | Web Platform · Web Language/Framework (13) |
| 3 | 🔧 **Backend** | Java Core · Spring · Architecture · DevOps · DB · Messaging · API · Security · Perf (39) |
| 4 | 🤖 **Android** | Runtime · Framework · Kotlin · Compose · 아키텍처 · 퍼포먼스 · 빌드 (8) |
| 5 | 🍎 **iOS** | Swift · ObjC Runtime · LifeCycle · SwiftUI · UIKit · Concurrency · 퍼포먼스 (7) |
| 6 | 🔀 **Cross Platform** | React Native · Flutter · Kotlin Multiplatform (3) |
| 7 | 📊 **Data Engineering** | Spark · Stream Processing · Columnar Storage (3) |
| 8 | 🧱 **Languages** | Rust · Go (2) |
| 99 | 🧬 **Synthesis** | Concurrency / Memory / Compilation / Rendering / Reactivity / Caching 비교 (6) |

**역할 프리셋** (Setup wizard + 설정 모달 둘 다):
- 🔧 **백엔드 개발자** — Foundations · Languages · Backend · Data Eng (50 repos)
- 🌐 **프론트엔드 개발자** — Foundations · Languages · Frontend (20 repos)
- 📱 **모바일 개발자** — Foundations · Languages · Android · iOS · Cross Platform (25 repos)
- 🧬 **풀스택 · CS 깊게** — 모든 도메인 + Synthesis (86 repos)

> 💡 **기존 워크스페이스에 추가 받기** — 설정 모달의 "받을 위치" 자동으로 활성 워크스페이스 폴더 지정. 다른 위치 선택 시 경고 카드로 분리됨을 안내. → 풀스택으로 업그레이드해도 기존 백엔드 자료·진행도(d1/d2) 그대로 유지.

---

## 🚀 시작하기

### 1. 다운로드 후 첫 실행

위 한 줄 설치 명령으로 받았다면 자동 실행됨. 그렇지 않으면 `Spiral Buddy.app`을 더블클릭.

### 2. 첫 실행 시 Setup Wizard

1. **AI API Key 입력** — 현재 Anthropic 모델 지원, [console.anthropic.com](https://console.anthropic.com/)에서 발급한 `sk-ant-...` 키
2. **노트 보관함 폴더 선택** — 노트가 저장될 폴더 (Obsidian vault 사용 시 자동 감지)
3. *(선택)* **역할 프리셋으로 한 번에 받기** — 위 4종 중 하나 클릭 → 폴더 지정 → incremental git clone

### 3. 학습 시작

좌측 사이드바에서 챕터 선택 → 버디와 대화 → `End & Save` 클릭 → 노트 보관함에 자동 생성.

---

## ⌨️ 단축키

| 단축키 | 동작 |
|-----|-----|
| `⌘B` | 좌측 사이드바 토글 |
| `⌘L` | 우측 Look-up 패널 토글 |
| `⌘K` | 통합 검색 모달 (노트 본문 fulltext) |
| `⌘F` | 사이드바 inline 검색 (로드맵/챕터 필터) |
| `⌘J` | 입력 다듬기 (보내지 않음) |
| `⌘⇧↵` | 입력 다듬어서 즉시 보내기 |
| `⌘Z` (입력란 포커스 시) | 다듬은 직후 원본 복원 |
| `Enter` (입력란) | 보내기 |
| `Shift+Enter` | 줄바꿈 |
| `Esc` (사이드바 검색) | 검색어 비우기 |
| `Esc` (Look-up 패널) | 패널 닫기 |

---

## 🏗️ 개발 / 빌드

```bash
# 의존성 (pnpm 권장)
pnpm install

# 개발 (브라우저 웹앱 모드 — 백엔드 서버 + 자동 브라우저 열기)
pnpm dev

# Electron dev (TypeScript 빌드 + Electron 실행)
pnpm electron:dev

# 패키징 (현재 OS용)
pnpm electron:build:mac    # macOS dmg
pnpm electron:build:win    # Windows exe
pnpm electron:build:linux  # Linux AppImage
```

`.env` 파일 (개발 모드용):
```
ANTHROPIC_API_KEY=sk-ant-...
SPIRAL_VAULT_PATH=/Users/you/Documents/MyNotes
SPIRAL_ROADMAP_ROOT=/path/to/your/roadmaps   # 선택
SPIRAL_CURATED_ORG=iq-dev-lab                # 선택
SPIRAL_MODEL=claude-sonnet-4-6               # 선택
```

---

## 🧩 Claude Desktop MCP (옵션)

같은 노트 vault를 공유하는 9개 MCP 도구:

- `spiral_list_roadmaps` · `spiral_list_chapters` · `spiral_get_chapter_context`
- `spiral_save_note` · `spiral_read_note` · `spiral_list_notes` · `spiral_delete_notes`
- `spiral_search`
- `spiral_install_curated`

Claude Desktop 설정에 추가:
```json
{
  "mcpServers": {
    "spiral-buddy": {
      "command": "node",
      "args": ["/path/to/spiral-buddy-blue/dist/mcp.js"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "SPIRAL_VAULT_PATH": "/Users/you/Documents/MyNotes"
      }
    }
  }
}
```

---

## 📂 데이터 위치

- **노트**: `<vault>/spiral-buddy/` (워크스페이스마다 별도 sub-dir — 섞이지 않음)
- **휴지통**: `<vault>/spiral-buddy/.trash/` (30일 후 자동 청소)
- **앱 설정**: `~/Library/Application Support/Spiral Buddy/spiral-buddy-config.json` (macOS)
- **로그**: `~/Library/Logs/Spiral Buddy/server.log` (macOS)
- **Curated 캐시 / 자료**: 사용자가 지정한 폴더 (예: `~/Documents/spiral/iq-dev-lab/<repo>`)

재설치해도 위 데이터는 **모두 보존**됩니다.

---

## 🛠️ 디렉토리 구조

```
src/
  ├ config.ts          ─ 환경변수 + Config 인터페이스
  ├ roadmap.ts         ─ discoverRoadmaps · loadRoadmapChapters
  ├ vault.ts           ─ 노트 R/W, listSpiralNotes, trash 관리
  ├ note-writer.ts     ─ 8섹션 구조화 + Look-up callout 첨부
  ├ spiral.ts          ─ AI 기반 다음 챕터 추천
  ├ session-store.ts   ─ 세션 + lookups + pause state 인메모리 store
  ├ claude.ts          ─ Anthropic SDK wrapper (retry/backoff)
  ├ curated.ts         ─ GitHub 조직 레포 on-demand clone
  ├ categories.ts      ─ org → 도메인/카테고리 매핑 + findDomainForCategory
  ├ routes.ts          ─ Hono API routes
  ├ server.ts          ─ 웹앱 진입점
  └ mcp.ts             ─ MCP 서버 진입점

client/                ─ 브라우저 SPA (vanilla JS + ESM)
electron/              ─ Electron main · preload · setup wizard
docs/                  ─ phase별 spec
scripts/               ─ 통합 테스트, 일회성 도구
data/curated-domains.json     ─ iq-dev-lab 9개 도메인 hierarchy + 역할 프리셋
```

---

## 🤝 Contributing

PR / 이슈 환영. 큰 변경 전엔 이슈로 먼저 논의해주세요.

## 📄 License

MIT
