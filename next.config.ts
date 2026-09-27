import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Screenshot import posts the image to a server action. The browser
      // shrinks it well under this first; the default 1MB is what a raw phone
      // screenshot can blow through. Kept below Vercel's 4.5MB request cap.
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
