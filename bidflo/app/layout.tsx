import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BidFlo | Atlasium 7/88",
  description: "Intelligent Opportunity & Proposal Management",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
