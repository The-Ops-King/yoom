import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({ error: "Upload not configured" }, { status: 501 });
}
