import { describe, expect, it } from "vitest";
import type { ClickMark, Rect, VideoEdits } from "@/lib/edits";
import type { KeySample } from "@/lib/recording/types";
import {
  CLICK_RIPPLE_S,
  KEY_FADE_S,
  MOTION_MAX_FRAC,
  MOTION_MIN_SPEED,
  activeClicks,
  createKeySampler,
  cursorHeightPx,
  cursorPath,
  keyBadgesAt,
  drawInputLayer,
  keyLabel,
  motionOffsets,
  motionTapAlpha,
} from "./render-input";
import type { RenderInputs } from "./render";

const click = (t: number, on = true): ClickMark => ({ t, x: 0.5, y: 0.5, on });
const key = (t: number, k: string, mods: KeySample["mods"] = []): KeySample => ({ t, key: k, mods });
const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

describe("activeClicks", () => {
  const clicks = [click(1), click(2, false), click(3)];

  it("is empty with no lane at all", () => {
    expect(activeClicks(undefined, 1)).toEqual([]);
    expect(activeClicks([], 1)).toEqual([]);
  });

  it("keeps a click for exactly the ripple's length", () => {
    expect(activeClicks(clicks, 1)).toEqual([click(1)]);
    expect(activeClicks(clicks, 1 + CLICK_RIPPLE_S)).toEqual([click(1)]);
    expect(activeClicks(clicks, 1 + CLICK_RIPPLE_S + 0.01)).toEqual([]);
  });

  it("ignores a click before it happens, and one switched off", () => {
    expect(activeClicks(clicks, 0.9)).toEqual([]);
    expect(activeClicks(clicks, 2.1)).toEqual([]);
    expect(activeClicks(clicks, 3.1)).toEqual([click(3)]);
  });

  it("returns every overlapping ripple", () => {
    expect(activeClicks([click(1), click(1.2), click(1.4)], 1.45)).toHaveLength(3);
  });

  it("keeps a click active past CLICK_RIPPLE_S when given a longer duration", () => {
    const longer = CLICK_RIPPLE_S * 2;
    // Past the DEFAULT window, but still inside the longer one passed in.
    expect(activeClicks(clicks, 1 + CLICK_RIPPLE_S + 0.01, longer)).toEqual([click(1)]);
    expect(activeClicks(clicks, 1 + longer, longer)).toEqual([click(1)]);
    expect(activeClicks(clicks, 1 + longer + 0.01, longer)).toEqual([]);
  });

  it("drops a click earlier than CLICK_RIPPLE_S when given a shorter duration", () => {
    const shorter = CLICK_RIPPLE_S / 2;
    expect(activeClicks(clicks, 1 + shorter, shorter)).toEqual([click(1)]);
    expect(activeClicks(clicks, 1 + shorter + 0.01, shorter)).toEqual([]);
    // The same instant is still active under the default (unshortened) window.
    expect(activeClicks(clicks, 1 + shorter + 0.01)).toEqual([click(1)]);
  });

  it("behaves exactly as before when no duration is passed", () => {
    for (const t of [0.9, 1, 1 + CLICK_RIPPLE_S, 1 + CLICK_RIPPLE_S + 0.01, 3.1]) {
      expect(activeClicks(clicks, t)).toEqual(activeClicks(clicks, t, CLICK_RIPPLE_S));
    }
  });
});

describe("keyLabel", () => {
  it("uppercases a letter and names the special keys", () => {
    expect(keyLabel("k")).toBe("K");
    expect(keyLabel("Enter")).toBe("⏎");
    expect(keyLabel(" ")).toBe("Space");
    expect(keyLabel("F5")).toBe("F5");
  });
});

describe("keyBadgesAt", () => {
  it("renders a chord from the sample's own mods", () => {
    expect(keyBadgesAt([key(1, "k", ["meta", "shift"])], 1)).toEqual([
      { label: "⌘ ⇧ K", alpha: 1, t: 1 },
    ]);
  });

  it("folds a bare modifier into the key pressed right after it", () => {
    const keys = [key(1, "Meta"), key(1.1, "Shift"), key(1.2, "k")];
    expect(keyBadgesAt(keys, 1.25).map((b) => b.label)).toEqual(["⌘ ⇧ K"]);
  });

  it("shows a modifier on its own while it is still held", () => {
    expect(keyBadgesAt([key(1, "Meta")], 1.05).map((b) => b.label)).toEqual(["⌘"]);
  });

  it("does not fold a key pressed too long after the modifier", () => {
    const keys = [key(1, "Meta"), key(1.5, "k")];
    expect(keyBadgesAt(keys, 1.5).map((b) => b.label)).toEqual(["⌘", "K"]);
  });

  it("folds a right-hand modifier like its left-hand twin", () => {
    for (const mod of ["MetaRight", "ShiftRight", "CtrlRight", "AltRight"]) {
      const badges = keyBadgesAt([key(1, mod), key(1.1, "k")], 1.15);
      expect(badges).toHaveLength(1);
      // The chord carries a modifier symbol, not a "MetaRight" badge of its own.
      expect(badges[0].label).toMatch(/^[⌘⇧⌃⌥] K$/);
    }
  });

  it("orders oldest first and drops a press once it has faded", () => {
    const keys = [key(1, "a"), key(1.5, "b")];
    expect(keyBadgesAt(keys, 1.6).map((b) => b.label)).toEqual(["A", "B"]);
    expect(keyBadgesAt(keys, 1 + KEY_FADE_S + 0.01).map((b) => b.label)).toEqual(["B"]);
  });

  it("fades a badge out over the tail of its life", () => {
    const keys = [key(1, "a")];
    expect(keyBadgesAt(keys, 1).at(0)?.alpha).toBe(1);
    expect(keyBadgesAt(keys, 1.6).at(0)?.alpha).toBe(1);
    const late = keyBadgesAt(keys, 1 + KEY_FADE_S - 0.2).at(0)?.alpha ?? -1;
    expect(late).toBeGreaterThan(0);
    expect(late).toBeLessThan(1);
  });

  it("ignores presses in the future and caps the row", () => {
    expect(keyBadgesAt([key(2, "a")], 1)).toEqual([]);
    const many = Array.from({ length: 12 }, (_, i) => key(1 + i * 0.05, String(i)));
    expect(keyBadgesAt(many, 1.6)).toHaveLength(6);
  });
});

describe("createKeySampler", () => {
  const keys = [key(0, "a"), key(1, "b"), key(1.2, "c"), key(5, "d")];

  it("is empty for an empty track", () => {
    expect(createKeySampler([])(1)).toEqual([]);
  });

  it("windows the track and agrees with the unsampled helper", () => {
    const at = createKeySampler(keys);
    expect(at(1.3).map((k) => k.key)).toEqual(["a", "b", "c"]);
    expect(at(5).map((k) => k.key)).toEqual(["d"]);
    for (const t of [0, 1, 1.3, 2.5, 5]) {
      expect(keyBadgesAt(at(t), t)).toEqual(keyBadgesAt(keys, t));
    }
  });

  it("sorts an out-of-order track", () => {
    const at = createKeySampler([key(1.2, "c"), key(1, "b")]);
    expect(at(1.3).map((k) => k.key)).toEqual(["b", "c"]);
  });
});

describe("cursorPath", () => {
  it("is a closed arrow with its tip at the origin, one unit tall", () => {
    const pts = cursorPath();
    expect(pts.length).toBeGreaterThanOrEqual(6);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
    // Taller than it is wide, like the real pointer.
    expect(Math.max(...pts.map((p) => p.y))).toBeGreaterThan(Math.max(...pts.map((p) => p.x)));
  });

  it("scales to 20 px at 1080p and follows `size`", () => {
    expect(cursorHeightPx(1080, 1)).toBe(20);
    expect(cursorHeightPx(1080, 2)).toBe(40);
    expect(cursorHeightPx(2160, 1)).toBe(40);
    expect(cursorHeightPx(1080, 0.5)).toBe(10);
  });

  it("grows with the zoom, like the captured cursor it covers", () => {
    // A view half as tall is a 2x zoom.
    expect(cursorHeightPx(1080, 1, 1 / 0.5)).toBe(40);
    expect(cursorHeightPx(1080, 1, 1)).toBe(20);
  });
});

describe("motionOffsets", () => {
  const still = rect(0.2, 0.2, 0.4, 0.4);

  it("is empty when the view has not moved", () => {
    expect(motionOffsets(still, still, 1920)).toEqual([]);
  });

  it("is empty below the speed threshold", () => {
    // Just under 0.5 frame-widths/s over one frame.
    const slow = (MOTION_MIN_SPEED / 60) * 0.9;
    expect(motionOffsets(rect(0.2 + slow, 0.2, 0.4, 0.4), still, 1920)).toEqual([]);
  });

  it("returns three taps along the motion vector past the threshold", () => {
    const fast = (MOTION_MIN_SPEED / 60) * 4;
    const offs = motionOffsets(rect(0.2 + fast, 0.2, 0.4, 0.4), still, 1920);
    expect(offs).toHaveLength(3);
    expect(offs[1]).toEqual({ dx: 0, dy: 0 });
    expect(offs[0].dx).toBeCloseTo(-offs[2].dx);
    expect(offs[0].dy).toBe(-0);
    expect(offs[2].dx).toBeGreaterThan(0);
  });

  it("caps the smear length", () => {
    const offs = motionOffsets(rect(0.9, 0.2, 0.4, 0.4), still, 1920);
    expect(offs).toHaveLength(3);
    expect(Math.hypot(offs[2].dx, offs[2].dy)).toBeCloseTo(1920 * MOTION_MAX_FRAC);
  });

  it("ignores a pure zoom that does not move the centre", () => {
    // Same centre (0.4, 0.4), half the size: a scale, not a pan.
    expect(motionOffsets(rect(0.3, 0.3, 0.2, 0.2), still, 1920)).toEqual([]);
  });

  it("smears vertically for a vertical pan", () => {
    const fast = (MOTION_MIN_SPEED / 60) * 4;
    const offs = motionOffsets(rect(0.2, 0.2 + fast, 0.4, 0.4), still, 1920);
    expect(offs[2].dx).toBe(0);
    expect(offs[2].dy).toBeGreaterThan(0);
  });

  it("is empty for a non-positive dt", () => {
    expect(motionOffsets(rect(0.9, 0.2, 0.4, 0.4), still, 1920, 0)).toEqual([]);
  });

  it("smears a slow pan less than a fast one", () => {
    const at = (fw: number) => {
      const offs = motionOffsets(rect(0.2 + fw, 0.2, 0.4, 0.4), still, 1920);
      return offs.length === 0 ? 0 : Math.hypot(offs[2].dx, offs[2].dy);
    };
    // Both past the threshold, both under the cap.
    const slow = at((MOTION_MIN_SPEED / 60) * 1.5);
    const fast = at((MOTION_MIN_SPEED / 60) * 3);
    expect(slow).toBeGreaterThan(0);
    expect(fast).toBeGreaterThan(slow);
    expect(fast).toBeLessThan(1920 * MOTION_MAX_FRAC);
  });

  it("scales the cap with the output width", () => {
    const far = rect(0.9, 0.2, 0.4, 0.4);
    expect(Math.hypot(...Object.values(motionOffsets(far, still, 960)[2]))).toBeCloseTo(960 * MOTION_MAX_FRAC);
  });
});

describe("motionTapAlpha", () => {
  it("weights the taps 1, 1/2, 1/3", () => {
    expect([0, 1, 2].map(motionTapAlpha)).toEqual([1, 0.5, 1 / 3]);
  });

  it("composites to a fully opaque stack, each tap an equal third", () => {
    // Painting `n` taps progressively at 1/(i+1): after tap i the newest
    // contributes 1/(i+1) and everything before it keeps i/(i+1) of its
    // weight — so all three end at exactly 1/3, and nothing bleeds through.
    const weights = [0, 0, 0];
    let covered = 0;
    for (let i = 0; i < 3; i++) {
      const a = motionTapAlpha(i);
      for (let j = 0; j < i; j++) weights[j] *= 1 - a;
      weights[i] = a;
      covered = covered * (1 - a) + a;
    }
    expect(covered).toBeCloseTo(1);
    for (const w of weights) expect(w).toBeCloseTo(1 / 3);
  });
});

/** Records the text drawn, which is all the placeholder assertions need. */
function textCtx() {
  const texts: string[] = [];
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === "texts") return texts;
      if (prop === "measureText") return () => ({ width: 40 });
      if (prop === "fillText") return (s: string) => { texts.push(s); };
      return () => undefined;
    },
    set: () => true,
  };
  return new Proxy({}, handler) as unknown as CanvasRenderingContext2D & { texts: string[] };
}

describe("drawInputLayer", () => {
  const box = { box: rect(0, 0, 1920, 1080), view: rect(0, 0, 1, 1), W: 1920 };
  const withKeysRange = (extra: Partial<RenderInputs> = {}): RenderInputs => ({
    screen: null,
    camera: null,
    mode: "screen",
    background: null,
    edits: {
      version: 1, cuts: [], crop: null, zooms: [], markers: [],
      overlays: [{ type: "keys", start: 0, end: 5, rect: rect(0.35, 0.86, 0.3, 0.08) }],
    } as VideoEdits,
    ...extra,
  });

  it("ghosts an empty keys range on the preview so it is visible", () => {
    const ctx = textCtx();
    drawInputLayer(ctx, withKeysRange({ preview: true }), 1, box);
    expect(ctx.texts).toEqual(["keys"]);
  });

  it("burns nothing in for the export", () => {
    const ctx = textCtx();
    drawInputLayer(ctx, withKeysRange(), 1, box);
    expect(ctx.texts).toEqual([]);
  });

  it("draws the real chord instead of the ghost once a key is pressed", () => {
    const keys = [key(0.9, "k", ["meta"])];
    const ctx = textCtx();
    drawInputLayer(ctx, withKeysRange({ preview: true, keysAt: () => keys }), 1, box);
    expect(ctx.texts).toEqual(["\u2318 K"]);
  });

  it("leaves a range alone outside its span", () => {
    const ctx = textCtx();
    drawInputLayer(ctx, withKeysRange({ preview: true }), 9, box);
    expect(ctx.texts).toEqual([]);
  });
});
