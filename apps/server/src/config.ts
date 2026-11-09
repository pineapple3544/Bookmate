export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const databaseUrl = env.DATABASE_URL;
  if (
    !databaseUrl ||
    !["postgres:", "postgresql:"].includes(new URL(databaseUrl).protocol)
  ) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection URL");
  }
  const port = Number(env.PORT ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  const origins = (env.WEB_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  for (const origin of origins) {
    const parsed = new URL(origin);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.origin !== origin
    ) {
      throw new Error("WEB_ORIGINS must contain exact HTTP(S) origins");
    }
  }
  return {
    databaseUrl,
    port,
    host: env.HOST ?? "127.0.0.1",
    origins,
    logLevel: env.LOG_LEVEL ?? "info",
  };
}
