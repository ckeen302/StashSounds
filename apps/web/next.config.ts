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
    ];
  },
};

export default config;
