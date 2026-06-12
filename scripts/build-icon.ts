// 앱 아이콘 생성기:
//   1. 여백이 있는 archimedean spiral 좌표 계산
//   2. SVG 문자열 생성 (deep navy + electric blue — Spiral Buddy Blue 정체성)
//   3. 1024 PNG 출력 — @resvg/resvg-js가 있으면 사용
//
// 출력: electron/build/icon.svg, electron/build/icon.png

import fs from "node:fs";
import path from "node:path";

const SIZE = 1024;
const CENTER = SIZE / 2;

// Archimedean spiral: r(θ) = a + b·θ.
// 앱 아이콘 크기에서는 빼곡한 4+턴보다 2.35턴이 더 선명하게 읽힌다.
const TURNS = 2.35;
const POINTS = 420;
const START_R = SIZE * 0.058;
const OUTER_R = SIZE * 0.32;
const B = (OUTER_R - START_R) / (TURNS * 2 * Math.PI);
const OFFSET = -Math.PI / 2.08;

function spiralPath(): string {
  const cmds: string[] = [];
  for (let i = 0; i <= POINTS; i++) {
    const t = i / POINTS;
    const theta = t * TURNS * 2 * Math.PI;
    const r = START_R + B * theta;
    const angle = theta + OFFSET;
    const x = CENTER + r * Math.cos(angle);
    const y = CENTER + r * Math.sin(angle);
    cmds.push(`${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return cmds.join(" ");
}

function svg(): string {
  const d = spiralPath();
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">
  <!-- Spiral Buddy Blue icon: deep navy + electric blue + ice 나선형 -->
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1c2e54"/>
      <stop offset="45%" stop-color="#2e6bf0"/>
      <stop offset="100%" stop-color="#0a1426"/>
    </linearGradient>
    <radialGradient id="glow" cx="58%" cy="62%" r="62%">
      <stop offset="0%"  stop-color="#a8d2ff" stop-opacity="0.40"/>
      <stop offset="38%" stop-color="#5cb8ff" stop-opacity="0.20"/>
      <stop offset="72%" stop-color="#2563eb" stop-opacity="0.05"/>
      <stop offset="100%" stop-color="#2563eb" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="coolGlow" cx="32%" cy="24%" r="62%">
      <stop offset="0%" stop-color="#bfe0ff" stop-opacity="0.1"/>
      <stop offset="58%" stop-color="#bfe0ff" stop-opacity="0.025"/>
      <stop offset="100%" stop-color="#bfe0ff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="rim" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%"  stop-color="#ffffff" stop-opacity="0.24"/>
      <stop offset="40%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="spiralStroke" x1="18%" y1="4%" x2="83%" y2="96%">
      <stop offset="0%"   stop-color="#8ec8ff"/>
      <stop offset="42%"  stop-color="#ffffff"/>
      <stop offset="72%"  stop-color="#dcecff"/>
      <stop offset="100%" stop-color="#6fb2ff"/>
    </linearGradient>
    <filter id="spiralGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <!-- macOS squircle 근사 (rounded square) -->
  <rect x="0" y="0" width="${SIZE}" height="${SIZE}" rx="220" ry="220" fill="url(#bg)"/>
  <!-- 옵시디언 보석 림 라이트 -->
  <rect x="0" y="0" width="${SIZE}" height="${SIZE}" rx="220" ry="220" fill="url(#rim)"/>
  <!-- soft brand glow -->
  <circle cx="${CENTER + 38}" cy="${CENTER + 72}" r="460" fill="url(#glow)"/>
  <circle cx="${CENTER - 118}" cy="${CENTER - 138}" r="340" fill="url(#coolGlow)"/>
  <path d="M 228 258 C 336 136 537 92 699 162 C 814 211 879 312 894 430"
        stroke="#ffffff"
        stroke-width="18"
        stroke-linecap="round"
        fill="none"
        opacity="0.12"/>

  <!-- open spiral (archimedean, ${TURNS}턴) -->
  <path d="${d}"
        stroke="url(#spiralStroke)"
        stroke-width="58"
        stroke-linecap="round"
        stroke-linejoin="round"
        fill="none"
        filter="url(#spiralGlow)"/>

  <!-- calm center -->
  <circle cx="${CENTER}" cy="${CENTER}" r="18" fill="#ffffff" opacity="0.9"/>
  <circle cx="${CENTER}" cy="${CENTER}" r="38" fill="none" stroke="#ffffff" stroke-width="3" opacity="0.2"/>
</svg>
`;
}

async function main() {
  const buildDir = path.resolve("electron/build");
  fs.mkdirSync(buildDir, { recursive: true });
  const svgPath = path.join(buildDir, "icon.svg");
  fs.writeFileSync(svgPath, svg(), "utf-8");
  console.log(`✓ ${svgPath}`);

  // 가능하면 @resvg/resvg-js로 PNG도 같이 생성. 없으면 SVG만.
  try {
    const { Resvg } = await import("@resvg/resvg-js");
    const png = new Resvg(svg(), { fitTo: { mode: "width", value: SIZE } })
      .render()
      .asPng();
    const pngPath = path.join(buildDir, "icon.png");
    fs.writeFileSync(pngPath, png);
    console.log(`✓ ${pngPath} (${SIZE}x${SIZE})`);
  } catch (err) {
    console.log(
      "ℹ @resvg/resvg-js 없음 — SVG만 생성됨. PNG 만들려면: pnpm add -D @resvg/resvg-js",
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
