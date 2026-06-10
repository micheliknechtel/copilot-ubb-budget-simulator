import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Copilot UBB Budget Simulator",
  description: "Simulate budget controls for GitHub Copilot Enterprise usage-based billing",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
