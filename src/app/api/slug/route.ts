import { NextResponse } from "next/server";
import { isOwner } from "@/lib/auth";
import { isSlugTaken } from "@/lib/db";
import { normalizeSlug, SLUG_RE } from "@/lib/slug";

export async function GET(request: Request) {
  if (!(await isOwner())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const raw = new URL(request.url).searchParams.get("slug") ?? "";
  const slug = normalizeSlug(raw);
  if (!SLUG_RE.test(slug)) return NextResponse.json({ slug, valid: false, available: false });
  return NextResponse.json({ slug, valid: true, available: !(await isSlugTaken(slug)) });
}
