import type { Metadata } from "next";
import { Inter, Instrument_Sans } from "next/font/google";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { identityConfigured } from "@/lib/user";

const inter = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-inter", display: "swap" });
const instrument = Instrument_Sans({ subsets: ["latin", "latin-ext"], variable: "--font-instrument", display: "swap" });

export const metadata: Metadata = {
  title: "Fortress HQ",
  description: "What to change in your Google Ads accounts, with Analytics, Search Console and Tag Manager alongside.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const page = (
    <html lang="en" className={`${inter.variable} ${instrument.variable} ${GeistMono.variable}`}>
      <body>
        {children}
      </body>
    </html>
  );

  // Clerk is only pulled in when it is actually configured.
  if (!identityConfigured) return page;
  const { ClerkProvider } = await import("@clerk/nextjs");
  return <ClerkProvider>{page}</ClerkProvider>;
}
