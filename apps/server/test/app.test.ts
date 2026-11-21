import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "../src/app.js";
import { readConfig } from "../src/config.js";

test("liveness stays available when database readiness fails without leaking details", async (t) => {
  const app = await buildApp({
    checkDatabase: async () => {
      throw new Error("secret database credentials");
    },
  });
  t.after(() => app.close());
  assert.equal((await app.inject("/health")).statusCode, 200);
  const result = await app.inject("/health/ready");
  assert.equal(result.statusCode, 503);
  assert.equal(result.json().error.code, "DATABASE_UNAVAILABLE");
  assert.ok(result.json().error.requestId);
  assert.doesNotMatch(result.body, /secret/);
});

test("readiness, OpenAPI, and unknown routes have stable responses", async (t) => {
  const app = await buildApp({ checkDatabase: async () => {} });
  t.after(() => app.close());
  assert.deepEqual((await app.inject("/health/ready")).json(), {
    status: "ready",
  });
  assert.ok((await app.inject("/openapi.json")).json().paths["/health/ready"]);
  const missing = await app.inject("/api/v1/rooms");
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error.code, "NOT_FOUND");
});

test("CORS only grants browser access to configured origins", async (t) => {
  const app = await buildApp({
    checkDatabase: async () => {},
    origins: ["http://localhost:5173"],
  });
  t.after(() => app.close());
  const allowed = await app.inject({
    url: "/health",
    headers: { origin: "http://localhost:5173" },
  });
  assert.equal(
    allowed.headers["access-control-allow-origin"],
    "http://localhost:5173",
  );
  const denied = await app.inject({
    url: "/health",
    headers: { origin: "https://untrusted.example" },
  });
  assert.equal(denied.headers["access-control-allow-origin"], undefined);
});

test("invalid deployment configuration fails early", () => {
  assert.throws(() => readConfig({ DATABASE_URL: "https://example.com" }));
  assert.throws(() =>
    readConfig({ DATABASE_URL: "postgresql://localhost/db", PORT: "0" }),
  );
  assert.throws(() =>
    readConfig({ DATABASE_URL: "postgresql://localhost/db", WEB_ORIGINS: "*" }),
  );
});

test("production rejects HTTP origins and unauthenticated prototype routes", () => {
  const base = {
    DATABASE_URL: "postgresql://localhost/db",
    NODE_ENV: "production",
  };
  assert.throws(() =>
    readConfig({ ...base, WEB_ORIGINS: "http://localhost:5173" }),
  );
  assert.throws(() =>
    readConfig({
      ...base,
      WEB_ORIGINS: "https://book.example",
      PROTOTYPE_CHAT_ENABLED: "true",
    }),
  );
  assert.equal(
    readConfig({ ...base, WEB_ORIGINS: "https://book.example" }).secureCookies,
    true,
  );
});
