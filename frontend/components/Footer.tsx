export default function Footer() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-4">
        <p className="text-muted text-sm">
          © {new Date().getFullYear()} Macathon. AI-powered table extraction.
        </p>
        <p className="text-muted text-xs font-mono">
          Table Detection · Structure Recognition · OCR
        </p>
      </div>
    </footer>
  );
}
