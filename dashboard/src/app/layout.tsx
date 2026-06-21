import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "wankle-trials // live dashboard",
  description: "Live telemetry dashboard for the wankle-trials cheat detection experiment. Reads from GitHub, no VM dependency.",
  keywords: ["wankle", "trials", "cheat", "telemetry", "dashboard", "ascii art"],
  authors: [{ name: "wankle-trials" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "wankle-trials // live dashboard",
    description: "Live telemetry + ASCII art stream from the cheat-detection experiment",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "wankle-trials",
    description: "Live telemetry + ASCII art stream",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground scanlines`}
      >
        {children}
      </body>
    </html>
  );
}
