"use client";

import { useRef } from "react";
import {
  DEFAULT_CURSOR,
  MAX_CLICK_RIPPLE_MS,
  MAX_CURSOR_SIZE,
  MIN_CLICK_RIPPLE_MS,
  MIN_CURSOR_SIZE,
  type CursorStyle,
  type Rect,
  type VideoEdits,
} from "@/lib/edits";
import * as ops from "@/lib/editor/edit-ops";
import { isDesktop } from "@/lib/recording/desktop-bridge";
import { Slider } from "../slider";
import type { StagingContext } from "../types";
import * as ui from "../ui";

/** Where a new key-tracking range puts its badge: bottom centre, like CleanShot. */
const KEYS_RECT: Rect = { x: 0.35, y: 0.86, w: 0.3, h: 0.08 };
/** How long a key-tracking range covers when it is added from here. */
const KEYS_SPAN_S = 5;
/** Seconds a marker's one-click cut spans. */
const MARKER_CUT_S = 2;

/** `render-input.ts`'s fallback, so the swatch opens on the colour actually drawn. */
const DEFAULT_CLICK_COLOR = "#f5c542";
/** Preset swatches offered before the free-pick cell; the first matches `DEFAULT_CLICK_COLOR`. */
const CLICK_SWATCH_PALETTE = ["#f5c542", "#ef4444", "#f97316", "#22c55e", "#3b82f6", "#a855f7", "#111827"];
/** `render-input.ts`'s fallback (`CLICK_RIPPLE_S` in ms), so the slider opens on the duration actually drawn. */
const DEFAULT_CLICK_RIPPLE_MS = 500;
const rippleMsFmt = (v: number) => `${Math.round(v)} ms`;

const STYLES: { id: CursorStyle; label: string; hint: string }[] = [
  { id: "none", label: "None", hint: "Draw nothing over the capture" },
  { id: "real", label: "Real", hint: "Keep the cursor the capture recorded" },
  {
    id: "smooth",
    label: "Smooth",
    // Neither Electron nor Chrome honours a `cursor: "never"` constraint any
    // more, so the captured pointer is always in the pixels: the synthetic one
    // is drawn OVER it. Said plainly here so nobody files it as a bug.
    hint: "Draws a smoothed arrow over the captured cursor",
  },
];

export function CursorSection({ ctx }: { ctx: StagingContext }) {
  const { edits, player, duration } = ctx;
  const cursor = edits.cursor ?? DEFAULT_CURSOR;
  const clicks = edits.clicks ?? [];
  /** Pre-gesture edits for the size slider, so a drag is one undo step. */
  const sizeFrom = useRef<VideoEdits | null>(null);
  /** Same gesture batching, for the ripple-duration slider. */
  const rippleFrom = useRef<VideoEdits | null>(null);

  const hasCursorTrack = ctx.cursor.length > 0;
  const hasInput = ctx.clicks.length > 0 || ctx.keys.length > 0;

  const setSize = (size: number) => {
    sizeFrom.current ??= edits;
    ctx.applyLive((e) => ops.setCursor(e, { ...cursor, size }));
  };
  const commitSize = () => {
    const from = sizeFrom.current;
    sizeFrom.current = null;
    if (from) ctx.commit(from);
  };

  const setRipple = (clickRippleMs: number) => {
    rippleFrom.current ??= edits;
    ctx.applyLive((e) => ops.setCursor(e, { ...cursor, clickRippleMs }));
  };
  const commitRipple = () => {
    const from = rippleFrom.current;
    rippleFrom.current = null;
    if (!from) return;
    ctx.commit(from);
    // `cursor` has already re-rendered with the settled drag value by the
    // time the gesture ends — the same reasoning `setSize` skips for size,
    // except size is not a sticky default and click duration is.
    ctx.setStagingDefaults({ clickRippleMs: cursor.clickRippleMs ?? DEFAULT_CLICK_RIPPLE_MS });
  };

  /** A key-tracking range at the playhead, bottom-centre, selected on arrival. */
  const addKeysRange = () => {
    const start = player.timeRef.current;
    const end = Math.min(duration, start + KEYS_SPAN_S);
    if (end - start < 0.1) return;
    const next = ops.addOverlay(edits, { type: "keys", start, end, rect: KEYS_RECT });
    ctx.apply(() => next);
    // `addOverlay` refuses past `MAX_OVERLAYS`: only select what it added.
    if (next.overlays.length > edits.overlays.length) {
      ctx.setSelected({ kind: "overlay", index: next.overlays.length - 1 });
    }
  };

  return (
    <div className={ui.section}>
      <div className={ui.group}>
        <span className={ui.label}>Cursor</span>
        <div role="radiogroup" aria-label="Cursor style" className={ui.seg}>
          {STYLES.map((s) => {
            // `smooth` needs a path to draw along; without a track it would
            // silently draw nothing at all, so it is disabled rather than lying.
            const disabled = s.id === "smooth" && !hasCursorTrack;
            const on = cursor.style === s.id;
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={disabled}
                title={disabled ? "No mouse track for this take" : s.hint}
                className={on ? ui.segItemOn : ui.segItem}
                onClick={() => ctx.apply((e) => ops.setCursor(e, { ...cursor, style: s.id }))}
              >
                {s.label}
              </button>
            );
          })}
        </div>
        <p className={ui.hint}>
          {STYLES.find((s) => s.id === cursor.style)?.hint}
        </p>
      </div>

      <div className={ui.group}>
        <label htmlFor="cursor-size" className={ui.label}>
          Size {cursor.size.toFixed(1)}×
        </label>
        <input
          id="cursor-size"
          type="range"
          min={MIN_CURSOR_SIZE}
          max={MAX_CURSOR_SIZE}
          step={0.1}
          value={cursor.size}
          disabled={cursor.style !== "smooth"}
          className="w-full disabled:opacity-30"
          onChange={(e) => setSize(Number(e.target.value))}
          onPointerUp={commitSize}
          onBlur={commitSize}
          onKeyUp={commitSize}
        />
      </div>

      <label className={ui.check}>
        <input
          type="checkbox"
          checked={edits.motionBlur !== false}
          onChange={(e) => ctx.apply((ed) => ops.setMotionBlur(ed, e.target.checked))}
        />
        Motion blur while a zoom moves
      </label>

      <div className={ui.group}>
        <span className={ui.label}>
          Click ripples {clicks.length > 0 && `(${clicks.filter((c) => c.on).length}/${clicks.length})`}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className={ui.btn}
            disabled={clicks.length === 0}
            onClick={() => ctx.apply((e) => ops.setAllClicks(e, true))}
          >
            All on
          </button>
          <button
            type="button"
            className={ui.btn}
            disabled={clicks.length === 0}
            onClick={() => ctx.apply((e) => ops.setAllClicks(e, false))}
          >
            All off
          </button>
        </div>
        <p className={ui.hint}>
          {clicks.length > 0
            ? "Each click is a dot on the Clicks lane — click one to mute it, click it again to bring it back. Filled is on, hollow is off."
            : "This take captured no clicks."}
        </p>

        <div className={ui.group}>
          <span className="text-[11px] text-muted">Colour</span>
          <div className={`${ui.swatchGrid} grid-cols-8`}>
            {CLICK_SWATCH_PALETTE.map((hex) => {
              const on = (cursor.clickColor ?? DEFAULT_CLICK_COLOR) === hex;
              return (
                <button
                  key={hex}
                  type="button"
                  title={hex}
                  aria-label={`Colour ${hex}`}
                  aria-pressed={on}
                  className={on ? ui.swatchOn : ui.swatch}
                  style={{ background: hex }}
                  onClick={() => {
                    ctx.apply((e) => ops.setCursor(e, { ...cursor, clickColor: hex }));
                    ctx.setStagingDefaults({ clickColor: hex });
                  }}
                />
              );
            })}
            <input
              type="color"
              title="Custom colour"
              aria-label="Custom colour"
              value={cursor.clickColor ?? DEFAULT_CLICK_COLOR}
              className={`${ui.swatch} cursor-pointer border-0 p-0`}
              onChange={(e) => {
                ctx.apply((ed) => ops.setCursor(ed, { ...cursor, clickColor: e.target.value }));
                ctx.setStagingDefaults({ clickColor: e.target.value });
              }}
            />
          </div>
        </div>

        <div
          className="w-full"
          onPointerUp={commitRipple}
          onBlur={commitRipple}
          onKeyUp={commitRipple}
        >
          <Slider
            name="Duration"
            value={cursor.clickRippleMs ?? DEFAULT_CLICK_RIPPLE_MS}
            min={MIN_CLICK_RIPPLE_MS}
            max={MAX_CLICK_RIPPLE_MS}
            step={50}
            format={rippleMsFmt}
            onChange={setRipple}
          />
        </div>
      </div>

      <div className={ui.group}>
        <span className={ui.label}>Key tracking</span>
        <button
          type="button"
          className={ui.btn}
          disabled={ctx.keys.length === 0}
          title={ctx.keys.length === 0 ? "This take captured no key presses" : undefined}
          onClick={addKeysRange}
        >
          Add range at playhead
        </button>
        <p className={ui.hint}>
          {KEYS_SPAN_S}s of keycaps at the bottom of the frame. Drag its lane to move it, or its
          box on the preview to re-place the badge.
        </p>
      </div>

      {edits.markers.length > 0 && (
        <div className={ui.group}>
          <span className={ui.label}>Markers ({edits.markers.length})</span>
          <ul className={ui.group}>
            {edits.markers.map((m) => (
              <li key={m.t} className="flex items-center justify-between gap-1.5">
                <button
                  type="button"
                  onClick={() => player.seek(m.t)}
                  className="flex-1 text-left text-[11px] text-muted hover:text-foreground"
                >
                  {m.label ?? ui.fmt(m.t)}
                </button>
                <button
                  type="button"
                  className={ui.btn}
                  onClick={() =>
                    ctx.apply((e) =>
                      ops.addCut(e, { start: Math.max(0, m.t - MARKER_CUT_S), end: m.t }),
                    )
                  }
                >
                  Cut 2 s before
                </button>
                <button
                  type="button"
                  className={ui.btn}
                  onClick={() =>
                    ctx.apply((e) =>
                      ops.addCut(e, { start: m.t, end: Math.min(duration, m.t + MARKER_CUT_S) }),
                    )
                  }
                >
                  Cut 2 s after
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/*
        Silence from the input hook is normal and carries no error, so the one
        place it can be explained is here — and only when the take really did
        arrive without a single click or key press.
      */}
      {!hasInput && (
        <p className={ui.hint}>
          {isDesktop()
            ? "No clicks or keys were captured. macOS needs Input Monitoring for the desktop app — grant it in System Settings ▸ Privacy & Security ▸ Input Monitoring, then record again. Window captures never produce a click track."
            : "Clicks and key presses are captured by the desktop app only."}
        </p>
      )}
    </div>
  );
}
