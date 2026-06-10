import type { NextConfig } from "next";

const basePath = "/copilot-ubb-budget-simulator";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default nextConfig;
