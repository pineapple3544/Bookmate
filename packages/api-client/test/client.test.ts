import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiClientError, createApiClient } from "../src/index.js";

test("client sends credentials to the configured API", async () => {
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(input, "http://localhost:3000/health");
    assert.equal(init?.credentials, "include");
    return Response.json({ status: "ok" });
  };
  assert.deepEqual(
    await createApiClient("http://localhost:3000/", fetcher).health(),
    { status: "ok" },
  );
});

test("plain-text reverse proxy errors preserve the HTTP status", async () => {
  const fetcher: typeof fetch = async () =>
    new Response("Bad Gateway", { status: 502 });
  await assert.rejects(
    createApiClient("http://localhost:3000", fetcher).ready(),
    (error) =>
      error instanceof ApiClientError &&
      error.status === 502 &&
      error.body === "Bad Gateway",
  );
});
