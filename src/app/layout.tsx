import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { appUrl } from "@/lib/env";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Yoom",
  description: "Screen recording with shareable links",
  icons: { icon: `${appUrl()}/favicon.ico` },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${jakarta.className} bg-background text-foreground min-h-screen antialiased selection:bg-accent/20 selection:text-foreground`}>
        {children}
      </body>
    </html>
  );
}
