import fs from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";

const ROOT = path.resolve(import.meta.dirname, "..");

loadEnv({ path: path.join(ROOT, ".env") });

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const paths = {
  root: ROOT,
  workspace: path.join(ROOT, "workspace"),
  jobs: path.join(ROOT, "workspace", "jobs"),
  envFile: path.join(ROOT, ".env"),
};

export const config = {
  openRouterKey: process.env.OPENROUTER_API_KEY?.trim() ?? "",
  model: process.env.OPENROUTER_MODEL?.trim() || "google/gemini-3.8-flash",
  copyModel: process.env.OPENROUTER_COPY_MODEL?.trim() || "google/gemini-2.5-flash-lite",
  maxClips: envInt("MAX_CLIPS", 10),
  minClipSeconds: envInt("MIN_CLIP_SECONDS", 15),
  maxClipSeconds: Math.min(envInt("MAX_CLIP_SECONDS", 60), 60),
  /** Local file base64 path only under this size (bytes). */
  maxInlineVideoBytes: envInt("MAX_INLINE_VIDEO_BYTES", 95 * 1024 * 1024),
  padStartSeconds: 0.25,
  padEndSeconds: 0.35,
};

export function ensureWorkspace() {
  fs.mkdirSync(paths.jobs, { recursive: true });
}

export function requireOpenRouterKey() {
  if (!config.openRouterKey) {
    throw new Error(
      "Missing OPENROUTER_API_KEY. Copy .env.example to .env and paste your key, or run: npm run setup",
    );
  }
}
