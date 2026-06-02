# 🌀 Spiral Buddy

> Claude와 Obsidian을 잇는 **나선형 학습** 데스크톱 앱.
> 로드맵 따라가며 학습 → Claude와 Socratic 대화 → **8섹션 구조 노트**로 vault에 자동 축적 → 다음 세션 진입 시 이전 노트가 컨텍스트로 자동 합류.

<p align="center">
  <a href="https://github.com/iq-agent-lab/iq-spiral-buddy/releases/latest"><img alt="latest release" src="https://img.shields.io/github/v/release/iq-agent-lab/iq-spiral-buddy?display_name=tag&style=flat-square"></a>
  <img alt="platforms" src="https://img.shields.io/badge/macOS%20%C2%B7%20Windows%20%C2%B7%20Linux-supported-blue?style=flat-square">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-green?style=flat-square">
</p>

---

## ⚡ 30초 설치 (macOS Apple Silicon)

터미널에 그대로 붙여넣기 — 실행 중이면 자동 종료 → 최신 버전 받기 → 설치 → 재실행까지 한 번에:

```bash
osascript -e 'tell application "Spiral Buddy" to quit' 2>/dev/null; sleep 1; \
V=$(curl -fsSL https://api.github.com/repos/iq-agent-lab/iq-spiral-buddy/releases/latest | sed -n 's/.*"tag_name": "v\([^"]*\)".*/\1/p') && \
echo "→ installing v$V" && cd /tmp && \
curl -fL -o /tmp/spiral.dmg "https://github.com/iq-agent-lab/iq-spiral-buddy/releases/download/v$V/Spiral.Buddy-$V-arm64.dmg" && \
hdiutil attach -nobrowse -quiet /tmp/spiral.dmg && \
rm -rf '/Applications/Spiral Buddy.app' && \
cp -R "/Volumes/Spiral Buddy $V/Spiral Buddy.app" /Applications/ && \
hdiutil detach -quiet "/Volumes/Spiral Buddy $V" && \
xattr -cr '/Applications/Spiral Buddy.app' && \
rm -f /tmp/spiral.dmg && \
open '/Applications/Spiral Buddy.app'
```

> **Intel Mac**: 위 명령에서 `-arm64`를 빼고 `Spiral.Buddy-$V.dmg`로 변경.
>
> **Windows / Linux**: [Releases 페이지](https://github.com/iq-agent-lab/iq-spiral-buddy/releases/latest)에서 `.exe` 또는 `.AppImage` 다운로드.
>
> ⚙️ 앱 안에서도 **설정 > 일반 > "새 버전 사용 가능"** 배너에서 한 번 클릭으로 업데이트 가능 (macOS).
>
> 첫 실행 시 macOS Gatekeeper 경고("'손상되었기 때문에 열 수 없습니다") — 위 명령의 `xattr -cr`이 해결. 노트·설정·워크스페이스는 vault 또는 `~/Library/Application Support/Spiral Buddy/`에 저장돼서 재설치해도 안 사라집니다.

---

## ✨ 주요 기능

### 🗺️ 로드맵 + 챕터 학습 흐름
- **로컬 디렉토리** (사용자 폴더 트리) + **GitHub Curated** (기본 `iq-dev-lab` 38+ deep-dive 레포) — 두 source 공존
- README 안의 마크다운 링크 등장 순서를 sub-roadmap 학습 순서로 사용 (번호 prefix 없어도 OK)
- 카테고리별 정렬 (`data/curated-categories.json`)
- 멀티 워크스페이스 — 여러 학습 컨텍스트를 한 vault의 별도 폴더로 분리

### 💬 Claude Socratic 학습 세션
- depth 1 (첫 학습) → depth 2 (복습) → depth 3 (심화) — 같은 챕터를 나선형으로 반복
- 이전 노트가 자동으로 새 세션 컨텍스트에 포함
- 스트리밍 응답 (실시간 토큰 단위 표시)
- 모델 선택 (Sonnet 4.6 추천 기본값 · Opus · Haiku 등)

### 🔍 Look-up 패널 (사이드 학습)
대화 흐름을 끊지 않고 사이드에서 모르는 표현을 즉시 확인:
- **드래그 + 깊이 선택**: 채팅에서 텍스트 드래그 → 간결 / 중간 / 깊이 / 질문 4가지 응답 옵션
- **질문 추가**: 키워드 + 추가 질문 함께 보내기 (예: `Buffer Pool` + "LRU랑 어떻게 연결돼?")
- **패널 직접 입력**: 우측 하단 composer에서 키워드 + 문맥 직접 입력
- 카드 자동 펼침/접기 — 새 질문만 펼쳐 시야 깨끗
- Look-up 응답에서도 또 드래그해서 한 단계 더 파볼 수 있음
- 👍/👎 만족도 피드백

### 📝 8섹션 구조 노트
세션 종료 후 Claude가 대화 로그를 다음 8섹션으로 정돈:
1. 한 줄 요약
2. 핵심 개념
3. 직관 / 비유
4. 짚고 넘어간 예제
5. 헷갈렸던 / 확인이 필요한 지점
6. 이전 학습과의 연결 (`[[note-title]]` 위키링크)
7. 다음에 볼 것
8. 🔍 학습 중 찾아본 표현 — Look-up 카드들이 Obsidian native callout으로 자동 첨부

frontmatter도 정리됨: `repo` → `roadmap` → `chapter` → `depth` → `date` → `tags` → `summary` 순.

### 🎯 깊이 있는 학습 도구
- **Quiz 단계별 난이도** — Quiz 버튼을 누를수록 어려워짐 (개념 확인 → 적용 → 함정·엣지케이스 → 종합 시나리오)
- **✨ 프롬프트 다듬기** — 보내기 전 (또는 보내면서) 거친 질문을 명확한 학습 질문으로 자동 정돈 (`⌘J` / `⌘⇧↵`). 마음에 안 들면 `⌘Z`로 원본 복원.
- **Cmd+K 통합 검색** — 로드맵·챕터·노트 한 번에

### 📊 학습 추적
- **활동 캘린더** — 1년치 contribution graph + 5단계 강도 (가볍게/보통/몰입/집중/대규모)
- **Streak 표시** — 연속 학습 일수 + 7일/14일/30일 도달 시 시각 효과 (flame flicker → glow → 골드 펄스)
- **챕터별 진도** — 사이드바에 d1/d2/d3 배지 + 진행도 bar

### 🗑️ 안전한 노트 관리
- 삭제는 `.trash/`로 이동 (즉시 복구 가능)
- 30일 후 자동 청소
- 챕터별 / depth별 / 전체 삭제 옵션

### 🔁 자동 업데이트
- 앱이 GitHub Releases를 폴링해서 새 버전 감지
- **설정 > 일반**에 "v0.5.XX 사용 가능 [받기]" 버튼
- 클릭 시 자동 종료 → 다운로드 → 설치 → 재실행 (macOS)

### 🛡️ API 오류 자동 복구
- Anthropic API의 일시적 `overloaded_error`는 1.5s → 4s → 9s backoff로 자동 3회 재시도
- 그래도 실패하면 raw JSON 대신 친절한 한국어 메시지로 표시

---

## 🚀 시작하기

### 1. 다운로드 후 첫 실행

위 한 줄 설치 명령으로 받았다면 자동 실행됨. 그렇지 않으면 `Spiral Buddy.app`을 더블클릭.

### 2. 첫 실행 시 Setup Wizard

1. **Anthropic API Key 입력** — [console.anthropic.com](https://console.anthropic.com/)에서 발급한 `sk-ant-...` 키
2. **Obsidian Vault 폴더 선택** — 노트가 저장될 vault (앱이 자동 감지 시도)
3. *(선택)* **iq-dev-lab 38개 deep-dive 한 번에 받기** — Java / Spring / DB / Architecture / MSA 등 카테고리별로 git clone

### 3. 학습 시작

좌측 사이드바에서 챕터 선택 → Claude와 대화 → `End & Save` 클릭 → 옵시디언에 노트 자동 생성.

---

## ⌨️ 단축키

| 단축키 | 동작 |
|-----|-----|
| `⌘B` | 좌측 사이드바 토글 |
| `⌘L` | 우측 Look-up 패널 토글 |
| `⌘K` | 통합 검색 |
| `⌘J` | 입력 다듬기 (보내지 않음) |
| `⌘⇧↵` | 입력 다듬어서 즉시 보내기 |
| `⌘Z` (입력란 포커스 시) | 다듬은 직후 원본 복원 |
| `Enter` (입력란) | 보내기 |
| `Shift+Enter` | 줄바꿈 |

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
SPIRAL_VAULT_PATH=/Users/you/Documents/Obsidian Vault
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
      "args": ["/path/to/iq-spiral-buddy/dist/mcp.js"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "SPIRAL_VAULT_PATH": "/Users/you/Documents/Obsidian Vault"
      }
    }
  }
}
```

---

## 📂 데이터 위치

- **노트**: `<vault>/spiral-buddy/` (워크스페이스마다 sub-dir 가능)
- **휴지통**: `<vault>/spiral-buddy/.trash/` (30일 후 자동 청소)
- **앱 설정**: `~/Library/Application Support/Spiral Buddy/spiral-buddy-config.json` (macOS)
- **로그**: `~/Library/Logs/Spiral Buddy/server.log` (macOS)
- **Curated 캐시**: `~/.cache/spiral-buddy/curated/` (on-demand git clone)

재설치해도 위 데이터는 **모두 보존**됩니다.

---

## 🛠️ 디렉토리 구조

```
src/
  ├ config.ts          ─ 환경변수 + Config 인터페이스
  ├ roadmap.ts         ─ discoverRoadmaps · loadRoadmapChapters
  ├ vault.ts           ─ 노트 R/W, listSpiralNotes, trash 관리
  ├ note-writer.ts     ─ 8섹션 구조화 + Look-up callout 첨부
  ├ spiral.ts          ─ Claude suggest next chapter
  ├ session-store.ts   ─ 세션 + lookups 인메모리 store
  ├ claude.ts          ─ Anthropic SDK wrapper (retry/backoff)
  ├ curated.ts         ─ GitHub 조직 레포 on-demand clone
  ├ categories.ts      ─ org → 카테고리 매핑
  ├ routes.ts          ─ Hono API routes
  ├ server.ts          ─ 웹앱 진입점
  └ mcp.ts             ─ MCP 서버 진입점

client/                ─ 브라우저 SPA (vanilla JS + ESM)
electron/              ─ Electron main · preload · setup wizard
docs/                  ─ phase별 spec
scripts/               ─ 통합 테스트, 일회성 도구
data/curated-categories.json  ─ iq-dev-lab 9개 카테고리 매핑
```

---

## 🤝 Contributing

PR / 이슈 환영. 큰 변경 전엔 이슈로 먼저 논의해주세요.

## 📄 License

MIT
