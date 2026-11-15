import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { WebSocket } from "ws";
import { buildApp } from "../src/app.js";
import { createDatabase } from "../src/db.js";

test(
  "server core: sessions, membership, concurrent capacity, reading transfers, durable chat and realtime fencing",
  { skip: process.env.CORE_DB_TEST !== "1", timeout: 60000 },
  async () => {
    const db = createDatabase(process.env.DATABASE_URL!);
    const origin = "http://localhost:5173";
    const app = await buildApp({
      db,
      origins: [origin],
      checkDatabase: async () => {},
    });
    const prefix = randomUUID();
    const users: string[] = [],
      rooms: string[] = [],
      sockets: WebSocket[] = [];
    type Actor = { id: string; cookie: string };
    async function call(
      method: any,
      path: string,
      actor?: Actor,
      body?: unknown,
      customOrigin = origin,
    ) {
      return app.inject({
        method,
        url: "/api/v1" + path,
        headers: {
          origin: customOrigin,
          ...(actor ? { cookie: actor.cookie } : {}),
        },
        ...(body !== undefined ? { payload: body as any } : {}),
      });
    }
    async function actor(n: number): Promise<Actor> {
      const credentials = {
        email: `${prefix}-${n}@example.com`,
        password: "test-password-123",
        nickname: `사용자 ${n}`,
      };
      const registered = await call(
        "POST",
        "/auth/register",
        undefined,
        credentials,
      );
      assert.equal(registered.statusCode, 201, registered.body);
      const id = registered.json().user.id;
      users.push(id);
      assert.equal(registered.json().user.passwordHash, undefined);
      const login = await call("POST", "/auth/login", undefined, credentials);
      assert.equal(login.statusCode, 200, login.body);
      assert.match(
        String(login.headers["set-cookie"]),
        /HttpOnly; SameSite=Strict/,
      );
      return { id, cookie: String(login.headers["set-cookie"]).split(";")[0]! };
    }
    async function room(a: Actor, maxMembers = 4, visibility = "PRIVATE") {
      const response = await call("POST", "/rooms", a, {
        title: "임시 문구1",
        bookTitle: "임시 문구2",
        maxMembers,
        visibility,
      });
      assert.equal(response.statusCode, 201, response.body);
      rooms.push(response.json().room.id);
      return response.json().room.id as string;
    }
    async function invite(id: string, a: Actor, maxUses = 1) {
      const response = await call("POST", `/rooms/${id}/invites`, a, {
        maxUses,
      });
      assert.equal(response.statusCode, 201, response.body);
      return response.json().invite;
    }
    async function connect(id: string, a: Actor) {
      const address = app.server.address();
      assert.ok(address && typeof address !== "string");
      const socket = new WebSocket(
        `ws://127.0.0.1:${address.port}/api/v1/rooms/${id}/live`,
        { headers: { origin, cookie: a.cookie } },
      );
      sockets.push(socket);
      const messages: any[] = [];
      socket.on("message", (data) => messages.push(JSON.parse(String(data))));
      await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
      const wait = async (predicate: (value: any) => boolean) => {
        const end = Date.now() + 5000;
        while (Date.now() < end) {
          const value = messages.find(predicate);
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        assert.fail("WebSocket message timed out: " + JSON.stringify(messages));
      };
      return { socket, messages, wait };
    }
    try {
      assert.equal((await call("GET", "/auth/me")).statusCode, 401);
      const a = await actor(1),
        b = await actor(2),
        c = await actor(3),
        d = await actor(4);
      const duplicate = await call("POST", "/auth/register", undefined, {
        email: `${prefix}-1@EXAMPLE.COM`,
        password: "test-password-123",
        nickname: "사용자 1",
      });
      assert.equal(duplicate.statusCode, 409);
      assert.equal(
        (
          await call(
            "POST",
            "/rooms",
            a,
            { title: "x", bookTitle: "y" },
            "https://evil.example",
          )
        ).statusCode,
        403,
      );
      assert.equal(
        (
          await call("POST", "/auth/login", undefined, {
            email: `${prefix}-1@example.com`,
            password: "incorrect-password",
          })
        ).statusCode,
        401,
      );
      const id = await room(a, 3);
      assert.equal((await call("GET", `/rooms/${id}`, b)).statusCode, 403);
      assert.equal(
        (await call("POST", `/rooms/${id}/join`, b, {})).statusCode,
        403,
      );
      const admission = await invite(id, a, 2);
      assert.equal(
        (
          await call("POST", `/rooms/${id}/join`, b, {
            inviteToken: admission.token,
          })
        ).statusCode,
        200,
      );
      assert.equal(
        (
          await call("POST", `/rooms/${id}/join`, b, {
            inviteToken: admission.token,
          })
        ).statusCode,
        200,
      );
      assert.equal(
        (await db.roomInvite.findUnique({ where: { id: admission.id } }))!.uses,
        1,
      );
      assert.equal(
        (
          await call("POST", `/rooms/${id}/join`, c, {
            inviteToken: admission.token,
          })
        ).statusCode,
        200,
      );
      assert.equal(
        (
          await call("POST", `/rooms/${id}/join`, d, {
            inviteToken: admission.token,
          })
        ).statusCode,
        403,
      );
      assert.equal((await call("DELETE", `/rooms/${id}`, b)).statusCode, 403);
      assert.equal(
        (await call("POST", `/rooms/${id}/reading/complete`, b)).statusCode,
        409,
      );
      assert.equal(
        (await call("POST", `/rooms/${id}/reading/complete`, a)).statusCode,
        200,
      );
      const version = (await call("GET", `/rooms/${id}`, a)).json().room
        .version;
      const transfer = { id: randomUUID(), toUserId: b.id, version };
      const [first, retry] = await Promise.all([
        call("POST", `/rooms/${id}/transfers`, a, transfer),
        call("POST", `/rooms/${id}/transfers`, a, transfer),
      ]);
      assert.equal(first.statusCode, 200, first.body);
      assert.equal(retry.statusCode, 200, retry.body);
      assert.equal(await db.bookTransfer.count({ where: { roomId: id } }), 1);
      assert.equal(
        (
          await call("POST", `/rooms/${id}/transfers`, a, {
            ...transfer,
            toUserId: c.id,
          })
        ).statusCode,
        409,
      );
      assert.equal(
        (await call("GET", `/rooms/${id}`, b)).json().room.bookHolderId,
        b.id,
      );
      assert.equal(
        (await call("DELETE", `/rooms/${id}/membership`, b)).statusCode,
        409,
      );
      assert.equal(
        (await call("DELETE", `/rooms/${id}/membership`, a)).statusCode,
        409,
      );
      const message = { id: randomUUID(), text: "임시 문구1" };
      const [m1, m2] = await Promise.all([
        call("POST", `/rooms/${id}/messages`, a, message),
        call("POST", `/rooms/${id}/messages`, a, message),
      ]);
      assert.equal(m1.statusCode, 201, m1.body);
      assert.equal(m1.json().message.id, m2.json().message.id);
      assert.equal(m1.json().message.senderId, a.id);
      assert.equal(
        (await call("POST", `/rooms/${id}/messages`, b, message)).statusCode,
        409,
      );
      assert.equal(
        (await call("GET", `/rooms/${id}/messages`, d)).statusCode,
        403,
      );
      await Promise.all(
        Array.from({ length: 51 }, (_, i) =>
          call("POST", `/rooms/${id}/messages`, a, {
            id: randomUUID(),
            text: `임시 문구${i}`,
          }),
        ),
      );
      const chat = (await call("GET", `/rooms/${id}/messages`, b)).json();
      assert.equal(chat.messages.length, 50);
      assert.equal(chat.hasMore, true);
      const old = (
        await call(
          "GET",
          `/rooms/${id}/messages?before=${chat.messages[0].sequence}`,
          b,
        )
      ).json();
      assert.equal(old.messages.length, 2);
      const reconnect = await buildApp({
        db,
        origins: [origin],
        checkDatabase: async () => {},
      });
      assert.equal(
        (
          await reconnect.inject({
            url: `/api/v1/rooms/${id}/messages`,
            headers: { cookie: a.cookie },
          })
        ).json().messages.length,
        50,
      );
      await reconnect.close();
      // Concurrent joins cannot exceed capacity; failed admissions do not consume tokens.
      const small = await room(a, 2, "PUBLIC");
      const admissions = await Promise.all([
        call("POST", `/rooms/${small}/join`, b, {}),
        call("POST", `/rooms/${small}/join`, c, {}),
      ]);
      assert.deepEqual(admissions.map((r) => r.statusCode).sort(), [200, 409]);
      assert.equal(await db.roomMember.count({ where: { roomId: small } }), 2);
      const expired = await invite(id, a);
      await db.roomInvite.update({
        where: { id: expired.id },
        data: { expiresAt: new Date(0) },
      });
      assert.equal(
        (
          await call("POST", `/rooms/${id}/join`, d, {
            inviteToken: expired.token,
          })
        ).statusCode,
        403,
      );
      const revoked = await invite(id, a);
      await call("DELETE", `/rooms/${id}/invites/${revoked.id}`, a);
      assert.equal(
        (
          await call("POST", `/rooms/${id}/join`, d, {
            inviteToken: revoked.token,
          })
        ).statusCode,
        403,
      );
      // Real sockets: host election, authorized relay, stale epoch rejection, migration.
      await app.listen({ host: "127.0.0.1", port: 0 });
      await assert.rejects(connect(id, d), /403/);
      const wa = await connect(id, a);
      const initial = await wa.wait((x) => x.type === "presence");
      assert.equal(initial.hostUserId, a.id);
      const wb = await connect(id, b);
      await wb.wait(
        (x) => x.type === "presence" && x.onlineUserIds.length === 2,
      );
      wa.socket.send(JSON.stringify({ type: "move", x: 480, y: 320 }));
      await wb.wait((x) => x.type === "move" && x.userId === a.id);
      wa.socket.send(
        JSON.stringify({
          type: "signal",
          kind: "offer",
          targetUserId: b.id,
          hostEpoch: "0",
          payload: { sdp: "test" },
        }),
      );
      await wa.wait((x) => x.code === "STALE_EPOCH");
      wa.socket.send(
        JSON.stringify({
          type: "signal",
          kind: "offer",
          targetUserId: b.id,
          hostEpoch: initial.hostEpoch,
          payload: { sdp: "test" },
        }),
      );
      await wb.wait((x) => x.type === "signal" && x.fromUserId === a.id);
      wa.socket.send(
        JSON.stringify({
          type: "signal",
          kind: "offer",
          targetUserId: d.id,
          hostEpoch: initial.hostEpoch,
          payload: { sdp: "test" },
        }),
      );
      await wa.wait((x) => x.code === "PEER_OFFLINE");
      wa.socket.close();
      const migrated = await wb.wait(
        (x) => x.type === "presence" && x.hostUserId === b.id,
      );
      assert.ok(BigInt(migrated.hostEpoch) > BigInt(initial.hostEpoch));
      await call("DELETE", `/rooms/${id}`, a);
      await new Promise<void>((resolve) => {
        if (wb.socket.readyState === WebSocket.CLOSED) resolve();
        else wb.socket.once("close", () => resolve());
      });
      assert.equal(await db.chatMessage.count({ where: { roomId: id } }), 0);
      assert.equal(await db.roomInvite.count({ where: { roomId: id } }), 0);
      assert.equal((await call("POST", "/auth/logout", a)).statusCode, 204);
      assert.equal((await call("GET", "/auth/me", a)).statusCode, 401);
      await db.session.updateMany({
        where: { userId: b.id },
        data: { expiresAt: new Date(0) },
      });
      assert.equal((await call("GET", "/auth/me", b)).statusCode, 401);
      // Auth rate limiting also covers malformed requests before hashing work.
      const attempts = await Promise.all(
        Array.from({ length: 16 }, () =>
          call("POST", "/auth/register", undefined, {}),
        ),
      );
      assert.ok(attempts.some((response) => response.statusCode === 429));
      const throttled = attempts.find(
        (response) => response.statusCode === 429,
      )!;
      assert.equal(throttled.json().error.code, "RATE_LIMITED");
    } finally {
      for (const socket of sockets) socket.terminate();
      await app.close();
      await db.room.deleteMany({ where: { id: { in: rooms } } });
      await db.user.deleteMany({ where: { id: { in: users } } });
      await db.$disconnect();
    }
  },
);
