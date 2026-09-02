import { allowedOrigins, appUrl } from "@/lib/env";

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (origin === appUrl()) return true;
  return allowedOrigins().includes(origin);
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Range",
    "Access-Control-Expose-Headers":
      "Content-Range, Content-Length, Accept-Ranges, ETag",
  };
  if (isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin as string;
  }
  return headers;
}

/** 204 preflight response for an OPTIONS request. */
export function preflight(request: Request): Response {
  const headers = corsHeaders(request.headers.get("origin"));
  headers["Access-Control-Max-Age"] = "86400";
  return new Response(null, { status: 204, headers });
}

/** Copy CORS headers onto an existing response, preserving status and body. */
export function withCors(request: Request, response: Response): Response {
  const cors = corsHeaders(request.headers.get("origin"));
  // `fetch()` responses carry immutable headers, so we can't mutate them
  // in place — build a new Headers instance and a new Response instead.
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(cors)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
