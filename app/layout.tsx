import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { identityConfigured } from "@/lib/user";

export const metadata: Metadata = {
  title: "Fortress HQ",
  description: "Advertising and analytics operations across Google Ads, Analytics, Search Console and Tag Manager.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const page = (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <div className="shell">
          <Nav />
          <main>{children}</main>
        </div>
      </body>
    </html>
  );

  // Clerk is only pulled in when it is actually configured. Wrapping
  // unconditionally would drag its provider and scripts into every page of a
  // deployment that has no identity provider and does not want one.
  if (!identityConfigured) return page;
  const { ClerkProvider } = await import("@clerk/nextjs");
  return <ClerkProvider>{page}</ClerkProvider>;
}
