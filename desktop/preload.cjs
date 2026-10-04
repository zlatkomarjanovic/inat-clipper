const { contextBridge, ipcRenderer } = require("electron");

let statusListener = null;
let trackListener = null;

contextBridge.exposeInMainWorld("clipper", {
  pickVideo: () => ipcRenderer.invoke("pick-video"),
  pickImage: () => ipcRenderer.invoke("pick-image"),
  pickFolder: () => ipcRenderer.invoke("pick-folder"),
  loadSettings: () => ipcRenderer.invoke("load-settings"),
  saveSettings: (settings) => ipcRenderer.invoke("save-settings", settings),
  startJob: (job) => ipcRenderer.invoke("start-job", job),
  exportJob: (payload) => ipcRenderer.invoke("export-job", payload),
  listHistory: () => ipcRenderer.invoke("list-history"),
  trackJob: (payload) => ipcRenderer.invoke("track-job", payload),
  filmstrip: (payload) => ipcRenderer.invoke("filmstrip", payload),
  openPath: (target) => ipcRenderer.invoke("open-path", target),
  onStatus: (callback) => {
    if (statusListener) ipcRenderer.removeListener("job-status", statusListener);
    statusListener = (_event, message) => callback(message);
    ipcRenderer.on("job-status", statusListener);
  },
  clearStatus: () => {
    if (statusListener) ipcRenderer.removeListener("job-status", statusListener);
    statusListener = null;
  },
  onTrack: (callback) => {
    if (trackListener) ipcRenderer.removeListener("track-status", trackListener);
    trackListener = (_event, message) => callback(message);
    ipcRenderer.on("track-status", trackListener);
  },
});
