"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  onCapture: (files: File[]) => void;
}

interface Crop {
  x: number; // 0..1 normalized
  y: number;
  w: number;
  h: number;
}
type Filter = "original" | "enhance" | "bw" | "document" | "high-contrast";

const FILTER_LABELS: Record<Filter, string> = {
  original: "Original",
  enhance: "Enhance",
  bw: "B&W",
  "high-contrast": "High contrast",
  document: "Document",
};

// CSS preview filters — must visually match the canvas-time effects in
// `applyFilter` below as closely as the CSS filter primitives allow.
const FILTER_CSS: Record<Filter, string | undefined> = {
  original: undefined,
  enhance: "contrast(1.15) saturate(1.1) brightness(1.05)",
  bw: "grayscale(1) contrast(1.05)",
  "high-contrast": "contrast(1.5) saturate(1.2) brightness(1.05)",
  document: "grayscale(1) contrast(1.6) brightness(1.1)",
};

interface Shot {
  id: number;
  dataUrl: string;
  width: number;
  height: number;
  crop: Crop;
  filter: Filter;
}

const DEFAULT_CROP: Crop = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };

export default function CameraCapture({ open, onClose, onCapture }: Props) {
  const [stage, setStage] = useState<"live" | "review">("live");
  const [shots, setShots] = useState<Shot[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [streamErr, setStreamErr] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Start/stop camera with the live stage.
  useEffect(() => {
    if (!open || stage !== "live") {
      stopStream();
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            // Continuous autofocus where supported (Chrome/Android, recent iOS).
            // Unknown constraints are ignored, so this is safe to always request.
            advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet],
          },
          audio: false,
        });
        // Best-effort: re-apply continuous focus after the track is live; some
        // implementations only honor it via applyConstraints, not getUserMedia.
        const track = s.getVideoTracks()[0];
        if (track) {
          track
            .applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] })
            .catch(() => {});
        }
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.play().catch(() => {});
        }
        setStreamErr(null);
      } catch (e) {
        setStreamErr(e instanceof Error ? e.message : "Camera blocked");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stage]);

  // Stop on unmount/close.
  useEffect(() => {
    if (!open) stopStream();
    return () => stopStream();
  }, [open]);

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  const capture = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    setShots((prev) => [
      ...prev,
      {
        id: Date.now() + Math.random(),
        dataUrl,
        width: v.videoWidth,
        height: v.videoHeight,
        crop: { ...DEFAULT_CROP }, // TODO: auto-detect document edges (Sobel/Canny) and snap
        filter: "original",
      },
    ]);
  }, []);

  function reviewShots() {
    if (shots.length === 0) return;
    setSelectedIdx(0);
    setStage("review");
  }

  function backToLive() {
    setStage("live");
  }

  function deleteShot(idx: number) {
    setShots((prev) => prev.filter((_, i) => i !== idx));
    setSelectedIdx((cur) => Math.max(0, Math.min(cur, shots.length - 2)));
  }

  function setShotCrop(idx: number, crop: Crop) {
    setShots((prev) => prev.map((s, i) => (i === idx ? { ...s, crop } : s)));
  }
  function setShotFilter(idx: number, filter: Filter) {
    setShots((prev) => prev.map((s, i) => (i === idx ? { ...s, filter } : s)));
  }

  async function finish() {
    if (shots.length === 0) return;
    const files: File[] = [];
    for (let i = 0; i < shots.length; i++) {
      const blob = await renderShot(shots[i]);
      files.push(new File([blob], `capture_${i + 1}.jpg`, { type: "image/jpeg" }));
    }
    stopStream();
    setShots([]);
    setSelectedIdx(0);
    setStage("live");
    onCapture(files);
  }

  function close() {
    stopStream();
    setShots([]);
    setSelectedIdx(0);
    setStage("live");
    onClose();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 text-white">
        <div className="font-bold">
          {stage === "live" ? "Camera" : `Review (${shots.length} shot${shots.length === 1 ? "" : "s"})`}
        </div>
        <button onClick={close} className="text-2xl leading-none px-3 hover:opacity-70" aria-label="Close">
          ×
        </button>
      </div>

      {stage === "live" && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-4">
          {streamErr ? (
            <div className="text-red-300 text-sm max-w-md text-center">
              Camera unavailable: {streamErr}.
              <br />
              Allow camera permission in your browser, or use file upload.
            </div>
          ) : (
            <video
              ref={videoRef}
              playsInline
              muted
              onClick={(e) => {
                const v = videoRef.current;
                const track = streamRef.current?.getVideoTracks()[0];
                if (!v || !track) return;
                const r = v.getBoundingClientRect();
                const x = (e.clientX - r.left) / r.width;
                const y = (e.clientY - r.top) / r.height;
                track
                  .applyConstraints({
                    advanced: [
                      {
                        focusMode: "single-shot",
                        pointsOfInterest: [{ x, y }],
                      } as MediaTrackConstraintSet,
                    ],
                  })
                  .catch(() => {});
              }}
              className="max-w-full max-h-[70vh] rounded-xl border border-white/10 bg-black cursor-crosshair"
            />
          )}
          <div className="flex items-center gap-3 flex-wrap justify-center">
            <button
              onClick={capture}
              disabled={!!streamErr}
              className="px-6 py-3 rounded-full bg-cyan text-black font-bold disabled:opacity-40"
            >
              Capture {shots.length > 0 ? `(${shots.length})` : ""}
            </button>
            <button
              onClick={reviewShots}
              disabled={shots.length === 0}
              className="px-5 py-3 rounded-full border border-white/30 text-white hover:bg-white/10 disabled:opacity-30"
            >
              Review →
            </button>
          </div>
          {shots.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto max-w-full px-4 py-2">
              {shots.map((s, i) => (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  key={s.id}
                  src={s.dataUrl}
                  alt={`shot ${i + 1}`}
                  className="h-16 w-16 object-cover rounded-md border border-white/20"
                />
              ))}
            </div>
          )}
        </div>
      )}

      {stage === "review" && shots.length > 0 && (
        <div className="flex-1 flex flex-col gap-3 p-4 overflow-hidden">
          <div className="flex items-center gap-2 overflow-x-auto pb-2">
            {shots.map((s, i) => (
              <button
                key={s.id}
                onClick={() => setSelectedIdx(i)}
                className={`relative shrink-0 rounded-md border-2 overflow-hidden ${
                  i === selectedIdx ? "border-cyan" : "border-white/20"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.dataUrl} alt={`shot ${i + 1}`} className="h-16 w-16 object-cover" />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteShot(i);
                  }}
                  aria-label={`Remove shot ${i + 1}`}
                  className="absolute top-0 right-0 w-5 h-5 bg-black/70 text-red-300 text-xs hover:bg-red-500/40"
                >
                  ×
                </button>
              </button>
            ))}
          </div>

          <div className="flex-1 min-h-0">
            <CropEditor
              shot={shots[selectedIdx]}
              onCropChange={(c) => setShotCrop(selectedIdx, c)}
            />
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-white/60 text-xs font-mono">Filter:</span>
              {(Object.keys(FILTER_LABELS) as Filter[]).map((f) => (
                <FilterButton
                  key={f}
                  active={shots[selectedIdx].filter === f}
                  onClick={() => setShotFilter(selectedIdx, f)}
                >
                  {FILTER_LABELS[f]}
                </FilterButton>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={backToLive}
                className="px-4 py-2 rounded-lg border border-white/30 text-white hover:bg-white/10 text-sm"
              >
                ← Take more
              </button>
              <button
                onClick={finish}
                className="px-5 py-2 rounded-lg bg-cyan text-black font-bold text-sm"
              >
                Use {shots.length} shot{shots.length === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-md text-xs font-mono border ${
        active
          ? "bg-cyan text-black border-cyan"
          : "bg-transparent text-white/80 border-white/20 hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// CropEditor — overlays a draggable rectangle on the captured photo with 4
// corner + 4 edge handles. Crop coords are normalized 0..1.
// ---------------------------------------------------------------------------

type Handle = "tl" | "tr" | "bl" | "br" | "t" | "r" | "b" | "l" | "move" | null;

function CropEditor({
  shot,
  onCropChange,
}: {
  shot: Shot;
  onCropChange: (c: Crop) => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    handle: Handle;
    startX: number;
    startY: number;
    start: Crop;
  } | null>(null);
  const [, setTick] = useState(0); // re-render on drag

  const c = shot.crop;

  function onPointerDown(handle: Handle, e: React.PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      handle,
      startX: e.clientX,
      startY: e.clientY,
      start: { ...c },
    };
  }

  function onPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    const wrap = wrapRef.current;
    if (!drag || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    const dx = (e.clientX - drag.startX) / rect.width;
    const dy = (e.clientY - drag.startY) / rect.height;
    const next = applyDrag(drag.start, drag.handle, dx, dy);
    onCropChange(next);
    setTick((t) => t + 1);
  }

  function onPointerUp(e: React.PointerEvent) {
    dragRef.current = null;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  }

  return (
    <div
      ref={wrapRef}
      className="relative w-full h-full flex items-center justify-center select-none"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="relative max-w-full max-h-full" style={{ aspectRatio: `${shot.width} / ${shot.height}` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={shot.dataUrl}
          alt="captured"
          className="w-full h-full object-contain"
          style={FILTER_CSS[shot.filter] ? { filter: FILTER_CSS[shot.filter] } : undefined}
          draggable={false}
        />

        {/* darken outside crop */}
        <div className="absolute inset-0 pointer-events-none">
          <div
            className="absolute inset-0 bg-black/55"
            style={{
              clipPath: `polygon(
                0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
                ${c.x * 100}% ${c.y * 100}%,
                ${c.x * 100}% ${(c.y + c.h) * 100}%,
                ${(c.x + c.w) * 100}% ${(c.y + c.h) * 100}%,
                ${(c.x + c.w) * 100}% ${c.y * 100}%,
                ${c.x * 100}% ${c.y * 100}%
              )`,
            }}
          />
        </div>

        {/* crop rectangle */}
        <div
          onPointerDown={(e) => onPointerDown("move", e)}
          className="absolute border-2 border-cyan cursor-move touch-none"
          style={{
            left: `${c.x * 100}%`,
            top: `${c.y * 100}%`,
            width: `${c.w * 100}%`,
            height: `${c.h * 100}%`,
          }}
        >
          {/* corner handles */}
          <Handle pos="tl" onDown={onPointerDown} />
          <Handle pos="tr" onDown={onPointerDown} />
          <Handle pos="bl" onDown={onPointerDown} />
          <Handle pos="br" onDown={onPointerDown} />
          {/* edge handles */}
          <Handle pos="t" onDown={onPointerDown} />
          <Handle pos="r" onDown={onPointerDown} />
          <Handle pos="b" onDown={onPointerDown} />
          <Handle pos="l" onDown={onPointerDown} />
        </div>
      </div>
    </div>
  );
}

function Handle({
  pos,
  onDown,
}: {
  pos: Handle;
  onDown: (h: Handle, e: React.PointerEvent) => void;
}) {
  const style: React.CSSProperties = { touchAction: "none" };
  let cls = "absolute w-3 h-3 bg-cyan border border-white shadow rounded-sm touch-none ";
  switch (pos) {
    case "tl":
      cls += "-left-1.5 -top-1.5 cursor-nwse-resize";
      break;
    case "tr":
      cls += "-right-1.5 -top-1.5 cursor-nesw-resize";
      break;
    case "bl":
      cls += "-left-1.5 -bottom-1.5 cursor-nesw-resize";
      break;
    case "br":
      cls += "-right-1.5 -bottom-1.5 cursor-nwse-resize";
      break;
    case "t":
      cls += "left-1/2 -top-1.5 -translate-x-1/2 cursor-ns-resize";
      break;
    case "b":
      cls += "left-1/2 -bottom-1.5 -translate-x-1/2 cursor-ns-resize";
      break;
    case "l":
      cls += "-left-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize";
      break;
    case "r":
      cls += "-right-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize";
      break;
    default:
      return null;
  }
  return <div className={cls} style={style} onPointerDown={(e) => onDown(pos, e)} />;
}

function applyDrag(start: Crop, h: Handle, dx: number, dy: number): Crop {
  const MIN = 0.05;
  let { x, y, w, h: hh } = start;
  if (h === "move") {
    x = clamp01(start.x + dx, 1 - start.w);
    y = clamp01(start.y + dy, 1 - start.h);
    return { x, y, w, h: hh };
  }
  if (h === "tl" || h === "t" || h === "tr") {
    const ny = clamp01(start.y + dy, 1 - MIN);
    const newH = start.h - (ny - start.y);
    if (newH >= MIN) {
      y = ny;
      hh = newH;
    }
  }
  if (h === "bl" || h === "b" || h === "br") {
    hh = Math.max(MIN, Math.min(1 - start.y, start.h + dy));
  }
  if (h === "tl" || h === "l" || h === "bl") {
    const nx = clamp01(start.x + dx, 1 - MIN);
    const newW = start.w - (nx - start.x);
    if (newW >= MIN) {
      x = nx;
      w = newW;
    }
  }
  if (h === "tr" || h === "r" || h === "br") {
    w = Math.max(MIN, Math.min(1 - start.x, start.w + dx));
  }
  return { x, y, w, h: hh };
}

function clamp01(v: number, max = 1) {
  return Math.max(0, Math.min(max, v));
}

// ---------------------------------------------------------------------------
// Render a Shot (crop + filter applied) to a JPEG Blob.
// ---------------------------------------------------------------------------
async function renderShot(shot: Shot): Promise<Blob> {
  const img = await loadImage(shot.dataUrl);
  const sx = Math.round(shot.crop.x * shot.width);
  const sy = Math.round(shot.crop.y * shot.height);
  const sw = Math.round(shot.crop.w * shot.width);
  const sh = Math.round(shot.crop.h * shot.height);

  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

  if (shot.filter !== "original") {
    const data = ctx.getImageData(0, 0, sw, sh);
    applyFilter(data, shot.filter);
    ctx.putImageData(data, 0, 0);
  }

  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      "image/jpeg",
      0.92,
    ),
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function applyFilter(img: ImageData, filter: Filter) {
  switch (filter) {
    case "enhance":
      enhanceInPlace(img);
      return;
    case "bw":
      grayscaleInPlace(img);
      return;
    case "high-contrast":
      enhanceInPlace(img);
      contrastInPlace(img, 1.4);
      return;
    case "document":
      grayscaleInPlace(img);
      enhanceInPlace(img);
      contrastInPlace(img, 1.5);
      return;
  }
}

function grayscaleInPlace(img: ImageData) {
  const px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    // Rec. 709 luma weights — closer to perceived brightness than equal-weight.
    const v = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    px[i] = px[i + 1] = px[i + 2] = v;
  }
}

function contrastInPlace(img: ImageData, amount: number) {
  // Stretch around 128. amount=1.0 is identity, >1 increases contrast.
  const px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = (px[i + c] - 128) * amount + 128;
      px[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
}

// Auto-contrast (1st/99th percentile stretch) + light unsharp.
// Color preserved — operates per-channel.
function enhanceInPlace(img: ImageData) {
  const px = img.data;
  const n = px.length / 4;

  // 1) per-channel histograms for percentile stretch
  const histR = new Uint32Array(256);
  const histG = new Uint32Array(256);
  const histB = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    histR[px[i]]++;
    histG[px[i + 1]]++;
    histB[px[i + 2]]++;
  }
  const lo = Math.floor(n * 0.01);
  const hi = Math.floor(n * 0.99);
  const find = (h: Uint32Array, target: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += h[v];
      if (acc >= target) return v;
    }
    return 255;
  };
  const rLo = find(histR, lo),
    rHi = find(histR, hi);
  const gLo = find(histG, lo),
    gHi = find(histG, hi);
  const bLo = find(histB, lo),
    bHi = find(histB, hi);
  const stretch = (v: number, lo2: number, hi2: number) => {
    if (hi2 <= lo2) return v;
    const out = ((v - lo2) * 255) / (hi2 - lo2);
    return out < 0 ? 0 : out > 255 ? 255 : out;
  };
  for (let i = 0; i < px.length; i += 4) {
    px[i] = stretch(px[i], rLo, rHi);
    px[i + 1] = stretch(px[i + 1], gLo, gHi);
    px[i + 2] = stretch(px[i + 2], bLo, bHi);
  }

  // 2) light unsharp mask: a 3x3 sharpening kernel applied subtly.
  // Kernel: 0 -1 0 / -1 5 -1 / 0 -1 0, blended at alpha=0.4 with original.
  const w = img.width;
  const h = img.height;
  const src = new Uint8ClampedArray(px); // snapshot
  const idx = (x: number, y: number, c: number) => (y * w + x) * 4 + c;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      for (let c = 0; c < 3; c++) {
        const center = src[idx(x, y, c)];
        const sharp =
          5 * center -
          src[idx(x - 1, y, c)] -
          src[idx(x + 1, y, c)] -
          src[idx(x, y - 1, c)] -
          src[idx(x, y + 1, c)];
        const blended = center * 0.6 + sharp * 0.4;
        px[idx(x, y, c)] = blended < 0 ? 0 : blended > 255 ? 255 : blended;
      }
    }
  }
}
