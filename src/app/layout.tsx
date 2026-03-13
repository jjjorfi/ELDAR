import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Fragment_Mono, Inter } from "next/font/google";

import { SmoothScrollProvider } from "@/components/SmoothScrollProvider";
import { ThemedClerkProvider } from "@/components/ThemedClerkProvider";
import { ContextMenuRoot } from "@/components/ui/CopyContextMenu";
import { GlobalCommandPalette } from "@/components/ui/GlobalCommandPalette";

import "./globals.css";
import "@/ui/theme/theme.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-fastino-sans"
});

const fragmentMono = Fragment_Mono({
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  variable: "--font-fastino-mono"
});

const metadataBase = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000");
  } catch {
    return new URL("http://localhost:3000");
  }
})();

export const metadata: Metadata = {
  metadataBase,
  title: "ELDAR",
  description: "ELDAR institutional stock analysis platform.",
  icons: {
    icon: "/brand/eldar-logo-512.png",
    shortcut: "/brand/eldar-logo-512.png",
    apple: "/brand/eldar-logo-512.png"
  },
  openGraph: {
    title: "ELDAR",
    description: "Institutional-grade platform for real-time stock analysis.",
    type: "website",
    images: [
      {
        url: "/brand/eldar-og.png",
        width: 1200,
        height: 630,
        alt: "ELDAR"
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: "ELDAR",
    description: "Institutional-grade platform for real-time stock analysis.",
    images: ["/brand/eldar-og.png"]
  }
};

function PageVignette(): JSX.Element {
  return <div aria-hidden="true" className="page-vignette" />;
}

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const clerkEnabled = typeof publishableKey === "string" && publishableKey.trim().length > 0;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/brand/eldar-logo-512.png" sizes="512x512" type="image/png" />
        <link rel="apple-touch-icon" href="/brand/eldar-logo-512.png" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(() => {
  try {
    const saved = localStorage.getItem("eldar-theme-mode");
    document.documentElement.dataset.theme = saved === "light" ? "light" : "dark";
  } catch {
    document.documentElement.dataset.theme = "dark";
  }
})();`
          }}
        />
      </head>
      <body className={`${inter.variable} ${fragmentMono.variable} relative min-h-screen bg-ink text-slate-100`}>
        <ContextMenuRoot />
        {clerkEnabled ? (
          <ThemedClerkProvider>
            <div className="relative z-[1]">
              <SmoothScrollProvider />
              <PageVignette />
              {children}
              <GlobalCommandPalette />
            </div>
          </ThemedClerkProvider>
        ) : (
          <div className="relative z-[1]">
            <SmoothScrollProvider />
            <PageVignette />
            {children}
            <GlobalCommandPalette />
          </div>
        )}
      </body>
    </html>
  );
}
