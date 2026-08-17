"use client";

import { useEffect, useRef, useState } from "react";

// Sendes fra fasevelgeren og fra tavlen når en deal settes til «Vunnet».
export const WON_EVENT = "crm:deal-won";

export function celebrateWin(dealName?: string) {
  window.dispatchEvent(new CustomEvent(WON_EVENT, { detail: { dealName } }));
}

const COLORS = ["#0071e3", "#30d158", "#ff9f0a", "#5e5ce6", "#ff453a", "#ffd60a"];
const DURATION = 5000;

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  spin: number;
  angle: number;
  shape: "rect" | "circle";
}

function useConfetti(active: boolean) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // To skyer fra hver side pluss litt regn ovenfra.
    const pieces: Piece[] = [];
    const spawn = (x: number, y: number, vx: number, vy: number) => {
      pieces.push({
        x,
        y,
        vx,
        vy,
        size: 6 + Math.random() * 7,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        spin: (Math.random() - 0.5) * 0.3,
        angle: Math.random() * Math.PI,
        shape: Math.random() > 0.35 ? "rect" : "circle",
      });
    };

    const burst = () => {
      for (let i = 0; i < 110; i++) {
        spawn(0, height * 0.8, 4 + Math.random() * 8, -(5 + Math.random() * 9));
        spawn(width, height * 0.8, -(4 + Math.random() * 8), -(5 + Math.random() * 9));
      }
      for (let i = 0; i < 90; i++) {
        spawn(Math.random() * width, -20, (Math.random() - 0.5) * 2.5, 1.5 + Math.random() * 2);
      }
    };
    burst();
    // Flere salver så feiringen varer lenger og ikke er over på et blunk.
    const second = setTimeout(burst, 800);
    const third = setTimeout(burst, 1700);

    let raf = 0;
    const start = performance.now();

    const tick = (now: number) => {
      const elapsed = now - start;
      ctx.clearRect(0, 0, width, height);

      for (const p of pieces) {
        p.vy += 0.15; // tyngdekraft — lav nok til at konfettien svever litt
        p.vx *= 0.995;
        p.x += p.vx;
        p.y += p.vy;
        p.angle += p.spin;

        // Fader ut mot slutten så det ikke forsvinner brått.
        ctx.globalAlpha = Math.max(0, 1 - Math.max(0, elapsed - DURATION * 0.6) / (DURATION * 0.4));
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.fillStyle = p.color;
        if (p.shape === "rect") {
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      if (elapsed < DURATION) {
        raf = requestAnimationFrame(tick);
      } else {
        ctx.clearRect(0, 0, width, height);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(second);
      clearTimeout(third);
    };
  }, [active]);

  return canvasRef;
}

export default function WonCelebration() {
  const [active, setActive] = useState(false);
  const [dealName, setDealName] = useState<string | null>(null);
  const canvasRef = useConfetti(active);

  useEffect(() => {
    function onWon(event: Event) {
      const detail = (event as CustomEvent<{ dealName?: string }>).detail;
      setDealName(detail?.dealName ?? null);
      setActive(false);
      // Nullstiller først, slik at to seiere på rad begge gir animasjon.
      requestAnimationFrame(() => setActive(true));
    }
    window.addEventListener(WON_EVENT, onWon);
    return () => window.removeEventListener(WON_EVENT, onWon);
  }, []);

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setActive(false), DURATION);
    return () => clearTimeout(timer);
  }, [active]);

  if (!active) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[100] overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      <div className="absolute inset-x-0 bottom-[12vh] flex flex-col items-center gap-3">
        <div className="relative flex items-end gap-1">
          <span className="sparkle sparkle-1 select-none text-[34px] leading-none">✨</span>
          <span className="dancer dancer-1 select-none text-[72px] leading-none drop-shadow-lg">
            🕺
          </span>
          <span className="dancer dancer-2 select-none text-[86px] leading-none drop-shadow-lg">
            🎉
          </span>
          <span className="dancer dancer-1 select-none text-[72px] leading-none drop-shadow-lg">
            💃
          </span>
          <span className="sparkle sparkle-2 select-none text-[30px] leading-none">🎆</span>
        </div>
        <div className="won-banner rounded-full bg-surface/90 px-5 py-2.5 shadow-pop backdrop-blur-xl">
          <p className="text-[15px] font-semibold tracking-tight">
            Vunnet! {dealName && <span className="text-ink-soft">{dealName}</span>}
          </p>
        </div>
      </div>

      <style>{`
        @keyframes crm-dance-1 {
          0%   { transform: translateY(0) rotate(-14deg) scale(1); }
          15%  { transform: translateY(-26px) rotate(12deg) scale(1.06); }
          30%  { transform: translateY(0) rotate(-10deg) scale(1); }
          45%  { transform: translateY(-20px) rotate(14deg) scale(1.04); }
          60%  { transform: translateY(0) rotate(-12deg) scale(1); }
          75%  { transform: translateY(-24px) rotate(10deg) scale(1.05); }
          100% { transform: translateY(0) rotate(-14deg) scale(1); }
        }
        @keyframes crm-dance-2 {
          0%   { transform: translateY(0) rotate(0deg) scale(1); }
          25%  { transform: translateY(-32px) rotate(-16deg) scale(1.1); }
          50%  { transform: translateY(0) rotate(0deg) scale(1); }
          75%  { transform: translateY(-28px) rotate(16deg) scale(1.08); }
          100% { transform: translateY(0) rotate(0deg) scale(1); }
        }
        @keyframes crm-sparkle {
          0%, 100% { opacity: 0.3; transform: scale(0.8) rotate(0deg); }
          50% { opacity: 1; transform: scale(1.3) rotate(25deg); }
        }
        @keyframes crm-pop {
          0%   { opacity: 0; transform: translateY(14px) scale(0.9); }
          20%  { opacity: 1; transform: translateY(0) scale(1); }
          85%  { opacity: 1; }
          100% { opacity: 0; }
        }
        .dancer-1 {
          animation: crm-dance-1 0.85s ease-in-out infinite;
        }
        .dancer-2 {
          animation: crm-dance-2 0.95s ease-in-out infinite;
          animation-delay: 0.15s;
        }
        .sparkle {
          animation: crm-sparkle 1.1s ease-in-out infinite;
        }
        .sparkle-2 {
          animation-delay: 0.4s;
        }
        .won-banner {
          animation: crm-pop ${DURATION}ms ease-out forwards;
        }
        @media (prefers-reduced-motion: reduce) {
          .dancer-1, .dancer-2, .sparkle { animation: none; }
        }
      `}</style>
    </div>
  );
}
