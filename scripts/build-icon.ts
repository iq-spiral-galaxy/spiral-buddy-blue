// 앱 아이콘 생성기:
//   1. 정확한 archimedean spiral 좌표 계산
//   2. SVG 문자열 생성 (옵시디언 보라 + 클로드 오렌지 + cyan 나선)
//   3. (선택) 1024 PNG 출력 — @resvg/resvg-js가 있으면 사용
//
// 출력: electron/build/icon.svg, electron/build/icon.png

import fs from "node:fs";
import path from "node:path";

const SIZE = 1024;
const CENTER = SIZE / 2;

// Archimedean spiral: r(θ) = a + b·θ
// 5턴 (θ: 0 → 10π), 시작 위에서 (-90° offset)
const TURNS = 4.5;
const POINTS = 600; // 부드러움
const B = (SIZE * 0.42) / (TURNS * 2 * Math.PI);
const OFFSET = -Math.PI / 2;

function spiralPath(): string {
  const cmds: string[] = [];
  for (let i = 0; i <= POINTS; i++) {
    const t = i / POINTS;
    const theta = t * TURNS * 2 * Math.PI;
    const r = B * theta;
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
  <!-- Spiral Buddy icon: 옵시디언 보라 + 클로드 오렌지 + cyan 나선형 -->
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#8b7ce0"/>
      <stop offset="42%" stop-color="#5d4eb8"/>
      <stop offset="100%" stop-color="#1e1342"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="48%" r="60%">
      <stop offset="0%"  stop-color="#ffc99b" stop-opacity="0.55"/>
      <stop offset="35%" stop-color="#e88752" stop-opacity="0.32"/>
      <stop offset="70%" stop-color="#cc785c" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="#cc785c" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="rim" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%"  stop-color="#ffffff" stop-opacity="0.22"/>
      <stop offset="40%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="spiralStroke" x1="20%" y1="0%" x2="80%" y2="100%">
      <stop offset="0%"   stop-color="#7ee2ff"/>
      <stop offset="35%"  stop-color="#ffffff"/>
      <stop offset="68%"  stop-color="#ffd4a8"/>
      <stop offset="100%" stop-color="#ff8a5b"/>
    </linearGradient>
    <filter id="spiralGlow" x="-15%" y="-15%" width="130%" height="130%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur"/>
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
  <!-- 클로드 오렌지 글로우 -->
  <circle cx="${CENTER}" cy="${CENTER - 12}" r="450" fill="url(#glow)"/>

  <!-- 나선 (archimedean, ${TURNS}턴) -->
  <path d="${d}"
        stroke="url(#spiralStroke)"
        stroke-width="58"
        stroke-linecap="round"
        stroke-linejoin="round"
        fill="none"
        filter="url(#spiralGlow)"/>

  <!-- 나선 중앙 강조 점 (작은 발광) -->
  <circle cx="${CENTER}" cy="${CENTER}" r="14" fill="#ffffff" opacity="0.85"/>
  <circle cx="${CENTER}" cy="${CENTER}" r="22" fill="none" stroke="#ffffff" stroke-width="2" opacity="0.4"/>
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
