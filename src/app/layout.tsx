import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kawashima Motors Shaken",
  description: "Vehicle inspection reservation system for Kawashima Motors.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
