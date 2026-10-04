import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { buildAss, type OverlaySpec } from "./ass.js";
import { frameFilter, type FrameSpec, type TrackPoint } from "./frame.js";
import type { Cue } from "./subs.js";
import type { ValidatedClip } from "./validate-clips.js";

export function cutClip(sourcePath: string, clip: ValidatedClip, outFile: string) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  const copyArgs = [
    "-hide_banner",
    "-y",
    "-ss",
    String(clip.start_seconds),
    "-to",
    String(clip.end_seconds),
    "-i",
    sourcePath,
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    outFile,
  ];

  let result = spawnSync("ffmpeg", copyArgs, { encoding: "utf-8" });
  if (result.status === 0 && fs.existsSync(outFile) && fs.statSync(outFile).size > 0) {
    return;
  }

  const reencodeArgs = [
    "-hide_banner",
    "-y",
    "-ss",
    String(clip.start_seconds),
    "-to",
    String(clip.end_seconds),
    "-i",
    sourcePath,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    outFile,
  ];

  result = spawnSync("ffmpeg", reencodeArgs, { encoding: "utf-8" });
  if (result.status !== 0 || !fs.existsSync(outFile)) {
    throw new Error(`ffmpeg failed for ${clip.id}:\n${result.stderr || result.stdout}`);
  }
}

export function burnClip(
  sourcePath: string,
  clip: ValidatedClip,
  outFile: string,
  cues: Cue[],
  width?: number,
  height?: number,
) {
  const dir = path.dirname(outFile);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "captions.ass"), buildAss(cues, width ?? 1920, height ?? 1080), "utf8");

  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-y",
      "-ss",
      String(clip.start_seconds),
      "-to",
      String(clip.end_seconds),
      "-i",
      sourcePath,
      "-vf",
      "ass=captions.ass",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-movflags",
      "+faststart",
      "clip.mp4",
    ],
    { cwd: dir, encoding: "utf-8" },
  );

  if (result.status !== 0 || !fs.existsSync(outFile) || fs.statSync(outFile).size === 0) {
    throw new Error(`Could not burn captions for ${clip.id}:\n${(result.stderr || result.stdout || "").slice(-1500)}`);
  }
}

export function renderClip(
  sourcePath: string,
  clip: ValidatedClip,
  outFile: string,
  options: {
    cues?: Cue[];
    frame?: FrameSpec;
    sourceWidth?: number;
    sourceHeight?: number;
    overlays?: OverlaySpec;
    watermarkImage?: string;
    track?: TrackPoint[];
  },
) {
  const cues = options.cues ?? [];
  const frame = options.frame;
  const watermarkImage = options.watermarkImage && fs.existsSync(options.watermarkImage) ? options.watermarkImage : undefined;
  const overlays = options.overlays ? { ...options.overlays, logo: Boolean(watermarkImage) } : undefined;
  const assW = frame?.width ?? options.sourceWidth ?? 1920;
  const assH = frame?.height ?? options.sourceHeight ?? 1080;
  const duration = Math.max(0.4, clip.end_seconds - clip.start_seconds);
  const ass = buildAss(cues, assW, assH, overlays, duration);
  const needsFilter = Boolean(frame) || Boolean(ass) || Boolean(watermarkImage);
  if (!needsFilter) {
    cutClip(sourcePath, clip, outFile);
    return;
  }

  const dir = path.dirname(outFile);
  fs.mkdirSync(dir, { recursive: true });
  const filters: string[] = [];
  if (frame && options.sourceWidth && options.sourceHeight) {
    filters.push(frameFilter(options.sourceWidth, options.sourceHeight, frame, options.track?.length
      ? { points: options.track, start: clip.start_seconds, end: clip.end_seconds }
      : undefined));
  }
  if (ass) {
    fs.writeFileSync(path.join(dir, "captions.ass"), ass, "utf8");
    filters.push("ass=captions.ass");
  }

  const chain = filters.join(",") || "null";
  const encode = [
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-movflags",
    "+faststart",
    path.basename(outFile),
  ];

  const args = [
    "-hide_banner",
    "-y",
    "-ss",
    String(clip.start_seconds),
    "-to",
    String(clip.end_seconds),
    "-i",
    sourcePath,
  ];

  if (watermarkImage) {
    const box = overlays?.logoBox;
    const size = box ? Math.max(24, Math.round(Math.min(0.8, Math.max(0.04, box.w)) * assW)) : Math.max(48, Math.round(assW * 0.18));
    const pos = box
      ? `${Math.round(Math.min(1, Math.max(0, box.x)) * assW)}:${Math.round(Math.min(1, Math.max(0, box.y)) * assH)}`
      : watermarkPosition(overlays?.watermarkCorner);
    args.push(
      "-i",
      watermarkImage,
      "-filter_complex",
      `[0:v]${chain}[base];[1:v]scale=${size}:-1[wm];[base][wm]overlay=${pos}:format=auto[v]`,
      "-map",
      "[v]",
      "-map",
      "0:a?",
      ...encode,
    );
  } else {
    args.push("-vf", chain, ...encode);
  }

  const result = spawnSync("ffmpeg", args, { cwd: dir, encoding: "utf-8" });
  if (result.status !== 0 || !fs.existsSync(outFile) || fs.statSync(outFile).size === 0) {
    throw new Error(`Could not render ${clip.id}:\n${(result.stderr || result.stdout || "").slice(-1500)}`);
  }
}

export function concatClips(files: string[], dest: string) {
  if (files.length < 2) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const listPath = path.join(path.dirname(dest), "concat.txt");
  const lines = files.map((file) => `file '${file.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`);
  fs.writeFileSync(listPath, `${lines.join("\n")}\n`, "utf8");

  const copy = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-movflags", "+faststart", dest],
    { encoding: "utf-8" },
  );
  if (copy.status === 0 && fs.existsSync(dest) && fs.statSync(dest).size > 0) return;

  const inputs = files.flatMap((file) => ["-i", file]);
  const pads = files.map((_, index) => `[${index}:v][${index}:a]`).join("");
  const filter = `${pads}concat=n=${files.length}:v=1:a=1[v][a]`;
  const reencode = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-y",
      ...inputs,
      "-filter_complex",
      filter,
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-movflags",
      "+faststart",
      dest,
    ],
    { encoding: "utf-8" },
  );
  if (reencode.status !== 0 || !fs.existsSync(dest) || fs.statSync(dest).size === 0) {
    fs.rmSync(dest, { force: true });
    throw new Error(`Could not mix the cuts:\n${(reencode.stderr || copy.stderr || "").slice(-1500)}`);
  }
}

function watermarkPosition(corner?: OverlaySpec["watermarkCorner"]): string {
  if (corner === "tl") return "24:24";
  if (corner === "tr") return "W-w-24:24";
  if (corner === "bl") return "24:H-h-24";
  return "W-w-24:H-h-24";
}

export function cutAllClips(sourcePath: string, clips: ValidatedClip[], clipsRoot: string) {
  for (const clip of clips) {
    const dir = path.join(clipsRoot, clip.folderSlug);
    const outFile = path.join(dir, "clip.mp4");
    cutClip(sourcePath, clip, outFile);
  }
}
