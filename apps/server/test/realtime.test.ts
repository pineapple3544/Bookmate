import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { WebSocket } from "ws";
import { buildApp } from "../src/app.js";
import { createDatabase } from "../src/db.js";

async function until(description: string, check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check() && Date.now() < deadline) await delay(10);
  assert.ok(check(), description);
}

test(
  "ten authenticated sockets converge while chat and signaling run, and isolate revoked peers",
  {
    skip: process.env.CORE_DB_TEST !== "1",
    timeout: 30000,
  },
  async () => {
    const db = createDatabase(process.env.DATABASE_URL!);
    const queries: string[] = [];
    const traced = db.$extends({
      query: {
        $allModels: {
          $allOperations({ model, operation, args, query }) {
            queries.push(model + "." + operation);
            return query(args);
          },
        },
      },
    });
    const origin = "http://localhost:5173";
    const app = await buildApp({
      db: traced as unknown as PrismaClient,
      origins: [origin],
      checkDatabase: async () => {},
    });
    const roomId = randomUUID();
    const actors = Array.from({ length: 10 }, () => {
      const id = randomUUID();
      const token = randomBytes(32).toString("hex");
      return {
        id,
        cookie: "bookmate_session=" + token,
        tokenHash: createHash("sha256").update(token).digest("hex"),
      };
    });
    const sockets: WebSocket[] = [];
    try {
      await db.user.createMany({
        data: actors.map(({ id }) => ({
          id,
          email: id + "@example.com",
          nickname: id,
          passwordHash: "test-fixture",
        })),
      });
      await db.session.createMany({
        data: actors.map(({ id, tokenHash }) => ({
          tokenHash,
          userId: id,
          expiresAt: new Date(Date.now() + 60000),
        })),
      });
      await db.room.create({
        data: {
          id: roomId,
          title: "Movement integration",
          bookTitle: "Test",
          maxMembers: 10,
          members: {
            create: actors.map(({ id }, i) => ({
              userId: id,
              readingOrder: i + 1,
              role: i === 0 ? "ADMIN" : "MEMBER",
              readingStatus: i < 2 ? "READING" : "WAITING",
            })),
          },
        },
      });
      const base = await app.listen({ host: "127.0.0.1", port: 0 });
      const roomPath = "/api/v1/rooms/" + roomId;
      const clients = await Promise.all(
        actors.map(async ({ cookie }) => {
          const socket = new WebSocket(
            base.replace(/^http/, "ws") + roomPath + "/live",
            { origin, headers: { cookie } },
          );
          sockets.push(socket);
          const client = {
            socket,
            presence: null as any,
            moves: new Map<string, any>(),
            signals: [] as any[],
            errors: [] as string[],
            moveCount: 0,
            closed: 0,
            send: (data: object) => socket.send(JSON.stringify(data)),
          };
          socket.on("message", (data) => {
            const frame = JSON.parse(data.toString());
            if (frame.type === "presence") client.presence = frame;
            if (frame.type === "move") {
              client.moves.set(frame.userId, frame);
              client.moveCount++;
            }
            if (frame.type === "signal") client.signals.push(frame);
            if (frame.type === "error") client.errors.push(frame.code);
          });
          socket.on("close", (code) => {
            client.closed = code;
          });
          await once(socket, "open");
          return client;
        }),
      );
      await until("ten admitted peers", () =>
        clients.every((c) => c.presence?.peers.length === 10),
      );
      const position = (i: number, step: number) => ({
        x: 50 + i * 25 + step,
        y: 180 + step,
        seat: step === 15 ? i : null,
      });
      function burst(lastStep: number) {
        for (let step = 0; step <= lastStep; step++)
          clients.forEach((c, i) =>
            c.send({ type: "move", ...position(i, step) }),
          );
      }
      function converged(step: number) {
        return clients.every((c) =>
          actors.every(({ id }, i) => {
            const frame = c.moves.get(id);
            const expected = position(i, step);
            return (
              frame?.x === expected.x &&
              frame.y === expected.y &&
              frame.seat === expected.seat
            );
          }),
        );
      }
      queries.length = 0;
      burst(9);
      await until("all clients see all ten final positions", () =>
        converged(9),
      );
      // Only the periodic bulk heartbeat can overlap an otherwise move-only interval.
      assert.ok(
        queries.length <= 2 &&
          queries.every(
            (q) => q === "Session.findMany" || q === "RoomMember.findMany",
          ),
        queries.join(", "),
      );
      assert.ok(
        clients.every((c) => c.moveCount < 100),
        "intermediate movement is coalesced",
      );

      const message = { id: randomUUID(), text: "chat during movement" };
      const chatWrite = app
        .inject({
          method: "POST",
          url: roomPath + "/messages",
          headers: { origin, cookie: actors[2].cookie },
          payload: message,
        })
        .then((r) => r);
      const signal = {
        type: "signal",
        kind: "offer",
        targetPeerId: clients[1].presence.selfPeerId,
        hostEpoch: clients[0].presence.hostEpoch,
        payload: { sdp: "during-movement" },
      };
      clients[0].send(signal);
      for (let step = 10; step <= 15; step++) {
        clients.forEach((c, i) =>
          c.send({ type: "move", ...position(i, step) }),
        );
        await delay(100);
      }
      await until(
        "final seated positions and a peer-targeted offer arrive",
        () =>
          converged(15) &&
          clients[1].signals.some(
            (f) =>
              f.fromPeerId === clients[0].presence.selfPeerId &&
              f.payload.sdp === signal.payload.sdp,
          ),
      );
      assert.equal((await chatWrite).statusCode, 201);
      const chat = await app.inject({
        url: roomPath + "/messages",
        headers: { cookie: actors[9].cookie },
      });
      assert.equal(chat.json().messages[0].id, message.id);
      assert.ok(clients.every((c) => c.closed === 0 && c.errors.length === 0));

      clients[2].send({ type: "move", x: 112, y: 192, seat: 0 });
      await until("occupied seat rejected", () => clients[2].errors.includes("SEAT_OCCUPIED"));
      clients[2].send({ type: "move", x: 114, y: 192, seat: null });
      await until("seat released", () => clients.every(c => c.moves.get(actors[2].id)?.seat === null));
      clients[2].send({ type: "move", x: 116, y: 192, seq: 3, targets: [clients[3].presence.selfPeerId] });
      await until("targeted fallback received", () => clients[3].moves.get(actors[2].id)?.x === 116);
      assert.equal(clients[4].moves.get(actors[2].id)?.x, 114);

      // Both claims target a genuinely empty seat in the same event-loop turn.
      clients[3].send({ type: "move", x: 200, y: 190, seat: null });
      await until("chair three empty", () => clients[0].moves.get(actors[3].id)?.seat === null);
      const contenders = [2, 3];
      for (const i of contenders)
        clients[i].send({ type: "move", x: 268, y: 304, seat: 3, seq: 10 });
      await until("one winner visible to every observer", () =>
        clients.every(c => contenders.filter(i => c.moves.get(actors[i].id)?.seat === 3).length === 1) &&
        contenders.some(i => clients[i].moves.get(actors[i].id)?.seq === 10 &&
          clients[i].moves.get(actors[i].id)?.seat === null));
      const winner = contenders.find(i => clients[0].moves.get(actors[i].id)?.seat === 3)!;
      for (const c of clients) assert.equal(c.moves.get(actors[winner].id)?.seat, 3);
      clients[2].send(signal);
      await until("waiting reader cannot signal a record peer", () =>
        clients[2].errors.includes("RECORDS_LOCKED"),
      );
      const logout = await app.inject({
        method: "POST",
        url: "/api/v1/auth/logout",
        headers: { origin, cookie: actors[9].cookie },
      });
      assert.equal(logout.statusCode, 204);
      const leave = await app.inject({
        method: "DELETE",
        url: roomPath + "/membership",
        headers: { origin, cookie: actors[8].cookie },
      });
      assert.equal(leave.statusCode, 204);
      await until(
        "only logged-out and departed sockets close",
        () =>
          clients[8].closed === 1008 &&
          clients[9].closed === 1008 &&
          clients[0].presence.peers.length === 8,
      );
      assert.equal(clients[0].presence.positions[actors[8].id], undefined);
      assert.equal(clients[0].presence.positions[actors[9].id], undefined);

      // Bulk refresh observes a shortened deadline, then the hot path enforces it
      // even if the next heartbeat is several seconds away.
      const expires = Date.now() + 1000;
      await db.session.update({
        where: { tokenHash: actors[7].tokenHash },
        data: { expiresAt: new Date(expires) },
      });
      clients[0].send({
        ...signal,
        hostEpoch: clients[0].presence.hostEpoch,
        payload: { sdp: "refresh-deadline" },
      });
      await until("fresh authorization applied", () =>
        clients[1].signals.some((f) => f.payload.sdp === "refresh-deadline"),
      );
      await delay(Math.max(0, expires - Date.now()) + 25);
      if (!clients[7].closed) clients[7].send({ type: "move", x: 615, y: 375 });
      await until("expired sender rejected", () => clients[7].closed === 1008);
      assert.ok(clients[0].moves.get(actors[7].id).x !== 615);
      // A single over-capacity peer cannot close unrelated room connections.
      for (let i = 0; i < 150; i++)
        clients[6].send({ type: "move", x: 100, y: 220 });
      await until(
        "only over-limit sender closed",
        () => clients[6].closed === 1008,
      );
      clients[0].send({ type: "move", x: 610, y: 370 });
      await until("remaining six peers still exchange movement", () =>
        clients
          .slice(0, 6)
          .every((c) => !c.closed && c.moves.get(actors[0].id)?.x === 610),
      );
      const deletion = await app.inject({
        method: "DELETE",
        url: roomPath,
        headers: { origin, cookie: actors[0].cookie },
      });
      assert.equal(deletion.statusCode, 204);
      await until("deleted room disconnects remaining peers", () =>
        clients.slice(0, 6).every((c) => c.closed === 1008),
      );
    } finally {
      for (const socket of sockets) socket.terminate();
      await app.close();
      await db.room.deleteMany({ where: { id: roomId } });
      await db.user.deleteMany({
        where: { id: { in: actors.map((a) => a.id) } },
      });
      await db.$disconnect();
    }
  },
);
