import type { NextConfig } from "next";

// Vercel setter denne selv under bygget.
const onVercel = Boolean(process.env.VERCEL);
const isDev = process.env.NODE_ENV === "development";

// Ingen nonce her — det krever at hele appen rendres dynamisk og at nonce
// tres gjennom layout/proxy. img-src må tillate https: bredt siden
// firmalogoer hentes fra selskapenes egne nettsider (CompanyLogo.tsx).
const cspHeader = `
  default-src 'self';
  script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""};
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https:;
  font-src 'self';
  connect-src 'self';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  upgrade-insecure-requests;
`
  .replace(/\s{2,}/g, " ")
  .trim();

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
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: cspHeader },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
