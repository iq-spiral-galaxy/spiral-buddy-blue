// electron-builder afterPack hook — macOS Helper 앱을 CFBundleName에 맞게 rename.
//
// v0.5.95 — dock 호버 이름을 "Spiral Buddy Blue"로 띄우기 위한 핵심 조각.
//
// 배경 (실측으로 확정):
// - macOS dock 툴팁은 CFBundleName을 읽는다 (CFBundleDisplayName/.app 파일명 X).
//   v0.5.92(CFBundleName=Blue)→dock "Blue", v0.5.94(CFBundleName=기본)→"Spiral
//   Buddy"로 바뀐 대조가 증거.
// - 그런데 Electron 메인 프로세스는 CFBundleName으로 Helper 앱 이름
//   (`<CFBundleName> Helper.app`)을 유추해 찾는다. 그래서 CFBundleName을
//   "Spiral Buddy Blue"로 두면 "Spiral Buddy Blue Helper.app"을 찾는데,
//   electron-builder는 Helper를 productName 기준 "Spiral Buddy Helper.app"로
//   패키징 → 이름 불일치 → "Unable to find helper app" FATAL(크래시).
//
// 해법: extendInfo로 CFBundleName="Spiral Buddy Blue"를 설정하고, 이 훅에서
// Helper 앱 4종(+executable+Info.plist)을 "Spiral Buddy Blue Helper*"로 rename해
// CFBundleName과 일치시킨다. → dock에 Blue 표시 + 크래시 없음.
//
// 재서명하지 않는다(중요): 린커 서명은 Mach-O에 내장되어 파일명/Info.plist
// 변경으로 깨지지 않고(이 앱은 Sealed Resources 없음), 재서명하면 sealed
// resources가 생겨 macOS 업데이트 스크립트의 cp -R가 seal을 깨 오히려 크래시
// 위험이 생긴다. productName/.app 파일명은 그대로라 자동 업데이트도 유지된다.

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const productFilename = context.packager.appInfo.productFilename; // "Spiral Buddy"
  const appPath = path.join(context.appOutDir, `${productFilename}.app`);
  const plist = path.join(appPath, "Contents", "Info.plist");
  const fw = path.join(appPath, "Contents", "Frameworks");

  // extendInfo로 설정된 메인 CFBundleName 읽기.
  let bundleName;
  try {
    bundleName = execFileSync(
      "/usr/libexec/PlistBuddy",
      ["-c", "Print :CFBundleName", plist],
      { encoding: "utf8" },
    ).trim();
  } catch {
    return;
  }
  // 기본값(productFilename)과 같으면 Helper 이름이 이미 일치 — 할 일 없음.
  if (!bundleName || bundleName === productFilename) return;

  const pbSet = (file, key, val) =>
    execFileSync("/usr/libexec/PlistBuddy", ["-c", `Set :${key} ${val}`, file], {
      stdio: "ignore",
    });

  // Helper 변형 4종: "" / " (GPU)" / " (Plugin)" / " (Renderer)"
  const suffixes = [" (GPU)", " (Plugin)", " (Renderer)", ""];
  let renamed = 0;
  for (const sfx of suffixes) {
    const oldName = `${productFilename} Helper${sfx}`; // "Spiral Buddy Helper (GPU)"
    const newName = `${bundleName} Helper${sfx}`; //      "Spiral Buddy Blue Helper (GPU)"
    const oldApp = path.join(fw, `${oldName}.app`);
    const newApp = path.join(fw, `${newName}.app`);
    if (!fs.existsSync(oldApp)) continue;

    const macos = path.join(oldApp, "Contents", "MacOS");
    fs.renameSync(path.join(macos, oldName), path.join(macos, newName));
    const hplist = path.join(oldApp, "Contents", "Info.plist");
    pbSet(hplist, "CFBundleExecutable", newName);
    try {
      pbSet(hplist, "CFBundleName", newName);
    } catch {}
    fs.renameSync(oldApp, newApp);
    renamed++;
  }

  console.log(
    `[after-pack] ${renamed} helper(s) renamed to "${bundleName} Helper*" (CFBundleName 일치, 재서명 없음)`,
  );
};
