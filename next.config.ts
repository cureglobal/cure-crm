import type { NextConfig } from "next";

// Vercel setter denne selv under bygget.
const onVercel = Boolean(process.env.VERCEL);

const nextConfig: NextConfig = {
  // Kun for Docker/Fly-bygg: samler nødvendige filer i .next/standalone.
  // Slått av på Vercel — deres egen bunnbygger har hatt rapporterte kvirker
  // med standalone-output, og den trengs ikke der i utgangspunktet.
  ...(onVercel ? {} : { output: "standalone" }),
  // @libsql/client bruker plattformspesifikke native bindings og må ikke
  // pakkes av bunnbyggeren.
  serverExternalPackages: ["@libsql/client"],
  experimental: {
    // Standard er 1 MB — for lite til skjermbilder som sendes som base64
    // fra referanseprosjekt-skjemaet i prisverktøyet.
    serverActions: { bodySizeLimit: "8mb" },
  },
};

export default nextConfig;
