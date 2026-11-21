import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { test } from "node:test";
import { buildApp } from "../src/app.js";
import { createDatabase } from "../src/db.js";
test(
  "P2P metadata: reader gate, authorship, idempotency, reply ownership and tombstones",
  { skip: process.env.CORE_DB_TEST !== "1" },
  async () => {
    const db = createDatabase(process.env.DATABASE_URL!);
    const app = await buildApp({
      db,
      origins: ["http://localhost:5173"],
      checkDatabase: async () => {},
    });
    const ids: string[] = [];
    let roomId = "";
    const call = (method: any, path: string, cookie = "", payload?: any) =>
      app.inject({
        method,
        url: "/api/v1" + path,
        headers: { origin: "http://localhost:5173", cookie },
        ...(payload === undefined ? {} : { payload }),
      });
    async function actor() {
      const info = {
        email: randomUUID() + "@example.com",
        password: "p2p-test-password",
        nickname: "사용자",
      };
      const reg = await call("POST", "/auth/register", "", info);
      assert.equal(reg.statusCode, 201, reg.body);
      ids.push(reg.json().user.id);
      const login = await call("POST", "/auth/login", "", info);
      return String(login.headers["set-cookie"]).split(";")[0]!;
    }
    try {
      const a = await actor(),
        b = await actor(),
        c = await actor();
      const made = await call("POST", "/exchanges", a, {
        title: "P2P",
        name: "사용자 1",
        capacity: 2,
        theme: "mint",
      });
      const room = made.json().room;
      roomId = room.id;
      const path = "/rooms/" + roomId + "/record-ops";
      await call("POST", "/exchanges/" + room.code + "/join", b, {
        name: "사용자 2",
      });
      await call("POST", "/exchanges/" + room.code + "/start", a, {});
      assert.equal((await call("GET", path)).statusCode, 401);
      assert.equal((await call("GET", path, c)).statusCode, 403);
      assert.equal((await call("GET", path, b)).statusCode, 403);
      const postId = randomUUID();
      const op = {
        id: randomUUID(),
        kind: "publish",
        slot: 0,
        page: 1,
        postId,
        digest: "a".repeat(64),
        bytes: 100,
      };
      let res = await call("POST", path, a, op);
      assert.equal(res.statusCode, 201, res.body);
      const seq = res.json().operation.sequence;
      res = await call("POST", path, a, op);
      assert.equal(res.statusCode, 200);
      assert.equal(res.json().operation.sequence, seq);
      assert.equal(
        (await call("POST", path, a, { ...op, digest: "b".repeat(64) }))
          .statusCode,
        409,
      );
      assert.equal(
        (await call("POST", path, a, { ...op, id: randomUUID(), slot: 1 }))
          .statusCode,
        403,
      );
      await call("POST", "/exchanges/" + room.code + "/finish", a, {
        rating: 4,
      });
      const reply = {
        ...op,
        id: randomUUID(),
        kind: "reply",
        replyId: randomUUID(),
      };
      assert.equal((await call("POST", path, b, reply)).statusCode, 201);
      assert.equal(
        (
          await call("POST", path, a, {
            ...reply,
            id: randomUUID(),
            kind: "edit-reply",
          })
        ).statusCode,
        403,
      );
      assert.equal(
        (
          await call("POST", path, b, {
            ...reply,
            id: randomUUID(),
            kind: "edit-reply",
          })
        ).statusCode,
        201,
      );
      const parallel = await Promise.all(
        [1, 2].map(() =>
          call("POST", path, b, {
            ...reply,
            id: randomUUID(),
            replyId: randomUUID(),
          }),
        ),
      );
      assert.ok(parallel.every((x) => x.statusCode === 201));
      assert.equal(
        (
          await call("POST", path, b, {
            ...op,
            id: randomUUID(),
            kind: "delete",
          })
        ).statusCode,
        403,
      );
      const deletion = { ...op, id: randomUUID(), kind: "delete" };
      const deleted = await call("POST", path, a, deletion);
      assert.equal(deleted.statusCode, 201);
      assert.equal(deleted.json().operation.bytes, deletion.bytes);
      assert.equal(deleted.json().operation.digest, deletion.digest);
      assert.equal((await call("POST", path, a, deletion)).statusCode, 200);
      assert.equal(
        (await call("POST", path, a, { ...deletion, bytes: deletion.bytes + 1 })).statusCode,
        409,
      );
      assert.equal(
        (
          await call("POST", path, b, {
            ...reply,
            id: randomUUID(),
            replyId: randomUUID(),
          })
        ).statusCode,
        409,
      );
      const manifest = (await call("GET", path, b)).json();
      assert.equal(manifest.operations.length, 6);
      assert.ok(manifest.operations.every((x: any) => !x.body && !x.photo));
      assert.equal(
        (await call("GET", "/rooms/" + roomId + "/rtc-config", c)).statusCode,
        403,
      );
      const saved = {
        url: process.env.RTC_TURN_URLS,
        secret: process.env.RTC_TURN_SECRET,
        relay: process.env.RTC_RELAY_ONLY,
      };
      try {
        process.env.RTC_TURN_URLS = "turn:turn.example.test:3478";
        process.env.RTC_TURN_SECRET = "test-only-secret";
        process.env.RTC_RELAY_ONLY = "true";
        const rtc = await call("GET", "/rooms/" + roomId + "/rtc-config", a);
        assert.equal(rtc.statusCode, 200);
        assert.equal(rtc.headers["cache-control"], "no-store");
        const result = rtc.json();
        assert.equal(result.iceTransportPolicy, "relay");
        const server = result.iceServers.find((s: any) => s.username);
        assert.ok(Number(server.username.split(":")[0]) > Date.now() / 1000);
        assert.equal(
          server.credential,
          createHmac("sha1", "test-only-secret")
            .update(server.username)
            .digest("base64"),
        );
        assert.ok(!rtc.body.includes("test-only-secret"));
      } finally {
        for (const [key, value] of [
          ["RTC_TURN_URLS", saved.url],
          ["RTC_TURN_SECRET", saved.secret],
          ["RTC_RELAY_ONLY", saved.relay],
        ]) {
          if (value === undefined) delete process.env[key!];
          else process.env[key!] = value;
        }
      }
    } finally {
      await app.close();
      if (roomId) await db.room.deleteMany({ where: { id: roomId } });
      await db.user.deleteMany({ where: { id: { in: ids } } });
      await db.$disconnect();
    }
  },
);
