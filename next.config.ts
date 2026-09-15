import type { NextConfig } from "next";

const config: NextConfig = {
  // There is a package-lock.json in the parent GitHub folder; without this
  // Turbopack infers that as the workspace root and warns on every boot.
  turbopack: { root: __dirname },
  // gRPC / native deps must not be bundled.
  serverExternalPackages: ["pg", "googleapis", "google-auth-library"],
  typedRoutes: true,
};

export default config;
