import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { buildApp } from "../src/app.js";
import { createDatabase } from "../src/db.js";

test(
  "integrated exchanges: authenticated discovery, capacity, order, reviews, atomic finish and durable appearance",
  { skip: process.env.CORE_DB_TEST !== "1", timeout: 60000 },
  async () => {
    const db = createDatabase(process.env.DATABASE_URL!);
    const app = await buildApp({
      db,
      origins: ["http://localhost:5173"],
      checkDatabase: async () => {},
    });
    const users: string[] = [],
      rooms: string[] = [];
    const call = (method: any, path: string, cookie = "", payload?: unknown) =>
      app.inject({
        method,
        url: "/api/v1" + path,
        headers: { origin: "http://localhost:5173", cookie },
        ...(payload === undefined ? {} : { payload: payload as any }),
      });
    async function actor() {
      const data = {
        email: randomUUID() + "@example.com",
        password: "integration-password",
        nickname: "사용자",
      };
      const response = await call("POST", "/auth/register", "", data);
      assert.equal(response.statusCode, 201, response.body);
      users.push(response.json().user.id);
      const login = await call("POST", "/auth/login", "", data);
      return {
        id: response.json().user.id,
        cookie: String(login.headers["set-cookie"]).split(";")[0]!,
      };
    }
    try {
      const a = await actor(),
        b = await actor(),
        c = await actor();
      assert.equal((await call("GET", "/exchanges")).statusCode, 401);
      const made = await call("POST", "/exchanges", a.cookie, {
        title: "임시 문구1",
        author: "임시 문구2",
        name: "사용자 1",
        capacity: 2,
        theme: "plum",
      });
      assert.equal(made.statusCode, 201, made.body);
      const room = made.json().room;
      rooms.push(room.id);
      const path = "/exchanges/" + room.code;
      assert.equal(room.startedAt, null);
      assert.equal(room.members[0].receivedAt, null);
      assert.deepEqual(
        (await call("GET", "/exchanges", a.cookie)).json().codes,
        [room.code],
      );
      assert.equal((await call("GET", path, b.cookie)).json().room.me, -1);
      assert.equal(
        (await call("POST", path + "/start", a.cookie, {})).statusCode,
        409,
      );
      assert.equal(
        (await call("POST", path + "/join", b.cookie, { name: "사용자 2" }))
          .statusCode,
        200,
      );
      assert.equal(
        (await call("POST", path + "/join", c.cookie, { name: "사용자 3" }))
          .statusCode,
        409,
      );
      assert.equal(
        (
          await call("POST", path + "/settings", b.cookie, {
            title: "x",
            name: "b",
            capacity: 2,
          })
        ).statusCode,
        403,
      );
      assert.equal(
        (
          await call("POST", path + "/order", a.cookie, {
            previous: [a.id, b.id],
            order: [b.id, a.id],
          })
        ).statusCode,
        200,
      );
      assert.equal(
        (
          await call("POST", path + "/order", a.cookie, {
            previous: [a.id, b.id],
            order: [a.id, b.id],
          })
        ).statusCode,
        409,
      );
      const started = await call("POST", path + "/start", a.cookie, {});
      assert.equal(started.statusCode, 200, started.body);
      assert.ok(started.json().room.members[0].receivedAt);
      assert.equal(
        (await call("POST", path + "/start", a.cookie, {})).json().room
          .startedAt,
        started.json().room.startedAt,
      );
      assert.equal(
        (
          await call("POST", path + "/order", a.cookie, {
            previous: [b.id, a.id],
            order: [a.id, b.id],
          })
        ).statusCode,
        409,
      );
      assert.equal(
        (await call("POST", path + "/finish", a.cookie, { rating: 4 }))
          .statusCode,
        409,
      );
      assert.equal(
        (await call("POST", `/rooms/${room.id}/reading/complete`, b.cookie))
          .statusCode,
        409,
      );
      assert.equal(
        (
          await call("POST", path + "/appearance", b.cookie, {
            hairstyle: "bob",
            skinShade: 75,
            top: "frog",
          })
        ).statusCode,
        200,
      );
      const retry = await Promise.all([
        call("POST", path + "/finish", b.cookie, {
          rating: 4.5,
          review: "임시 문구3",
        }),
        call("POST", path + "/finish", b.cookie, {
          rating: 4.5,
          review: "임시 문구3",
        }),
      ]);
      assert.ok(
        retry.every((r) => r.statusCode === 200),
        retry.map((r) => r.body).join("\n"),
      );
      assert.equal(
        await db.bookTransfer.count({ where: { roomId: room.id } }),
        1,
      );
      const reading = (await call("GET", path, a.cookie)).json().room;
      assert.equal(reading.members[0].review, undefined);
      assert.ok(reading.members[1].receivedAt);
      assert.equal(
        (await call("POST", path + "/finish", a.cookie, { rating: 0 }))
          .statusCode,
        400,
      );
      const done = (
        await call("POST", path + "/finish", a.cookie, {
          rating: 5,
          review: "임시 문구4",
          quote: "임시 문구5",
        })
      ).json().room;
      assert.ok(done.completedAt);
      assert.equal(done.members[0].review, "임시 문구3");
      assert.equal(done.members[1].quote, "임시 문구5");
      assert.equal(
        (
          await call("POST", path + "/review", b.cookie, {
            rating: 3,
            review: "임시 문구6",
          })
        ).json().room.members[0].review,
        "임시 문구6",
      );
      const reloaded = await db.room.findUnique({
        where: { id: room.id },
        include: { members: true },
      });
      assert.ok(reloaded!.completedAt);
      assert.deepEqual(
        reloaded!.members.find((m) => m.userId === b.id)!.appearance,
        { hairstyle: "bob", top: "frog", skinShade: 75 },
      );
      assert.equal(
        (await call("GET", path, c.cookie)).json().room.members[0].review,
        undefined,
      );
    } finally {
      await app.close();
      await db.room.deleteMany({ where: { id: { in: rooms } } });
      await db.user.deleteMany({ where: { id: { in: users } } });
      await db.$disconnect();
    }
  },
);
