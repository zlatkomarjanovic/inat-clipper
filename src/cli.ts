import fs from "node:fs";
import { requireOpenRouterKey } from "./config.js";
import { exportClipJob, runClipJob, type ClipMode, type ExportJobInput } from "./run-job.js";
import { trackAction } from "./track.js";

function usage() {
  console.log(`inat-clipper

Usage:
  npm run clip -- <youtube-url-or-local-path> [--out folder] [--name "Clip name"] [--mode basic|advanced]
Requires: yt-dlp, ffmpeg, ffprobe on PATH
Env: OPENROUTER_API_KEY in .env
`);
}

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  let outputDir: string | undefined;
  let name: string | undefined;
  let mode: ClipMode = "basic";
  let manual = false;
  let progress = false;
  let analyzeOnly = false;
  let exportFile: string | undefined;
  let track: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out") outputDir = argv[++i];
    else if (arg === "--name") name = argv[++i];
    else if (arg === "--mode") mode = argv[++i] === "advanced" ? "advanced" : "basic";
    else if (arg === "--progress") progress = true;
    else if (arg === "--analyze-only") analyzeOnly = true;
    else if (arg === "--manual") manual = true;
    else if (arg === "--export-file") exportFile = argv[++i];
    else if (arg === "--track") track = argv[++i];
    else if (arg === "--help" || arg === "-h") positional.push(arg);
    else if (!arg.startsWith("--")) positional.push(arg);
  }

  return { input: positional[0]?.trim() ?? "", outputDir, name, mode, progress, analyzeOnly, manual, exportFile, track };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const say = (message: string) => {
    if (args.progress) console.log(`STATUS\t${message}`);
    else console.log(message);
  };

  if (args.track) {
    const points = await trackAction(args.track, say);
    const payload = { points };
    if (args.progress) console.log(`RESULT\t${JSON.stringify(payload)}`);
    else console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (args.exportFile) {
    const payload = JSON.parse(fs.readFileSync(args.exportFile, "utf8")) as ExportJobInput;
    const result = await exportClipJob({ ...payload, onStatus: say });
    if (args.progress) console.log(`RESULT\t${JSON.stringify(result)}`);
    else {
      console.log("\nDone.");
      console.log(`Clips: ${result.outputDir}`);
    }
    return;
  }

  if (!args.input || args.input === "--help" || args.input === "-h") {
    usage();
    process.exit(args.input ? 0 : 1);
  }

  if (!args.manual) requireOpenRouterKey();

  const result = await runClipJob({
    input: args.input,
    outputDir: args.outputDir,
    name: args.name,
    mode: args.mode,
    analyzeOnly: args.analyzeOnly || args.manual,
    manual: args.manual,
    onStatus: say,
  });

  if (args.progress || args.analyzeOnly) {
    if (args.progress) console.log(`RESULT\t${JSON.stringify(result)}`);
    else console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!("outputDir" in result)) return;

  console.log("\nDone.");
  console.log(`Clips: ${result.outputDir}`);
  if (result.transcriptPath) {
    console.log(`Transcript (${result.transcriptSource}, ${result.cueCount} lines): ${result.transcriptPath}`);
  }
  for (const clip of result.clips) {
    const captionNote = clip.captions ? " captions" : "";
    console.log(`  - ${clip.file}  (${clip.start}s -> ${clip.end}s)  score ${clip.score}${captionNote}`);
  }
  if (result.mixFile) console.log(`Mix: ${result.mixFile}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
