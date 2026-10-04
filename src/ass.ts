import type { Cue } from "./subs.js";

export type OverlaySpec = {
  watermarkText?: string;
  watermarkCorner?: "tl" | "tr" | "bl" | "br";
  overlayText?: string;
  overlayPlace?: "top" | "middle" | "bottom";
  logo?: boolean;
  watermarkPos?: { x: number; y: number };
  titlePos?: { x: number; y: number };
  logoBox?: { x: number; y: number; w: number };
};

export function buildAss(
  cues: Cue[],
  width: number,
  height: number,
  overlays?: OverlaySpec,
  durationSeconds = 0,
): string {
  const playW = width || 1920;
  const playH = height || 1080;
  const fontSize = Math.max(28, Math.round(playH * 0.046));
  const marginV = Math.max(42, Math.round(playH * 0.08));
  const marginH = Math.max(48, Math.round(playW * 0.06));
  const outline = Math.max(2, Math.round(fontSize / 14));
  const wmSize = Math.max(18, Math.round(playH * 0.028));
  const titleSize = Math.max(32, Math.round(playH * 0.055));
  const titleAlign = overlays?.overlayPlace === "middle" ? 5 : overlays?.overlayPlace === "bottom" ? 2 : 8;
  const wmAlign = cornerAlign(overlays?.watermarkCorner);

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${playW}
PlayResY: ${playH}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Segoe UI,${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,${outline},0,2,${marginH},${marginH},${marginV},1
Style: Watermark,Segoe UI,${wmSize},&H66FFFFFF,&H000000FF,&H96000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,0,${wmAlign},${marginH},${marginH},${marginV},1
Style: Title,Segoe UI,${titleSize},&H00FFFFFF,&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,${Math.max(3, Math.round(titleSize / 14))},0,${titleAlign},${marginH},${marginH},${Math.round(marginV * 1.4)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events: string[] = [];
  for (const cue of cues) {
    const text = wrapAss(cue.text);
    if (!text) continue;
    events.push(`Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Caption,,0,0,0,,${text}`);
  }

  const end = assTime(Math.max(durationSeconds, 0.4));
  const watermark = wrapAss(overlays?.watermarkText ?? "", 28);
  const wmMargin = overlays?.logo && !overlays?.watermarkPos ? Math.round(playH * 0.14) : 0;
  if (watermark) {
    events.push(`Dialogue: 2,0:00:00.00,${end},Watermark,,${wmMargin},${wmMargin},${wmMargin},,${posTag(overlays?.watermarkPos, playW, playH)}${watermark}`);
  }
  const title = wrapAss(overlays?.overlayText ?? "", 32);
  if (title) events.push(`Dialogue: 1,0:00:00.00,${end},Title,,0,0,0,,${posTag(overlays?.titlePos, playW, playH)}${title}`);
  if (events.length === 0) return "";

  return `${header}${events.join("\n")}\n`;
}

function posTag(pos: { x: number; y: number } | undefined, playW: number, playH: number): string {
  if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return "";
  const x = Math.round(Math.min(1, Math.max(0, pos.x)) * playW);
  const y = Math.round(Math.min(1, Math.max(0, pos.y)) * playH);
  return `{\\an7\\pos(${x},${y})}`;
}

function cornerAlign(corner?: OverlaySpec["watermarkCorner"]): number {
  if (corner === "tl") return 7;
  if (corner === "tr") return 9;
  if (corner === "bl") return 1;
  return 3;
}

function wrapAss(text: string, max = 34): string {
  const clean = text.replace(/\\/g, "").replace(/\{/g, "(").replace(/\}/g, ")").replace(/\s+/g, " ").trim();
  const words = clean.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > max && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 2).join("\\N");
}

function assTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = Math.floor(safe % 60);
  const cs = Math.min(99, Math.round((safe - Math.floor(safe)) * 100));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs)}`;
}
