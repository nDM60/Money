import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Money Pocket",
  description: "Personal finance: balances, budgets, savings, investments and AI insights.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Money Pocket", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#0b1f3a" }, { media: "(prefers-color-scheme: dark)", color: "#0c0d10" }],
};

// Applies the saved theme before first paint (no flash).
const themeScript = `(function(){try{var t=localStorage.getItem('mp-theme')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';var l=localStorage.getItem('mp-lang');if(l)document.documentElement.lang=l;}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+Lao:wght@400;500;600;700&family=Noto+Sans+Thai:wght@400;500;600;700&display=swap"
        />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
