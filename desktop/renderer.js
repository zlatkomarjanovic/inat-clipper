const api = window.clipper;

const state = {
  sourceKind: "youtube",
  filePath: "",
  outputDir: "",
  lastVideoDir: "",
  outputResult: "",
  mode: "basic",
  nameDirty: false,
  running: false,
  preset: "9:16",
  outW: 1080,
  outH: 1920,
};

const MAX_CUT = 60;

const editor = {
  open: false,
  workDir: "",
  duration: 0,
  sourceWidth: 0,
  sourceHeight: 0,
  clips: [],
  selected: 0,
  zoom: 1,
  crop: null,
  watermarkImage: "",
  seqTime: 0,
  sequencePlay: false,
  logo: null,
  wmPos: null,
  titlePos: null,
  layer: "crop",
  picker: null,
  sourcePath: "",
  follow: true,
  track: null,
  trackToken: null,
  filmstrip: [],
  filmSource: "",
  filmToken: null,
};

let hydrating = true;

const el = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function clock(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const remain = total % 60;
  return `${minutes}:${String(remain).padStart(2, "0")}`;
}

function setSource(kind) {
  state.sourceKind = kind;
  el("tab-youtube").classList.toggle("active", kind === "youtube");
  el("tab-local").classList.toggle("active", kind === "local");
  el("youtube-wrap").hidden = kind !== "youtube";
  el("local-wrap").hidden = kind !== "local";
  if (!hydrating) persist();
}

function setMode(mode) {
  state.mode = mode;
  el("mode-basic").classList.toggle("active", mode === "basic");
  el("mode-advanced").classList.toggle("active", mode === "advanced");
  if (!hydrating) persist();
}

function showFormError(message) {
  const node = el("form-error");
  node.hidden = !message;
  node.textContent = message;
}

function setBusy(busy) {
  state.running = busy;
  for (const id of ["url", "name", "choose", "browse", "tab-youtube", "tab-local", "mode-basic", "mode-advanced", "start", "manual", "add-clip", "follow", "out-w", "out-h", "in-time", "out-time", "mix", "watermark", "watermark-corner", "watermark-image", "watermark-clear", "overlay-text", "overlay-place", "zoom", "zoom-in", "zoom-out", "clip-title", "remove-clip"]) {
    el(id).disabled = busy;
  }
  document.querySelectorAll(".preset").forEach((button) => {
    button.disabled = busy;
  });
  el("export").disabled = busy || !editor.open || editor.clips.length === 0;
  el("play").disabled = busy || !editor.open;
  el("start").textContent = busy ? "Working" : "Find clips";
  el("bar").hidden = !busy;
}

function persist() {
  return api.saveSettings({
    outputDir: state.outputDir,
    mode: state.mode,
    sourceKind: state.sourceKind,
    lastVideoDir: state.lastVideoDir,
    framePreset: state.preset,
    outW: state.outW,
    outH: state.outH,
    mix: el("mix").checked,
    watermarkText: el("watermark").value,
    watermarkCorner: el("watermark-corner").value,
    overlayText: el("overlay-text").value,
    overlayPlace: el("overlay-place").value,
    watermarkImage: editor.watermarkImage,
    logo: editor.logo,
    wmPos: editor.wmPos,
    titlePos: editor.titlePos,
  });
}

function renderSteps(steps) {
  el("steps").innerHTML = steps.map((step) => `<li>${escapeHtml(step.label)}</li>`).join("");
}

function renderResults(result) {
  const root = el("results");
  const transcript = result.transcriptPath
    ? `<div class="row">
        <div class="copy">
          <strong>Transcript</strong>
          <em>${result.cueCount} lines, from ${result.transcriptSource === "captions" ? "captions" : "the model"}</em>
        </div>
        <button type="button" data-open="${escapeHtml(result.transcriptPath)}">Open</button>
      </div>`
    : `<div class="row"><div class="copy"><strong>Transcript</strong><em>No lines found for this video</em></div></div>`;

  const mix = result.mixFile
    ? `<div class="row">
        <div class="copy">
          <strong>Mixed video</strong>
          <em>All cuts, in list order</em>
        </div>
        <button type="button" data-open="${escapeHtml(result.mixFile)}">Open</button>
      </div>`
    : "";

  const clips = result.clips.map((clip) => `<div class="row">
      <div class="copy">
        <strong>${escapeHtml(clip.title)}</strong>
        <em>${clock(clip.start)} to ${clock(clip.end)} · ${clip.captions ? "Captions on" : "Clean cut"}</em>
      </div>
      <span class="score">${Math.round(clip.score)}</span>
      <button type="button" data-open="${escapeHtml(clip.file)}">Open</button>
    </div>`).join("");

  root.hidden = false;
  root.innerHTML = transcript + mix + clips;
  root.querySelectorAll("[data-open]").forEach((button) => {
    button.addEventListener("click", () => api.openPath(button.getAttribute("data-open")));
  });
}

el("tab-youtube").addEventListener("click", () => setSource("youtube"));
el("tab-local").addEventListener("click", () => setSource("local"));
el("mode-basic").addEventListener("click", () => setMode("basic"));
el("mode-advanced").addEventListener("click", () => setMode("advanced"));

el("name").addEventListener("input", () => {
  state.nameDirty = true;
});

el("choose").addEventListener("click", async () => {
  const filePath = await api.pickVideo();
  if (!filePath) return;
  state.filePath = filePath;
  state.lastVideoDir = filePath.replace(/\\[^\\]+$/, "");
  const base = filePath.split(/[/\\]/).pop() || filePath;
  el("file-label").textContent = base;
  if (!state.nameDirty) {
    el("name").value = base.replace(/\.[^.]+$/, "");
  }
  setSource("local");
});

el("browse").addEventListener("click", async () => {
  const folder = await api.pickFolder();
  if (!folder) return;
  state.outputDir = folder;
  el("folder-label").textContent = folder;
  persist();
});

el("open-folder").addEventListener("click", () => {
  if (state.outputResult) api.openPath(state.outputResult);
});

el("form").addEventListener("submit", (event) => {
  event.preventDefault();
  beginJob(false);
});

el("manual").addEventListener("click", () => beginJob(true));

async function beginJob(manual) {
  if (state.running) return;

  const url = el("url").value.trim();
  if (state.sourceKind === "youtube" && !/^https?:\/\//i.test(url)) {
    showFormError("Paste a full YouTube link.");
    return;
  }
  if (state.sourceKind === "local" && !state.filePath) {
    showFormError("Choose a video file.");
    return;
  }
  if (!state.outputDir) {
    showFormError("Choose an output folder.");
    return;
  }
  showFormError("");

  setBusy(true);
  el("status").textContent = manual ? "Opening the video" : "Working";
  el("empty").hidden = true;
  el("error").hidden = true;
  el("results").hidden = true;
  el("editor").hidden = true;
  editor.open = false;
  document.querySelector("main").classList.remove("editing");
  el("open-folder").hidden = true;
  el("steps").innerHTML = "";

  const steps = [];
  api.onStatus((message) => {
    const key = message.startsWith("Downloading")
      ? "download"
      : message.startsWith("Preparing the video")
        ? "prepare"
        : message;
    const existing = steps.find((step) => step.key === key);
    if (existing) existing.label = message;
    else steps.push({ key, label: message });
    renderSteps(steps);
    el("status").textContent = message;
  });

  const response = await api.startJob({
    input: state.sourceKind === "youtube" ? url : state.filePath,
    outputDir: state.outputDir,
    name: el("name").value,
    mode: state.mode,
    manual,
  });

  api.clearStatus();
  setBusy(false);

  if (!response?.ok) {
    el("status").textContent = "Failed";
    el("error").hidden = false;
    el("error").textContent = response?.error || "The clip run failed.";
    return;
  }

  openEditor(response.result);
  loadHistory();
}

function even(value) {
  return Math.max(2, Math.floor(value / 2) * 2);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sourceSize() {
  return {
    w: editor.sourceWidth || 1920,
    h: editor.sourceHeight || 1080,
  };
}

function defaultCrop() {
  const { w: srcW, h: srcH } = sourceSize();
  const ratio = state.outW / state.outH;
  let w = srcW;
  let h = w / ratio;
  if (h > srcH) {
    h = srcH;
    w = h * ratio;
  }
  return {
    x: (srcW - w) / 2 / srcW,
    y: (srcH - h) / 2 / srcH,
    w: w / srcW,
    h: h / srcH,
  };
}

function refitCrop() {
  const { w: srcW, h: srcH } = sourceSize();
  const current = editor.crop || defaultCrop();
  const ratio = state.outW / state.outH;
  const cx = (current.x + current.w / 2) * srcW;
  const cy = (current.y + current.h / 2) * srcH;
  let w = Math.max(srcW * 0.12, current.w * srcW);
  let h = w / ratio;
  if (h > srcH) {
    h = srcH;
    w = h * ratio;
  }
  if (w > srcW) {
    w = srcW;
    h = w / ratio;
  }
  const x = clamp(cx - w / 2, 0, srcW - w);
  const y = clamp(cy - h / 2, 0, srcH - h);
  editor.crop = { x: x / srcW, y: y / srcH, w: w / srcW, h: h / srcH };
}

function layoutCrop() {
  const stage = el("crop-stage");
  const canvas = el("crop-canvas");
  const { w: srcW, h: srcH } = sourceSize();
  if (!stage || !editor.sourceWidth || !stage.clientWidth || !stage.clientHeight) return;
  const scale = Math.min(stage.clientWidth / srcW, stage.clientHeight / srcH);
  canvas.style.width = `${srcW * scale}px`;
  canvas.style.height = `${srcH * scale}px`;
  if (!editor.crop) editor.crop = defaultCrop();
  const crop = visibleCrop();
  const box = el("crop-box");
  box.style.left = `${crop.x * 100}%`;
  box.style.top = `${crop.y * 100}%`;
  box.style.width = `${crop.w * 100}%`;
  box.style.height = `${crop.h * 100}%`;
}

function moveCrop(origin, dxPx, dyPx, rect) {
  editor.crop = {
    ...origin,
    x: clamp(origin.x + dxPx / rect.width, 0, 1 - origin.w),
    y: clamp(origin.y + dyPx / rect.height, 0, 1 - origin.h),
  };
}

function resizeCrop(origin, corner, dxPx, dyPx, rect) {
  const { w: srcW, h: srcH } = sourceSize();
  const ratio = state.outW / state.outH;
  const dx = (dxPx / rect.width) * srcW;
  const dy = (dyPx / rect.height) * srcH;
  const right = origin.x * srcW + origin.w * srcW;
  const bottom = origin.y * srcH + origin.h * srcH;
  let w = origin.w * srcW;
  if (corner.includes("e")) w += dx;
  if (corner.includes("w")) w -= dx;
  const heightDrag = corner.includes("s") ? origin.h * srcH + dy : origin.h * srcH - dy;
  if (Math.abs(heightDrag * ratio - origin.w * srcW) > Math.abs(w - origin.w * srcW)) w = heightDrag * ratio;
  w = clamp(w, srcW * 0.12, srcW);
  let h = w / ratio;
  if (h > srcH) {
    h = srcH;
    w = h * ratio;
  }
  let x = corner.includes("w") ? right - w : origin.x * srcW;
  let y = corner.includes("n") ? bottom - h : origin.y * srcH;
  x = clamp(x, 0, srcW - w);
  y = clamp(y, 0, srcH - h);
  editor.crop = { x: x / srcW, y: y / srcH, w: w / srcW, h: h / srcH };
}

function visibleCrop() {
  const crop = editor.crop || defaultCrop();
  if (!editor.follow || !editor.track?.length) return crop;
  const time = el("preview")?.currentTime || 0;
  const center = sampleTrack(editor.track, time);
  return {
    ...crop,
    x: clamp(center.x - crop.w / 2, 0, 1 - crop.w),
    y: clamp(center.y - crop.h / 2, 0, 1 - crop.h),
  };
}

function sampleTrack(points, time) {
  if (!points.length) return { x: 0.5, y: 0.5 };
  if (time <= points[0].t) return points[0];
  const last = points[points.length - 1];
  if (time >= last.t) return last;
  let low = 0;
  let high = points.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (points[mid].t <= time) low = mid;
    else high = mid;
  }
  const a = points[low];
  const b = points[high];
  const span = b.t - a.t || 1;
  const blend = (time - a.t) / span;
  return { x: a.x + (b.x - a.x) * blend, y: a.y + (b.y - a.y) * blend };
}

function setFollowNote(text) {
  el("follow-note").textContent = text;
}

function startTracking() {
  const token = {};
  editor.trackToken = token;
  editor.track = null;
  if (!editor.sourcePath || !editor.workDir) {
    setFollowNote("The frame stays centered.");
    return;
  }
  setFollowNote("Looking for the action...");
  api.trackJob({ workDir: editor.workDir, sourcePath: editor.sourcePath }).then((response) => {
    if (editor.trackToken !== token) return;
    if (!response?.ok || !response.result?.points?.length) {
      setFollowNote("Could not track the action. Drag the orange frame yourself.");
      return;
    }
    editor.track = response.result.points;
    if (editor.follow) setFollowNote("The orange frame follows the action.");
    layoutCrop();
  });
}

function selectedClip() {
  return editor.clips[editor.selected] || null;
}

function parseTime(value) {
  const text = String(value).trim();
  if (!text) return NaN;
  if (text.includes(":")) {
    const [minutes, seconds] = text.split(":");
    return Number(minutes) * 60 + Number(seconds);
  }
  return Number(text);
}

function formatExact(seconds) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remain = safe - minutes * 60;
  return `${minutes}:${remain.toFixed(1).padStart(4, "0")}`;
}

function applyClipBounds(clip) {
  clip.start = clamp(clip.start, 0, Math.max(0, editor.duration - 3));
  clip.end = clamp(clip.end, clip.start + 3, Math.min(editor.duration, clip.start + MAX_CUT));
}

function openEditor(result) {
  editor.open = true;
  editor.workDir = result.workDir;
  editor.duration = result.duration;
  editor.sourceWidth = result.width || 1920;
  editor.sourceHeight = result.height || 1080;
  editor.clips = result.clips.map((clip) => ({ ...clip }));
  editor.clips.forEach(applyClipBounds);
  editor.selected = 0;
  editor.zoom = 1;
  editor.crop = defaultCrop();
  editor.follow = true;
  editor.track = null;
  editor.sourcePath = result.sourcePath || "";
  const filmKey = result.sourcePath || result.mediaUrl || "";
  if (editor.filmSource !== filmKey) {
    editor.filmstrip = [];
    editor.filmToken = null;
    editor.filmSource = filmKey;
    const film = el("picker-film");
    if (film) film.innerHTML = "";
  }
  el("follow").checked = true;
  editor.seqTime = 0;
  editor.sequencePlay = false;
  el("zoom").value = "1";
  el("zoom-label").textContent = "1.0x";
  document.querySelector("main").classList.add("editing");
  el("editor").hidden = false;
  el("empty").hidden = true;
  el("status").textContent = editor.clips.length ? "Edit the cuts" : "Mark a moment";
  el("export").disabled = editor.clips.length === 0;
  el("play").disabled = false;
  const video = el("preview");
  video.src = result.mediaUrl;
  video.addEventListener("loadedmetadata", () => {
    const previousW = editor.sourceWidth;
    const previousH = editor.sourceHeight;
    if (video.videoWidth) editor.sourceWidth = video.videoWidth;
    if (video.videoHeight) editor.sourceHeight = video.videoHeight;
    if (previousW !== editor.sourceWidth || previousH !== editor.sourceHeight) editor.crop = defaultCrop();
    layoutCrop();
    const clip = selectedClip();
    if (clip) video.currentTime = clip.start;
  }, { once: true });
  renderTimeline();
  renderInspector();
  layoutCrop();
  updateLiveOverlays();
  requestAnimationFrame(() => {
    layoutCrop();
    if (!editor.clips.length) openPicker(null);
  });
  startTracking();
  startFilmstrip();
}

function clipLength(clip) {
  return Math.max(0, clip.end - clip.start);
}

function sequenceSpans() {
  let cursor = 0;
  return editor.clips.map((clip, index) => {
    const duration = clipLength(clip);
    const span = { index, seq: cursor, duration };
    cursor += duration;
    return span;
  });
}

function sequenceDuration() {
  const spans = sequenceSpans();
  if (!spans.length) return 0;
  const last = spans[spans.length - 1];
  return last.seq + last.duration;
}

function basePx() {
  const view = Math.max(1, (el("timeline-scroll").clientWidth || 1) - 4);
  return view / Math.max(sequenceDuration(), 1);
}

function pxPerSecond() {
  return basePx() * editor.zoom;
}

function timelineWidth() {
  return Math.max(el("timeline-scroll").clientWidth || 1, sequenceDuration() * pxPerSecond());
}

function tickStep(px) {
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  return steps.find((step) => step * px >= 72) || 300;
}

function hitAt(seq) {
  const spans = sequenceSpans();
  if (!spans.length) return null;
  const safe = clamp(seq, 0, Math.max(0, sequenceDuration() - 0.001));
  const span = spans.find((item) => safe < item.seq + item.duration) || spans[spans.length - 1];
  const clip = editor.clips[span.index];
  return { ...span, clip, source: clip.start + (safe - span.seq) };
}

function renderTimeline() {
  const canvas = el("timeline-canvas");
  const scroll = el("timeline-scroll");
  const keep = scroll.scrollLeft;
  const total = sequenceDuration();
  const width = timelineWidth();
  canvas.style.width = `${width}px`;
  const ruler = el("ruler");
  ruler.innerHTML = "";
  const px = pxPerSecond();
  if (total > 0) {
    const step = tickStep(px);
    for (let time = 0; time <= total + 0.001; time += step) {
      const mark = document.createElement("span");
      mark.style.left = `${time * px}px`;
      mark.textContent = step < 1 ? formatExact(time) : clock(time);
      ruler.append(mark);
    }
  }
  const track = el("track");
  track.innerHTML = "";
  sequenceSpans().forEach((span) => {
    const clip = editor.clips[span.index];
    const block = document.createElement("button");
    block.type = "button";
    block.className = `clip-block${span.index === editor.selected ? " selected" : ""}`;
    block.style.left = `${span.seq * px}px`;
    block.style.width = `${Math.max(18, span.duration * px)}px`;
    block.dataset.index = String(span.index);
    const left = document.createElement("span");
    left.className = "handle left";
    const right = document.createElement("span");
    right.className = "handle right";
    const name = document.createElement("span");
    name.className = "clip-name";
    name.textContent = clip.title || `Cut ${span.index + 1}`;
    const dur = document.createElement("span");
    dur.className = "clip-dur";
    dur.textContent = clock(span.duration);
    block.append(left, name, dur, right);
    block.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      const handle = event.target.closest(".handle");
      if (handle && span.index === editor.selected) {
        trimClip(event, span.index, handle.classList.contains("left") ? "start" : "end");
        return;
      }
      reorderClip(event, span.index);
    });
    track.append(block);
  });
  placePlayhead();
  scroll.scrollLeft = keep;
  el("zoom").value = String(editor.zoom);
  el("zoom-label").textContent = `${editor.zoom.toFixed(1)}x`;
  el("snap-line").hidden = true;
}

function renderInspector() {
  const clip = selectedClip();
  const span = sequenceSpans()[editor.selected];
  const title = el("clip-title");
  if (document.activeElement !== title) title.value = clip ? clip.title : "";
  title.disabled = !clip;
  el("remove-clip").disabled = !clip;
  el("clip-readout").textContent = clip && span
    ? `${formatExact(clip.start)} to ${formatExact(clip.end)} · ${clock(span.duration)} on the timeline`
    : "Select a cut on the timeline.";
  syncTimeFields();
}

function syncTimeFields() {
  const clip = selectedClip();
  el("in-time").value = clip ? formatExact(clip.start) : "";
  el("out-time").value = clip ? formatExact(clip.end) : "";
}

function selectClip(index, seek) {
  if (!editor.clips[index]) return;
  editor.selected = index;
  const span = sequenceSpans()[index];
  if (seek && span) editor.seqTime = span.seq;
  renderTimeline();
  renderInspector();
  if (seek && span) el("preview").currentTime = editor.clips[index].start;
}

function slotForPointer(clientX, movingIndex) {
  const spans = sequenceSpans();
  const seq = timeAt(clientX);
  let slot = 0;
  for (let index = 0; index < spans.length; index += 1) {
    if (index === movingIndex) continue;
    const mid = spans[index].seq + spans[index].duration / 2;
    if (seq > mid) slot = index + 1;
  }
  if (slot > movingIndex) slot -= 1;
  return clamp(slot, 0, Math.max(0, editor.clips.length - 1));
}

function showSnap(index) {
  const spans = sequenceSpans();
  const seq = spans[index] ? spans[index].seq : sequenceDuration();
  const line = el("snap-line");
  line.hidden = false;
  line.style.left = `${seq * pxPerSecond()}px`;
}

function trimClip(event, index, edge) {
  event.preventDefault();
  event.stopPropagation();
  editor.sequencePlay = false;
  el("preview").pause();
  editor.selected = index;
  const originX = event.clientX;
  const original = { ...editor.clips[index] };
  const move = (moveEvent) => {
    const delta = (moveEvent.clientX - originX) / pxPerSecond();
    const clip = editor.clips[index];
    if (edge === "start") clip.start = original.start + delta;
    else clip.end = original.end + delta;
    applyClipBounds(clip);
    const span = sequenceSpans()[index];
    editor.seqTime = span ? span.seq : 0;
    renderTimeline();
    renderInspector();
    el("preview").currentTime = edge === "start" ? clip.start : Math.max(clip.start, clip.end - 0.2);
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function reorderClip(event, index) {
  event.preventDefault();
  editor.sequencePlay = false;
  el("preview").pause();
  editor.selected = index;
  const originX = event.clientX;
  let moved = false;
  const move = (moveEvent) => {
    if (Math.abs(moveEvent.clientX - originX) < 4) return;
    moved = true;
    const target = slotForPointer(moveEvent.clientX, editor.selected);
    if (target !== editor.selected) {
      const [clip] = editor.clips.splice(editor.selected, 1);
      editor.clips.splice(target, 0, clip);
      editor.selected = target;
      renderTimeline();
      renderInspector();
    }
    showSnap(editor.selected);
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    el("snap-line").hidden = true;
    if (!moved) {
      const span = sequenceSpans()[editor.selected];
      if (span) seekSequence(span.seq);
    } else {
      renderTimeline();
    }
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function markSelected() {
  document.querySelectorAll(".clip-block").forEach((block, index) => {
    block.classList.toggle("selected", index === editor.selected);
  });
  renderInspector();
}

function placePlayhead() {
  const total = sequenceDuration();
  const px = clamp(editor.seqTime || 0, 0, total || 0) * pxPerSecond();
  el("playhead").style.left = `${px}px`;
  el("time-readout").textContent = `${clock(editor.seqTime || 0)} / ${clock(total)}`;
  if (editor.sequencePlay) {
    const scroll = el("timeline-scroll");
    const view = scroll.clientWidth;
    if (px < scroll.scrollLeft + 24 || px > scroll.scrollLeft + view - 24) {
      scroll.scrollLeft = Math.max(0, px - view * 0.25);
    }
  }
}


function setFrame(preset, width, height) {
  state.preset = preset;
  state.outW = even(width);
  state.outH = even(height);
  el("out-w").value = String(state.outW);
  el("out-h").value = String(state.outH);
  document.querySelectorAll(".preset").forEach((button) => {
    button.classList.toggle("active", button.dataset.preset === preset);
  });
  if (editor.open && editor.sourceWidth) {
    refitCrop();
    layoutCrop();
  }
  if (!hydrating) persist();
}

document.querySelectorAll(".preset").forEach((button) => {
  button.addEventListener("click", () => {
    setFrame(button.dataset.preset, Number(button.dataset.w), Number(button.dataset.h));
  });
});

function readCustomFrame() {
  const width = even(Number(el("out-w").value));
  const height = even(Number(el("out-h").value));
  if (!Number.isFinite(width) || !Number.isFinite(height)) return;
  const match = [...document.querySelectorAll(".preset")].find((button) => Number(button.dataset.w) === width && Number(button.dataset.h) === height);
  setFrame(match ? match.dataset.preset : "custom", width, height);
}

el("out-w").addEventListener("change", readCustomFrame);
el("out-h").addEventListener("change", readCustomFrame);

el("crop-box").addEventListener("pointerdown", (event) => {
  if (!editor.open || !editor.crop || event.target.closest(".layer")) return;
  editor.layer = "crop";
  paintLayers();
  editor.crop = visibleCrop();
  const grip = event.target.closest("[data-resize]");
  if (!grip) {
    editor.follow = false;
    el("follow").checked = false;
    setFollowNote("The frame stays where you put it.");
  }
  const rect = el("crop-canvas").getBoundingClientRect();
  const origin = { ...editor.crop };
  const startX = event.clientX;
  const startY = event.clientY;
  event.preventDefault();
  const move = (moveEvent) => {
    if (grip) resizeCrop(origin, grip.dataset.resize, moveEvent.clientX - startX, moveEvent.clientY - startY, rect);
    else moveCrop(origin, moveEvent.clientX - startX, moveEvent.clientY - startY, rect);
    layoutCrop();
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
});

function timeAt(clientX) {
  const rect = el("timeline-canvas").getBoundingClientRect();
  const x = clamp(clientX - rect.left, 0, rect.width);
  return (x / Math.max(rect.width, 1)) * sequenceDuration();
}

function seekSequence(seq) {
  const total = sequenceDuration();
  if (!total) return;
  editor.seqTime = clamp(seq, 0, total);
  const hit = hitAt(editor.seqTime);
  if (!hit) return;
  editor.selected = hit.index;
  markSelected();
  const video = el("preview");
  if (Math.abs((video.currentTime || 0) - hit.source) > 0.08) video.currentTime = hit.source;
  placePlayhead();
}

function scrubFrom(event) {
  editor.sequencePlay = false;
  el("preview").pause();
  const move = (moveEvent) => seekSequence(timeAt(moveEvent.clientX));
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  move(event);
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

el("timeline-scroll").addEventListener("pointerdown", (event) => {
  if (!sequenceDuration() || event.target.closest(".clip-block") || event.target.closest(".playhead")) return;
  scrubFrom(event);
});

el("playhead").addEventListener("pointerdown", (event) => {
  if (!sequenceDuration()) return;
  event.stopPropagation();
  event.preventDefault();
  scrubFrom(event);
});

el("timeline-scroll").addEventListener("wheel", (event) => {
  if (!editor.open || !sequenceDuration()) return;
  event.preventDefault();
  const scroll = el("timeline-scroll");
  const rect = scroll.getBoundingClientRect();
  const cursor = event.clientX - rect.left;
  const ratio = (scroll.scrollLeft + cursor) / timelineWidth();
  editor.zoom = clamp(editor.zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15), 1, 24);
  renderTimeline();
  scroll.scrollLeft = ratio * timelineWidth() - cursor;
}, { passive: false });

function zoomAroundCenter(next) {
  const scroll = el("timeline-scroll");
  const ratio = (scroll.scrollLeft + scroll.clientWidth / 2) / timelineWidth();
  editor.zoom = clamp(next, 1, 24);
  renderTimeline();
  scroll.scrollLeft = ratio * timelineWidth() - scroll.clientWidth / 2;
}

el("zoom").addEventListener("input", () => zoomAroundCenter(Number(el("zoom").value)));
el("zoom-in").addEventListener("click", () => zoomAroundCenter(editor.zoom * 1.25));
el("zoom-out").addEventListener("click", () => zoomAroundCenter(editor.zoom / 1.25));

el("play").addEventListener("click", () => {
  const video = el("preview");
  if (!sequenceDuration()) return;
  if (!video.paused) {
    video.pause();
    return;
  }
  if (editor.seqTime >= sequenceDuration() - 0.05) editor.seqTime = 0;
  const hit = hitAt(editor.seqTime);
  if (!hit) return;
  editor.selected = hit.index;
  editor.sequencePlay = true;
  video.currentTime = hit.source;
  video.play();
  el("play").textContent = "Pause";
  markSelected();
});

el("preview").addEventListener("timeupdate", () => {
  if (editor.follow) layoutCrop();
  const video = el("preview");
  if (editor.picker?.playing && !video.paused) {
    const pick = editor.picker;
    if (video.currentTime >= pick.end - 0.05) {
      pick.playing = false;
      video.pause();
      el("picker-play").textContent = "Play";
      placePickerHead(pick.end);
      return;
    }
    placePickerHead(video.currentTime);
    return;
  }
  if (!editor.sequencePlay || video.paused) {
    placePlayhead();
    return;
  }
  const clip = selectedClip();
  const span = sequenceSpans()[editor.selected];
  if (!clip || !span) return;
  if (video.currentTime >= clip.end - 0.04) {
    const next = sequenceSpans()[editor.selected + 1];
    if (!next) {
      editor.sequencePlay = false;
      editor.seqTime = sequenceDuration();
      video.pause();
    } else {
      editor.selected = next.index;
      editor.seqTime = next.seq;
      video.currentTime = editor.clips[next.index].start;
      markSelected();
    }
  } else {
    editor.seqTime = span.seq + Math.max(0, video.currentTime - clip.start);
  }
  placePlayhead();
});

el("preview").addEventListener("seeked", () => {
  if (editor.follow) layoutCrop();
});

el("preview").addEventListener("pause", () => {
  editor.sequencePlay = false;
  el("play").textContent = "Play";
  if (editor.picker) {
    editor.picker.playing = false;
    el("picker-play").textContent = "Play";
  }
});

el("in-time").addEventListener("change", () => {
  const clip = selectedClip();
  if (!clip) return;
  const value = parseTime(el("in-time").value);
  if (Number.isFinite(value)) clip.start = value;
  applyClipBounds(clip);
  const span = sequenceSpans()[editor.selected];
  if (span) editor.seqTime = span.seq;
  renderTimeline();
  renderInspector();
  el("preview").currentTime = clip.start;
});

el("out-time").addEventListener("change", () => {
  const clip = selectedClip();
  if (!clip) return;
  const value = parseTime(el("out-time").value);
  if (Number.isFinite(value)) clip.end = value;
  applyClipBounds(clip);
  renderTimeline();
  renderInspector();
});

function removeSelected() {
  if (!editor.clips.length) return;
  editor.clips.splice(editor.selected, 1);
  editor.selected = Math.max(0, Math.min(editor.selected, editor.clips.length - 1));
  editor.seqTime = sequenceSpans()[editor.selected]?.seq || 0;
  renderTimeline();
  renderInspector();
  el("export").disabled = editor.clips.length === 0;
}

el("remove-clip").addEventListener("click", removeSelected);

el("clip-title").addEventListener("input", () => {
  const clip = selectedClip();
  if (!clip) return;
  clip.title = el("clip-title").value;
  const name = document.querySelector(".clip-block.selected .clip-name");
  if (name) name.textContent = clip.title || `Cut ${editor.selected + 1}`;
});

el("export").addEventListener("click", () => exportCuts(editor.clips, el("mix").checked, false));

async function exportCuts(clips, mix, single) {
  const usable = clips.filter(Boolean);
  if (state.running || !editor.open || usable.length === 0) return;
  showFormError("");
  setBusy(true);
  el("status").textContent = single ? "Exporting this clip" : "Exporting";
  el("error").hidden = true;
  const steps = [];
  api.onStatus((message) => {
    const existing = steps.find((step) => step.key === "export");
    if (existing) existing.label = message;
    else steps.push({ key: "export", label: message });
    renderSteps(steps);
    el("status").textContent = message;
  });
  const response = await api.exportJob({
    workDir: editor.workDir,
    outputDir: state.outputDir,
    name: el("name").value,
    mode: state.mode,
    width: state.outW,
    height: state.outH,
    crop: editor.crop || defaultCrop(),
    follow: Boolean(editor.follow && editor.track?.length),
    track: editor.follow ? editor.track : [],
    single: Boolean(single),
    mix: Boolean(mix) && !single,
    watermarkText: el("watermark").value.trim(),
    watermarkCorner: el("watermark-corner").value,
    overlayText: el("overlay-text").value.trim(),
    overlayPlace: el("overlay-place").value,
    watermarkImage: editor.watermarkImage,
    logoBox: editor.logo,
    watermarkPos: editor.wmPos,
    titlePos: editor.titlePos,
    clips: usable.map((clip) => ({
      id: clip.id,
      title: clip.title,
      hook: clip.hook,
      start: clip.start,
      end: clip.end,
      score: clip.score,
    })),
  });
  api.clearStatus();
  setBusy(false);
  el("export").disabled = editor.clips.length === 0;
  el("play").disabled = false;
  if (!response?.ok) {
    el("status").textContent = "Export failed";
    el("error").hidden = false;
    el("error").textContent = response?.error || "Export failed.";
    return;
  }
  el("status").textContent = single ? "Exported this clip" : "Exported";
  state.outputResult = response.result.outputDir;
  el("open-folder").hidden = false;
  renderResults(response.result);
  const notes = [];
  if (response.result.mixError) notes.push(response.result.mixError);
  if (response.result.warnings?.length) notes.push(...response.result.warnings);
  if (notes.length) {
    el("error").hidden = false;
    el("error").textContent = notes.join(" ");
  }
  loadHistory();
}

window.addEventListener("keydown", (event) => {
  if (event.target.closest("input, textarea, select") || !editor.open) return;
  if (event.code === "Escape") {
    el("menu").hidden = true;
    if (editor.picker) closePicker();
    return;
  }
  if (editor.picker) {
    if (event.code === "Space") {
      event.preventDefault();
      togglePickerPlay();
    }
    return;
  }
  if (event.code === "Space") {
    event.preventDefault();
    el("play").click();
  }
  if (event.code === "Delete" || event.code === "Backspace") {
    event.preventDefault();
    removeSelected();
  }
});

window.addEventListener("resize", () => layoutCrop());

function placeLogo(corner, width) {
  const w = width || 0.18;
  const h = logoHeight(w);
  const m = 0.04;
  if (corner === "tl") return { x: m, y: m, w };
  if (corner === "tr") return { x: 1 - w - m, y: m, w };
  if (corner === "bl") return { x: m, y: 1 - h - m, w };
  return { x: 1 - w - m, y: 1 - h - m, w };
}

function placeWm(corner) {
  const m = 0.04;
  if (corner === "tl") return { x: m, y: 0.12 };
  if (corner === "tr") return { x: 0.46, y: 0.12 };
  if (corner === "bl") return { x: m, y: 0.86 };
  return { x: 0.46, y: 0.86 };
}

function placeTitle(place) {
  if (place === "middle") return { x: 0.14, y: 0.44 };
  if (place === "bottom") return { x: 0.14, y: 0.8 };
  return { x: 0.14, y: 0.05 };
}

function logoHeight(width) {
  const img = el("live-logo");
  const aspect = img.naturalWidth ? img.naturalHeight / img.naturalWidth : 0.6;
  return width * aspect * (state.outW / Math.max(1, state.outH));
}

function paintLayers() {
  const watermark = el("watermark").value.trim();
  const title = el("overlay-text").value.trim();
  el("live-wm").textContent = watermark;
  el("live-title").textContent = title;
  const wm = el("wm-layer");
  const titleLayer = el("title-layer");
  const logoLayer = el("logo-layer");
  wm.hidden = !watermark;
  titleLayer.hidden = !title;
  logoLayer.hidden = !editor.watermarkImage;
  if (!editor.wmPos) editor.wmPos = placeWm(el("watermark-corner").value);
  if (!editor.titlePos) editor.titlePos = placeTitle(el("overlay-place").value);
  if (editor.watermarkImage && !editor.logo) editor.logo = placeLogo(el("watermark-corner").value, 0.18);
  positionLayer(wm, editor.wmPos);
  positionLayer(titleLayer, editor.titlePos);
  if (editor.logo) {
    const h = logoHeight(editor.logo.w);
    editor.logo.x = clamp(editor.logo.x, 0, Math.max(0, 1 - editor.logo.w));
    editor.logo.y = clamp(editor.logo.y, 0, Math.max(0, 1 - h));
    logoLayer.style.left = `${editor.logo.x * 100}%`;
    logoLayer.style.top = `${editor.logo.y * 100}%`;
    logoLayer.style.width = `${editor.logo.w * 100}%`;
  }
  logoLayer.classList.toggle("selected", editor.layer === "logo");
  wm.classList.toggle("selected", editor.layer === "wm");
  titleLayer.classList.toggle("selected", editor.layer === "title");
  const logo = el("live-logo");
  if (editor.watermarkImage) {
    const src = `media://clip/play?path=${encodeURIComponent(editor.watermarkImage)}`;
    if (logo.getAttribute("src") !== src) logo.src = src;
    el("watermark-file").textContent = editor.watermarkImage.split(/[/\\]/).pop();
    el("watermark-clear").hidden = false;
  } else {
    logo.removeAttribute("src");
    el("watermark-file").textContent = "No logo";
    el("watermark-clear").hidden = true;
  }
}

function positionLayer(node, pos) {
  node.style.left = `${pos.x * 100}%`;
  node.style.top = `${pos.y * 100}%`;
  node.style.right = "auto";
  node.style.bottom = "auto";
}

function updateLiveOverlays() {
  paintLayers();
}

function dragLayer(event, key) {
  if (event.target.closest("[data-logo]")) return;
  event.preventDefault();
  event.stopPropagation();
  editor.layer = key;
  const current = key === "logo" ? editor.logo : key === "wm" ? editor.wmPos : editor.titlePos;
  if (!current) return;
  const pointer = { x: event.clientX, y: event.clientY };
  const origin = { ...current };
  const rect = el("crop-box").getBoundingClientRect();
  const move = (moveEvent) => {
    const dx = (moveEvent.clientX - pointer.x) / Math.max(rect.width, 1);
    const dy = (moveEvent.clientY - pointer.y) / Math.max(rect.height, 1);
    const h = key === "logo" ? logoHeight(origin.w) : 0.08;
    const width = origin.w || 0.2;
    const next = {
      x: clamp(origin.x + dx, 0, Math.max(0, 1 - width)),
      y: clamp(origin.y + dy, 0, Math.max(0, 1 - h)),
    };
    if (key === "logo") editor.logo = { x: next.x, y: next.y, w: origin.w };
    if (key === "wm") editor.wmPos = next;
    if (key === "title") editor.titlePos = next;
    paintLayers();
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    persist();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

el("logo-layer").addEventListener("pointerdown", (event) => dragLayer(event, "logo"));
el("wm-layer").addEventListener("pointerdown", (event) => dragLayer(event, "wm"));
el("title-layer").addEventListener("pointerdown", (event) => dragLayer(event, "title"));

el("logo-layer").addEventListener("pointerdown", (event) => {
  const grip = event.target.closest("[data-logo]");
  if (!grip || !editor.logo) return;
  event.preventDefault();
  event.stopPropagation();
  editor.layer = "logo";
  const origin = { ...editor.logo };
  const rect = el("crop-box").getBoundingClientRect();
  const move = (moveEvent) => {
    const dw = (moveEvent.clientX - event.clientX) / rect.width;
    editor.logo = { ...origin, w: clamp(origin.w + dw, 0.06, 0.62) };
    paintLayers();
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    persist();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
});

el("live-logo").addEventListener("load", () => paintLayers());

for (const id of ["watermark", "overlay-text", "mix"]) {
  el(id).addEventListener("input", () => {
    updateLiveOverlays();
    if (!hydrating) persist();
  });
}

el("watermark-corner").addEventListener("change", () => {
  const corner = el("watermark-corner").value;
  if (editor.logo) editor.logo = placeLogo(corner, editor.logo.w);
  editor.wmPos = placeWm(corner);
  updateLiveOverlays();
  if (!hydrating) persist();
});

el("overlay-place").addEventListener("change", () => {
  editor.titlePos = placeTitle(el("overlay-place").value);
  updateLiveOverlays();
  if (!hydrating) persist();
});

el("watermark-image").addEventListener("click", async () => {
  const filePath = await api.pickImage();
  if (!filePath) return;
  editor.watermarkImage = filePath;
  editor.logo = placeLogo(el("watermark-corner").value, editor.logo?.w || 0.18);
  editor.layer = "logo";
  updateLiveOverlays();
  persist();
});

el("watermark-clear").addEventListener("click", () => {
  editor.watermarkImage = "";
  editor.logo = null;
  editor.layer = "crop";
  updateLiveOverlays();
  persist();
});

function layoutFilmstrip() {
  const film = el("picker-film");
  if (!film || !editor.duration) return;
  const px = pickerPx();
  film.style.width = `${editor.duration * px}px`;
  const frames = editor.filmstrip;
  for (let index = 0; index < frames.length; index++) {
    const img = film.children[index];
    if (!img) continue;
    const next = frames[index + 1]?.t ?? editor.duration;
    img.style.width = `${Math.max(2, (next - frames[index].t) * px)}px`;
  }
}

function seekGrab(video, time) {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 2 && Math.abs(video.currentTime - time) < 0.05) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("frame"));
    }, 1200);
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener("seeked", onSeek);
      video.removeEventListener("error", onError);
    };
    const onSeek = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("frame"));
    };
    video.addEventListener("seeked", onSeek);
    video.addEventListener("error", onError);
    try {
      video.currentTime = time;
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

function frameGrabber() {
  let grab = el("frame-grab");
  if (grab) return grab;
  grab = document.createElement("video");
  grab.id = "frame-grab";
  grab.muted = true;
  grab.playsInline = true;
  grab.preload = "auto";
  grab.crossOrigin = "anonymous";
  document.body.append(grab);
  return grab;
}

function startFilmstrip() {
  const preview = el("preview");
  if (!editor.open || !editor.duration || !preview.src) return;
  if (editor.filmToken || editor.filmstrip.length) {
    layoutFilmstrip();
    return;
  }
  const token = {};
  editor.filmToken = token;
  const grab = frameGrabber();
  const count = Math.min(72, Math.max(16, Math.round(editor.duration / 2)));
  const step = editor.duration / count;
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 90;
  const draw = async () => {
    if (editor.filmToken !== token) return;
    const ratio = (grab.videoWidth && grab.videoHeight) ? grab.videoHeight / grab.videoWidth : 9 / 16;
    canvas.height = Math.max(48, Math.round(canvas.width * ratio));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;
    const film = el("picker-film");
    for (let index = 0; index < count; index++) {
      if (editor.filmToken !== token) return;
      const slot = index * step;
      const at = Math.min(Math.max(0, editor.duration - 0.05), slot + step * 0.35);
      try {
        await seekGrab(grab, at);
        if (editor.filmToken !== token) return;
        context.drawImage(grab, 0, 0, canvas.width, canvas.height);
        let url = "";
        try {
          url = canvas.toDataURL("image/jpeg", 0.68);
        } catch {
          editor.filmstrip = [];
          film.innerHTML = "";
          editor.filmToken = { fallback: true };
          loadFilmstripFiles();
          return;
        }
        editor.filmstrip.push({ t: slot, url });
        const img = document.createElement("img");
        img.src = url;
        img.alt = "";
        film.append(img);
        if (editor.picker) layoutFilmstrip();
      } catch {
        // Skip a frame the decoder did not land on.
      }
    }
  };
  if (grab.src === preview.src && grab.readyState >= 1) draw();
  else {
    grab.src = preview.src;
    grab.addEventListener("loadedmetadata", () => draw(), { once: true });
  }
}

function loadFilmstripFiles() {
  if (!editor.workDir || !editor.sourcePath) return;
  const source = editor.sourcePath;
  api.filmstrip({
    workDir: editor.workDir,
    sourcePath,
    duration: editor.duration,
  }).then((response) => {
    if (editor.sourcePath !== source || !response?.ok || !response.frames?.length) return;
    editor.filmstrip = response.frames;
    const film = el("picker-film");
    film.innerHTML = "";
    for (const frame of response.frames) {
      const img = document.createElement("img");
      img.src = frame.url;
      img.alt = "";
      film.append(img);
    }
    if (editor.picker) layoutFilmstrip();
  });
}

function pickerPx() {
  const view = Math.max(1, (el("picker-scroll").clientWidth || 1) - 4);
  const zoom = editor.picker?.zoom || 1;
  return (view / Math.max(editor.duration, 0.1)) * zoom;
}

function openPicker(index) {
  if (!editor.open || !editor.duration) return;
  const video = el("preview");
  video.pause();
  editor.sequencePlay = false;
  el("play").textContent = "Play";
  let start = 0;
  let end = Math.min(15, editor.duration);
  if (index == null) {
    const length = Math.min(15, editor.duration);
    const cursor = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    start = clamp(cursor, 0, Math.max(0, editor.duration - length));
    end = Math.min(editor.duration, start + length);
  } else {
    const clip = editor.clips[index];
    if (!clip) return;
    start = clip.start;
    end = clip.end;
    editor.selected = index;
  }
  editor.picker = { index, start, end, zoom: 1, playing: false };
  el("picker-play").textContent = "Play";
  el("menu").hidden = true;
  el("picker").hidden = false;
  renderPicker();
  startFilmstrip();
  const scroll = el("picker-scroll");
  scroll.scrollLeft = Math.max(0, start * pickerPx() - 40);
  seekPicker();
}

function closePicker() {
  const video = el("preview");
  if (editor.picker?.playing) video.pause();
  editor.picker = null;
  el("picker").hidden = true;
  el("picker-play").textContent = "Play";
}

function seekPicker() {
  const video = el("preview");
  if (!editor.picker) return;
  if (editor.picker.playing) {
    editor.picker.playing = false;
    video.pause();
    el("picker-play").textContent = "Play";
  }
  const time = editor.picker.start;
  if (Math.abs(video.currentTime - time) > 0.05) video.currentTime = time;
}

function togglePickerPlay() {
  const pick = editor.picker;
  if (!pick) return;
  const video = el("preview");
  editor.sequencePlay = false;
  if (pick.playing && !video.paused) {
    video.pause();
    return;
  }
  let time = video.currentTime;
  if (time < pick.start - 0.05 || time >= pick.end - 0.08) time = pick.start;
  pick.playing = true;
  el("picker-play").textContent = "Pause";
  if (Math.abs(video.currentTime - time) > 0.05) video.currentTime = time;
  video.play().catch(() => {
    pick.playing = false;
    el("picker-play").textContent = "Play";
  });
}

function placePickerHead(time) {
  const pick = editor.picker;
  if (!pick) return;
  const px = pickerPx();
  el("picker-playhead").style.left = `${time * px}px`;
  const scroll = el("picker-scroll");
  const x = time * px;
  const edge = 48;
  if (x < scroll.scrollLeft + edge || x > scroll.scrollLeft + scroll.clientWidth - edge) {
    scroll.scrollLeft = Math.max(0, x - scroll.clientWidth * 0.3);
  }
  el("picker-readout").textContent = `${clock(time)}   ${clock(pick.start)} - ${clock(pick.end)}`;
}

function renderPicker() {
  const pick = editor.picker;
  if (!pick) return;
  const px = pickerPx();
  const width = Math.max(el("picker-scroll").clientWidth || 1, editor.duration * px);
  el("picker-canvas").style.width = `${width}px`;
  const ruler = el("picker-ruler");
  ruler.innerHTML = "";
  const step = tickStep(px);
  for (let time = 0; time <= editor.duration + 0.001; time += step) {
    const mark = document.createElement("span");
    mark.style.left = `${time * px}px`;
    mark.textContent = step < 1 ? formatExact(time) : clock(time);
    ruler.append(mark);
  }
  const track = el("picker-track");
  track.querySelectorAll(".clip-block").forEach((node) => node.remove());
  const block = document.createElement("button");
  block.type = "button";
  block.className = "clip-block selected";
  block.style.left = `${pick.start * px}px`;
  block.style.width = `${Math.max(18, (pick.end - pick.start) * px)}px`;
  const left = document.createElement("span");
  left.className = "handle left";
  const right = document.createElement("span");
  right.className = "handle right";
  const name = document.createElement("span");
  name.className = "clip-name";
  name.textContent = pick.index == null ? "New cut" : (editor.clips[pick.index]?.title || "Cut");
  const dur = document.createElement("span");
  dur.className = "clip-dur";
  dur.textContent = clock(pick.end - pick.start);
  block.append(left, name, dur, right);
  block.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.target.closest(".handle");
    dragPicker(event, handle ? (handle.classList.contains("left") ? "start" : "end") : "body");
  });
  track.append(block);
  const leftShade = el("picker-shade-left");
  const rightShade = el("picker-shade-right");
  leftShade.style.width = `${pick.start * px}px`;
  rightShade.style.left = `${pick.end * px}px`;
  rightShade.style.width = `${Math.max(0, editor.duration * px - pick.end * px)}px`;
  layoutFilmstrip();
  const head = pick.playing ? el("preview").currentTime : pick.start;
  el("picker-playhead").style.left = `${head * px}px`;
  el("picker-readout").textContent = `${clock(pick.start)} - ${clock(pick.end)}`;
}

function dragPicker(event, edge) {
  const origin = event.clientX;
  const start0 = editor.picker.start;
  const end0 = editor.picker.end;
  const px = pickerPx();
  const move = (ev) => {
    const delta = (ev.clientX - origin) / px;
    if (edge === "body") {
      const length = end0 - start0;
      const start = clamp(start0 + delta, 0, Math.max(0, editor.duration - length));
      editor.picker.start = start;
      editor.picker.end = start + length;
    } else if (edge === "start") {
      editor.picker.start = clamp(start0 + delta, Math.max(0, end0 - MAX_CUT), end0 - 3);
    } else {
      editor.picker.end = clamp(end0 + delta, start0 + 3, Math.min(editor.duration, start0 + MAX_CUT));
    }
    renderPicker();
    seekPicker();
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function commitPicker() {
  const pick = editor.picker;
  if (!pick) return;
  const start = Math.max(0, pick.start);
  const end = Math.min(editor.duration, pick.end);
  if (end - start < 3) return;
  if (pick.index == null) {
    editor.clips.push({
      id: `manual-${Date.now()}`,
      title: `Cut ${editor.clips.length + 1}`,
      hook: "",
      start,
      end,
      score: 0,
    });
    editor.selected = editor.clips.length - 1;
  } else if (editor.clips[pick.index]) {
    editor.clips[pick.index].start = start;
    editor.clips[pick.index].end = end;
    editor.selected = pick.index;
  }
  closePicker();
  const span = sequenceSpans().find((item) => item.index === editor.selected);
  editor.seqTime = span ? span.seq : 0;
  renderTimeline();
  renderInspector();
  el("export").disabled = editor.clips.length === 0;
  const clip = selectedClip();
  if (clip) el("preview").currentTime = clip.start;
  placePlayhead();
}

function openMenu(x, y, index) {
  const menu = el("menu");
  menu.hidden = false;
  menu.dataset.index = index == null ? "" : String(index);
  for (const action of ["pick", "play", "remove", "export"]) {
    menu.querySelector(`[data-menu="${action}"]`).hidden = index == null;
  }
  menu.style.left = "0px";
  menu.style.top = "0px";
  const box = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - box.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - box.height - 8))}px`;
}

function playFrom(index) {
  const span = sequenceSpans().find((item) => item.index === index);
  if (!span) return;
  editor.selected = index;
  editor.seqTime = span.seq;
  const video = el("preview");
  video.pause();
  el("play").click();
}

el("add-clip").addEventListener("click", () => openPicker(null));
el("picker-cancel").addEventListener("click", closePicker);
el("picker-play").addEventListener("click", togglePickerPlay);
el("picker-done").addEventListener("click", commitPicker);

el("timeline-scroll").addEventListener("contextmenu", (event) => {
  if (!editor.open || editor.picker) return;
  event.preventDefault();
  const block = event.target.closest(".clip-block");
  const index = block ? Number(block.dataset.index) : null;
  openMenu(event.clientX, event.clientY, Number.isFinite(index) ? index : null);
});

el("menu").addEventListener("click", (event) => {
  const action = event.target.closest("button")?.dataset.menu;
  if (!action) return;
  const raw = el("menu").dataset.index;
  const index = raw === "" ? null : Number(raw);
  el("menu").hidden = true;
  if (action === "add") openPicker(null);
  if (action === "pick" && index != null) openPicker(index);
  if (action === "remove" && index != null) {
    editor.selected = index;
    removeSelected();
  }
  if (action === "play" && index != null) playFrom(index);
  if (action === "export" && index != null) exportCuts([editor.clips[index]], false, true);
});

document.addEventListener("pointerdown", (event) => {
  if (!el("menu").hidden && !event.target.closest("#menu")) el("menu").hidden = true;
});

el("timeline-scroll").addEventListener("scroll", () => {
  el("menu").hidden = true;
});

el("picker-scroll").addEventListener("wheel", (event) => {
  if (!editor.picker) return;
  event.preventDefault();
  const scroll = el("picker-scroll");
  const rect = scroll.getBoundingClientRect();
  const cursor = event.clientX - rect.left;
  const before = pickerPx();
  const ratio = (scroll.scrollLeft + cursor) / Math.max(1, editor.duration * before);
  editor.picker.zoom = clamp(editor.picker.zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15), 1, 24);
  renderPicker();
  scroll.scrollLeft = ratio * editor.duration * pickerPx() - cursor;
}, { passive: false });

el("follow").addEventListener("change", () => {
  if (!el("follow").checked) editor.crop = visibleCrop();
  editor.follow = el("follow").checked;
  layoutCrop();
  if (!editor.follow) setFollowNote("The frame stays where you put it.");
  else if (editor.track?.length) setFollowNote("The orange frame follows the action.");
  else setFollowNote("Looking for the action...");
});

async function loadHistory() {
  const items = await api.listHistory();
  const box = el("history");
  box.innerHTML = "";
  if (!items?.length) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "Clips you find stay on this computer.";
    box.append(empty);
    return;
  }
  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    if (!item.sourceReady) button.className = "missing";
    const title = document.createElement("strong");
    title.textContent = item.title || "Untitled";
    const meta = document.createElement("span");
    const when = item.createdAt ? new Date(item.createdAt) : null;
    const date = when && !Number.isNaN(when.getTime())
      ? when.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
      : "";
    const count = item.clipCount ? `${item.clipCount} clips` : "No clips yet";
    meta.textContent = [count, date, item.sourceReady ? "" : "Video missing"].filter(Boolean).join(", ");
    button.append(title, meta);
    button.addEventListener("click", () => {
      if (state.running) return;
      if (!item.sourceReady) {
        showFormError("That video is no longer on this computer.");
        return;
      }
      showFormError("");
      if (item.title) el("name").value = String(item.title).slice(0, 80);
      openEditor(item);
    });
    box.append(button);
  }
}

api.onTrack((message) => {
  if (!editor.open || !editor.follow) return;
  setFollowNote(message);
});

api.loadSettings().then((settings) => {
  state.outputDir = settings?.outputDir || "";
  state.lastVideoDir = settings?.lastVideoDir || "";
  state.mode = settings?.mode === "advanced" ? "advanced" : "basic";
  state.sourceKind = settings?.sourceKind === "local" ? "local" : "youtube";
  el("folder-label").textContent = state.outputDir || "Choose a folder";
  setSource(state.sourceKind);
  setMode(state.mode);
  setFrame(settings?.framePreset || "9:16", settings?.outW || 1080, settings?.outH || 1920);
  el("mix").checked = Boolean(settings?.mix);
  el("watermark").value = settings?.watermarkText || "";
  el("watermark-corner").value = settings?.watermarkCorner || "br";
  el("overlay-text").value = settings?.overlayText || "";
  el("overlay-place").value = settings?.overlayPlace || "top";
  editor.watermarkImage = settings?.watermarkImage || "";
  editor.logo = settings?.logo || null;
  editor.wmPos = settings?.wmPos || null;
  editor.titlePos = settings?.titlePos || null;
  updateLiveOverlays();
  hydrating = false;
  loadHistory();
});
