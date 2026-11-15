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

test("mutations keep retry IDs and send JSON; logout accepts 204", async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), ...(init ? { init } : {}) });
    return new Response(null, { status: 204 });
  };
  const api = createApiClient("http://localhost:3000", fetcher);
  await api.sendMessage("room/id", { id: "retry-id", text: "임시 문구1" });
  assert.equal(
    requests[0]!.url,
    "http://localhost:3000/api/v1/rooms/room%2Fid/messages",
  );
  assert.equal(requests[0]!.init!.credentials, "include");
  assert.deepEqual(JSON.parse(String(requests[0]!.init!.body)), {
    id: "retry-id",
    text: "임시 문구1",
  });
  assert.equal(await api.logout(), undefined);
  assert.equal(
    api.realtimeUrl("room"),
    "ws://localhost:3000/api/v1/rooms/room/live",
  );
});
