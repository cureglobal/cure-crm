import { initials } from "@/lib/format";

const PALETTE = [
  ["#eaf3fe", "#0071e3"],
  ["#efeafe", "#5e5ce6"],
  ["#e6f8ec", "#1d7a3a"],
  ["#fef3e6", "#b06a00"],
  ["#fdeaea", "#c23b35"],
  ["#e8f6f8", "#0e7c8a"],
];

export default function Avatar({
  name,
  size = 26,
  title,
  imageUrl,
}: {
  name: string;
  size?: number;
  title?: string;
  imageUrl?: string | null;
}) {
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- data-URL, ikke en Next-håndtert ekstern ressurs
      <img
        src={imageUrl}
        alt={name}
        title={title ?? name}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const [bg, fg] = PALETTE[Math.abs(hash) % PALETTE.length];
  return (
    <span
      title={title ?? name}
      className="flex shrink-0 items-center justify-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        background: bg,
        color: fg,
        fontSize: size * 0.4,
      }}
    >
      {initials(name)}
    </span>
  );
}
