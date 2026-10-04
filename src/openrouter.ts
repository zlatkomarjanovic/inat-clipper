import fs from "node:fs";
import { z } from "zod";
import { config } from "./config.js";
import { clipResponseSchema, type ClipResponse } from "./schema.js";
import { isYouTubeUrl } from "./utils.js";

const SYSTEM_PROMPT = `You are a short-form clip editor for Inat Bosanski (Bosnian media).
Analyze the full video and return ONLY valid JSON (no markdown fences).

Rules:
- Each clip is one complete moment: it starts at the beginning of a sentence or action, and it ends after the payoff, the answer, or the reaction.
- Never start or end mid-word. Never cut off the line people came to hear.
- The first 2 seconds must already contain the hook. No warmup, no "welcome back", no logos.
- Length target: 25-45 seconds. Never under 15. Never over 60.
- Timestamps are seconds on the video timeline (decimals allowed).
- Do not invent quotes. Titles and hooks must match what is actually said or shown.
- Prefer conflict, surprise, a bold claim, a funny line, a knockdown, or a visible reaction.
- Skip ads, intros, outros, subscribe plugs, dead air, applause with nobody talking, and clips that only make sense if you saw the previous minute.
- Do not overlap clips. If two moments share the same line, keep the stronger one.
- Only return clips you would actually post. Leave viral_score under 45 off the list.
- Write title and hook in Bosnian (ijekavica where natural).`;

function buildUserPrompt(maxClips: number, durationSeconds: number, extra?: string) {
  return `Video duration is approximately ${durationSeconds.toFixed(1)} seconds.

Return JSON with this shape:
{
  "video": { "source_url": "...", "duration_seconds": number, "language": "bs|hr|en|de|..." },
  "clips": [
    {
      "id": "clip-01",
      "start_seconds": number,
      "end_seconds": number,
      "viral_score": 0-100,
      "title": "...",
      "hook": "...",
      "reason": "...",
      "tags": ["..."],
      "platforms": ["tiktok", "reels", "shorts", "facebook"]
    }
  ]
}

Return up to ${maxClips} clips, sorted by viral_score descending.
${extra ?? ""}`;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed);
  }
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    return JSON.parse(fence[1].trim());
  }
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return JSON.parse(trimmed.slice(first, last + 1));
  }
  throw new Error("Model response did not contain JSON");
}

type VideoPart =
  | { type: "text"; text: string }
  | {
      type: "video_url";
      video_url: { url: string };
      processing?: "agentic" | "static";
    };

function buildVideoPart(sourceUrl: string, localPath: string): VideoPart {
  if (isYouTubeUrl(sourceUrl)) {
    return {
      type: "video_url",
      video_url: { url: sourceUrl },
      processing: "agentic",
    };
  }

  const stat = fs.statSync(localPath);
  if (stat.size > config.maxInlineVideoBytes) {
    throw new Error(
      `Local video is ${(stat.size / 1024 / 1024).toFixed(1)} MB. OpenRouter Gemini needs a public YouTube URL for long files, or a file under ${Math.round(config.maxInlineVideoBytes / 1024 / 1024)} MB for inline upload.`,
    );
  }

  const buf = fs.readFileSync(localPath);
  const b64 = buf.toString("base64");
  const ext = localPath.toLowerCase().endsWith(".webm") ? "webm" : "mp4";
  return {
    type: "video_url",
    video_url: { url: `data:video/${ext};base64,${b64}` },
    processing: "static",
  };
}

export async function analyzeVideoForClips(input: {
  sourceUrl: string;
  localPath: string;
  durationSeconds: number;
  maxClips: number;
  includeTranscript?: boolean;
}): Promise<ClipResponse> {
  const transcriptAsk = input.includeTranscript
    ? `Also return "transcript": an array of { "start_seconds", "end_seconds", "text" } covering the spoken words from the start of the video to the end. Each cue should be about 2 to 6 seconds. Use the exact words spoken, in the language spoken. Do not summarize.`
    : `Set "transcript" to an empty array.`;
  const userText = buildUserPrompt(input.maxClips, input.durationSeconds, transcriptAsk);
  const videoPart = buildVideoPart(input.sourceUrl, input.localPath);

  const body = {
    model: config.model,
    temperature: 0.2,
    max_tokens: 32768,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [{ type: "text", text: userText }, videoPart],
      },
    ],
  };

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openRouterKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://www.inatbosanski.com",
      "X-Title": "inat-clipper",
    },
    body: JSON.stringify(body),
  });

  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(`OpenRouter ${response.status}: ${rawText.slice(0, 2000)}`);
  }

  const payload = JSON.parse(rawText) as {
    choices?: Array<{ message?: { content?: string | Array<{ type: string; text?: string }> } }>;
  };

  const content = payload.choices?.[0]?.message?.content;
  let text = "";
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) {
    text = content
      .filter((p) => p.type === "text" && p.text)
      .map((p) => p.text)
      .join("\n");
  }

  if (!text.trim()) {
    throw new Error("OpenRouter returned empty content");
  }

  const parsed = extractJson(text);
  return clipResponseSchema.parse(parsed);
}

export type ClickbaitCopy = {
  title: string;
  description: string;
  tags: string[];
  hashtags: string[];
};

const clickbaitSchema = z.object({
  clips: z.array(
    z.object({
      id: z.string(),
      title: z.string().default(""),
      description: z.string().default(""),
      tags: z.array(z.string()).default([]),
      hashtags: z.array(z.string()).default([]),
    }),
  ),
});

const CLICKBAIT_PROMPT = `You write clickbait for Inat Bosanski short clips.
Return ONLY JSON. No markdown.

The title must make a person stop scrolling. Curious, specific, a little sharp.
It must still be true to the transcript. Do not invent quotes, names, or events.
Write in Bosnian (ijekavica where natural).

For every clip return:
- title: under 70 characters, no hashtags, no quotes unless those exact words are in the transcript
- description: two short paragraphs. First line is the hook. Second line says why it is worth watching. No "u ovom videu".
- tags: 5 to 8 lowercase phrases, no # 
- hashtags: 6 to 10, each starting with #

Example of the voice, not of the facts:
{
  "clips": [
    {
      "id": "clip-1",
      "title": "Rekao je to usred emisije i studio je zanijemio",
      "description": "Gost je krenuo mirno. Onda je pala jedna rečenica i voditelj je stao.\\n\\nOstani do kraja. Reakcija je bolja od same rečenice.",
      "tags": ["inat bosanski", "emisija", "reakcija", "gost", "studio"],
      "hashtags": ["#InatBosanski", "#Emisija", "#Reakcija", "#Balkan", "#Shorts", "#Viral"]
    }
  ]
}`;

export async function writeClickbait(
  videoTitle: string,
  clips: Array<{ id: string; transcript: string; title?: string }>,
): Promise<Map<string, ClickbaitCopy>> {
  const packed = clips
    .map((clip, index) => {
      const spoken = clip.transcript.trim() || "(no transcript, use the working title only)";
      return `${index + 1}. id: ${clip.id}\nWorking title: ${clip.title || "Cut"}\nTranscript:\n${spoken.slice(0, 1800)}`;
    })
    .join("\n\n");

  const body = {
    model: config.copyModel,
    temperature: 0.7,
    max_tokens: 4096,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: CLICKBAIT_PROMPT },
      {
        role: "user",
        content: `Video title: ${videoTitle || "Untitled"}\n\nWrite one object per clip. Keep every id exactly as given.\n\n${packed}`,
      },
    ],
  };

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openRouterKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://www.inatbosanski.com",
      "X-Title": "inat-clipper",
    },
    body: JSON.stringify(body),
  });
  const rawText = await response.text();
  if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${rawText.slice(0, 800)}`);
  const payload = JSON.parse(rawText) as {
    choices?: Array<{ message?: { content?: string | Array<{ type: string; text?: string }> } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  const text = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.filter((part) => part.type === "text" && part.text).map((part) => part.text).join("\n")
      : "";
  if (!text.trim()) throw new Error("OpenRouter returned empty clickbait");
  const parsed = clickbaitSchema.parse(extractJson(text));
  const out = new Map<string, ClickbaitCopy>();
  parsed.clips.forEach((clip, index) => {
    const id = clips.some((item) => item.id === clip.id) ? clip.id : clips[index]?.id;
    if (!id) return;
    out.set(id, {
      title: clip.title.replace(/\s+/g, " ").trim().slice(0, 90) || clips[index]?.title || "Cut",
      description: clip.description.trim().slice(0, 600),
      tags: cleanTags(clip.tags),
      hashtags: cleanHashes(clip.hashtags),
    });
  });
  return out;
}

function cleanTags(tags: string[]): string[] {
  return tags
    .map((tag) => tag.replace(/#/g, "").replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 8);
}

function cleanHashes(tags: string[]): string[] {
  return tags
    .map((tag) => {
      const clean = tag.replace(/\s+/g, "").replace(/^#+/, "");
      return clean ? `#${clean}` : "";
    })
    .filter(Boolean)
    .slice(0, 10);
}
