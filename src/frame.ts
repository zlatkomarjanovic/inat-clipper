export const HARD_MAX_CLIP_SECONDS = 60;

export type PixelCrop = {
  /** Fractions of the source frame, from 0 to 1. */
  x: number;
  y: number;
  w: number;
  h: number;
};

export type FrameSpec = {
  width: number;
  height: number;
  crop?: PixelCrop;
};

export type CropRect = {
  x: number;
  y: number;
  w: number;
  h: number;
  outW: number;
  outH: number;
};

function evenSize(value: number): number {
  return Math.max(2, Math.floor(value / 2) * 2);
}

function evenPos(value: number): number {
  return Math.max(0, Math.floor(value / 2) * 2);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function resolveCrop(srcWidth: number, srcHeight: number, frame: FrameSpec): CropRect {
  const srcW = Math.max(2, Math.floor(srcWidth));
  const srcH = Math.max(2, Math.floor(srcHeight));
  const outW = evenSize(frame.width);
  const outH = evenSize(frame.height);
  const ratio = outW / outH;

  let w = srcW;
  let h = w / ratio;
  let x = 0;
  let y = 0;

  if (frame.crop && Number.isFinite(frame.crop.w) && Number.isFinite(frame.crop.h)) {
    w = clamp(frame.crop.w, 0.05, 1) * srcW;
    h = w / ratio;
    x = clamp(frame.crop.x, 0, 1) * srcW;
    y = clamp(frame.crop.y, 0, 1) * srcH;
  }

  if (h > srcH) {
    h = srcH;
    w = h * ratio;
  }
  if (w > srcW) {
    w = srcW;
    h = w / ratio;
  }

  w = evenSize(Math.min(srcW, w));
  h = evenSize(Math.min(srcH, h));
  if (w > srcW) w = evenSize(srcW);
  if (h > srcH) h = evenSize(srcH);
  x = evenPos(clamp(x, 0, Math.max(0, srcW - w)));
  y = evenPos(clamp(y, 0, Math.max(0, srcH - h)));
  if (x + w > srcW) x = Math.max(0, srcW - w);
  if (y + h > srcH) y = Math.max(0, srcH - h);

  return { x, y, w, h, outW, outH };
}

export type TrackPoint = {
  t: number;
  x: number;
  y: number;
};

export function frameFilter(
  srcWidth: number,
  srcHeight: number,
  frame: FrameSpec,
  motion?: { points: TrackPoint[]; start: number; end: number },
): string {
  const crop = resolveCrop(srcWidth, srcHeight, frame);
  const scale = `scale=${crop.outW}:${crop.outH},setsar=1`;
  const moving = motion ? movingCrop(srcWidth, srcHeight, crop, motion) : null;
  if (!moving) return `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},${scale}`;
  return `crop=${crop.w}:${crop.h}:x='${moving.x}':y='${moving.y}',${scale}`;
}

function movingCrop(
  srcW: number,
  srcH: number,
  crop: CropRect,
  motion: { points: TrackPoint[]; start: number; end: number },
) {
  const duration = motion.end - motion.start;
  if (!motion.points.length || duration < 0.4) return null;
  const step = 0.5;
  const samples: Array<{ t: number; x: number; y: number }> = [];
  for (let t = 0; t <= duration + 0.001; t += step) {
    const time = Math.min(duration, t);
    const center = sampleTrack(motion.points, motion.start + time);
    samples.push({
      t: Math.round(time * 1000) / 1000,
      x: evenPixel(center.x * srcW - crop.w / 2, srcW - crop.w),
      y: evenPixel(center.y * srcH - crop.h / 2, srcH - crop.h),
    });
  }
  if (samples.length < 2) return null;
  const xStill = spanOf(samples.map((sample) => sample.x)) <= 4;
  const yStill = spanOf(samples.map((sample) => sample.y)) <= 4;
  if (xStill && yStill) return null;
  return {
    x: xStill ? String(samples[0].x) : evenExpr(samples.map((sample) => ({ t: sample.t, v: sample.x }))),
    y: yStill ? String(samples[0].y) : evenExpr(samples.map((sample) => ({ t: sample.t, v: sample.y }))),
  };
}

function sampleTrack(points: TrackPoint[], time: number) {
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
  return { t: time, x: a.x + (b.x - a.x) * blend, y: a.y + (b.y - a.y) * blend };
}

function evenPixel(value: number, max: number) {
  const clamped = Math.min(max, Math.max(0, value));
  return Math.max(0, Math.floor(clamped / 2) * 2);
}

function spanOf(values: number[]) {
  return Math.max(...values) - Math.min(...values);
}

function evenExpr(samples: Array<{ t: number; v: number }>) {
  let expr = String(samples[samples.length - 1].v);
  for (let index = samples.length - 2; index >= 0; index--) {
    const from = samples[index];
    const to = samples[index + 1];
    const dt = Math.max(0.001, Math.round((to.t - from.t) * 1000) / 1000);
    const piece = `${from.v}+(${to.v - from.v})*(t-${from.t})/${dt}`;
    expr = `if(lt(t,${to.t}),${piece},${expr})`;
  }
  return `2*trunc((${expr.replaceAll(",", "\\,")})/2)`;
}
