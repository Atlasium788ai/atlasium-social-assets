import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.echoflowsocial.ca"),
  title: "EchoFlow Social",
  description: "One prompt, every brand, one controlled social publishing flow. Powered by Atlasium 7/88 AI.",
  openGraph: {
    title: "EchoFlow Social",
    description: "One prompt, every brand, one controlled publishing flow.",
    url: "https://www.echoflowsocial.ca",
    siteName: "EchoFlow Social",
    images: [{
      url: "/echoflow-social.png",
      width: 1254,
      height: 1254,
      alt: "EchoFlow Social, powered by Atlasium 7/88 AI",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title: "EchoFlow Social",
    description: "One prompt, every brand, one controlled publishing flow.",
    images: ["/echoflow-social.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#070706",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
