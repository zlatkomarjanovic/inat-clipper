import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { runProcess } from "./proc.js";

export async function videoForAnalysis(
  localPath: string,
  workDir: string,
  durationSeconds: number,
  onStatus?: (message: string) => void,
): Promise<string> {
  const size = fs.statSync(localPath).size;
  if (size <= config.maxInlineVideoBytes) return localPath;

  fs.mkdirSync(workDir, { recursive: true });
  const dest = path.join(workDir, "analysis.mp4");
  const targetBytes = Math.floor(config.maxInlineVideoBytes * 0.72);
  const audioBps = 48_000;
  const videoBps = Math.max(
    120_000,
    Math.floor((targetBytes * 8) / Math.max(durationSeconds, 1) - audioBps),
  );
  const height = videoBps < 350_000 ? 480 : 720;
  let lastPercent = -1;

  onStatus?.("Preparing the video");

  await runProcess(
    "ffmpeg",
    [
      "-hide_banner",
      "-y",
      "-i",
      localPath,
      "-vf",
      `scale=-2:${height}`,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-b:v",
      String(videoBps),
      "-maxrate",
      String(videoBps),
      "-bufsize",
      String(videoBps * 2),
      "-c:a",
      "aac",
      "-b:a",
      "48k",
      "-ac",
      "1",
      "-progress",
      "pipe:1",
      "-nostats",
      dest,
    ],
    {
      onText(chunk, stream) {
        if (stream !== "stdout") return;
        const match = chunk.match(/out_time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (!match || durationSeconds <= 0) return;
        const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
        const percent = Math.min(99, Math.floor((seconds / durationSeconds) * 100));
        if (percent >= lastPercent + 5) {
          lastPercent = percent;
          onStatus?.(`Preparing the video ${percent}%`);
        }
      },
    },
  );

  if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) {
    throw new Error("Could not prepare the local video for analysis.");
  }
  if (fs.statSync(dest).size > config.maxInlineVideoBytes) {
    throw new Error(
      "That local video is still too large to send after compression. Use a shorter file, or paste the YouTube link.",
    );
  }
  return dest;
}
