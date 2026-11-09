import "dotenv/config";
import { buildApp } from "./app.js";
import { readConfig } from "./config.js";
import { createDatabase } from "./db.js";

import { createChatStore } from "./chat.js";

const config = readConfig();
const db = createDatabase(config.databaseUrl);
const app = await buildApp({
  origins: config.origins,
  ...(process.env.PROTOTYPE_CHAT_ENABLED === "true"
    ? { chatStore: createChatStore(db) }
    : {}),
  logger: { level: config.logLevel },
  checkDatabase: async () => {
    await db.$queryRaw`SELECT 1`;
  },
});
app.addHook("onClose", async () => {
  await db.$disconnect();
});

async function shutdown() {
  try {
    await app.close();
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
  }
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
