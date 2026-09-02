export interface BackgroundPreset {
  id: string;
  label: string;
  /** Same-origin path so canvases stay untainted. */
  src: string;
  /** CSS gradient used for the swatch in the picker. */
  swatch: string;
}

export const BACKGROUND_PRESETS: BackgroundPreset[] = [
  {
    id: "sunset",
    label: "Sunset",
    src: "/backgrounds/sunset.svg",
    swatch: "linear-gradient(135deg,#f5734c 0%,#e8465a 55%,#7a2a6b 100%)",
  },
  {
    id: "ocean",
    label: "Ocean",
    src: "/backgrounds/ocean.svg",
    swatch: "linear-gradient(135deg,#1e3a8a 0%,#0ea5b7 55%,#67e8c3 100%)",
  },
  {
    id: "graphite",
    label: "Graphite",
    src: "/backgrounds/graphite.svg",
    swatch: "linear-gradient(135deg,#2c2c32 0%,#1a1a1e 55%,#0c0c0f 100%)",
  },
  {
    id: "mint",
    label: "Mint",
    src: "/backgrounds/mint.svg",
    swatch: "linear-gradient(135deg,#0f766e 0%,#34d399 55%,#d9f99d 100%)",
  },
];

/** Framed capture reuses the same gradients. */
export const FRAME_PRESETS: BackgroundPreset[] = BACKGROUND_PRESETS;

/** Solid colours offered next to the gradients. */
export const COLOR_SWATCHES = [
  "#1a1a1e",
  "#232328",
  "#0f172a",
  "#134e4a",
  "#7c2d12",
  "#e85a4f",
  "#f0f0f2",
];

export function findPreset(id: string | undefined): BackgroundPreset | undefined {
  if (!id) return undefined;
  return BACKGROUND_PRESETS.find((p) => p.id === id);
}
