"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import type { Quad } from "@/lib/api";

interface Props {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  quads: Quad[];
  activeQuadIndex: number;
  onQuadChange: (index: number, quad: Quad) => void;
}

const HANDLE_R = 9;
const STROKE = "#00d4ff";
const STROKE_INACTIVE = "rgba(124,58,237,0.55)";

export default function QuadEditor({
  imageUrl,
  imageWidth,
  imageHeight,
  quads,
  activeQuadIndex,
  onQuadChange,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [rendered, setRendered] = useState({ w: 0, h: 0 });
  const [dragging, setDragging] = useState<{ qi: number; ci: number } | null>(null);

  // Track rendered <img> size to translate between client and image-space.
  useEffect(() => {
    function update() {
      if (imgRef.current) {
        setRendered({
          w: imgRef.current.clientWidth,
          h: imgRef.current.clientHeight,
        });
      }
    }
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [imageUrl]);

  const sx = rendered.w ? rendered.w / imageWidth : 1;   // image → screen
  const sy = rendered.h ? rendered.h / imageHeight : 1;

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!dragging || !imgRef.current) return;
      const rect = imgRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left) / sx;
      const y = (e.clientY - rect.top) / sy;
      const clampedX = Math.max(0, Math.min(imageWidth, x));
      const clampedY = Math.max(0, Math.min(imageHeight, y));
      const q = quads[dragging.qi];
      if (!q) return;
      const next: Quad = [
        [...q[0]] as [number, number],
        [...q[1]] as [number, number],
        [...q[2]] as [number, number],
        [...q[3]] as [number, number],
      ];
      next[dragging.ci] = [clampedX, clampedY];
      onQuadChange(dragging.qi, next);
    },
    [dragging, sx, sy, imageWidth, imageHeight, quads, onQuadChange],
  );

  const onPointerUp = useCallback(() => setDragging(null), []);

  useEffect(() => {
    if (!dragging) return;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [dragging, onPointerMove, onPointerUp]);

  return (
    <div ref={wrapRef} className="relative inline-block max-w-full">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={imageUrl}
        alt="page"
        className="block max-w-full h-auto select-none"
        draggable={false}
        onLoad={(e) => {
          const el = e.currentTarget;
          setRendered({ w: el.clientWidth, h: el.clientHeight });
        }}
      />

      {rendered.w > 0 && (
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox={`0 0 ${rendered.w} ${rendered.h}`}
          preserveAspectRatio="none"
        >
          {quads.map((q, qi) => {
            const isActive = qi === activeQuadIndex;
            const points = q.map(([x, y]) => `${x * sx},${y * sy}`).join(" ");
            return (
              <g key={qi}>
                <polygon
                  points={points}
                  fill={isActive ? "rgba(0,212,255,0.10)" : "rgba(124,58,237,0.05)"}
                  stroke={isActive ? STROKE : STROKE_INACTIVE}
                  strokeWidth={2}
                  strokeDasharray={isActive ? "" : "4 4"}
                />
                {isActive &&
                  q.map(([x, y], ci) => (
                    <circle
                      key={ci}
                      cx={x * sx}
                      cy={y * sy}
                      r={HANDLE_R}
                      fill="#0a0b0f"
                      stroke={STROKE}
                      strokeWidth={2}
                      style={{ pointerEvents: "all", cursor: "grab" }}
                      onPointerDown={(e) => {
                        (e.target as Element).setPointerCapture?.(e.pointerId);
                        setDragging({ qi, ci });
                      }}
                    />
                  ))}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
