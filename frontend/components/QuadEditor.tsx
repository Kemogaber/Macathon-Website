"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import type { Quad } from "@/lib/api";

export interface RectQuad {
  cx: number;
  cy: number;
  w: number;
  h: number;
  rot: number; // radians, 0 = axis-aligned, CCW positive
}

interface Props {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  rects: RectQuad[];
  activeIndex: number;
  onRectChange: (index: number, rect: RectQuad) => void;
  onRemove?: (index: number) => void;
  locked?: boolean;
}

const HANDLE_R = 9;
const ROT_OFFSET = 36;          // pixel distance of rotation handle above top edge
const STROKE = "#00d4ff";
const STROKE_INACTIVE = "rgba(124,58,237,0.55)";
const FRAME_MAX_VH = 80;        // viewport-height cap for the frame
const ZOOM_STEPS = [0.25, 0.35, 0.5, 0.75, 1, 1.5, 2, 3];
const MIN_SIZE = 12;            // min rect width/height in image pixels

type DragMode =
  | { kind: "edge"; ri: number; edge: "top" | "right" | "bottom" | "left" }
  | { kind: "rotate"; ri: number }
  | { kind: "pan"; startX: number; startY: number; startSL: number; startST: number };

export function quadToRect(q: Quad): RectQuad {
  // Best-effort: assume the quad is (near-) axis-aligned (backend yields bboxes).
  const xs = q.map((p) => p[0]);
  const ys = q.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const w = Math.max(MIN_SIZE, Math.max(...xs) - Math.min(...xs));
  const h = Math.max(MIN_SIZE, Math.max(...ys) - Math.min(...ys));
  return { cx, cy, w, h, rot: 0 };
}

export function rectToQuad(r: RectQuad): Quad {
  const c = Math.cos(r.rot);
  const s = Math.sin(r.rot);
  const hw = r.w / 2;
  const hh = r.h / 2;
  // local TL, TR, BR, BL  →  rotate → translate
  const local: [number, number][] = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ];
  return local.map(([lx, ly]) => [
    r.cx + lx * c - ly * s,
    r.cy + lx * s + ly * c,
  ]) as unknown as Quad;
}

function rectCorners(r: RectQuad) {
  return rectToQuad(r);
}

function rectMidpoints(r: RectQuad) {
  const c = Math.cos(r.rot);
  const s = Math.sin(r.rot);
  const hw = r.w / 2;
  const hh = r.h / 2;
  // local midpoints: top, right, bottom, left
  const local: [number, number][] = [
    [0, -hh],
    [hw, 0],
    [0, hh],
    [-hw, 0],
  ];
  return local.map(([lx, ly]) => [
    r.cx + lx * c - ly * s,
    r.cy + lx * s + ly * c,
  ]) as [number, number][];
}

function rotationHandlePos(r: RectQuad, scale: number) {
  // Place rotation handle ROT_OFFSET screen-pixels above top midpoint, in image space.
  const c = Math.cos(r.rot);
  const s = Math.sin(r.rot);
  const offImg = ROT_OFFSET / scale; // image-space offset
  const lx = 0;
  const ly = -r.h / 2 - offImg;
  return [r.cx + lx * c - ly * s, r.cy + lx * s + ly * c] as [number, number];
}

export default function QuadEditor({
  imageUrl,
  imageWidth,
  imageHeight,
  rects,
  activeIndex,
  onRectChange,
  onRemove,
  locked = false,
}: Props) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [fitScale, setFitScale] = useState(1);
  const [drag, setDrag] = useState<DragMode | null>(null);

  // Compute fit scale on mount + on resize.
  useEffect(() => {
    function computeFit() {
      const frame = frameRef.current;
      if (!frame) return;
      const maxH = Math.min(window.innerHeight * (FRAME_MAX_VH / 100), 900);
      const maxW = frame.clientWidth || imageWidth;
      const fitW = maxW / imageWidth;
      const fitH = maxH / imageHeight;
      setFitScale(Math.min(fitW, fitH, 1));
    }
    computeFit();
    window.addEventListener("resize", computeFit);
    return () => window.removeEventListener("resize", computeFit);
  }, [imageWidth, imageHeight]);

  const scale = zoom === "fit" ? fitScale : zoom;
  const renderedW = imageWidth * scale;
  const renderedH = imageHeight * scale;

  // Convert a client (mouse) point to image-space coords.
  const clientToImage = useCallback(
    (clientX: number, clientY: number): [number, number] => {
      const img = imgRef.current;
      if (!img) return [0, 0];
      const rect = img.getBoundingClientRect();
      return [(clientX - rect.left) / scale, (clientY - rect.top) / scale];
    },
    [scale],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!drag) return;
      if (drag.kind === "pan") {
        const frame = frameRef.current;
        if (!frame) return;
        frame.scrollLeft = drag.startSL - (e.clientX - drag.startX);
        frame.scrollTop = drag.startST - (e.clientY - drag.startY);
        return;
      }
      const [px, py] = clientToImage(e.clientX, e.clientY);
      const r = rects[drag.ri];
      if (!r) return;

      const c = Math.cos(r.rot);
      const s = Math.sin(r.rot);
      // local frame: u=right, v=down (after rotation)
      const dx = px - r.cx;
      const dy = py - r.cy;
      const localX = dx * c + dy * s;
      const localY = -dx * s + dy * c;

      if (drag.kind === "rotate") {
        // user wants the rotation-handle direction (above top edge) to point at cursor
        const newRot = Math.atan2(px - r.cx, -(py - r.cy));
        onRectChange(drag.ri, { ...r, rot: newRot });
        return;
      }

      // edge drag — slide one edge while keeping the opposite edge fixed
      let { cx, cy, w, h } = r;
      if (drag.kind === "edge") {
        if (drag.edge === "top" || drag.edge === "bottom") {
          // Movement constrained to local v-axis. Opposite edge fixed.
          const oppY = drag.edge === "top" ? h / 2 : -h / 2;
          let newY = localY;
          if (drag.edge === "top" && newY > oppY - MIN_SIZE) newY = oppY - MIN_SIZE;
          if (drag.edge === "bottom" && newY < oppY + MIN_SIZE) newY = oppY + MIN_SIZE;
          const newH = Math.abs(oppY - newY);
          const newCenterLocalY = (oppY + newY) / 2;
          // translate center along v in world frame
          cx = r.cx - newCenterLocalY * s;
          cy = r.cy + newCenterLocalY * c;
          h = newH;
        } else {
          // left / right
          const oppX = drag.edge === "left" ? w / 2 : -w / 2;
          let newX = localX;
          if (drag.edge === "left" && newX > oppX - MIN_SIZE) newX = oppX - MIN_SIZE;
          if (drag.edge === "right" && newX < oppX + MIN_SIZE) newX = oppX + MIN_SIZE;
          const newW = Math.abs(oppX - newX);
          const newCenterLocalX = (oppX + newX) / 2;
          cx = r.cx + newCenterLocalX * c;
          cy = r.cy + newCenterLocalX * s;
          w = newW;
        }
        onRectChange(drag.ri, { cx, cy, w, h, rot: r.rot });
      }
    },
    [drag, rects, onRectChange, clientToImage],
  );

  const onPointerUp = useCallback(() => setDrag(null), []);

  useEffect(() => {
    if (!drag) return;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [drag, onPointerMove, onPointerUp]);

  function bumpZoom(delta: number) {
    const current = zoom === "fit" ? fitScale : zoom;
    // find nearest step then move by delta
    let idx = ZOOM_STEPS.findIndex((z) => z >= current);
    if (idx === -1) idx = ZOOM_STEPS.length - 1;
    idx = Math.max(0, Math.min(ZOOM_STEPS.length - 1, idx + delta));
    setZoom(ZOOM_STEPS[idx]);
  }

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => bumpZoom(-1)}
            className="w-8 h-8 rounded-lg border border-border hover:border-cyan/40 text-sm"
            title="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => setZoom("fit")}
            className={`px-3 h-8 rounded-lg border text-xs font-mono ${
              zoom === "fit"
                ? "border-cyan bg-[rgba(0,212,255,0.12)] text-cyan"
                : "border-border hover:border-cyan/40"
            }`}
            title="Fit to view"
          >
            Fit
          </button>
          <button
            type="button"
            onClick={() => bumpZoom(1)}
            className="w-8 h-8 rounded-lg border border-border hover:border-cyan/40 text-sm"
            title="Zoom in"
          >
            +
          </button>
          <span className="text-xs text-muted font-mono ml-2">
            {Math.round(scale * 100)}%
          </span>
        </div>
        <span className="text-xs text-muted font-mono">
          drag edges to slide · top knob to rotate
        </span>
      </div>

      <div
        ref={frameRef}
        className="relative bg-input rounded-xl overflow-auto flex items-center justify-center"
        style={{ maxHeight: `${FRAME_MAX_VH}vh`, minHeight: 320 }}
      >
        <div
          className="relative inline-block"
          style={{
            width: renderedW,
            height: renderedH,
            cursor: drag?.kind === "pan" ? "grabbing" : "grab",
          }}
          onPointerDown={(e) => {
            if ((e.target as Element).tagName !== "IMG") return;
            const frame = frameRef.current;
            if (!frame) return;
            (e.target as Element).setPointerCapture?.(e.pointerId);
            setDrag({
              kind: "pan",
              startX: e.clientX,
              startY: e.clientY,
              startSL: frame.scrollLeft,
              startST: frame.scrollTop,
            });
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={imageUrl}
            alt="page"
            className="block select-none"
            draggable={false}
            style={{ width: renderedW, height: renderedH }}
          />

          <svg
            className="absolute inset-0 pointer-events-none"
            width={renderedW}
            height={renderedH}
            viewBox={`0 0 ${imageWidth} ${imageHeight}`}
            preserveAspectRatio="none"
          >
            {rects.map((r, ri) => {
              const isActive = ri === activeIndex;
              const corners = rectCorners(r);
              const mids = rectMidpoints(r);
              const rotPos = rotationHandlePos(r, scale);
              const points = corners.map((p) => `${p[0]},${p[1]}`).join(" ");
              const topMid = mids[0];
              const handleR = HANDLE_R / scale;

              return (
                <g key={ri}>
                  <polygon
                    points={points}
                    fill={isActive ? "rgba(0,212,255,0.10)" : "rgba(124,58,237,0.05)"}
                    stroke={isActive ? STROKE : STROKE_INACTIVE}
                    strokeWidth={2 / scale}
                    strokeDasharray={isActive ? "" : `${4 / scale} ${4 / scale}`}
                  />

                  {isActive && !locked && (
                    <>
                      {/* rotation tether */}
                      <line
                        x1={topMid[0]}
                        y1={topMid[1]}
                        x2={rotPos[0]}
                        y2={rotPos[1]}
                        stroke={STROKE}
                        strokeWidth={1.5 / scale}
                      />

                      {/* edge midpoint handles */}
                      {(["top", "right", "bottom", "left"] as const).map(
                        (edge, i) => (
                          <rect
                            key={edge}
                            x={mids[i][0] - handleR}
                            y={mids[i][1] - handleR}
                            width={handleR * 2}
                            height={handleR * 2}
                            rx={handleR / 2}
                            fill="#0a0b0f"
                            stroke={STROKE}
                            strokeWidth={2 / scale}
                            style={{
                              pointerEvents: "all",
                              cursor:
                                edge === "top" || edge === "bottom"
                                  ? "ns-resize"
                                  : "ew-resize",
                            }}
                            onPointerDown={(e) => {
                              (e.target as Element).setPointerCapture?.(e.pointerId);
                              setDrag({ kind: "edge", ri, edge });
                            }}
                          />
                        ),
                      )}

                      {/* rotation handle */}
                      <circle
                        cx={rotPos[0]}
                        cy={rotPos[1]}
                        r={handleR}
                        fill={STROKE}
                        stroke="#0a0b0f"
                        strokeWidth={2 / scale}
                        style={{ pointerEvents: "all", cursor: "grab" }}
                        onPointerDown={(e) => {
                          (e.target as Element).setPointerCapture?.(e.pointerId);
                          setDrag({ kind: "rotate", ri });
                        }}
                      />

                      {/* delete X badge */}
                      {onRemove && (
                        <g
                          style={{ pointerEvents: "all", cursor: "pointer" }}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            onRemove(ri);
                          }}
                        >
                          <circle
                            cx={corners[1][0]}
                            cy={corners[1][1]}
                            r={handleR * 1.2}
                            fill="#ef4444"
                            stroke="#0a0b0f"
                            strokeWidth={2 / scale}
                          />
                          <path
                            d={`M ${corners[1][0] - handleR * 0.5} ${
                              corners[1][1] - handleR * 0.5
                            } L ${corners[1][0] + handleR * 0.5} ${
                              corners[1][1] + handleR * 0.5
                            } M ${corners[1][0] + handleR * 0.5} ${
                              corners[1][1] - handleR * 0.5
                            } L ${corners[1][0] - handleR * 0.5} ${
                              corners[1][1] + handleR * 0.5
                            }`}
                            stroke="#fff"
                            strokeWidth={2 / scale}
                            strokeLinecap="round"
                          />
                        </g>
                      )}
                    </>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}
