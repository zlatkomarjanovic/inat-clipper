# inat-clipper (agent instructions)

Local clip pipeline for Inat Bosanski. No web UI.

## First time in this folder

1. `npm install`
2. `npm run setup` (creates `.env` and `workspace/jobs/`)
3. User pastes `OPENROUTER_API_KEY` into `.env` if they skipped the prompt

## Every clip job

User gives a **YouTube URL** (best) or a **local video path**.

Run from `C:\Users\PC\Desktop\inat-clipper`:

```bash
npm run clip -- "https://www.youtube.com/watch?v=VIDEO_ID"
```

Or local file (under ~95 MB for Gemini inline, or use YouTube for long files):

```bash
npm run clip -- "C:\path\to\video.mp4"
```

## Output

Each run creates:

```text
workspace/jobs/{timestamp}_{slug}/
  job.json
  source/source.mp4
  candidates/candidates.raw.json
  candidates/candidates.validated.json
  clips/{slug}/clip.mp4
  clips/{slug}/meta.json
```

Tell the user the `clips/` folder path when finished.

## Requirements on PATH

- `yt-dlp`
- `ffmpeg`
- `ffprobe`

## Do not

- Commit `.env` or paste API keys into chat
- Block on building a web dashboard unless asked

## Optional env (.env)

- `OPENROUTER_MODEL` (default `google/gemini-3.8-flash`)
- `MAX_CLIPS` (default 10)
- `MIN_CLIP_SECONDS` / `MAX_CLIP_SECONDS`
