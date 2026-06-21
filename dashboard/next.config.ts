import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export for GitHub Pages — no server, no API routes.
  output: "export",
  // GitHub Pages serves at /<repo>/, so we need this basePath.
  // The CNAME workflow will use a custom domain or the default
  // deq710sia.github.io/wankle-trials path.
  basePath: "/wankle-trials",
  // Disable image optimization (not supported in static export).
  images: { unoptimized: true },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
