import type { Metadata } from "next";
import { Instrument_Sans, Source_Serif_4, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument-sans",
  display: "swap",
});

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-source-serif",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Ada — Research workspace",
  description: "A personal workspace for planning research, reviewing evidence, and writing grounded reports.",
};

import { AuthProvider } from "@/context/AuthContext";
import CommandPalette from "@/components/CommandPalette";
import AuthBoundary from "@/components/AuthBoundary";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${instrumentSans.variable} ${sourceSerif.variable} ${jetbrainsMono.variable} font-sans min-h-screen bg-[var(--paper)] text-[var(--ink)] antialiased selection:bg-[var(--accent-soft)] selection:text-[var(--ink)]`}
      >
        <AuthProvider>
          <AuthBoundary>
            {children}
            <CommandPalette />
          </AuthBoundary>
        </AuthProvider>
      </body>
    </html>
  );
}

