import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

export function createDatabase(databaseUrl: string) {
  const adapter = new PrismaPg({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 3000,
    query_timeout: 3000,
    max: 5,
  });
  return new PrismaClient({ adapter });
}
