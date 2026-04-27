"use client";

import { useCallback, useState } from "react";

interface Props {
  onFileSelect: (file: File) => void;
  disabled?: boolean;
}

const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export default function UploadZone({ onFileSelect, disabled }: Props) {
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handle = useCallback(
    (file: File) => {
      if (!ACCEPTED.includes(file.type)) {
        setError("Only JPG, PNG, WebP, and PDF are supported.");
        return;
      }
      if (file.size > 25 * 1024 * 1024) {
        setError("File is too large. Maximum size is 25 MB.");
        return;
      }
      setError(null);
      setPreview(file.type === "application/pdf" ? null : URL.createObjectURL(file));
      onFileSelect(file);
    },
    [onFileSelect]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handle(file);
    },
    [handle]
  );

  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handle(file);
    e.target.value = "";
  };

  return (
    <div className="w-full space-y-3">
      <label
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`relative flex flex-col items-center justify-center w-full min-h-52 rounded-2xl cursor-pointer transition-all duration-200 gradient-border
          ${disabled ? "opacity-50 cursor-not-allowed" : ""}
          ${dragging
            ? "bg-cyan-dim border-cyan/50 glow-cyan"
            : "bg-white/[0.02] hover:bg-white/[0.04] border-transparent"
          }`}
      >
        {preview ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={preview}
            alt="Preview"
            className="max-h-72 max-w-full rounded-xl object-contain"
          />
        ) : (
          <div className="flex flex-col items-center gap-3 px-6 text-center">
            <div className="w-14 h-14 rounded-2xl bg-cyan-dim flex items-center justify-center text-3xl">
              🖼️
            </div>
            <div>
              <p className="text-text font-medium">Drop your image or PDF here</p>
              <p className="text-muted text-sm mt-1">
                or click to browse — JPG, PNG, WebP, PDF up to 25 MB
              </p>
            </div>
            <span className="px-3 py-1 rounded-full border border-border text-xs text-muted font-mono">
              Click to select
            </span>
          </div>
        )}
        <input
          type="file"
          accept={ACCEPTED.join(",")}
          onChange={onInput}
          disabled={disabled}
          className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed"
        />
      </label>

      {preview && (
        <button
          onClick={() => { setPreview(null); }}
          className="text-xs text-muted hover:text-text transition-colors"
        >
          ✕ Remove image
        </button>
      )}

      {error && (
        <p className="text-red-400 text-sm flex items-center gap-2">
          <span>⚠</span> {error}
        </p>
      )}
    </div>
  );
}
