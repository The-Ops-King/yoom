interface YoomLogoProps {
  size?: "sm" | "md" | "lg";
  showText?: boolean;
  className?: string;
}

const sizes = {
  sm: { mark: 24, text: "text-sm", gap: "gap-2" },
  md: { mark: 32, text: "text-lg", gap: "gap-2.5" },
  lg: { mark: 48, text: "text-2xl", gap: "gap-3" },
};

export function YoomLogo({ size = "md", showText = true, className = "" }: YoomLogoProps) {
  const s = sizes[size];

  return (
    <div className={`flex items-center ${s.gap} ${className}`}>
      <svg
        width={s.mark}
        height={s.mark}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Geometric Y: two diagonal strokes converging to a vertical */}
        <path
          d="M10 8L24 26L38 8"
          stroke="#3f7d5c"
          strokeWidth="4.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M24 26L24 40"
          stroke="#3f7d5c"
          strokeWidth="4.5"
          strokeLinecap="round"
        />
        {/* Record dot at the junction */}
        <circle
          cx="24"
          cy="26"
          r="4"
          fill="#3f7d5c"
        />
      </svg>
      {showText && (
        <span
          className={`${s.text} font-bold text-foreground`}
          style={{ letterSpacing: "-0.02em" }}
        >
          Yoom
        </span>
      )}
    </div>
  );
}
