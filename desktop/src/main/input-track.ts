/**
 * The pure half of the global input track (spec addendum 2026-09-02, "Input
 * tracks (desktop only)"). Everything here is testable without an Electron
 * runtime and without loading the native hook; `input.ts` owns `uiohook-napi`,
 * the timers, the permission dialog and the IPC send.
 *
 * The wire types mirror `../shared/ipc.ts` and the web app's
 * `src/lib/recording/types.ts` — see the note there.
 */

/**
 * One global mouse click. `x`/`y` are normalized against the captured display
 * exactly like a `CursorSample`, so a click and the cursor path agree.
 *
 * MUST stay identical to `ClickSample` in `../shared/ipc.ts`.
 */
export interface ClickSample {
  /** Milliseconds of RECORDED material since the take started, paused time excluded. */
  t: number;
  x: number;
  y: number;
  /** 0 = left, 1 = right, 2 = middle; anything else is whatever the hook reported. */
  button: number;
}

/** MUST stay identical to `KeyMod` in `../shared/ipc.ts`. */
export type KeyMod = "meta" | "ctrl" | "alt" | "shift";

/** MUST stay identical to `KeySample` in `../shared/ipc.ts`. */
export interface KeySample {
  t: number;
  key: string;
  mods: KeyMod[];
}

/**
 * What actually travels on `IPC.input`: one mixed, time-ordered batch rather
 * than two arrays, so a click and the key pressed with it keep their relative
 * order without the renderer having to merge on `t`.
 *
 * MUST stay identical to `InputSample` in `../shared/ipc.ts`.
 */
export type InputSample =
  | ({ kind: "click" } & ClickSample)
  | ({ kind: "key" } & KeySample);

/**
 * Keys whose press is only ever a prefix. A bare ⌘ or ⇧ is not a keystroke the
 * viewer of a tutorial cares about — it is noise, and it would fire a badge for
 * every chord twice. The chord itself arrives on the NEXT keydown with the
 * modifier already reflected in `mods`.
 *
 * CapsLock is in here for the same reason: it toggles, it is not a keystroke.
 */
const MODIFIER_NAMES: ReadonlySet<string> = new Set([
  "Ctrl",
  "CtrlRight",
  "Alt",
  "AltRight",
  "Shift",
  "ShiftRight",
  "Meta",
  "MetaRight",
  "CapsLock",
]);

/**
 * `UiohookKey`'s names are already human ("Enter", "ArrowLeft", "F5", "K"),
 * which is exactly what the `keys` overlay wants on a keycap — except for
 * punctuation, where "Semicolon" on a badge reads far worse than ";".
 *
 * Deliberately NOT a full keyboard-layout translation: the hook reports a
 * physical keycode, and resolving it to the character a non-US layout would
 * actually produce needs `UCKeyTranslate` and the live input source. The badge
 * shows the key you pressed, not the character it emitted — good enough for a
 * tutorial, and it is why the shell never claims to know typed text.
 */
const PRINTABLE_OVERRIDES: Readonly<Record<string, string>> = {
  Semicolon: ";",
  Equal: "=",
  Comma: ",",
  Minus: "-",
  Period: ".",
  Slash: "/",
  Backquote: "`",
  BracketLeft: "[",
  Backslash: "\\",
  BracketRight: "]",
  Quote: "'",
};

/** The shape of `UiohookKey`: a flat name → keycode table. */
export type KeyTable = Readonly<Record<string, number>>;

export interface KeyNames {
  /** keycode → the name that goes on the wire. */
  names: ReadonlyMap<number, string>;
  /** Keycodes whose keydown is dropped outright. */
  modifiers: ReadonlySet<number>;
}

/**
 * Invert `UiohookKey` once at start-up.
 *
 * Built from the table rather than hard-coded so a `uiohook-napi` upgrade that
 * adds or renumbers a key cannot silently mislabel it. First name wins: the
 * table has no duplicate codes today (asserted in the tests), and if a future
 * version introduces one, the earlier — more common — name is the better badge.
 */
export function buildKeyNames(table: KeyTable): KeyNames {
  const names = new Map<number, string>();
  const modifiers = new Set<number>();
  for (const [name, code] of Object.entries(table)) {
    if (!Number.isFinite(code)) continue;
    if (MODIFIER_NAMES.has(name)) modifiers.add(code);
    if (!names.has(code)) names.set(code, PRINTABLE_OVERRIDES[name] ?? name);
  }
  return { names, modifiers };
}

/**
 * The name for a keycode, or `Key<code>` for one the table does not know.
 * An unknown code is still worth a badge — a media key on an external keyboard,
 * say — and the numeric fallback is at least honest about what it is.
 */
export function keyNameFor(names: ReadonlyMap<number, string>, keycode: number): string {
  return names.get(keycode) ?? `Key${keycode}`;
}

/** The keyboard-event flags `uiohook-napi` puts on every event. */
export interface ModifierFlags {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * Modifiers in the order a macOS keycap badge renders them (⌃ ⌥ ⇧ ⌘ is the
 * Apple HIG order, read left to right; `meta` last matches "⌃⌥⇧⌘K"). Fixed
 * order means two identical chords always produce an identical badge.
 */
export function modsOf(flags: ModifierFlags): KeyMod[] {
  const mods: KeyMod[] = [];
  if (flags.ctrlKey) mods.push("ctrl");
  if (flags.altKey) mods.push("alt");
  if (flags.shiftKey) mods.push("shift");
  if (flags.metaKey) mods.push("meta");
  return mods;
}

/**
 * `uiohook-napi` types `button` as `unknown` because libuiohook's value is
 * platform-defined. On every platform it is 1-based (1 = left, 2 = right,
 * 3 = middle); the wire format is 0-based to match `MouseEvent.button`, which
 * is what the staging editor already speaks.
 *
 * Anything unparseable becomes 0 (left) rather than being dropped: a click
 * happened, and the ripple matters more than which button caused it.
 */
export function normalizeButton(button: unknown): number {
  const n = typeof button === "number" ? button : Number(button);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n) - 1);
}
