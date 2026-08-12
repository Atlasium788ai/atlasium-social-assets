import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Atlasium Image Upload",
  description: "Upload an image and get a permanent public URL.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "Atlasium Image Upload",
    description: "Upload. Copy. Post.",
    images: [{ url: "/og.png", width: 1792, height: 921, alt: "Atlasium — Upload. Copy. Post." }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Atlasium Image Upload",
    description: "Upload. Copy. Post.",
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
