import { spawn } from "node:child_process";
import { probeVideo } from "./probe.js";

export type TrackPoint = { t: number; x: number; y: number };

type Center = { x: number; y: number };

export async function trackAction(
  sourcePath: string,
  onStatus?: (message: string) => void,
): Promise<TrackPoint[]> {
  const probe = probeVideo(sourcePath);
  const duration = probe.durationSeconds;
  const fps = duration > 45 * 60 ? 1 : 2;
  const { width, height } = sampleSize(probe.width ?? 1920, probe.height ?? 1080);
  const frameBytes = width * height * 3;
  const expected = Math.max(1, Math.floor(duration * fps));

  const frames = await readFrames(sourcePath, width, height, fps, frameBytes, expected, onStatus);
  if (frames.length < 2) return [];

  const raw: Array<Center | null> = [];
  let previous: Buffer | null = null;
  for (const frame of frames) {
    raw.push(subjectCenter(frame, previous, width, height));
    previous = frame;
  }

  let x = 0.5;
  let y = 0.5;
  for (const point of raw) {
    if (!point) continue;
    x = point.x;
    y = point.y;
    break;
  }

  const smoothed: TrackPoint[] = [];
  let pendingJump = 0;
  frames.forEach((_, index) => {
    const point = raw[index];
    if (!point) {
      smoothed.push({ t: round3(index / fps), x: round3(x), y: round3(y) });
      return;
    }
    const jump = Math.hypot(point.x - x, point.y - y);
    if (jump > 0.22) {
      pendingJump += 1;
      if (pendingJump >= 2) {
        x = point.x;
        y = point.y;
        pendingJump = 0;
      }
    } else {
      pendingJump = 0;
      const alpha = jump > 0.08 ? 0.4 : 0.22;
      x += (point.x - x) * alpha;
      y += (point.y - y) * alpha;
    }
    smoothed.push({ t: round3(index / fps), x: round3(clamp01(x)), y: round3(clamp01(y)) });
  });

  onStatus?.("Action tracked");
  return smoothed;
}

export function subjectCenter(frame: Buffer, previous: Buffer | null, width: number, height: number): Center | null {
  const gridX = 16;
  const gridY = Math.max(6, Math.round(gridX * height / width));
  const cells = new Float64Array(gridX * gridY);
  const cellW = width / gridX;
  const cellH = height / gridY;

  for (let y = 0; y < height; y++) {
    const band = y < height * 0.08 ? 0.35 : y > height * 0.88 ? 0.5 : 1;
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 3;
      const r = frame[offset];
      const g = frame[offset + 1];
      const b = frame[offset + 2];
      const cb = (((b * 112 - r * 38 - g * 74 + 128) >> 8) + 128);
      const cr = (((r * 112 - g * 94 - b * 18 + 128) >> 8) + 128);
      const skin = cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173 ? 1 : 0;
      let motion = 0;
      if (previous) {
        const delta = Math.abs(r - previous[offset]) + Math.abs(g - previous[offset + 1]) + Math.abs(b - previous[offset + 2]);
        motion = delta > 54 ? 1 : 0;
      }
      let weight = skin * 2.4 + motion * (skin ? 3.2 : 0.45);
      if (weight <= 0) continue;
      const nx = x / width - 0.5;
      const ny = y / height - 0.5;
      const edge = Math.min(1, Math.hypot(nx, ny) / 0.72);
      weight *= (1 - edge * 0.22) * band;
      const cell = Math.min(gridY - 1, Math.floor(y / cellH)) * gridX + Math.min(gridX - 1, Math.floor(x / cellW));
      cells[cell] += weight;
    }
  }

  let best = 0;
  let bestIndex = -1;
  for (let index = 0; index < cells.length; index++) {
    if (cells[index] > best) {
      best = cells[index];
      bestIndex = index;
    }
  }
  if (bestIndex < 0 || best < 18) return null;

  const seen = new Uint8Array(cells.length);
  const queue = [bestIndex];
  seen[bestIndex] = 1;
  let weight = 0;
  let sumX = 0;
  let sumY = 0;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const index = queue[cursor];
    const cx = index % gridX;
    const cy = Math.floor(index / gridX);
    weight += cells[index];
    sumX += (cx + 0.5) * cells[index];
    sumY += (cy + 0.5) * cells[index];
    const neighbors = [index - 1, index + 1, index - gridX, index + gridX];
    for (const next of neighbors) {
      if (next < 0 || next >= cells.length || seen[next]) continue;
      const nx = next % gridX;
      if (Math.abs(nx - cx) + Math.abs(Math.floor(next / gridX) - cy) !== 1) continue;
      if (cells[next] < Math.max(8, best * 0.32)) continue;
      seen[next] = 1;
      queue.push(next);
    }
  }

  if (weight <= 0) return null;
  return {
    x: clamp01(sumX / weight / gridX),
    y: clamp01(sumY / weight / gridY),
  };
}

function sampleSize(srcW: number, srcH: number) {
  const aspect = srcW / Math.max(1, srcH);
  let width = 96;
  let height = Math.round(width / aspect);
  if (height > 96) {
    height = 96;
    width = Math.round(height * aspect);
  }
  width = Math.max(32, width - (width % 2));
  height = Math.max(32, height - (height % 2));
  return { width, height };
}

function readFrames(
  sourcePath: string,
  width: number,
  height: number,
  fps: number,
  frameBytes: number,
  expected: number,
  onStatus?: (message: string) => void,
): Promise<Buffer[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-an",
        "-sn",
        "-dn",
        "-i",
        sourcePath,
        "-vf",
        `fps=${fps},scale=${width}:${height}:flags=fast_bilinear,format=rgb24`,
        "-f",
        "rawvideo",
        "pipe:1",
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );

    const frames: Buffer[] = [];
    let pending = Buffer.alloc(0);
    let stderr = "";
    let reported = 0;
    onStatus?.("Finding the action");

    child.stdout.on("data", (chunk: Buffer) => {
      const incoming = Buffer.from(chunk);
      pending = pending.length ? Buffer.concat([pending, incoming]) : incoming;
      while (pending.length >= frameBytes) {
        frames.push(Buffer.from(pending.subarray(0, frameBytes)));
        pending = Buffer.from(pending.subarray(frameBytes));
      }
      const percent = Math.min(99, Math.round((frames.length / expected) * 100));
      if (percent >= reported + 15) {
        reported = percent;
        onStatus?.(`Finding the action, ${percent}%`);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-800);
    });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (!frames.length) {
        reject(new Error(stderr.trim() || `ffmpeg could not read frames (${code ?? "unknown"})`));
        return;
      }
      resolve(frames);
    });
  });
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function round3(value: number) {
  return Math.round(value * 1000) / 1000;
}
