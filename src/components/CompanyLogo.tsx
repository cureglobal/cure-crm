"use client";

import { useState } from "react";

export default function CompanyLogo({
  logoUrl,
  name,
  size = 36,
  radius = 10,
}: {
  logoUrl: string | null;
  name: string;
  size?: number;
  radius?: number;
}) {
  const [failed, setFailed] = useState(false);
  if (!logoUrl || failed) {
    return (
      <span
        className="flex shrink-0 items-center justify-center bg-accent-soft font-semibold text-accent"
        style={{ width: size, height: size, borderRadius: radius, fontSize: size * 0.42 }}
      >
        {name.charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logoUrl}
      alt=""
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className="shrink-0 border border-line bg-white object-contain p-[3px]"
      style={{ width: size, height: size, borderRadius: radius }}
    />
  );
}
