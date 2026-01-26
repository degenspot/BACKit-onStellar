import type { NextConfig } from "next";
import path from "path";

const nextConfig = {
  experimental: {
    turbopack: {
      root: path.resolve(process.cwd(), "../../"),
    },
  },
} as any;

export default nextConfig;
