import { describe, expect, it } from "vitest";
import { SLUG_RE, newSlug } from "@/lib/slug";

describe("newSlug", () => {
  it("returns 8 lowercase base36 characters", () => {
    for (let i = 0; i < 200; i++) {
      const slug = newSlug();
      expect(slug).toHaveLength(8);
      expect(slug).toMatch(/^[0-9a-z]{8}$/);
    }
  });

  it("passes SLUG_RE", () => {
    expect(SLUG_RE.test(newSlug())).toBe(true);
  });

  it("is not trivially repeating", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(newSlug());
    expect(seen.size).toBeGreaterThan(95);
  });
});

describe("SLUG_RE", () => {
  it.each(["abc", "my-demo", "a-b-c-1", "a".repeat(40)])("accepts %s", (slug) => {
    expect(SLUG_RE.test(slug)).toBe(true);
  });

  it.each(["ab", "AB", "my_demo", "a".repeat(41), "my demo", "", "my.demo"])(
    "rejects %s",
    (slug) => {
      expect(SLUG_RE.test(slug)).toBe(false);
    },
  );
});
