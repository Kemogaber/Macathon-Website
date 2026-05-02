// Visual showcase rendered entirely in CSS/SVG — no asset files. The
// "before" is a stylized scan/photo of a messy table; the "after" is a
// real HTML table with the same data cleanly rendered.

const sampleRows = [
  ["Q1", "$142,300", "$98,420", "+44.6%"],
  ["Q2", "$167,820", "$104,910", "+59.9%"],
  ["Q3", "$189,540", "$112,300", "+68.8%"],
  ["Q4", "$215,170", "$120,840", "+78.0%"],
];
const sampleHeader = ["Quarter", "Revenue", "Costs", "Margin"];

export default function BeforeAfterShowcase() {
  return (
    <section className="max-w-6xl mx-auto px-6 py-20">
      <div className="text-center mb-12">
        <h2 className="text-3xl md:text-4xl font-bold text-text mb-3">
          From a phone photo to clean data
        </h2>
        <p className="text-muted-2 max-w-xl mx-auto">
          Drop a snapshot, scan, or PDF — get a structured table you can edit
          and download.
        </p>
      </div>

      <div className="grid md:grid-cols-[1fr_auto_1fr] items-center gap-6">
        <BeforeCard />
        <Arrow />
        <AfterCard />
      </div>
    </section>
  );
}

function BeforeCard() {
  return (
    <div className="relative">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-2 mb-2">
        Before — your image
      </div>
      <div
        className="relative rounded-xl border border-border bg-[#6a4a43] p-4 shadow-2xl overflow-hidden"
        style={{ transform: "rotate(-1.5deg)" }}
      >
        {/* Faux paper */}
        <div className="rounded-md bg-[#f4ede0] p-4 relative" style={{ filter: "contrast(0.95) brightness(0.97)" }}>
          {/* warm photo cast */}
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none mix-blend-multiply"
            style={{
              background:
                "linear-gradient(135deg, rgba(255,200,150,0.25), rgba(180,140,100,0.15) 60%, rgba(60,40,20,0.2))",
            }}
          />
          {/* SVG: a deliberately uneven, OCR-unfriendly table */}
          <svg viewBox="0 0 360 200" className="w-full h-auto block relative">
            {/* outer skewed rect */}
            <g transform="skewX(-3) translate(8 4)">
              <rect x="0" y="0" width="340" height="190" fill="none" stroke="#3a2a18" strokeWidth="1.4" />
              {/* horizontal lines, slightly wavy */}
              {[35, 70, 105, 140, 175].map((y, i) => (
                <path
                  key={y}
                  d={`M 0 ${y} Q 110 ${y - (i % 2 ? 1.2 : -1.5)} 220 ${y + (i % 2 ? 0.8 : -0.5)} T 340 ${y}`}
                  fill="none"
                  stroke="#3a2a18"
                  strokeWidth="0.9"
                />
              ))}
              {/* vertical lines */}
              {[90, 180, 260].map((x) => (
                <line key={x} x1={x} y1="0" x2={x + (x === 180 ? 1 : 0)} y2="190" stroke="#3a2a18" strokeWidth="0.9" />
              ))}
              {/* fake handwritten-looking text */}
              <g fill="#241608" fontFamily="ui-monospace, monospace" fontSize="11">
                <text x="14" y="22">Quarter</text>
                <text x="100" y="22">Revenue</text>
                <text x="190" y="22">Costs</text>
                <text x="270" y="22">Margin</text>

                <text x="14" y="58">Q1</text>
                <text x="100" y="58">$142,3OO</text>
                <text x="190" y="58">$98,42O</text>
                <text x="270" y="58">+44.6%</text>

                <text x="14" y="93">Q2</text>
                <text x="100" y="93">$167,82O</text>
                <text x="190" y="93">$1O4,910</text>
                <text x="270" y="93">+59.9%</text>

                <text x="14" y="128">Q3</text>
                <text x="100" y="128">$189,54O</text>
                <text x="190" y="128">$112,3OO</text>
                <text x="270" y="128">+68.8%</text>

                <text x="14" y="163">Q4</text>
                <text x="100" y="163">$215,170</text>
                <text x="190" y="163">$120,84O</text>
                <text x="270" y="163">+78.O%</text>
              </g>
              {/* coffee stain / smudge */}
              <ellipse cx="305" cy="160" rx="22" ry="14" fill="rgba(120,70,30,0.2)" />
              <ellipse cx="295" cy="155" rx="9" ry="6" fill="rgba(120,70,30,0.25)" />
            </g>
          </svg>
        </div>
      </div>
    </div>
  );
}

function Arrow() {
  return (
    <div className="flex items-center justify-center">
      <div className="hidden md:flex flex-col items-center gap-1">
        <div className="text-cyan text-2xl">→</div>
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-2">
          Parsed
        </div>
      </div>
      <div className="md:hidden text-cyan text-2xl rotate-90">→</div>
    </div>
  );
}

function AfterCard() {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-2 mb-2">
        After — clean table
      </div>
      <div className="rounded-xl border border-cyan/30 bg-surface-3 shadow-2xl overflow-hidden">
        <div className="px-4 py-2 border-b border-border bg-overlay text-[10px] font-mono text-muted-2 flex items-center justify-between">
          <span>table_1.csv · 4 rows · 4 cols</span>
          <span className="text-purple">✓ extracted</span>
        </div>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {sampleHeader.map((h) => (
                <th
                  key={h}
                  className="text-left px-3 py-2 border-b border-border text-text font-semibold bg-overlay"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sampleRows.map((row, i) => (
              <tr key={i} className={i % 2 ? "bg-overlay" : ""}>
                {row.map((c, j) => (
                  <td
                    key={j}
                    className="px-3 py-2 border-b border-border text-muted-2 font-mono"
                  >
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
