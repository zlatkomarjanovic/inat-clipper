import fs from "node:fs";
import path from "node:path";

export type Cue = {
  start: number;
  end: number;
  text: string;
};

const TIME =
  /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s+-->\s+(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

function toSeconds(h: string | undefined, m: string, s: string, ms: string): number {
  const frac = ms.length === 3 ? Number(ms) / 1000 : Number(ms.padEnd(3, "0")) / 1000;
  return Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + frac;
}

function cleanCaptionText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function parseSubtitleFile(filePath: string): Cue[] {
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const blocks = raw.split(/\r?\n\r?\n/);
  const cues: Cue[] = [];

  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) continue;
    const match = lines[timingIndex].match(TIME);
    if (!match) continue;
    const text = cleanCaptionText(lines.slice(timingIndex + 1).join(" "));
    if (!text || text === "[Music]" || text === "[Applause]") continue;
    const start = toSeconds(match[1], match[2], match[3], match[4]);
    const end = toSeconds(match[5], match[6], match[7], match[8]);
    if (!(end > start)) continue;
    cues.push({ start, end, text });
  }

  return dedupeRolling(cues);
}

/** YouTube auto-captions repeat a line as it grows. Keep the fullest version. */
function dedupeRolling(cues: Cue[]): Cue[] {
  const sorted = [...cues].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Cue[] = [];

  for (const cue of sorted) {
    const prev = out[out.length - 1];
    if (!prev) {
      out.push({ ...cue });
      continue;
    }
    const sameWindow = cue.start < prev.end + 0.35;
    if (sameWindow && (cue.text.startsWith(prev.text) || prev.text.startsWith(cue.text))) {
      if (cue.text.length >= prev.text.length) {
        prev.text = cue.text;
        prev.end = Math.max(prev.end, cue.end);
      }
      continue;
    }
    out.push({ ...cue });
  }

  return out;
}

export function pickSubtitleFile(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((file) => /\.(vtt|srt)$/i.test(file));
  if (files.length === 0) return null;

  const rank = (file: string) => {
    const name = file.toLowerCase();
    let score = 0;
    if (name.includes(".bs")) score += 50;
    else if (name.includes(".hr")) score += 40;
    else if (name.includes(".sr")) score += 30;
    else if (name.includes(".en")) score += 10;
    if (name.includes("auto")) score -= 3;
    if (name.endsWith(".vtt")) score += 1;
    return score;
  };

  files.sort((a, b) => rank(b) - rank(a));
  return path.join(dir, files[0]);
}

export function cuesForWindow(cues: Cue[], start: number, end: number): Cue[] {
  const sliced: Cue[] = [];
  for (const cue of cues) {
    if (cue.end <= start || cue.start >= end) continue;
    const localStart = Math.max(0, cue.start - start);
    const localEnd = Math.min(end - start, cue.end - start);
    if (localEnd - localStart < 0.2) continue;
    sliced.push({ start: localStart, end: localEnd, text: cue.text });
  }
  return packCues(sliced);
}

function packCues(cues: Cue[]): Cue[] {
  const sorted = [...cues].sort((a, b) => a.start - b.start);
  const out: Cue[] = [];
  for (const cue of sorted) {
    const prev = out[out.length - 1];
    const next = { ...cue };
    if (prev && next.start < prev.end) prev.end = Math.max(prev.start + 0.15, next.start);
    if (prev && prev.end - prev.start < 0.15) out.pop();
    if (next.end - next.start < 0.15) continue;
    out.push(next);
  }
  return out;
}

export function writeTranscriptVtt(filePath: string, cues: Cue[]) {
  const lines = ["WEBVTT", ""];
  cues.forEach((cue, index) => {
    lines.push(String(index + 1));
    lines.push(`${vttTime(cue.start)} --> ${vttTime(cue.end)}`);
    lines.push(cue.text);
    lines.push("");
  });
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function vttTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = Math.floor(safe % 60);
  const ms = Math.round((safe - Math.floor(safe)) * 1000);
  const pad = (n: number, size = 2) => String(n).padStart(size, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
}
