import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Construction Cody — Submittal Requirements",
  description:
    "Extract source-backed construction submittal requirements for human review.",
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
