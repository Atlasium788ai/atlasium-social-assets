import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Visez | Atlasium",
  description: "Find better opportunities, build stronger proposals, and win more clients with AI-powered opportunity and proposal automation",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
