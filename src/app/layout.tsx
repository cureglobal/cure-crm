import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cure CRM",
  description: "Smart, enkelt CRM",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();

  return (
    <html lang="nb" className="h-full antialiased" data-theme={user?.theme ?? "lys"}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
