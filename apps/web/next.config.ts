import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=()" },
];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@stash/contracts", "@stash/ui", "@stash/audio"],
  async headers() {
    return [
      // Every page but the embed refuses to be framed; /embed/[id] sets its own headers (ticket 305).
      { source: "/((?!embed/).*)", headers: [...securityHeaders, { key: "X-Frame-Options", value: "DENY" }] },
      // The stretch worklet carries its library version in its name (request 135-serve-stretch-worklet).
      { source: "/worklets/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
    ];
  },
};

export default config;
