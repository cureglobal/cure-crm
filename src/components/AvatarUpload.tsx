"use client";

import { useRef, useState, useTransition } from "react";
import { updateAvatar } from "@/lib/actions";
import Avatar from "@/components/Avatar";
import { Camera } from "lucide-react";

const MAX_AVATAR_BYTES = 1.5 * 1024 * 1024; // 1,5 MB — rundt-tall nok til et portrett, uten å blåse opp siden

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function AvatarUpload({
  userId,
  name,
  avatarDataUrl,
  size = 36,
  editable = true,
}: {
  userId: number;
  name: string;
  avatarDataUrl: string | null;
  size?: number;
  editable?: boolean;
}) {
  const [preview, setPreview] = useState(avatarDataUrl);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(file: File) {
    setError(null);
    if (file.size > MAX_AVATAR_BYTES) {
      setError("Bildet er for stort (maks 1,5 MB).");
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    setPreview(dataUrl);
    const fd = new FormData();
    fd.set("avatar", dataUrl);
    startTransition(() => updateAvatar(userId, fd));
  }

  if (!editable) {
    return <Avatar name={name} imageUrl={preview} size={size} />;
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={pending}
        title="Endre bilde"
        className="group relative block rounded-full"
      >
        <Avatar name={name} imageUrl={preview} size={size} />
        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition group-hover:opacity-100">
          <Camera size={size * 0.42} className="text-white" />
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
