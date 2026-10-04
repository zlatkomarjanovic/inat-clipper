import fs from "node:fs";
import path from "node:path";
import { runProcess } from "./proc.js";

export type DownloadResult = {
  sourcePath: string;
  sourceUrl: string;
  title?: string;
};

export async function downloadFromUrl(
  url: string,
  outDir: string,
  onStatus?: (message: string) => void,
): Promise<DownloadResult> {
  fs.mkdirSync(outDir, { recursive: true });
  const template = path.join(outDir, "source.%(ext)s");
  const metaTemplate = path.join(outDir, "source.meta.json");
  let lastPercent = -1;

  await runProcess(
    "yt-dlp",
    [
      url,
      "-o",
      template,
      "--no-playlist",
      "--write-info-json",
      "--write-subs",
      "--write-auto-subs",
      "--sub-langs",
      "bs,hr,sr,en",
      "--convert-subs",
      "vtt",
      "--merge-output-format",
      "mp4",
      "-f",
      "bv*+ba/b",
    ],
    {
      onText(chunk) {
        const match = chunk.match(/\[download\]\s+([\d.]+)%/);
        if (!match) return;
        const percent = Math.floor(Number(match[1]));
        if (percent >= lastPercent + 1) {
          lastPercent = percent;
          onStatus?.(`Downloading ${percent}%`);
        }
      },
    },
  );

  const files = fs.readdirSync(outDir);
  const videoFile = files.find((file) => /^source\.(mp4|webm|mkv|mov)$/i.test(file));
  if (!videoFile) {
    throw new Error("yt-dlp finished but the video file was not found");
  }

  let title: string | undefined;
  const infoJson = files.find((file) => file.endsWith(".info.json"));
  if (infoJson) {
    try {
      const info = JSON.parse(fs.readFileSync(path.join(outDir, infoJson), "utf-8")) as {
        title?: string;
      };
      title = info.title?.trim();
      fs.renameSync(path.join(outDir, infoJson), metaTemplate);
    } catch {
      // Title is optional. The video is already on disk.
    }
  }

  return {
    sourcePath: path.join(outDir, videoFile),
    sourceUrl: url,
    title,
  };
}

export function useLocalVideo(filePath: string): DownloadResult {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Video file not found: ${resolved}`);
  }
  return {
    sourcePath: resolved,
    sourceUrl: resolved,
    title: path.basename(resolved, path.extname(resolved)),
  };
}
