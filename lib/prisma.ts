import { PrismaClient } from "@/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const pool = new pg.Pool({
  connectionString:
    process.env.ENVIRONMENT === "PROD"
      ? process.env.DATABASE_URL
      : process.env.DATABASE_URL_DEV,
  max: 5,
  connectionTimeoutMillis: 15000,
});

const adapter = new PrismaPg(pool);

function createPrismaClient(): PrismaClient {
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
