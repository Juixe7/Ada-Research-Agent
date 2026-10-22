"use client";

interface AdaLogoProps {
  size?: "sm" | "md" | "lg";
  showWordmark?: boolean;
  className?: string;
}

export default function AdaPrismLogo({
  size = "md",
  showWordmark = true,
  className = "",
}: AdaLogoProps) {
  const iconSizes = {
    sm: "w-8 h-8",
    md: "w-10 h-10",
    lg: "w-12 h-12",
  };

  const textSizes = {
    sm: "text-lg",
    md: "text-xl",
    lg: "text-2xl",
  };

  return (
    <div className={`inline-flex items-center gap-3 select-none ${className}`}>
      {/* Refined Geometric Emblem: The Astrolabe in Muted Titanium & Silver */}
      <div
        className={`relative ${iconSizes[size]} rounded-xl bg-[#13151c] border border-white/[0.1] flex items-center justify-center p-2 shadow-sm transition-all group-hover:border-white/[0.2]`}
      >
        <svg
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full"
        >
          <defs>
            <linearGradient id="astrolabeTitanium" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#f4f4f5" />
              <stop offset="50%" stopColor="#a1a1aa" />
              <stop offset="100%" stopColor="#71717a" />
            </linearGradient>
            <linearGradient id="astrolabeRay" x1="16" y1="4" x2="16" y2="28" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="50%" stopColor="#d4d4d8" />
              <stop offset="100%" stopColor="#71717a" />
            </linearGradient>
          </defs>

          {/* Precision outer dial */}
          <circle cx="16" cy="16" r="11" stroke="url(#astrolabeTitanium)" strokeWidth="1.2" strokeDasharray="3 2" />

          {/* Concentric inner focal ring */}
          <circle cx="16" cy="16" r="6.5" stroke="#e4e4e7" strokeWidth="1.2" />

          {/* Precision focal rays */}
          <line x1="16" y1="5" x2="16" y2="27" stroke="url(#astrolabeRay)" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="5" y1="16" x2="27" y2="16" stroke="url(#astrolabeTitanium)" strokeWidth="0.8" strokeLinecap="round" />

          {/* Core focal jewel */}
          <circle cx="16" cy="16" r="2.2" fill="#e4e4e7" />
        </svg>
      </div>

      {/* Confident Wordmark */}
      {showWordmark && (
        <div className="flex flex-col justify-center leading-none">
          <div className="flex items-baseline gap-2">
            <span
              className={`font-serif font-bold tracking-tight text-[var(--ink)] ${textSizes[size]}`}
            >
              Ada
            </span>
              <span className="max-[360px]:hidden text-[11px] font-sans font-semibold tracking-wide text-[var(--ink-3)]">
              Research
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
