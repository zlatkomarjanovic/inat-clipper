import fs from "node:fs";
import path from "node:path";

export function slugify(input: string, max = 48): string {
  const base = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (base || "clip").slice(0, max);
}

export function timestampFolder(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function writeJson(filePath: string, data: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

export function isYouTubeUrl(raw: string): boolean {
  try {
    const url = new URL(raw.trim());
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    return host === "youtu.be" || host.includes("youtube.com");
  } catch {
    return false;
  }
}

export function looksLikeUrl(raw: string): boolean {
  const v = raw.trim();
  return v.startsWith("http://") || v.startsWith("https://");
}

export function safeFolderName(input: string): string {
  const cleaned = input
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/[. ]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "clips").slice(0, 80);
}

export function isLocalVideoPath(raw: string): boolean {
  const v = raw.trim().replace(/^["']|["']$/g, "");
  if (looksLikeUrl(v)) return false;
  const ext = path.extname(v).toLowerCase();
  return [".mp4", ".webm", ".mov", ".mkv", ".m4v"].includes(ext);
}
