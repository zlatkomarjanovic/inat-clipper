import { spawnSync } from "node:child_process";

export type VideoProbe = {
  durationSeconds: number;
  width?: number;
  height?: number;
};

export function probeVideo(filePath: string): VideoProbe {
  const result = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=width,height",
      "-of",
      "json",
      filePath,
    ],
    { encoding: "utf-8" },
  );

  if (result.status !== 0) {
    throw new Error(`ffprobe failed: ${result.stderr || result.stdout}`);
  }

  const parsed = JSON.parse(result.stdout) as {
    format?: { duration?: string };
    streams?: Array<{ width?: number; height?: number }>;
  };

  const duration = Number(parsed.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Could not read video duration from ffprobe");
  }

  const videoStream = parsed.streams?.find((s) => s.width && s.height);
  return {
    durationSeconds: duration,
    width: videoStream?.width,
    height: videoStream?.height,
  };
}
