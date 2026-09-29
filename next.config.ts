import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The village's live connection (src/app/api/village/live): the WebSocket
  // server and the Redis subscriber are plain Node packages, loaded as-is
  // rather than bundled.
  serverExternalPackages: ["ws", "ioredis", "@vercel/functions"],
  experimental: {
    serverActions: {
      // Screenshot import posts the image to a server action. The browser
      // shrinks it well under this first; the default 1MB is what a raw phone
      // screenshot can blow through. Kept below Vercel's 4.5MB request cap.
      bodySizeLimit: "4mb",
    },
  },
  // The service worker must never be served from a cache, or a fix to it
  // could take a day to reach installed apps.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
};

export default nextConfig;
