"use client";

interface Props {
  html: string;
  csv: string;
}

function download(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function DownloadButtons({ html, csv }: Props) {
  return (
    <div className="flex gap-3 flex-wrap">
      <button
        onClick={() => download(html, "extracted_table.html", "text/html")}
        className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#00d4ff] text-[#0a0b0f] font-semibold text-sm hover:bg-cyan-300 transition-colors glow-cyan"
      >
        <span>↓</span> Download HTML
      </button>
      <button
        onClick={() => download(csv, "extracted_table.csv", "text/csv")}
        className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-[#7c3aed] text-[#a78bfa] font-semibold text-sm hover:bg-purple-dim transition-colors"
      >
        <span>↓</span> Download CSV
      </button>
    </div>
  );
}
