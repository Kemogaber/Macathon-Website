import Link from "next/link";

const features = [
  {
    title: "Table Detection",
    desc: "Locates every table region in your image with high precision, even in complex, multi-column layouts.",
  },
  {
    title: "Structure Recognition",
    desc: "Understands rows, columns, merged cells, and headers — preserving the original table structure.",
  },
  {
    title: "OCR Module",
    desc: "Reads text from each cell with high accuracy, handling handwritten notes and varied fonts.",
  },
];

const stats = [
  { value: "JPEG · PNG · WebP", label: "Supported formats" },
  { value: "HTML & CSV", label: "Output formats" },
  { value: "< 2s", label: "Avg. processing time" },
  { value: "Multi-table", label: "Per image" },
];

export default function HomePage() {
  return (
    <div className="grid-bg min-h-screen">
      {/* Hero */}
      <section className="relative max-w-6xl mx-auto px-6 pt-24 pb-20 text-center">
        <div
          aria-hidden
          className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] rounded-full opacity-20 blur-3xl pointer-events-none"
          style={{ background: "radial-gradient(ellipse, #00d4ff 0%, transparent 70%)" }}
        />
        <div
          aria-hidden
          className="absolute top-20 left-1/4 w-[300px] h-[200px] rounded-full opacity-10 blur-3xl pointer-events-none"
          style={{ background: "radial-gradient(ellipse, #7c3aed 0%, transparent 70%)" }}
        />

        <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-cyan/20 bg-[rgba(0,212,255,0.15)] text-cyan text-xs font-mono mb-6">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan animate-pulse" />
          AI-Powered · Real-time Extraction
        </span>

        <h1 className="text-5xl md:text-7xl font-black tracking-tight mb-6 leading-tight">
          Extract Tables{" "}
          <span className="gradient-text glow-cyan-text">Instantly</span>
          <br />
          from Any Image
        </h1>

        <p className="text-muted-2 text-lg md:text-xl max-w-2xl mx-auto mb-10 leading-relaxed">
          Upload a photo of any document, spreadsheet, or form. Our AI pipeline —
          table detection, structure recognition, and OCR — returns a clean,
          downloadable table in seconds.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/demo"
            className="px-8 py-4 rounded-xl bg-cyan text-background font-bold text-base hover:bg-cyan-300 transition-colors glow-cyan inline-block"
          >
            Parse →
          </Link>
          <Link
            href="/how-it-works"
            className="px-8 py-4 rounded-xl border border-border text-text font-medium text-base hover:bg-overlay transition-colors inline-block"
          >
            How It Works
          </Link>
        </div>
      </section>

      {/* Stats strip */}
      <section className="border-y border-border bg-white/[0.015]">
        <div className="max-w-6xl mx-auto px-6 py-8 grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          {stats.map((s) => (
            <div key={s.label}>
              <p className="text-xl font-bold text-cyan font-mono">{s.value}</p>
              <p className="text-muted text-sm mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-6 py-24">
        <div className="text-center mb-14">
          <h2 className="text-3xl md:text-4xl font-bold text-text mb-4">
            Three-stage AI Pipeline
          </h2>
          <p className="text-muted-2 max-w-xl mx-auto">
            Each stage is purpose-built for accuracy, working together to turn any
            image into structured, machine-readable data.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {features.map((f, i) => (
            <div key={f.title} className="glass rounded-2xl p-7 gradient-border hover:bg-white/[0.06] transition-all">
              <div className="flex items-center gap-3 mb-4">
                <span className="text-xs font-mono text-muted">Stage {i + 1}</span>
              </div>
              <h3 className="text-text font-semibold text-lg mb-2">{f.title}</h3>
              <p className="text-muted-2 text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-6xl mx-auto px-6 pb-24">
        <div className="glass rounded-3xl gradient-border p-10 md:p-16 text-center relative overflow-hidden">
          <div
            aria-hidden
            className="absolute inset-0 opacity-10 pointer-events-none"
            style={{ background: "radial-gradient(ellipse at 50% 0%, #00d4ff, transparent 70%)" }}
          />
          <h2 className="text-3xl md:text-4xl font-bold text-text mb-4 relative z-10">
            Ready to extract your first table?
          </h2>
          <p className="text-muted-2 mb-8 relative z-10">No sign-up required. Just upload and download.</p>
          <Link
            href="/demo"
            className="relative z-10 inline-block px-10 py-4 rounded-xl bg-cyan text-background font-bold text-base hover:bg-cyan-300 transition-colors glow-cyan"
          >
            Start Parsing →
          </Link>
        </div>
      </section>
    </div>
  );
}
