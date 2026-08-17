// prisma/config.ts
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url:
      process.env.ENVIRONMENT === "PROD"
        ? process.env["DATABASE_URL"]
        : process.env["DATABASE_URL_DEV"],
  },
  migrations: {
    path: "prisma/migrations",
  },
});
