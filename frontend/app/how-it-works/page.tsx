import Link from "next/link";

const steps = [
  {
    number: "01",
    title: "Upload Your Image",
    desc: "Drag and drop or select any image containing a table — photos, scans, screenshots, or PDF exports. Supports JPEG, PNG, and WebP up to 20 MB.",
    icon: "🖼️",
    color: "#00d4ff",
  },
  {
    number: "02",
    title: "Table Detection",
    desc: "A deep learning model scans the image and draws bounding boxes around every table region, even when tables overlap other content or have irregular borders.",
    icon: "🔍",
    color: "#00d4ff",
  },
  {
    number: "03",
    title: "Structure Recognition",
    desc: "A second model parses the detected region to identify rows, columns, merged cells, and header rows — reconstructing the full table grid.",
    icon: "🧩",
    color: "#7c3aed",
  },
  {
    number: "04",
    title: "OCR Extraction",
    desc: "Optical Character Recognition reads the text inside each individual cell, handling mixed fonts, numbers, special characters, and handwriting.",
    icon: "🔤",
    color: "#7c3aed",
  },
  {
    number: "05",
    title: "Download Results",
    desc: "The structured data is formatted as clean HTML (preserving headers and styles) and CSV (for spreadsheet or database import). Both download instantly.",
    icon: "⬇️",
    color: "#00d4ff",
  },
];

export default function HowItWorksPage() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-16">
      <div className="text-center mb-16">
        <span className="inline-block px-3 py-1 rounded-full border border-[#00d4ff]/20 bg-[rgba(0,212,255,0.1)] text-[#00d4ff] text-xs font-mono mb-4">
          Pipeline
        </span>
        <h1 className="text-4xl md:text-5xl font-black text-white mb-4">How It Works</h1>
        <p className="text-[#9ca3af] max-w-xl mx-auto leading-relaxed">
          From raw image to structured data in five steps. Each stage is a dedicated
          AI model working in sequence.
        </p>
      </div>

      {/* Steps */}
      <div className="relative">
        {/* Vertical connector */}
        <div className="absolute left-8 top-10 bottom-10 w-px bg-gradient-to-b from-[#00d4ff]/40 via-[#7c3aed]/40 to-[#00d4ff]/40 hidden md:block" />

        <div className="space-y-6">
          {steps.map((step) => (
            <div key={step.number} className="relative flex gap-6 md:gap-10 group">
              {/* Step dot */}
              <div
                className="relative z-10 flex-shrink-0 w-16 h-16 rounded-2xl flex items-center justify-center text-2xl glass"
                style={{ border: `1px solid ${step.color}30`, background: `${step.color}10` }}
              >
                {step.icon}
              </div>

              {/* Content */}
              <div className="glass rounded-2xl p-6 flex-1 gradient-border hover:bg-white/[0.04] transition-all">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-xs font-mono" style={{ color: step.color }}>
                    {step.number}
                  </span>
                  <h2 className="text-white font-semibold text-lg">{step.title}</h2>
                </div>
                <p className="text-[#9ca3af] text-sm leading-relaxed">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div className="mt-16 text-center">
        <Link
          href="/demo"
          className="inline-block px-10 py-4 rounded-xl bg-[#00d4ff] text-[#0a0b0f] font-bold hover:bg-cyan-300 transition-colors glow-cyan"
        >
          Try It Yourself →
        </Link>
      </div>
    </div>
  );
}
