import { describe, expect, it } from "vitest";
import { UiohookKey } from "uiohook-napi";
import {
  buildKeyNames,
  keyNameFor,
  modsOf,
  normalizeButton,
  shouldExplainInputPermission,
  type KeyTable,
} from "./input-track";

/**
 * The real `UiohookKey` is used here rather than a fixture: the whole point of
 * building the reverse table at runtime is that a `uiohook-napi` upgrade cannot
 * silently mislabel a key, and these tests are what would catch it.
 *
 * Importing it does load the native addon under vitest. That is deliberate —
 * it doubles as the "does the prebuild exist for this platform" check, and it
 * is exactly the module `main/input.ts` will require at runtime.
 */
const TABLE = UiohookKey as unknown as KeyTable;

describe("buildKeyNames", () => {
  const { names, modifiers } = buildKeyNames(TABLE);

  it("has no duplicate keycodes in UiohookKey", () => {
    // `buildKeyNames` is first-name-wins, which is only unambiguous while this
    // holds. If a future version collides two keys, this fails loudly rather
    // than quietly labelling one of them wrong.
    const codes = Object.values(TABLE).filter((c) => Number.isFinite(c));
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("names the keys a tutorial badge actually shows", () => {
    expect(names.get(TABLE.K as number)).toBe("K");
    expect(names.get(TABLE.Enter as number)).toBe("Enter");
    expect(names.get(TABLE.ArrowLeft as number)).toBe("ArrowLeft");
    expect(names.get(TABLE.Escape as number)).toBe("Escape");
    expect(names.get(TABLE.F5 as number)).toBe("F5");
    expect(names.get(TABLE.Space as number)).toBe("Space");
    expect(names.get(TABLE["1"] as number)).toBe("1");
  });

  it("renders punctuation as its symbol, not its name", () => {
    expect(names.get(TABLE.Semicolon as number)).toBe(";");
    expect(names.get(TABLE.Slash as number)).toBe("/");
    expect(names.get(TABLE.BracketLeft as number)).toBe("[");
    expect(names.get(TABLE.Backslash as number)).toBe("\\");
    expect(names.get(TABLE.Minus as number)).toBe("-");
  });

  it("marks every modifier-only key as droppable", () => {
    for (const key of [
      "Ctrl",
      "CtrlRight",
      "Alt",
      "AltRight",
      "Shift",
      "ShiftRight",
      "Meta",
      "MetaRight",
      "CapsLock",
    ] as const) {
      expect(modifiers.has(TABLE[key] as number)).toBe(true);
    }
  });

  it("does not mark ordinary keys as modifiers", () => {
    expect(modifiers.has(TABLE.K as number)).toBe(false);
    expect(modifiers.has(TABLE.Tab as number)).toBe(false);
    expect(modifiers.has(TABLE.Escape as number)).toBe(false);
  });

  it("ignores non-numeric table entries", () => {
    const { names: n } = buildKeyNames({ Good: 5, Bad: Number.NaN });
    expect(n.get(5)).toBe("Good");
    expect(n.size).toBe(1);
  });

  it("keeps the first name for a duplicated keycode", () => {
    const { names: n } = buildKeyNames({ Enter: 28, LegacyReturn: 28 });
    expect(n.get(28)).toBe("Enter");
  });
});

describe("keyNameFor", () => {
  const { names } = buildKeyNames(TABLE);

  it("falls back to the raw keycode for a key it does not know", () => {
    // A media key on an external keyboard, say. Still worth a badge.
    expect(keyNameFor(names, 60123)).toBe("Key60123");
  });
});

describe("modsOf", () => {
  const none = { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };

  it("is empty with no modifiers held", () => {
    expect(modsOf(none)).toEqual([]);
  });

  it("orders modifiers ⌃ ⌥ ⇧ ⌘ so an identical chord always reads the same", () => {
    expect(modsOf({ metaKey: true, ctrlKey: true, altKey: true, shiftKey: true })).toEqual([
      "ctrl",
      "alt",
      "shift",
      "meta",
    ]);
    // Order is by the badge, not by the order the flags happen to be read.
    expect(modsOf({ ...none, metaKey: true, shiftKey: true })).toEqual(["shift", "meta"]);
  });
});

describe("normalizeButton", () => {
  it("shifts libuiohook's 1-based buttons onto MouseEvent.button", () => {
    expect(normalizeButton(1)).toBe(0);
    expect(normalizeButton(2)).toBe(1);
    expect(normalizeButton(3)).toBe(2);
  });

  it("treats anything unparseable as a left click rather than dropping it", () => {
    // The ripple matters more than which button caused it.
    expect(normalizeButton(undefined)).toBe(0);
    expect(normalizeButton("nonsense")).toBe(0);
    expect(normalizeButton(0)).toBe(0);
    expect(normalizeButton(-4)).toBe(0);
  });

  it("parses a numeric string, which is what `unknown` allows through", () => {
    expect(normalizeButton("2")).toBe(1);
  });
});

describe("shouldExplainInputPermission", () => {
  it("explains a hook that failed to start", () => {
    expect(
      shouldExplainInputPermission({ started: false, alreadyExplained: false }),
    ).toBe(true);
  });

  it("stays silent when the hook started", () => {
    // The regression this guards: an earlier version also consulted the
    // Accessibility TCC entry, which is NOT the entry the event tap needs. On a
    // Mac with Input Monitoring granted and Accessibility not, the hook works
    // and the dialog fired at the top of every single take.
    expect(
      shouldExplainInputPermission({ started: true, alreadyExplained: false }),
    ).toBe(false);
    expect(
      shouldExplainInputPermission({ started: true, alreadyExplained: true }),
    ).toBe(false);
  });

  it("shows at most one dialog per app run", () => {
    // Take after take on a Mac that granted nothing: explained once, then quiet.
    expect(
      shouldExplainInputPermission({ started: false, alreadyExplained: true }),
    ).toBe(false);
  });
});
