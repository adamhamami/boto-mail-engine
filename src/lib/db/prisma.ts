import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { Pool } from "pg";
import { getEnv } from "@/lib/config/env";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  pool: Pool | undefined;
};

/** Délégations critiques — invalide le singleton HMR si le client est antérieur à un `prisma generate`. */
const REQUIRED_DELEGATES = [
  "salesTask",
  "contact",
  "campaign",
  "event",
  "sendAttempt",
] as const;

function hasDelegate(
  client: PrismaClient,
  name: (typeof REQUIRED_DELEGATES)[number],
): boolean {
  const delegate = (client as unknown as Record<string, { count?: unknown }>)[
    name
  ];
  return typeof delegate?.count === "function";
}

function isStalePrismaClient(client: PrismaClient): boolean {
  return REQUIRED_DELEGATES.some((name) => !hasDelegate(client, name));
}

function createPrismaClient(): PrismaClient {
  // Toujours via getEnv() : charge .env (worker tsx) + secrets Docker + défauts Zod
  const connectionString = getEnv().DATABASE_URL;
  process.env.DATABASE_URL = connectionString;

  const pool =
    globalForPrisma.pool ??
    new Pool({
      connectionString,
    });

  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.pool = pool;
  }

  const adapter = new PrismaPg(pool);

  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? ["error", "warn"]
        : ["error"],
  });
}

function getOrCreatePrismaClient(): PrismaClient {
  const existing = globalForPrisma.prisma;
  if (existing && !isStalePrismaClient(existing)) {
    return existing;
  }

  if (existing) {
    void existing.$disconnect().catch(() => undefined);
  }

  const client = createPrismaClient();
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = client;
  }
  return client;
}

export const prisma = getOrCreatePrismaClient();

export default prisma;
