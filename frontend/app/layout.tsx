import type { Metadata } from "next";
import { Montserrat, Playfair_Display } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { DemoProvider } from "@/lib/demoStore";
import { ToastProvider } from "@/lib/toast";
import Toaster from "@/components/Toaster";

const display = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-display",
});
const body = Montserrat({ subsets: ["latin"], variable: "--font-body" });

export const metadata: Metadata = {
  title: "Macathon — AI Table Extractor",
  description:
    "Extract structured tables from any image instantly. Powered by table detection, structure recognition, and OCR.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`} data-theme="light">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(()=>{try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t='light';}document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`,
          }}
        />
      </head>
      <body className="min-h-screen flex flex-col">
        <ToastProvider>
          <DemoProvider>
            <Navbar />
            <main className="flex-1">{children}</main>
            <Footer />
            <Toaster />
          </DemoProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
