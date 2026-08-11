import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cure CRM",
  description: "Smart, enkelt CRM",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="nb" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
