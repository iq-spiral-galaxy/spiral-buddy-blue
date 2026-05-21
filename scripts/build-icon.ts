// 앱 아이콘 생성기:
//   1. 여백이 있는 archimedean spiral 좌표 계산
//   2. SVG 문자열 생성 (quiet slate + muted violet + warm ink)
//   3. 1024 PNG 출력 — @resvg/resvg-js가 있으면 사용
//
// 출력: electron/build/icon.svg, electron/build/icon.png

import fs from "node:fs";
import path from "node:path";

const SIZE = 1024;
const CENTER = SIZE / 2;

// Archimedean spiral: r(θ) = a + b·θ.
// 앱 아이콘 크기에서는 빼곡한 4+턴보다 2턴대의 여백 있는 나선이 더 오래 보기 편하다.
const TURNS = 2.0;
const POINTS = 360;
const START_R = SIZE * 0.055;
const OUTER_R = SIZE * 0.258;
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
  <!-- Spiral Buddy icon: restrained study palette + open spiral -->
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#253246"/>
      <stop offset="52%" stop-color="#1b2232"/>
      <stop offset="100%" stop-color="#111722"/>
    </linearGradient>
    <radialGradient id="glow" cx="58%" cy="62%" r="62%">
      <stop offset="0%"  stop-color="#d8a46f" stop-opacity="0.2"/>
      <stop offset="42%" stop-color="#b77b63" stop-opacity="0.09"/>
      <stop offset="100%" stop-color="#b77b63" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="coolGlow" cx="32%" cy="24%" r="62%">
      <stop offset="0%" stop-color="#9fb6c8" stop-opacity="0.11"/>
      <stop offset="60%" stop-color="#9fb6c8" stop-opacity="0.025"/>
      <stop offset="100%" stop-color="#9fb6c8" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="rim" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%"  stop-color="#ffffff" stop-opacity="0.16"/>
      <stop offset="40%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="spiralStroke" x1="18%" y1="4%" x2="83%" y2="96%">
      <stop offset="0%"   stop-color="#a9bfce"/>
      <stop offset="44%"  stop-color="#c0b4d8"/>
      <stop offset="72%"  stop-color="#d9b98f"/>
      <stop offset="100%" stop-color="#c68463"/>
    </linearGradient>
    <filter id="spiralGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="3.5" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <!-- macOS squircle 근사 (rounded square) -->
  <rect x="0" y="0" width="${SIZE}" height="${SIZE}" rx="220" ry="220" fill="url(#bg)"/>
  <rect x="0" y="0" width="${SIZE}" height="${SIZE}" rx="220" ry="220" fill="url(#rim)"/>
  <circle cx="${CENTER + 38}" cy="${CENTER + 72}" r="460" fill="url(#glow)"/>
  <circle cx="${CENTER - 118}" cy="${CENTER - 138}" r="340" fill="url(#coolGlow)"/>
  <path d="M 242 264 C 348 154 536 112 684 174 C 786 217 846 306 862 414"
        stroke="#ffffff"
        stroke-width="12"
        stroke-linecap="round"
        fill="none"
        opacity="0.045"/>

  <!-- open spiral (archimedean, ${TURNS}턴) -->
  <path d="${d}"
        stroke="url(#spiralStroke)"
        stroke-width="42"
        stroke-linecap="round"
        stroke-linejoin="round"
        fill="none"
        filter="url(#spiralGlow)"
        opacity="0.94"/>

  <!-- calm center -->
  <circle cx="${CENTER}" cy="${CENTER}" r="14" fill="#dfe6e8" opacity="0.86"/>
  <circle cx="${CENTER}" cy="${CENTER}" r="31" fill="none" stroke="#dfe6e8" stroke-width="2.5" opacity="0.16"/>
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
