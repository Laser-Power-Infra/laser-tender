import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg"],
  allowedDevOrigins: ["192.168.1.200", "192.168.1.229", "192.168.1.190" ,"172.24.112.1","192.168.1.196"],
  output: "standalone",
};

export default nextConfig;
