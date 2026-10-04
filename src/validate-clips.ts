import { config } from "./config.js";
import { HARD_MAX_CLIP_SECONDS } from "./frame.js";
import type { ClipCandidate } from "./schema.js";
import type { Cue } from "./subs.js";
import { slugify } from "./utils.js";

export type ValidatedClip = ClipCandidate & {
  folderSlug: string;
  start_seconds: number;
  end_seconds: number;
};

export function validateAndNormalizeClips(
  clips: ClipCandidate[],
  durationSeconds: number,
  cues: Cue[] = [],
): ValidatedClip[] {
  const minLen = config.minClipSeconds;
  const maxLen = Math.min(config.maxClipSeconds, HARD_MAX_CLIP_SECONDS);
  const padStart = config.padStartSeconds;
  const padEnd = config.padEndSeconds;

  const sorted = [...clips].sort((a, b) => b.viral_score - a.viral_score);
  const loose: ValidatedClip[] = [];
  const strict: ValidatedClip[] = [];

  for (const clip of sorted) {
    if (loose.length >= config.maxClips) break;
    let start = clip.start_seconds - padStart;
    let end = clip.end_seconds + padEnd;

    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    start = Math.max(0, start);
    end = Math.min(durationSeconds, end);
    if (end <= start) continue;

    const snapped = snapToSpeech(start, end, cues, durationSeconds, minLen, maxLen);
    start = snapped.start;
    end = snapped.end;
    if (end - start < minLen) continue;
    if (end - start > maxLen) end = start + maxLen;
    if (loose.some((kept) => overlaps(kept.start_seconds, kept.end_seconds, start, end))) continue;

    const next: ValidatedClip = {
      ...clip,
      start_seconds: round3(start),
      end_seconds: round3(end),
      folderSlug: slugify(`${clip.id}-${clip.title}`),
    };
    loose.push(next);
    if (!cues.length || spokenSeconds(cues, start, end) >= (end - start) * 0.2) strict.push(next);
  }

  const pool = strict.length ? strict : loose;
  const strong = pool.filter((clip) => clip.viral_score >= 45);
  const picked = strong.length ? strong : pool;

  if (picked.length === 0) {
    throw new Error("No valid clips remained after timestamp validation");
  }

  return picked;
}

function snapToSpeech(
  start: number,
  end: number,
  cues: Cue[],
  duration: number,
  minLen: number,
  maxLen: number,
) {
  if (!cues.length) return { start, end };
  const inside = cues.filter((cue) => cue.end > start + 0.2 && cue.start < end - 0.2);
  if (!inside.length) return { start, end };

  const first = inside[0].start;
  const last = inside[inside.length - 1].end;
  if (first - start > 0.8) start = Math.max(0, first - 0.15);
  else {
    const mid = cues.find((cue) => cue.start < start && cue.end > start);
    if (mid && start - mid.start < 1.4) start = mid.start;
  }

  if (end - last > 1.2) end = Math.min(duration, last + 0.3);
  else {
    const mid = [...cues].reverse().find((cue) => cue.start < end && cue.end > end);
    if (mid && mid.end - end < 2.2 && mid.end - start <= maxLen) end = Math.min(duration, mid.end);
  }

  if (end - start < minLen) end = Math.min(duration, start + minLen);
  if (end - start > maxLen) end = start + maxLen;
  return { start: Math.max(0, start), end: Math.min(duration, end) };
}

function spokenSeconds(cues: Cue[], start: number, end: number) {
  let total = 0;
  for (const cue of cues) {
    const from = Math.max(start, cue.start);
    const to = Math.min(end, cue.end);
    if (to > from) total += to - from;
  }
  return total;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  const from = Math.max(aStart, bStart);
  const to = Math.min(aEnd, bEnd);
  if (to <= from) return false;
  const shorter = Math.min(aEnd - aStart, bEnd - bStart);
  return shorter > 0 && (to - from) / shorter > 0.5;
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}
