export default function Footer() {
  return (
    <footer className="border-t border-white/5 bg-[#0a0b0f]">
      <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-4">
        <p className="text-[#6b7280] text-sm">
          © {new Date().getFullYear()} Macathon. AI-powered table extraction.
        </p>
        <p className="text-[#6b7280] text-xs font-mono">
          Table Detection · Structure Recognition · OCR
        </p>
      </div>
    </footer>
  );
}
