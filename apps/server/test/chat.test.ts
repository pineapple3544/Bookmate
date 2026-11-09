import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createPresenceStore } from "../src/presence.js";
import { createChatStore } from "../src/chat.js";
import { createDatabase } from "../src/db.js";

test("presence expires, switches slots, and keeps a user online while another tab remains", () => {
  let time = 0;
  const presence = createPresenceStore(() => time);
  presence.update("a", 0, true);
  presence.update("b", 0, true);
  presence.update("a", 1, true);
  assert.deepEqual(presence.onlineSlots(), [0, 1]);
  presence.update("a", 1, false);
  assert.deepEqual(presence.onlineSlots(), [0]);
  time = 24999;
  assert.deepEqual(presence.onlineSlots(), [0]);
  time = 25000;
  assert.deepEqual(presence.onlineSlots(), []);
});

test(
  "PostgreSQL retains chat, deduplicates retries, paginates and cascades room deletion",
  {
    skip: process.env.CHAT_DB_TEST !== "1",
  },
  async () => {
    const db = createDatabase(process.env.DATABASE_URL!);
    const roomId = randomUUID();
    try {
      await db.room.create({
        data: { id: roomId, title: "chat-test", bookTitle: "chat-test" },
      });
      const store = createChatStore(db, roomId);
      const input = { id: randomUUID(), senderSlot: 0, text: "임시 문구1" };
      const [first, retry] = await Promise.all([
        store.send(input),
        store.send(input),
      ]);
      assert.equal(first.id, retry.id);
      assert.equal(
        await db.prototypeChatMessage.count({ where: { roomId } }),
        1,
      );
      await assert.rejects(store.send({ ...input, text: "different" }));
      await Promise.all(
        Array.from({ length: 54 }, (_, index) =>
          store.send({
            id: randomUUID(),
            senderSlot: index % 4,
            text: "임시 문구" + index,
          }),
        ),
      );
      const page = await store.list({});
      assert.equal(page.messages.length, 50);
      assert.equal(page.hasMore, true);
      const older = await store.list({ before: page.messages[0]!.sequence });
      assert.equal(older.messages.length, 5);
      assert.equal(older.hasMore, false);
      const all = await store.list({ after: "0" });
      const tail = await store.list({ after: all.messages.at(-1)!.sequence });
      assert.equal(all.messages.length + tail.messages.length, 55);
      const newClient = createDatabase(process.env.DATABASE_URL!);
      try {
        assert.equal(
          (await createChatStore(newClient, roomId).list({})).messages.length,
          50,
        );
      } finally {
        await newClient.$disconnect();
      }
      await db.room.delete({ where: { id: roomId } });
      assert.equal(
        await db.prototypeChatMessage.count({ where: { roomId } }),
        0,
      );
      await assert.rejects(store.send({ ...input, id: randomUUID() }));
    } finally {
      await db.room.deleteMany({ where: { id: roomId } });
      await db.$disconnect();
    }
  },
);
