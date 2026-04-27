import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { DemoProvider } from "@/lib/demoStore";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Macathon — AI Table Extractor",
  description:
    "Extract structured tables from any image instantly. Powered by table detection, structure recognition, and OCR.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} data-theme="dark">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(()=>{try{var t=localStorage.getItem('theme');if(!t){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-screen flex flex-col">
        <DemoProvider>
          <Navbar />
          <main className="flex-1">{children}</main>
          <Footer />
        </DemoProvider>
      </body>
    </html>
  );
}
