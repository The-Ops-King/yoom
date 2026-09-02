import type { FrameConfig } from "@/lib/recording/types";

/** A box in the layer element's own CSS pixels, origin at its top-left. */
export type Box = { x: number; y: number; w: number; h: number };

/**
 * Where `drawFrame` puts the source content inside a layer element that
 * exactly covers the preview canvas.
 *
 * `drawFrame` is handed `W`/`H` equal to the canvas backing store, which
 * `useStagingPlayer` keeps at `outputSize(...)`. So its internal scale is 1
 * and its content box is `computeFrameLayout(...).dest`, in canvas pixels.
 * The layer element is a uniform scale of that canvas (same aspect box), so
 * the mapping to element pixels only needs the padding, not the source
 * dimensions:
 *
 * - framing off — the content fills the element (`drawFrame` letterboxes by at
 *   most the one pixel `outputSize` adds to an odd dimension).
 * - framing on — `canvasW = srcW + 2·pad` with `pad = padding · srcW`, so
 *   `pad / canvasW = padding / (1 + 2·padding)`; the pad is square in canvas
 *   pixels and therefore square in element pixels too.
 *
 * `w / h` of the result is the source aspect ratio — the `screenAspect`
 * `bubbleHeightFor` wants.
 */
export function contentRect(elW: number, elH: number, frame?: FrameConfig | null): Box {
  if (elW <= 0 || elH <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  if (!frame?.enabled) return { x: 0, y: 0, w: elW, h: elH };
  const padding = Math.max(0, Math.min(0.2, frame.padding));
  const pad = (padding / (1 + 2 * padding)) * elW;
  return { x: pad, y: pad, w: Math.max(1, elW - pad * 2), h: Math.max(1, elH - pad * 2) };
}
