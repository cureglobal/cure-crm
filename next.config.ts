import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Trengs for Docker/Fly-bygg: samler kun nødvendige filer i .next/standalone.
  // Vercel ignorerer denne og pakker på sin egen måte, så den er trygg å la stå.
  output: "standalone",
  // @libsql/client bruker plattformspesifikke native bindings og må ikke
  // pakkes av bunnbyggeren.
  serverExternalPackages: ["@libsql/client"],
};

export default nextConfig;
