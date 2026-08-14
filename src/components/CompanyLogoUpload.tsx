"use client";

import { useRef, useState, useTransition } from "react";
import { updateCompanyLogo } from "@/lib/actions";
import CompanyLogo from "@/components/CompanyLogo";
import { Camera } from "lucide-react";

const MAX_LOGO_BYTES = 1.5 * 1024 * 1024;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function CompanyLogoUpload({
  companyId,
  name,
  logoUrl,
  size = 56,
  radius = 14,
}: {
  companyId: number;
  name: string;
  logoUrl: string | null;
  size?: number;
  radius?: number;
}) {
  const [preview, setPreview] = useState(logoUrl);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(file: File) {
    setError(null);
    if (file.size > MAX_LOGO_BYTES) {
      setError("Bildet er for stort (maks 1,5 MB).");
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    setPreview(dataUrl);
    const fd = new FormData();
    fd.set("logo", dataUrl);
    startTransition(() => updateCompanyLogo(companyId, fd));
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={pending}
        title="Last opp eget ikon"
        className="group relative block"
        style={{ borderRadius: radius }}
      >
        <CompanyLogo logoUrl={preview} name={name} size={size} radius={radius} />
        <span
          className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100"
          style={{ borderRadius: radius }}
        >
          <Camera size={size * 0.36} className="text-white" />
        </span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
      {error && (
        <p className="absolute left-0 top-full z-10 mt-1 w-36 text-[11px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
