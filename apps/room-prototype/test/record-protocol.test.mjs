import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encodeBody,
  decodeBody,
  digestBody,
  materialize,
  validateBody,
} from "../public/record-protocol.js";
test("binary record payload survives encoding; forged metadata/body mismatch is rejected", async () => {
  const value = {
    key: [0, 3],
    post: {
      id: "post",
      slot: 0,
      page: 3,
      photo: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
      replies: [],
    },
  };
  const body = await encodeBody("publish", value);
  const decoded = decodeBody(body);
  assert.deepEqual(
    [...new Uint8Array(await decoded.value.post.photo.arrayBuffer())],
    [1, 2, 3],
  );
  const meta = {
    kind: "publish",
    slot: 0,
    actorSlot: 0,
    page: 3,
    postId: "post",
    digest: await digestBody(body),
    bytes: new TextEncoder().encode(body).length,
    sequence: "1",
    createdAt: "2026-11-16T00:00:00Z",
  };
  validateBody(meta, decoded);
  assert.throws(() => validateBody({ ...meta, actorSlot: 1 }, decoded));
  assert.notEqual(await digestBody(body + " "), meta.digest);
});
test("ordered operations merge concurrent replies, own edits, annotations and durable delete", () => {
  const meta = (kind, sequence, extra = {}) => ({
    kind,
    sequence: String(sequence),
    slot: 0,
    actorSlot: 0,
    page: 1,
    postId: "p",
    createdAt: "2026-11-16T00:00:00Z",
    ...extra,
  });
  const rows = [
    {
      meta: meta("publish", 1),
      data: {
        value: { post: { photo: new Blob(["x"], { type: "image/png" }) } },
      },
    },
    {
      meta: meta("reply", 2, { actorSlot: 1, replyId: "r1" }),
      data: { value: { reply: { text: "a" } } },
    },
    {
      meta: meta("reply", 3, { replyId: "r2" }),
      data: { value: { reply: { text: "b" } } },
    },
    {
      meta: meta("edit-reply", 4, { actorSlot: 1, replyId: "r1" }),
      data: { value: { text: "edited" } },
    },
    {
      meta: meta("annotate", 5),
      data: { value: { layer: "data:image/png;base64,eA==" } },
    },
  ];
  let records = materialize(rows);
  assert.equal(records[0].replies.length, 2);
  assert.equal(records[0].replies[0].text, "edited");
  assert.equal(records[0].annotations.length, 1);
  rows.push({ meta: meta("delete-reply", 6, { actorSlot: 1, replyId: "r1" }) });
  assert.equal(materialize(rows)[0].replies.length, 1);
  rows.push({ meta: meta("delete", 7) });
  assert.equal(materialize(rows).length, 0);
});
