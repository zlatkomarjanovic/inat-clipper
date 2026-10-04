import fs from "node:fs";
import path from "node:path";
import { config, ensureWorkspace, paths } from "./config.js";
import { downloadFromUrl, useLocalVideo } from "./download.js";
import type { OverlaySpec } from "./ass.js";
import { concatClips, renderClip } from "./ffmpeg-cut.js";
import { HARD_MAX_CLIP_SECONDS, type FrameSpec, type TrackPoint } from "./frame.js";
import { analyzeVideoForClips, writeClickbait, type ClickbaitCopy } from "./openrouter.js";
import { probeVideo } from "./probe.js";
import { videoForAnalysis } from "./proxy.js";
import type { ClipResponse } from "./schema.js";
import { cuesForWindow, parseSubtitleFile, pickSubtitleFile, writeTranscriptVtt, type Cue } from "./subs.js";
import {
  isLocalVideoPath,
  looksLikeUrl,
  safeFolderName,
  slugify,
  timestampFolder,
  writeJson,
} from "./utils.js";
import { validateAndNormalizeClips } from "./validate-clips.js";

export type ClipMode = "basic" | "advanced";
export type TranscriptSource = "captions" | "model" | "none";

export type RunClipJobInput = {
  input: string;
  outputDir?: string;
  name?: string;
  mode?: ClipMode;
  analyzeOnly?: boolean;
  manual?: boolean;
  onStatus?: (message: string) => void;
};

export type AnalysisClip = {
  id: string;
  title: string;
  hook: string;
  start: number;
  end: number;
  score: number;
};

export type AnalysisResult = {
  workDir: string;
  sourcePath: string;
  title: string | null;
  duration: number;
  width: number;
  height: number;
  transcriptSource: TranscriptSource;
  cueCount: number;
  clips: AnalysisClip[];
  manual?: boolean;
};

export type ExportClipInput = {
  id?: string;
  title: string;
  hook?: string;
  start: number;
  end: number;
  score?: number;
};

export type ExportJobInput = {
  workDir: string;
  outputDir?: string;
  name?: string;
  mode?: ClipMode;
  width?: number;
  height?: number;
  crop?: { x: number; y: number; w: number; h: number };
  mix?: boolean;
  watermarkText?: string;
  watermarkCorner?: OverlaySpec["watermarkCorner"];
  overlayText?: string;
  overlayPlace?: OverlaySpec["overlayPlace"];
  watermarkImage?: string;
  logoBox?: { x: number; y: number; w: number };
  watermarkPos?: { x: number; y: number };
  titlePos?: { x: number; y: number };
  follow?: boolean;
  track?: TrackPoint[];
  single?: boolean;
  clips: ExportClipInput[];
  onStatus?: (message: string) => void;
};

export type JobClip = {
  title: string;
  file: string;
  start: number;
  end: number;
  score: number;
  captions: boolean;
};

export type JobResult = {
  outputDir: string;
  mode: ClipMode;
  transcriptPath: string | null;
  transcriptSource: TranscriptSource;
  cueCount: number;
  clips: JobClip[];
  mixFile?: string | null;
  mixError?: string | null;
  warnings?: string[];
};

export async function runClipJob(input: RunClipJobInput): Promise<JobResult | AnalysisResult> {
  const source = input.input.trim();
  const mode: ClipMode = input.mode === "advanced" ? "advanced" : "basic";
  const say = (message: string) => input.onStatus?.(message);

  if (!source) throw new Error("Choose a YouTube link or a video file.");

  ensureWorkspace();
  say("Checking the video");

  const jobSlug = `${timestampFolder()}_${slugify(input.name || source, 32)}`;
  const jobDir = path.join(paths.jobs, jobSlug);
  const sourceDir = path.join(jobDir, "source");
  fs.mkdirSync(sourceDir, { recursive: true });

  let download;
  if (looksLikeUrl(source)) {
    say("Downloading");
    download = await downloadFromUrl(source, sourceDir, say);
  } else if (isLocalVideoPath(source)) {
    say("Using the local video");
    download = useLocalVideo(source);
  } else {
    throw new Error("Use a YouTube link or a local video file (.mp4, .webm, .mov, .mkv).");
  }

  const probe = probeVideo(download.sourcePath);
  const folderName = safeFolderName(input.name?.trim() || download.title || "clips");
  const clipsRoot = path.join(jobDir, "clips");
  fs.mkdirSync(clipsRoot, { recursive: true });

  writeJson(path.join(jobDir, "job.json"), {
    app: "inat-clipper",
    status: "analyzing",
    createdAt: new Date().toISOString(),
    input: source,
    sourceUrl: download.sourceUrl,
    title: download.title ?? null,
    mode,
    model: config.model,
    probe,
    sourcePath: download.sourcePath,
  });

  say("Reading the transcript");
  let cues = looksLikeUrl(source)
    ? readDownloadedCaptions(sourceDir)
    : readSidecarCaptions(download.sourcePath);
  let transcriptSource: TranscriptSource = cues.length ? "captions" : "none";

  let validated: ReturnType<typeof validateAndNormalizeClips> = [];
  if (input.manual) {
    say("Opening the video");
  } else {
    const analysisPath = looksLikeUrl(source)
      ? download.sourcePath
      : await videoForAnalysis(download.sourcePath, sourceDir, probe.durationSeconds, say);
    say("Watching the video");
    const raw = await analyzeVideoForClips({
      sourceUrl: download.sourceUrl,
      localPath: analysisPath,
      durationSeconds: probe.durationSeconds,
      maxClips: config.maxClips,
      includeTranscript: cues.length === 0,
    });

    if (cues.length === 0) {
      cues = cuesFromModel(raw);
      if (cues.length) transcriptSource = "model";
    }

    writeJson(path.join(jobDir, "candidates", "candidates.raw.json"), raw);
    validated = validateAndNormalizeClips(raw.clips, probe.durationSeconds, cues);
    writeJson(path.join(jobDir, "candidates", "candidates.validated.json"), validated);

    if (analysisPath !== download.sourcePath) fs.rmSync(analysisPath, { force: true });
  }

  const workTranscript = cues.length ? path.join(jobDir, "transcript.vtt") : null;
  if (workTranscript) {
    writeTranscriptVtt(workTranscript, cues);
    writeJson(path.join(jobDir, "transcript.json"), {
      source: transcriptSource,
      cueCount: cues.length,
      cues,
    });
  }

  const analysis: AnalysisResult = {
    workDir: jobDir,
    sourcePath: download.sourcePath,
    title: download.title ?? null,
    duration: probe.durationSeconds,
    width: probe.width ?? 0,
    height: probe.height ?? 0,
    transcriptSource,
    cueCount: cues.length,
    clips: validated.map((clip) => ({
      id: clip.id,
      title: clip.title,
      hook: clip.hook,
      start: clip.start_seconds,
      end: clip.end_seconds,
      score: clip.viral_score,
    })),
    manual: Boolean(input.manual),
  };

  if (input.analyzeOnly) {
    say("Ready to edit");
    return analysis;
  }

  return exportClipJob({
    workDir: jobDir,
    outputDir: input.outputDir,
    name: folderName,
    mode,
    clips: analysis.clips,
    onStatus: say,
  });
}

export async function exportClipJob(input: ExportJobInput): Promise<JobResult> {
  const say = (message: string) => input.onStatus?.(message);
  const job = JSON.parse(fs.readFileSync(path.join(input.workDir, "job.json"), "utf8")) as {
    sourcePath?: string;
    sourceUrl?: string;
    title?: string | null;
    input?: string;
    probe?: { width?: number; height?: number; durationSeconds?: number };
  };
  const sourcePath = job.sourcePath;
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error("The source video for this edit is missing. Find the clips again.");
  }

  const mode: ClipMode = input.mode === "advanced" ? "advanced" : "basic";
  const duration = job.probe?.durationSeconds ?? Number.POSITIVE_INFINITY;
  const sourceWidth = job.probe?.width ?? 0;
  const sourceHeight = job.probe?.height ?? 0;
  const frame: FrameSpec | undefined =
    input.width && input.height && sourceWidth && sourceHeight
      ? {
          width: input.width,
          height: input.height,
          crop: input.crop,
        }
      : undefined;
  const track = input.follow === false ? undefined : cleanTrack(input.track);
  const overlays: OverlaySpec = {
    watermarkText: cleanOverlay(input.watermarkText),
    watermarkCorner: cornerOf(input.watermarkCorner),
    overlayText: cleanOverlay(input.overlayText),
    overlayPlace: placeOf(input.overlayPlace),
    watermarkPos: fracPoint(input.watermarkPos),
    titlePos: fracPoint(input.titlePos),
    logoBox: fracBox(input.logoBox),
  };
  const watermarkImage = imageFile(input.watermarkImage);

  const cues = readSavedCues(input.workDir);
  const folderName = safeFolderName(input.name?.trim() || job.title || "clips");
  const clipsRoot = path.join(input.workDir, "clips");
  if (!input.single) fs.rmSync(clipsRoot, { recursive: true, force: true });
  fs.mkdirSync(clipsRoot, { recursive: true });

  if (mode === "advanced" && cues.length === 0) {
    say("No transcript lines, so the clips are clean cuts");
  }

  const seen = new Set<string>();
  const clips: JobClip[] = [];
  const made: Array<{
    id: string;
    dir: string;
    title: string;
    hook: string;
    start: number;
    end: number;
  }> = [];
  const warnings: string[] = [];
  const usable = input.clips.filter((clip) => Number.isFinite(clip.start) && Number.isFinite(clip.end));

  for (const [index, rawClip] of usable.entries()) {
    let start = Math.max(0, rawClip.start);
    let end = Math.min(duration, rawClip.end);
    if (end - start < 3) continue;
    if (end - start > HARD_MAX_CLIP_SECONDS) end = start + HARD_MAX_CLIP_SECONDS;

    const title = rawClip.title?.trim() || `Clip ${index + 1}`;
    let slug = slugify(rawClip.id || `${index + 1}-${title}`);
    let n = 2;
    while (seen.has(slug)) slug = `${slugify(rawClip.id || title)}-${n++}`;
    seen.add(slug);

    const clip = {
      id: rawClip.id || `clip-${index + 1}`,
      start_seconds: round3(start),
      end_seconds: round3(end),
      viral_score: rawClip.score ?? 0,
      title,
      hook: rawClip.hook?.trim() || title,
      reason: "Edited before export",
      tags: [] as string[],
      platforms: [] as string[],
      folderSlug: slug,
    };

    say(`Exporting ${index + 1} of ${usable.length}`);
    const outFile = path.join(clipsRoot, slug, "clip.mp4");
    const windowCues = cuesForWindow(cues, clip.start_seconds, clip.end_seconds);
    const withCaptions = mode === "advanced" && windowCues.length > 0;
    try {
      renderClip(sourcePath, clip, outFile, {
        cues: withCaptions ? windowCues : [],
        frame,
        sourceWidth,
        sourceHeight,
        overlays,
        watermarkImage,
        track,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message.split("\n")[0] : "Render failed";
      warnings.push(`${title}: ${message.slice(0, 180)}`);
      continue;
    }

    writeJson(path.join(clipsRoot, slug, "meta.json"), {
      ...clip,
      source: job.sourceUrl ?? sourcePath,
      duration_seconds: clip.end_seconds - clip.start_seconds,
      captions: withCaptions,
      frame: frame ?? null,
    });

    made.push({
      id: clip.id,
      dir: path.join(clipsRoot, slug),
      title: clip.title,
      hook: clip.hook,
      start: clip.start_seconds,
      end: clip.end_seconds,
    });

    clips.push({
      title: clip.title,
      file: outFile,
      start: clip.start_seconds,
      end: clip.end_seconds,
      score: clip.viral_score,
      captions: withCaptions,
    });
  }

  if (clips.length === 0) {
    throw new Error(warnings[0] || "None of the cuts are long enough to export.");
  }

  say("Writing titles and hashtags");
  const copies = await loadClickbait(job.title ?? "", made.map((item) => ({
    id: item.id,
    title: item.title,
    transcript: cuesForWindow(cues, item.start, item.end).map((cue) => cue.text).join(" "),
  })));
  made.forEach((item, index) => {
    const copy = copies.get(item.id) ?? fallbackCopy(item.title, item.hook);
    writeCopyFiles(item.dir, copy);
    const metaPath = path.join(item.dir, "meta.json");
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as Record<string, unknown>;
    meta.title = copy.title;
    meta.description = copy.description;
    meta.tags = copy.tags;
    meta.hashtags = copy.hashtags;
    writeJson(metaPath, meta);
    if (clips[index]) clips[index].title = copy.title;
  });

  let mixError: string | null = null;
  if (input.mix && !input.single && clips.length > 1) {
    say("Mixing the cuts");
    try {
      concatClips(clips.map((clip) => clip.file), path.join(clipsRoot, "mix", "mix.mp4"));
    } catch (error) {
      console.error(error);
      mixError = "The cuts exported separately. Mixing them into one video failed.";
    }
  }

  const savedTranscript = cues.length ? path.join(input.workDir, "transcript.vtt") : null;
  const published = input.outputDir
    ? publish(input.workDir, clips, claimFolder(path.resolve(input.outputDir), folderName), Boolean(input.single))
    : { outputDir: clipsRoot, clips, transcriptPath: savedTranscript };

  const result: JobResult = {
    outputDir: published.outputDir,
    mode,
    transcriptPath: published.transcriptPath,
    transcriptSource: savedTranscript ? readTranscriptSource(input.workDir) : "none",
    cueCount: cues.length,
    clips: published.clips,
    mixFile: mixPath(published.outputDir),
    mixError,
    warnings,
  };

  writeJson(path.join(published.outputDir, "job.json"), {
    app: "inat-clipper",
    status: "ready",
    createdAt: new Date().toISOString(),
    input: job.input ?? sourcePath,
    title: job.title ?? null,
    mode,
    frame: frame ?? null,
    outputDir: published.outputDir,
    transcriptPath: published.transcriptPath,
    transcriptSource: result.transcriptSource,
    cueCount: cues.length,
    clipCount: countExported(published.outputDir),
  });

  say("Done");
  return result;
}

function cleanTrack(value?: TrackPoint[]): TrackPoint[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const points = value
    .map((point) => ({ t: Number(point?.t), x: Number(point?.x), y: Number(point?.y) }))
    .filter((point) => Number.isFinite(point.t) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1)
    .sort((a, b) => a.t - b.t);
  return points.length > 1 ? points : undefined;
}

function countExported(dir: string) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((name) => fs.existsSync(path.join(dir, name, "clip.mp4"))).length;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function fracPoint(value?: { x?: number; y?: number }) {
  const x = value?.x;
  const y = value?.y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x: clamp01(x as number), y: clamp01(y as number) };
}

function fracBox(value?: { x?: number; y?: number; w?: number }) {
  const x = value?.x;
  const y = value?.y;
  const w = value?.w;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w)) return undefined;
  return { x: clamp01(x as number), y: clamp01(y as number), w: Math.min(0.8, Math.max(0.04, w as number)) };
}

function fallbackCopy(title: string, hook: string): ClickbaitCopy {
  return {
    title: title || "Cut",
    description: hook || title || "Cut",
    tags: ["inat bosanski"],
    hashtags: ["#InatBosanski", "#Shorts"],
  };
}

async function loadClickbait(
  videoTitle: string,
  clips: Array<{ id: string; title: string; transcript: string }>,
): Promise<Map<string, ClickbaitCopy>> {
  if (!config.openRouterKey || clips.length === 0) return new Map();
  try {
    return await writeClickbait(videoTitle, clips);
  } catch (error) {
    console.error(error);
    return new Map();
  }
}

function writeCopyFiles(dir: string, copy: ClickbaitCopy) {
  fs.writeFileSync(path.join(dir, "title.txt"), `${copy.title}\n`, "utf8");
  fs.writeFileSync(path.join(dir, "description.txt"), `${copy.description.trim()}\n`, "utf8");
  fs.writeFileSync(path.join(dir, "tags.txt"), `${copy.tags.join("\n")}\n`, "utf8");
  fs.writeFileSync(path.join(dir, "hashtags.txt"), `${copy.hashtags.join("\n")}\n`, "utf8");
}

function cleanOverlay(value?: string): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
}

function cornerOf(value?: string): OverlaySpec["watermarkCorner"] {
  if (value === "tl" || value === "tr" || value === "bl" || value === "br") return value;
  return "br";
}

function placeOf(value?: string): OverlaySpec["overlayPlace"] {
  if (value === "top" || value === "middle" || value === "bottom") return value;
  return "top";
}

function imageFile(value?: string): string | undefined {
  if (!value || !fs.existsSync(value)) return undefined;
  if (!/\.(png|jpe?g|webp)$/i.test(value)) return undefined;
  return value;
}

function mixPath(dir: string): string | null {
  const file = path.join(dir, "mix", "mix.mp4");
  return fs.existsSync(file) ? file : null;
}

function round3(value: number) {
  return Math.round(value * 1000) / 1000;
}

function readSavedCues(workDir: string): Cue[] {
  const filePath = path.join(workDir, "transcript.json");
  if (!fs.existsSync(filePath)) return [];
  try {
    const saved = JSON.parse(fs.readFileSync(filePath, "utf8")) as { cues?: Cue[] };
    return Array.isArray(saved.cues) ? saved.cues : [];
  } catch {
    return [];
  }
}

function readTranscriptSource(workDir: string): TranscriptSource {
  const filePath = path.join(workDir, "transcript.json");
  try {
    const saved = JSON.parse(fs.readFileSync(filePath, "utf8")) as { source?: TranscriptSource };
    if (saved.source === "captions" || saved.source === "model") return saved.source;
  } catch {
    // Fall through to none.
  }
  return "none";
}

function readDownloadedCaptions(dir: string): Cue[] {
  const picked = pickSubtitleFile(dir);
  return picked ? parseSubtitleFile(picked) : [];
}

function readSidecarCaptions(videoPath: string): Cue[] {
  const parent = path.dirname(videoPath);
  const base = path.basename(videoPath, path.extname(videoPath)).toLowerCase();
  if (!fs.existsSync(parent)) return [];
  const sidecar = fs.readdirSync(parent).find((file) => {
    const lower = file.toLowerCase();
    return lower.startsWith(base) && /\.(vtt|srt)$/i.test(lower);
  });
  return sidecar ? parseSubtitleFile(path.join(parent, sidecar)) : [];
}

function cuesFromModel(raw: ClipResponse): Cue[] {
  return raw.transcript
    .map((cue) => ({
      start: cue.start_seconds ?? -1,
      end: cue.end_seconds ?? -1,
      text: (cue.text ?? "").replace(/\s+/g, " ").trim(),
    }))
    .filter((cue) => cue.text.length > 0 && cue.start >= 0 && cue.end > cue.start);
}

function claimFolder(parent: string, name: string): string {
  fs.mkdirSync(parent, { recursive: true });
  const scores = [name, ...Array.from({ length: 20 }, (_, index) => `${name} ${index + 2}`)];
  for (const candidateName of scores) {
    const candidate = path.join(parent, candidateName);
    if (!fs.existsSync(candidate)) return candidate;
    if (isOurFolder(candidate)) return candidate;
  }
  return path.join(parent, `${name} ${timestampFolder()}`);
}

function isOurFolder(dir: string): boolean {
  const jobPath = path.join(dir, "job.json");
  if (!fs.existsSync(jobPath)) return false;
  try {
    const job = JSON.parse(fs.readFileSync(jobPath, "utf8")) as { app?: string };
    return job.app === "inat-clipper";
  } catch {
    return false;
  }
}

function publish(jobDir: string, clips: JobClip[], dest: string, single = false) {
  fs.mkdirSync(dest, { recursive: true });
  if (!single && isOurFolder(dest)) {
    for (const entry of fs.readdirSync(dest)) {
      fs.rmSync(path.join(dest, entry), { recursive: true, force: true });
    }
  }

  const clipsRoot = path.join(jobDir, "clips");
  const names = single
    ? clips.map((clip) => path.basename(path.dirname(clip.file)))
    : fs.readdirSync(clipsRoot);
  for (const entry of names) {
    const from = path.join(clipsRoot, entry);
    if (!fs.existsSync(from)) continue;
    const to = path.join(dest, entry);
    if (single) fs.rmSync(to, { recursive: true, force: true });
    fs.cpSync(from, to, { recursive: true });
  }

  let transcriptPath: string | null = null;
  const vtt = path.join(jobDir, "transcript.vtt");
  const json = path.join(jobDir, "transcript.json");
  if (fs.existsSync(vtt)) {
    transcriptPath = path.join(dest, "transcript.vtt");
    fs.copyFileSync(vtt, transcriptPath);
  }
  if (fs.existsSync(json)) fs.copyFileSync(json, path.join(dest, "transcript.json"));

  return {
    outputDir: dest,
    transcriptPath,
    clips: clips.map((clip) => ({
      ...clip,
      file: path.join(dest, path.basename(path.dirname(clip.file)), "clip.mp4"),
    })),
  };
}
