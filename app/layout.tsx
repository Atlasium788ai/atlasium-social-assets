import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Atlasium Social Agent",
  description: "Create and publish complete social campaigns from one prompt.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "Atlasium Social Agent",
    description: "One prompt. A complete social campaign.",
    images: [{ url: "/og.png", width: 1792, height: 921, alt: "Atlasium — Upload. Copy. Post." }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Atlasium Social Agent",
    description: "One prompt. A complete social campaign.",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#080b0a",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
