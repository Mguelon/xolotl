import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  // `next dev` only serves its scripts to the origins listed here when you open the app by IP or hostname
  // instead of localhost (for example from another device on your LAN). Add yours, or set XOLOTL_DEV_ORIGINS.
  allowedDevOrigins: ["127.0.0.1", "localhost", ...(process.env.XOLOTL_DEV_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? [])],
};

export default nextConfig;
