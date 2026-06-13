# Perf — idle 시 GPU/CPU 폭증 (상시 UI 애니메이션)

> v0.5.99. 증상: 앱을 켜놓기만 해도 GPU ~42-80% / CPU 상승 / 발열 / 배터리 소모.
> 결론: idle 부하는 **100% 상시 CSS 애니메이션**. 기본 OFF로 전환해 해결.

## 증상

아무 작업도 안 하는 idle 상태(창 활성)에서 GPU 사용률이 치솟고 맥북이 뜨거워짐.
백그라운드로 보내면 0 근처로 떨어짐(Chromium이 가려진 창을 스로틀링하기 때문).

## 원인 — 측정으로 확정

CDP(`--remote-debugging-port`)로 애니메이션을 단계별로 토글하며 `top`으로
`Spiral Buddy Helper (GPU)` / `(Renderer)` 프로세스 CPU를 실측.

핵심 발견 (반직관):

- **GPU ~20%는 "컴포지터가 디스플레이 주사율(ProMotion 120Hz)로 쉬지 않고 합성하는" 고정 비용.**
  상시 애니메이션이 **하나라도** 있으면 이 floor에 고정됨.
- 격리 측정 (그 외 전부 OFF, 단일 요소만 애니메이션):

  | 단일 애니메이션 | GPU | Renderer |
  |---|---|---|
  | 없음 (바닥) | 0.2% | 0.0% |
  | opacity (합성 가능) | 19.2% | 4.5% |
  | transform (합성 가능) | 21.3% | 4.5% |
  | box-shadow (리페인트형) | 25.9% | 11.3% |

  → **합성 가능한 opacity/transform 애니메이션조차 단독 ~20%.** box-shadow·SVG `r`·
  backdrop-filter 같은 리페인트형은 renderer paint를 ~7% 더 얹을 뿐, 주된 비용은 컴포지터.
- 실제 앱은 상시 애니메이션이 여러 개 겹쳐 floor가 GPU 42~80%까지 올라갔음.
- **부분 제거는 무효:** 둘 중 하나만 꺼도 floor 안 떨어짐(44%→44%). 전부 꺼야 0.
- backend(Node/Hono)·JS·SSE·폴링은 idle 기여 **0** (setInterval 없음, SSE는 세션 중에만).

### "Hz를 낮춘다"는 왜 직접 안 되나

Electron/Chromium은 **포그라운드 창의 합성 frame rate를 낮추는 깔끔한 API가 없음**
(`webContents.setFrameRate()`는 offscreen 렌더링 전용). 따라서 "Hz 낮추기"의 실질적
구현은 곧 **"상시 애니메이션을 안 돌게 하기"**.

## 처방 (v0.5.99)

상시(infinite) 장식 애니메이션을 **기본 OFF**. 설정 → 일반 → "장식 모션"을 켜면
(`body.motion-on`) 재활성.

- **로고 스파이럴**: 상시 회전/글로우/센터 펄스 제거 → **진입 시 1회 스핀인(`spiral-intro`) 후 정지**.
  1회성 애니메이션은 끝나면 idle 비용 0.
- **사이드바 검색창 `sidebar-search-breath`**(box-shadow): 제거. hover/focus는 transition으로 처리.
- **streak 뱃지(tier 2~5)** `streak-flicker`/`streak-glow-pulse`: 제거. 정적 색/그라데이션/테두리는 유지.
  (주의: 연속 3일+ 사용자는 사이드바 뱃지가 영원히 깜빡여 동일 floor를 유발했음 — 숨은 비용)
- **quiz 버튼(level 4)** `quiz-pulse`: 제거.
- **유지**: 로딩 스피너류(`spin`·`refine-spin`·`marker-pulse`·`chapterAiDot`) — 실제 작업 중에만 잠깐 돌아 idle 비용 없음.
- **`prefers-reduced-motion: reduce`**: 토글 ON 여부와 무관하게 모든 애니메이션/트랜지션 정지(우선).

구현 위치:
- `client/styles.css` — 모션 게이팅 섹션(파일 하단), `spiral-intro` 키프레임, `prefers-reduced-motion`.
- `client/index.html` — 설정 "일반" 패널의 "장식 모션" 토글.
- `client/app.js` — `MOTION_KEY`/`applyMotion`/`getStoredMotion` (테마 토글과 동형, localStorage 영속화).

## 효과 — 실측 (전/후, 창 활성 상태)

| 상태 | GPU | Renderer |
|---|---|---|
| 수정 전 (상시 애니메이션) | 42~80% | 18~34% |
| **수정 후 기본 (모션 OFF)** | **0.0%** | **0.0%** |
| 수정 후 토글 ON | 98% | 34% |

→ 활성 상태 GPU **42% → 0.0%**. 토글 ON 시 의도대로만 상승.

## 가이드라인 (회귀 방지)

- **상시(`infinite`) 장식 애니메이션을 새로 추가하지 말 것.** 합성 가능 속성이어도
  ProMotion에서 단독 ~20% GPU. 꼭 필요하면 `body.motion-on` 아래에 두고 기본 OFF 유지.
- 1회성 인트로/hover·focus transition은 idle 비용이 없으니 자유롭게 사용 가능.
- box-shadow / SVG `r` / filter / backdrop-filter 의 **애니메이션**은 특히 회피(리페인트).

## 측정 재현 방법

```bash
# 1) 앱을 원격 디버깅 모드로 재실행
pkill -f "Spiral Buddy.app"; open -a "Spiral Buddy" --args --remote-debugging-port=9222
# 2) CDP로 body 클래스/CSS 토글하며 (Runtime.evaluate), GPU/Renderer Helper PID의 CPU를 top으로 측정
#    top -l 4 -s 1 -pid <GPU> -pid <Renderer> -stats pid,cpu
# (GPU 사용률 % 직접 측정은 sudo powermetrics --samplers gpu_power; Helper CPU가 좋은 프록시)
```
