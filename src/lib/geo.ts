import { createHmac } from "node:crypto";
import { optionalEnv } from "@/lib/env";

export type ViewerContext = {
  ipHash: string | null;
  userAgent: string | null;
  country: string | null;
  city: string | null;
};

function decode(value: string | null): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function readViewerContext(request: Request): ViewerContext {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded
    ? forwarded.split(",")[0]?.trim() || null
    : request.headers.get("x-real-ip");

  const secret = optionalEnv("SESSION_SECRET");
  const ipHash =
    ip && secret ? createHmac("sha256", secret).update(ip).digest("hex") : null;

  return {
    ipHash,
    userAgent: request.headers.get("user-agent"),
    country: decode(request.headers.get("x-vercel-ip-country")),
    city: decode(request.headers.get("x-vercel-ip-city")),
  };
}
