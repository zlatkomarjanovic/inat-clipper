# Inat Clipper

Local Windows app for cutting short videos. Paste a YouTube link or pick a file, mark the moments, and export vertical clips with a title, description, tags, and hashtags.

## What it does

- Find clips with AI, or mark them yourself
- Edit on a timeline: reorder, trim, crop, watermark, and logo
- Right-click a cut to pick a different moment on the full video
- The crop follows the action
- Export one clip or the whole batch
- Each clip folder gets `title.txt`, `description.txt`, `tags.txt`, and `hashtags.txt`

## Setup

You need `yt-dlp`, `ffmpeg`, and `ffprobe` on PATH, plus Node.js.

```bash
npm install
npm run setup
```

Put your OpenRouter key in `.env`. That file stays on your machine.

```bash
npm run app
```

Or double-click `Inat Clipper.bat`.

## CLI

```bash
npm run clip -- "https://www.youtube.com/watch?v=VIDEO_ID"
npm run clip -- "C:\path\to\video.mp4"
```

Finished clips go to the output folder you choose in the app. Work files stay in `workspace/jobs/`.
