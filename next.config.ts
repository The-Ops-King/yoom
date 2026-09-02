import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const appOrigin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
const isProduction = process.env.VERCEL_ENV === "production";

const nextConfig: NextConfig = {
  // `desktop/` is a separate npm package with its own lockfile sitting inside
  // the repo, so Turbopack finds two lockfiles and warns that it has guessed a
  // root. Pin it to the Next app's directory — the desktop package is never
  // bundled by Next.
  turbopack: {
    root: dirname(fileURLToPath(import.meta.url)),
  },

  // The watch page is served through a rewrite on jtylerray.com, so static
  // chunks must be requested from the app origin, not the share origin.
  // `VERCEL_ENV` (not `NODE_ENV`) gates this: Vercel sets NODE_ENV=production
  // for preview builds too, and locally `next start` also runs with
  // NODE_ENV=production, which must not fetch chunks from the prod origin.
  assetPrefix: isProduction && appOrigin ? appOrigin : undefined,

  async headers() {
    return [
      {
        source: "/_next/static/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
