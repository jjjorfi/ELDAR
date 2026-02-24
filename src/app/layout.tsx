import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { Inter } from "next/font/google";
import Script from "next/script";

import { SmoothScrollProvider } from "@/components/SmoothScrollProvider";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-body"
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

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const clerkEnabled = typeof publishableKey === "string" && publishableKey.trim().length > 0;

  const content = (
    <html lang="en">
      <body className={`${inter.variable} min-h-screen bg-ink text-slate-100`}>
        <SmoothScrollProvider />
        {children}
        <Script id="rssapp-widget" src="https://widget.rss.app/v1/ticker.js" strategy="afterInteractive" />
      </body>
    </html>
  );

  if (!clerkEnabled) {
    return content;
  }

  return (
    <ClerkProvider>
      {content}
    </ClerkProvider>
  );
}
