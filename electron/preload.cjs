// 안전한 IPC bridge — setup wizard에서만 사용. 메인 앱(브라우저 영역)에선 fetch /api/*만 사용.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("spiralSetup", {
  getCurrentConfig: () => ipcRenderer.invoke("setup:get-current-config"),
  pickDirectory: (opts) => ipcRenderer.invoke("setup:pick-directory", opts),
  validateAndSave: (cfg) => ipcRenderer.invoke("setup:validate-and-save", cfg),
  openExternal: (url) => ipcRenderer.invoke("app:open-external", url),
  detectVault: () => ipcRenderer.invoke("setup:detect-vault"),
  checkGit: () => ipcRenderer.invoke("setup:check-git"),
  pickParentDir: () => ipcRenderer.invoke("setup:pick-parent-dir"),
  downloadCurated: (args) => ipcRenderer.invoke("setup:download-curated", args),
  onDownloadProgress: (callback) => {
    const wrapper = (_e, payload) => callback(payload);
    ipcRenderer.on("setup:download-progress", wrapper);
    return () => ipcRenderer.removeListener("setup:download-progress", wrapper);
  },
});
