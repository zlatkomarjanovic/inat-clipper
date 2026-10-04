import { app, BrowserWindow, dialog, ipcMain, protocol, screen, shell } from "electron";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const tsxCli = require.resolve("tsx/cli");
const cliScript = path.join(root, "src", "cli.ts");

let running = null;
let tracking = null;

protocol.registerSchemesAsPrivileged([
  {
    scheme: "media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
      corsEnabled: true,
    },
  },
]);

function mediaType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".mkv") return "video/x-matroska";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "video/mp4";
}

function isMediaFile(filePath) {
  return [".mp4", ".webm", ".mov", ".mkv", ".m4v", ".png", ".jpg", ".jpeg", ".webp"].includes(path.extname(filePath).toLowerCase());
}

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
  } catch {
    return {
      outputDir: path.join(app.getPath("desktop"), "inat-clips"),
      mode: "basic",
      sourceKind: "youtube",
      framePreset: "9:16",
      outW: 1080,
      outH: 1920,
    };
  }
}

function createWindow() {
  const area = screen.getPrimaryDisplay().workArea;
  const width = Math.min(area.width, Math.max(1480, Math.round(area.width * 0.52)));
  const height = Math.min(area.height, Math.max(860, Math.round(area.height * 0.9)));
  const win = new BrowserWindow({
    width,
    height,
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    minWidth: 1200,
    minHeight: 760,
    show: false,
    backgroundColor: "#0e0f0c",
    title: "Inat Clipper",
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#0e0f0c",
      symbolColor: "#f4f1e8",
      height: 42,
    },
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.setMenuBarVisibility(false);
  win.once("ready-to-show", () => win.show());
  win.loadFile(path.join(here, "index.html"));
}

app.setAppUserModelId("com.inatbosanski.clipper");

function listHistory() {
  const jobsDir = path.join(root, "workspace", "jobs");
  if (!fs.existsSync(jobsDir)) return [];
  const items = [];
  for (const name of fs.readdirSync(jobsDir)) {
    const dir = path.join(jobsDir, name);
    const jobPath = path.join(dir, "job.json");
    if (!fs.existsSync(jobPath)) continue;
    try {
      const job = JSON.parse(fs.readFileSync(jobPath, "utf8"));
      const validatedPath = path.join(dir, "candidates", "candidates.validated.json");
      let clips = [];
      if (fs.existsSync(validatedPath)) {
        const validated = JSON.parse(fs.readFileSync(validatedPath, "utf8"));
        if (Array.isArray(validated)) {
          clips = validated.map((clip) => ({
            id: clip.id,
            title: clip.title || "Cut",
            hook: clip.hook || "",
            start: clip.start_seconds,
            end: clip.end_seconds,
            score: clip.viral_score || 0,
          })).filter((clip) => Number.isFinite(clip.start) && Number.isFinite(clip.end));
        }
      }
      const sourcePath = typeof job.sourcePath === "string" ? job.sourcePath : "";
      items.push({
        workDir: dir,
        title: job.title || job.input || name,
        createdAt: job.createdAt || "",
        duration: job.probe?.durationSeconds || 0,
        width: job.probe?.width || 0,
        height: job.probe?.height || 0,
        sourcePath,
        sourceReady: Boolean(sourcePath && fs.existsSync(sourcePath)),
        mediaUrl: sourcePath && fs.existsSync(sourcePath) ? `media://clip/play?path=${encodeURIComponent(sourcePath)}` : "",
        clipCount: clips.length,
        clips,
      });
    } catch {
      // Skip a broken job folder.
    }
  }
  items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return items.slice(0, 40);
}

function runCli(event, args, slot = "job") {
  if (slot === "job" && running) return Promise.resolve({ ok: false, error: "A clip is already running." });
  if (slot === "track" && tracking) {
    tracking.kill();
    tracking = null;
  }

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [tsxCli, cliScript, ...args], {
      cwd: root,
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    if (slot === "track") tracking = child;
    else running = child;

    let pending = "";
    let stderr = "";
    let result = null;

    const takeLine = (line) => {
      if (line.startsWith("STATUS\t")) event.sender.send(slot === "track" ? "track-status" : "job-status", line.slice(7));
      else if (line.startsWith("RESULT\t")) {
        try {
          result = JSON.parse(line.slice(7));
        } catch {
          stderr += "\nCould not read the clip result.";
        }
      }
    };

    const clear = () => {
      if (slot === "track") {
        if (tracking === child) tracking = null;
      } else if (running === child) running = null;
    };

    child.stdout.on("data", (buf) => {
      pending += buf.toString();
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) takeLine(line);
    });
    child.stderr.on("data", (buf) => {
      stderr += buf.toString();
    });
    child.on("error", (err) => {
      clear();
      resolve({ ok: false, error: err.message });
    });
    child.on("close", (code) => {
      clear();
      if (pending.trim()) takeLine(pending.trim());
      if (code === 0 && result) resolve({ ok: true, result });
      else resolve({ ok: false, error: stderr.trim().slice(-1800) || "The clip run failed." });
    });
  });
}

app.whenReady().then(() => {
  protocol.handle("media", (request) => {
    const filePath = new URL(request.url).searchParams.get("path");
    if (!filePath || !isMediaFile(filePath) || !fs.existsSync(filePath)) {
      return new Response("Not found", { status: 404 });
    }
    const stat = fs.statSync(filePath);
    const type = mediaType(filePath);
    const range = request.headers.get("range");
    if (!range) {
      return new Response(Readable.toWeb(fs.createReadStream(filePath)), {
        headers: {
          "Content-Type": type,
          "Content-Length": String(stat.size),
          "Accept-Ranges": "bytes",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
    const match = /bytes=(\d+)-(\d*)/.exec(range);
    const start = match ? Number(match[1]) : 0;
    const end = match && match[2] ? Number(match[2]) : stat.size - 1;
    return new Response(Readable.toWeb(fs.createReadStream(filePath, { start, end })), {
      status: 206,
      headers: {
        "Content-Type": type,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": "*",
      },
    });
  });

  ipcMain.handle("load-settings", () => readSettings());

  ipcMain.handle("save-settings", (_event, settings) => {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
    return true;
  });

  ipcMain.handle("pick-video", async () => {
    const current = readSettings();
    const result = await dialog.showOpenDialog({
      title: "Choose a video",
      defaultPath: current.lastVideoDir,
      properties: ["openFile"],
      filters: [{ name: "Video", extensions: ["mp4", "webm", "mov", "mkv", "m4v"] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("pick-image", async () => {
    const result = await dialog.showOpenDialog({
      title: "Choose a watermark image",
      properties: ["openFile"],
      filters: [{ name: "Image", extensions: ["png", "webp", "jpg", "jpeg"] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("pick-folder", async () => {
    const current = readSettings();
    const result = await dialog.showOpenDialog({
      title: "Choose the output folder",
      defaultPath: current.outputDir,
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("open-path", async (_event, target) => {
    if (typeof target !== "string" || !target) return false;
    const error = await shell.openPath(target);
    return !error;
  });

  ipcMain.handle("start-job", (event, job) => {
    if (!job?.input || !job?.outputDir) {
      return { ok: false, error: "Add a video and an output folder." };
    }
    const mode = job.mode === "advanced" ? "advanced" : "basic";
    const args = [job.input, "--out", job.outputDir, "--mode", mode, "--analyze-only", "--progress"];
    if (job.manual) args.push("--manual");
    if (typeof job.name === "string" && job.name.trim()) args.push("--name", job.name.trim());
    return runCli(event, args).then((response) => {
      if (response.ok && response.result?.sourcePath) {
        response.result.mediaUrl = `media://clip/play?path=${encodeURIComponent(response.result.sourcePath)}`;
      }
      return response;
    });
  });

  ipcMain.handle("export-job", (event, payload) => {
    if (!payload?.workDir || !Array.isArray(payload.clips) || payload.clips.length === 0) {
      return { ok: false, error: "There are no cuts to export." };
    }
    const filePath = path.join(root, "workspace", "export-request.json");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(payload));
    return runCli(event, ["--export-file", filePath, "--progress"]);
  });

  ipcMain.handle("list-history", () => listHistory());

  ipcMain.handle("filmstrip", async (_event, payload) => {
    const workDir = payload?.workDir;
    const sourcePath = payload?.sourcePath;
    const duration = Number(payload?.duration);
    if (typeof workDir !== "string" || typeof sourcePath !== "string" || !fs.existsSync(sourcePath) || !Number.isFinite(duration) || duration <= 0) {
      return { ok: false };
    }
    const dir = path.join(workDir, "filmstrip");
    const manifestPath = path.join(dir, "manifest.json");
    const toUrl = (file) => `media://clip/play?path=${encodeURIComponent(file)}`;
    if (fs.existsSync(manifestPath)) {
      try {
        const saved = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        if (saved.sourcePath === sourcePath && Array.isArray(saved.frames) && saved.frames.length && saved.frames.every((frame) => fs.existsSync(frame.file))) {
          return { ok: true, frames: saved.frames.map((frame) => ({ t: frame.t, url: toUrl(frame.file) })) };
        }
      } catch {
        // Build the strip again.
      }
    }
    fs.mkdirSync(dir, { recursive: true });
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith(".jpg")) fs.rmSync(path.join(dir, name), { force: true });
    }
    const count = Math.min(72, Math.max(16, Math.round(duration / 2)));
    const fps = count / duration;
    const code = await new Promise((resolve) => {
      const child = spawn("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-an",
        "-sn",
        "-i",
        sourcePath,
        "-vf",
        `fps=${fps},scale=160:-2:flags=fast_bilinear`,
        "-q:v",
        "8",
        path.join(dir, "f%04d.jpg"),
      ], { windowsHide: true });
      child.on("error", () => resolve(1));
      child.on("close", (status) => resolve(status ?? 1));
    });
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith(".jpg")).sort() : [];
    if (code !== 0 || !files.length) return { ok: false };
    const step = duration / files.length;
    const frames = files.map((name, index) => ({ t: index * step, file: path.join(dir, name) }));
    fs.writeFileSync(manifestPath, JSON.stringify({ sourcePath, frames }));
    return { ok: true, frames: frames.map((frame) => ({ t: frame.t, url: toUrl(frame.file) })) };
  });

  ipcMain.handle("track-job", (event, payload) => {
    const workDir = payload?.workDir;
    const sourcePath = payload?.sourcePath;
    if (typeof workDir !== "string" || typeof sourcePath !== "string" || !fs.existsSync(sourcePath)) {
      return { ok: false, error: "The video is missing." };
    }
    const saved = path.join(workDir, "track.json");
    if (fs.existsSync(saved)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(saved, "utf8"));
        if (Array.isArray(parsed.points) && parsed.points.length) return { ok: true, result: parsed };
      } catch {
        // Track it again.
      }
    }
    return runCli(event, ["--track", sourcePath, "--progress"], "track").then((response) => {
      if (response.ok && Array.isArray(response.result?.points) && response.result.points.length) {
        try {
          fs.writeFileSync(saved, JSON.stringify(response.result));
        } catch {
          // The editor can still use the points from this run.
        }
      }
      return response;
    });
  });

  createWindow();
});

app.on("window-all-closed", () => {
  if (running) running.kill();
  if (tracking) tracking.kill();
  app.quit();
});
