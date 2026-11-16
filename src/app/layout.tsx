import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Garageband Web",
  description: "A browser-based music studio for recording, arranging, and producing music.",
  applicationName: "Garageband Web",
  keywords: ["Garageband Web", "online music studio", "digital audio workstation", "music production"],
  icons: {
    icon: "/favicon.png",
  },
  openGraph: {
    title: "Garageband Web",
    description: "A browser-based music studio for recording, arranging, and producing music.",
    siteName: "Garageband Web",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Garageband Web",
    description: "A browser-based music studio for recording, arranging, and producing music.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
