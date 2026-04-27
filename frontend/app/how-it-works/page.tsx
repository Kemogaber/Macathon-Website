import Link from "next/link";

type IconProps = { color: string };

const SVG = ({ children }: { children: React.ReactNode }) => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

const UploadIcon = ({ color }: IconProps) => (
  <SVG>
    <rect x="3" y="5" width="14" height="12" rx="2" stroke={color} opacity="0.55" />
    <circle cx="8" cy="9.5" r="1.2" fill={color} opacity="0.7" />
    <path d="M3.5 14.5l3.5-3 3 2.5 3-3 3.5 3" stroke={color} opacity="0.55" />
    <circle cx="18" cy="18" r="4.5" fill="none" stroke={color} />
    <path d="M18 16v4M16 18l2-2 2 2" stroke={color} />
  </SVG>
);

const DetectIcon = ({ color }: IconProps) => (
  <SVG>
    <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" stroke={color} />
    <rect x="7" y="7" width="10" height="10" rx="1" stroke={color} opacity="0.85" />
    <line x1="7" y1="11.5" x2="17" y2="11.5" stroke={color} opacity="0.45" />
    <line x1="12" y1="7" x2="12" y2="17" stroke={color} opacity="0.45" />
  </SVG>
);

const StructureIcon = ({ color }: IconProps) => (
  <SVG>
    <rect x="3" y="3" width="18" height="18" rx="2" stroke={color} opacity="0.55" />
    <line x1="3" y1="9" x2="21" y2="9" stroke={color} opacity="0.55" />
    <line x1="3" y1="15" x2="21" y2="15" stroke={color} opacity="0.55" />
    <line x1="9" y1="3" x2="9" y2="21" stroke={color} opacity="0.55" />
    <line x1="15" y1="3" x2="15" y2="21" stroke={color} opacity="0.55" />
    <rect x="9" y="9" width="6" height="6" fill={color} opacity="0.25" />
    <rect x="9" y="9" width="6" height="6" stroke={color} />
  </SVG>
);

const OcrIcon = ({ color }: IconProps) => (
  <SVG>
    <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" stroke={color} />
    <path d="M8 15l2-6 2 6M8.7 13h2.6" stroke={color} />
    <path d="M14 15V9h2.5a1.5 1.5 0 0 1 0 3H14M14 12l2.5 3" stroke={color} />
    <line x1="3" y1="12" x2="21" y2="12" stroke={color} opacity="0.35" strokeDasharray="2 2" />
  </SVG>
);

const DownloadIcon = ({ color }: IconProps) => (
  <SVG>
    <path d="M7 3h7l4 4v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" stroke={color} opacity="0.6" />
    <path d="M14 3v4h4" stroke={color} opacity="0.6" />
    <line x1="8.5" y1="11" x2="14.5" y2="11" stroke={color} opacity="0.45" />
    <line x1="8.5" y1="13.5" x2="14.5" y2="13.5" stroke={color} opacity="0.45" />
    <path d="M11.5 16v4M9 17.5l2.5 2.5L14 17.5" stroke={color} />
  </SVG>
);

const steps = [
  {
    number: "01",
    title: "Upload Your Image",
    desc: "Drag and drop or select any image containing a table — photos, scans, screenshots, or PDF exports. Supports JPEG, PNG, and WebP up to 20 MB.",
    Icon: UploadIcon,
    color: "#00d4ff",
  },
  {
    number: "02",
    title: "Table Detection",
    desc: "A deep learning model scans the image and draws bounding boxes around every table region, even when tables overlap other content or have irregular borders.",
    Icon: DetectIcon,
    color: "#7c3aed",
  },
  {
    number: "03",
    title: "Structure Recognition",
    desc: "A second model parses the detected region to identify rows, columns, merged cells, and header rows — reconstructing the full table grid.",
    Icon: StructureIcon,
    color: "#00d4ff",
  },
  {
    number: "04",
    title: "OCR Extraction",
    desc: "Optical Character Recognition reads the text inside each individual cell, handling mixed fonts, numbers, special characters, and handwriting.",
    Icon: OcrIcon,
    color: "#7c3aed",
  },
  {
    number: "05",
    title: "Download Results",
    desc: "The structured data is formatted as clean HTML (preserving headers and styles) and CSV (for spreadsheet or database import). Both download instantly.",
    Icon: DownloadIcon,
    color: "#00d4ff",
  },
];

export default function HowItWorksPage() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-16">
      <div className="text-center mb-16">
        <span className="inline-block px-3 py-1 rounded-full border border-cyan/20 bg-[rgba(0,212,255,0.1)] text-cyan text-xs font-mono mb-4">
          Pipeline
        </span>
        <h1 className="text-4xl md:text-5xl font-black text-text mb-4">How It Works</h1>
        <p className="text-muted-2 max-w-xl mx-auto leading-relaxed">
          From raw image to structured data in five steps. Each stage is a dedicated
          AI model working in sequence.
        </p>
      </div>

      {/* Steps */}
      <div className="relative">
        {/* Vertical connector — passes through the icon centers (left-10 = 40px = half of 80px tile) */}
        <div className="absolute left-10 top-0 bottom-0 w-px bg-linear-to-b from-cyan/0 via-cyan/50 to-purple/0 hidden md:block" />

        <div className="space-y-8">
          {steps.map(({ number, title, desc, Icon, color }) => (
            <div key={number} className="relative flex gap-6 md:gap-8 items-start group">
              {/* Icon tile */}
              <div
                className="relative z-10 shrink-0 w-20 h-20 rounded-2xl flex items-center justify-center glass transition-transform duration-300 group-hover:scale-105 group-hover:rotate-[-2deg]"
                style={{
                  border: `1px solid ${color}40`,
                  background: `radial-gradient(circle at 30% 30%, ${color}25, ${color}08 70%)`,
                  boxShadow: `0 0 24px ${color}25, inset 0 0 12px ${color}15`,
                }}
              >
                <Icon color={color} />
                <span
                  className="absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-mono font-bold"
                  style={{
                    background: `${color}`,
                    color: "#0a0b0f",
                    boxShadow: `0 0 12px ${color}80`,
                  }}
                >
                  {number}
                </span>
              </div>

              {/* Content */}
              <div
                className="glass rounded-2xl p-6 flex-1 gradient-border transition-all duration-300 group-hover:bg-white/4"
                style={{ borderColor: `${color}20` }}
              >
                <div className="flex items-center gap-3 mb-2">
                  <h2 className="text-text font-semibold text-lg">{title}</h2>
                  <span className="h-px flex-1" style={{ background: `linear-gradient(to right, ${color}40, transparent)` }} />
                </div>
                <p className="text-muted-2 text-sm leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div className="mt-16 text-center">
        <Link
          href="/demo"
          className="inline-block px-10 py-4 rounded-xl bg-cyan text-background font-bold hover:bg-cyan-300 transition-colors glow-cyan"
        >
          Try It Yourself →
        </Link>
      </div>
    </div>
  );
}
