import type { NextConfig } from "next";

const appOrigin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
const isProduction = process.env.VERCEL_ENV === "production";

const nextConfig: NextConfig = {
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
