import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import Fastify from "fastify";
import { createDatabase } from "../src/db.js";
import { registerRecordSync } from "../src/record-sync.js";

for (const limit of ["count", "bytes"]) {
  test(
    `authorized deletes at the exact room ${limit} limit`,
    {
      skip: process.env.CORE_DB_TEST !== "1",
    },
    async () => {
      const db = createDatabase(process.env.DATABASE_URL!);
      const app = Fastify();
      const owner = randomUUID(),
        reader = randomUUID(),
        roomId = randomUUID();
      registerRecordSync(app, db, async (req) => String(req.headers.actor));
      const url = `/api/v1/rooms/${roomId}/record-ops`;
      const postId = randomUUID(),
        replyId = randomUUID();
      function operation(kind: string, target = {}) {
        return {
          id: randomUUID(),
          kind,
          slot: 0,
          page: 1,
          bytes: 1,
          digest: "a".repeat(64),
          ...target,
        };
      }
      const send = (actor: string, payload: ReturnType<typeof operation>) =>
        app.inject({ method: "POST", url, headers: { actor }, payload });
      try {
        await db.user.createMany({
          data: [owner, reader].map((id) => ({
            id,
            email: id + "@example.com",
            passwordHash: "-",
            nickname: "test",
          })),
        });
        await db.room.create({
          data: {
            id: roomId,
            title: "Quota test",
            bookTitle: "Quota test",
            exchangeCode: randomUUID(),
            startedAt: new Date(),
            members: {
              create: [owner, reader].map((userId, i) => ({
                userId,
                readingOrder: i + 1,
                readingStatus: "READING",
              })),
            },
          },
        });
        assert.equal(
          (await send(owner, operation("publish", { postId }))).statusCode,
          201,
        );
        assert.equal(
          (await send(reader, operation("reply", { postId, replyId })))
            .statusCode,
          201,
        );
        assert.equal((await send(owner, operation("note"))).statusCode, 201);
        assert.equal(
          (await send(owner, operation("note", { page: 2 }))).statusCode,
          201,
        );

        // Fill to one request below the real boundary, leaving the final write
        // to exercise the route's inclusive byte/count check.
        const maxBytes = 256 * 1024 * 1024;
        const maxBody = 22 * 1024 * 1024;
        let remaining = (limit === "count" ? 2048 : maxBytes) - 5;
        const filler = [];
        while (remaining > 0) {
          const bytes = limit === "count" ? 1 : Math.min(remaining, maxBody);
          filler.push({
            ...operation("note", { page: 3 }),
            bytes,
            roomId,
            authorId: owner,
            actorSlot: 0,
          });
          remaining -= bytes;
        }
        await db.recordOperation.createMany({ data: filler });
        const lastWrite = await send(owner, operation("note", { page: 3 }));
        assert.equal(lastWrite.statusCode, 201, lastWrite.body);
        const cursor = lastWrite.json().operation.sequence;
        const full = await db.recordOperation.aggregate({
          where: { roomId },
          _count: true,
          _sum: { bytes: true },
        });
        assert.equal(
          limit === "count" ? full._count : full._sum.bytes,
          limit === "count" ? 2048 : maxBytes,
        );
        assert.equal(
          (await send(owner, operation("note"))).json().code,
          "ROOM_RECORD_LIMIT",
        );

        for (const [kind, actor, target] of [
          ["delete", reader, { postId }],
          ["delete-reply", owner, { postId, replyId }],
          ["delete-note", reader, { page: 2 }],
        ] as const) {
          assert.equal(
            (await send(actor, operation(kind, target))).statusCode,
            403,
          );
        }
        assert.equal(
          (await send(owner, operation("delete-note", { page: 4 }))).json()
            .code,
          "NOTE_MISSING",
        );

        const emptyDigest = createHash("sha256").update("").digest("hex");
        for (const [kind, actor, target] of [
          ["delete-reply", reader, { postId, replyId }],
          ["delete-note", owner, { page: 2 }],
          ["delete", owner, { postId }],
        ] as const) {
          // Older clients can include media even in a delete-note body.
          const payload = operation(kind, { ...target, bytes: maxBody });
          const saved = await send(actor, payload);
          assert.equal(saved.statusCode, 201, saved.body);
          const tombstone = saved.json().operation;
          assert.equal(tombstone.bytes, 0);
          assert.equal(tombstone.digest, emptyDigest);
          const retried = await send(actor, payload);
          assert.equal(retried.statusCode, 200);
          assert.equal(retried.json().operation.sequence, tombstone.sequence);
          assert.equal(
            (await send(actor, { ...payload, page: 4 })).json().code,
            "OPERATION_CONFLICT",
          );
          assert.equal(
            (await send(actor, { ...payload, id: randomUUID() })).statusCode,
            409,
          );
        }
        // Deleting the post also erased its attached note.
        assert.equal(
          (await send(owner, operation("delete-note"))).json().code,
          "NOTE_MISSING",
        );
        assert.equal(
          (
            await send(owner, operation("publish", { postId: randomUUID() }))
          ).json().code,
          "ROOM_RECORD_LIMIT",
        );
        const manifest = await app.inject({
          method: "GET",
          url: url + "?after=" + cursor,
          headers: { actor: reader },
        });
        assert.deepEqual(
          manifest.json().operations.map((op: { kind: string }) => op.kind),
          ["delete-reply", "delete-note", "delete"],
        );
        const after = await db.recordOperation.aggregate({
          where: { roomId },
          _count: true,
          _sum: { bytes: true },
        });
        assert.equal(after._count, full._count + 3);
        assert.equal(after._sum.bytes, full._sum.bytes);
      } finally {
        await app.close();
        await db.room.deleteMany({ where: { id: roomId } });
        await db.user.deleteMany({ where: { id: { in: [owner, reader] } } });
        await db.$disconnect();
      }
    },
  );
}
