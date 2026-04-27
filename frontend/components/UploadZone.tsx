"use client";

import { useCallback, useState } from "react";

interface Props {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}

const ACCEPTED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/tiff",
  "application/pdf",
  "application/zip",
  "application/x-zip-compressed",
];
const ACCEPTED_EXTS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".bmp",
  ".tif",
  ".tiff",
  ".pdf",
  ".zip",
];
const MAX_PER_FILE = 25 * 1024 * 1024;

function isAccepted(f: File): boolean {
  if (ACCEPTED_TYPES.includes(f.type)) return true;
  const lower = f.name.toLowerCase();
  return ACCEPTED_EXTS.some((ext) => lower.endsWith(ext));
}

function fileKind(f: File): "pdf" | "zip" | "image" {
  if (f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"))
    return "pdf";
  if (f.type.includes("zip") || f.name.toLowerCase().endsWith(".zip"))
    return "zip";
  return "image";
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function UploadZone({ files, onChange, disabled }: Props) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addFiles = useCallback(
    (incoming: FileList | File[]) => {
      const next: File[] = [];
      const existingKeys = new Set(files.map((f) => `${f.name}:${f.size}`));
      const skipped: string[] = [];
      for (const f of Array.from(incoming)) {
        if (!isAccepted(f)) {
          skipped.push(`${f.name} (unsupported)`);
          continue;
        }
        if (f.size > MAX_PER_FILE) {
          skipped.push(`${f.name} (too large)`);
          continue;
        }
        const key = `${f.name}:${f.size}`;
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);
        next.push(f);
      }
      if (next.length) onChange([...files, ...next]);
      setError(skipped.length ? `Skipped: ${skipped.join(", ")}` : null);
    },
    [files, onChange],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) addFiles(e.target.files);
    e.target.value = "";
  };

  function removeAt(idx: number) {
    onChange(files.filter((_, i) => i !== idx));
  }

  return (
    <div className="w-full space-y-3">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`relative flex flex-col items-center justify-center w-full min-h-44 rounded-2xl cursor-pointer transition-all duration-200 gradient-border
          ${disabled ? "opacity-50 cursor-not-allowed" : ""}
          ${
            dragging
              ? "bg-cyan-dim border-cyan/50 glow-cyan"
              : "bg-overlay hover:bg-overlay/80 border-transparent"
          }`}
      >
        <div className="flex flex-col items-center gap-3 px-6 text-center py-6">
          <div className="w-12 h-12 rounded-2xl bg-cyan-dim flex items-center justify-center text-2xl">
            📥
          </div>
          <div>
            <p className="text-text font-medium">
              Drop images, PDFs, or ZIPs here
            </p>
            <p className="text-muted text-sm mt-1">
              or click to browse — multiple files OK · ZIPs unpacked into pages
            </p>
          </div>
          <span className="px-3 py-1 rounded-full border border-border text-xs text-muted font-mono">
            Click to select
          </span>
        </div>
        <input
          type="file"
          multiple
          accept={[...ACCEPTED_TYPES, ...ACCEPTED_EXTS].join(",")}
          onChange={onInput}
          disabled={disabled}
          className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed"
        />
      </label>

      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((f, i) => {
            const kind = fileKind(f);
            const url =
              kind === "image" ? URL.createObjectURL(f) : null;
            return (
              <li
                key={`${f.name}:${f.size}:${i}`}
                className="flex items-center gap-3 rounded-xl border border-border bg-overlay px-3 py-2"
              >
                <div className="w-10 h-10 rounded-lg bg-input flex items-center justify-center overflow-hidden shrink-0">
                  {url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={url}
                      alt={f.name}
                      className="w-full h-full object-cover"
                      onLoad={() => URL.revokeObjectURL(url)}
                    />
                  ) : (
                    <span className="text-lg">
                      {kind === "pdf" ? "📄" : "🗜️"}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-text truncate">{f.name}</p>
                  <p className="text-xs text-muted font-mono">
                    {kind.toUpperCase()} · {fmtSize(f.size)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  disabled={disabled}
                  title="Remove"
                  aria-label={`Remove ${f.name}`}
                  className="w-8 h-8 rounded-md flex items-center justify-center text-red-400 hover:bg-red-500/15 hover:text-red-300 disabled:opacity-40"
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {error && (
        <p className="text-yellow-300 text-sm flex items-center gap-2">
          <span>⚠</span> {error}
        </p>
      )}
    </div>
  );
}
