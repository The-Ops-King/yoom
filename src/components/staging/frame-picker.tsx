"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { COLOR_SWATCHES, FRAME_PRESETS, resolvePresetId } from "@/lib/recording/presets";
import { DEFAULT_FRAME, loadSettings } from "@/lib/recording/settings";
import type { FrameConfig } from "@/lib/recording/types";
import {
  addWallpaper,
  getWallpaperBlob,
  listWallpapers,
  removeWallpaper,
  type WallpaperMeta,
} from "@/lib/wallpapers";
import { Slider } from "./slider";
import * as ui from "./ui";

interface FramePickerProps {
  frame: FrameConfig;
  onChange: (patch: Partial<FrameConfig>) => void;
}

/** A saved wallpaper plus the object URL its thumbnail is drawn from. */
type Thumb = WallpaperMeta & { url: string };

/**
 * Loads the saved wallpapers and mints one object URL per thumbnail, revoking
 * every one of them on unmount. These URLs belong to the tiles only — the URL
 * handed to `onChange` when a wallpaper is *selected* is a separate, freshly
 * minted one, because the staging screen owns that one's lifetime and undo can
 * bring an earlier `src` back long after this panel has closed.
 */
function useWallpapers(): {
  items: Thumb[];
  error: string;
  add: (file: File) => Promise<WallpaperMeta | null>;
  remove: (id: string) => Promise<void>;
} {
  const [items, setItems] = useState<Thumb[]>([]);
  const [error, setError] = useState("");
  // Every URL this hook has minted, so unmount can revoke them all — including
  // ones already dropped from `items` by a delete.
  const mintedRef = useRef<string[]>([]);

  const mint = useCallback(async (meta: WallpaperMeta): Promise<Thumb | null> => {
    const blob = await getWallpaperBlob(meta.id);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    mintedRef.current.push(url);
    return { ...meta, url };
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const metas = await listWallpapers();
      const thumbs = (await Promise.all(metas.map(mint))).filter((t): t is Thumb => !!t);
      if (alive) setItems(thumbs);
    })();
    return () => {
      alive = false;
    };
  }, [mint]);

  // Revoke on unmount only — a re-render must not pull the rug out from under
  // the <img> tags that are still showing these.
  useEffect(() => {
    const minted = mintedRef;
    return () => {
      for (const url of minted.current) URL.revokeObjectURL(url);
      minted.current = [];
    };
  }, []);

  const add = useCallback(
    async (file: File): Promise<WallpaperMeta | null> => {
      setError("");
      try {
        const meta = await addWallpaper(file);
        const thumb = await mint(meta);
        if (thumb) setItems((prev) => [thumb, ...prev]);
        return meta;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save that image.");
        return null;
      }
    },
    [mint],
  );

  const remove = useCallback(async (id: string) => {
    await removeWallpaper(id);
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { items, error, add, remove };
}

export function FramePicker({ frame, onChange }: FramePickerProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const { items, error, add, remove } = useWallpapers();
  const selectedPreset = resolvePresetId(frame.background.presetId);
  const selectedWallpaper = frame.background.wallpaperId;

  /** Select a saved wallpaper: a fresh URL for the edits, plus the durable id. */
  const selectWallpaper = useCallback(async (id: string) => {
    const blob = await getWallpaperBlob(id);
    if (!blob) return;
    onChange({
      background: { kind: "image", src: URL.createObjectURL(blob), wallpaperId: id },
    });
  }, [onChange]);

  /**
   * Delete a saved wallpaper — and, when it is the one in use, put the frame
   * back on the default background. Otherwise `wallpaperId` is left pointing
   * at bytes that no longer exist: the tile is gone, nothing looks selected,
   * and the export quietly renders the frame with no background at all.
   */
  const deleteWallpaper = useCallback(
    async (id: string) => {
      await remove(id);
      if (frame.background.wallpaperId === id) onChange({ background: DEFAULT_FRAME.background });
    },
    [frame.background.wallpaperId, onChange, remove],
  );

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-3">
      <div className="flex items-center justify-between">
        <span className={ui.label}>
          Framed capture
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={frame.enabled}
          aria-label="Enable framed capture"
          onClick={() => onChange({ enabled: !frame.enabled })}
          className={`relative h-5 w-9 rounded-full transition-colors ${
            frame.enabled ? "bg-accent" : "border border-border bg-surface-raised"
          }`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
              frame.enabled ? "left-4" : "left-0.5"
            }`}
          />
        </button>
      </div>

      {frame.enabled && (
        <>
          <div className={ui.group}>
            <div className={ui.sectionHeader}>
              <span className={ui.sectionHeaderTitle}>Background</span>
              <button
                type="button"
                className={ui.sectionHeaderAction}
                onClick={() => onChange({ background: loadSettings().frame.background })}
              >
                Reset
              </button>
            </div>

            <div className={`${ui.swatchGrid} grid-cols-8`}>
              {FRAME_PRESETS.map((preset) => {
                const isOn = !selectedWallpaper && selectedPreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    title={preset.label}
                    aria-label={`Frame background ${preset.label}`}
                    onClick={() =>
                      onChange({
                        background: { kind: "image", src: preset.src, presetId: preset.id },
                      })
                    }
                    style={{ background: preset.swatch }}
                    className={`group relative overflow-hidden transition-colors ${
                      isOn ? ui.swatchOn : `${ui.swatch} hover:border-accent/50`
                    }`}
                  >
                    <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-black/45 px-0.5 py-0.5 text-[8px] leading-tight text-white opacity-0 transition-opacity group-hover:opacity-100">
                      {preset.label}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="space-y-1.5">
              <span className={ui.label}>Wallpapers</span>
              <div className="grid grid-cols-4 gap-1.5">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  title="Upload a wallpaper"
                  className="flex h-10 items-center justify-center rounded-md border border-dashed border-border bg-surface-raised text-[11px] font-medium text-muted transition-colors hover:border-accent/50 hover:text-foreground"
                >
                  Upload
                </button>
                {items.map((item) => (
                  <div key={item.id} className="group relative">
                    <button
                      type="button"
                      title={item.name}
                      aria-label={`Frame wallpaper ${item.name}`}
                      onClick={() => void selectWallpaper(item.id)}
                      className={`block h-10 w-full overflow-hidden rounded-md border transition-all ${
                        selectedWallpaper === item.id
                          ? "border-accent ring-2 ring-accent/40"
                          : "border-border hover:border-accent/50"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- a blob: URL cannot go through next/image */}
                      <img src={item.url} alt="" className="h-full w-full object-cover" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete wallpaper ${item.name}`}
                      onClick={() => void deleteWallpaper(item.id)}
                      className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full border border-border bg-surface text-[10px] leading-none text-muted transition-colors group-hover:flex hover:text-foreground"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              {error && <p className="text-[11px] text-danger-text">{error}</p>}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  // Saved first, then selected: the id is what survives into the
                  // next take, and the object URL is minted fresh from the store
                  // so the tile and the edits never share one. The caller owns
                  // that URL — `FrameSection` registers it with the staging
                  // screen, which revokes them all on unmount, never on
                  // replacement (undo can put an earlier `src` back and the
                  // export still has to load it).
                  void add(file).then((meta) => {
                    if (meta) return selectWallpaper(meta.id);
                  });
                }}
              />
            </div>

            <div className={`${ui.swatchGrid} grid-cols-5`}>
              {COLOR_SWATCHES.slice(0, 5).map((color) => {
                const isOn = frame.background.kind === "color" && frame.background.color === color;
                return (
                  <button
                    key={color}
                    type="button"
                    aria-label={`Frame colour ${color}`}
                    onClick={() => onChange({ background: { kind: "color", color } })}
                    style={{ background: color }}
                    className={`transition-colors ${isOn ? ui.swatchOn : `${ui.swatch} hover:border-accent/50`}`}
                  />
                );
              })}
            </div>
          </div>

          <div className={ui.group}>
            <div className={ui.sectionHeader}>
              <span className={ui.sectionHeaderTitle}>Appearance</span>
              <button
                type="button"
                className={ui.sectionHeaderAction}
                onClick={() => {
                  const saved = loadSettings().frame;
                  onChange({ padding: saved.padding, radius: saved.radius, shadow: saved.shadow });
                }}
              >
                Reset
              </button>
            </div>

            <Slider
              name="Padding"
              value={frame.padding}
              min={0}
              max={0.2}
              step={0.005}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => onChange({ padding: v })}
            />

            <Slider
              name="Radius"
              value={frame.radius}
              min={0}
              max={0.05}
              step={0.002}
              format={(v) => `${Math.round(v * 1000) / 10}%`}
              onChange={(v) => onChange({ radius: v })}
            />

            <Slider
              name="Shadow"
              value={frame.shadow}
              min={0}
              max={1}
              step={0.01}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => onChange({ shadow: v })}
            />
          </div>
        </>
      )}
    </div>
  );
}
