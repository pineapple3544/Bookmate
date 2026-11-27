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
      const firstView = await call("GET", path, a.cookie);
      const guestView = await call("GET", path, b.cookie);
      assert.equal(guestView.json().room.me, -1);
      assert.equal(firstView.headers["x-ratelimit-remaining"],
        guestView.headers["x-ratelimit-remaining"], "accounts behind one proxy have independent quotas");
      const forged = await call("GET", path, "bookmate_session=" + "1".repeat(64));
      const unknown = await call("GET", path, "bookmate_session=" + "2".repeat(64));
      assert.equal(forged.statusCode, 401);
      assert.equal(unknown.statusCode, 401);
      assert.equal(Number(unknown.headers["x-ratelimit-remaining"]),
        Number(forged.headers["x-ratelimit-remaining"]) - 1, "unknown credentials share the IP quota");
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
      const detail = `/rooms/${room.id}`;
      for (const route of [detail, path]) {
        const other = (await call("GET", route, a.cookie)).json().room
          .members[0];
        for (const key of ["review", "quote", "rating"])
          assert.equal(Object.hasOwn(other, key), false);
        const own = (await call("GET", route, b.cookie)).json().room.members[0];
        assert.equal(own.rating, 4.5);
        assert.equal(own.review, "임시 문구3");
        assert.equal(own.quote, "");
      }
      assert.equal((await call("GET", detail, c.cookie)).statusCode, 403);
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
      for (const route of [detail, path]) {
        const other = (await call("GET", route, b.cookie)).json().room
          .members[1];
        assert.deepEqual(
          [other.rating, other.review, other.quote],
          [5, "임시 문구4", "임시 문구5"],
        );
      }
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
      const defaults = "/me/appearance";
      assert.equal((await call("GET", defaults)).statusCode, 401);
      assert.equal((await call("PATCH", defaults, "", { top: "frog" })).statusCode, 401);
      assert.deepEqual((await call("GET", defaults, a.cookie)).json(), { appearance: null });
      const invalidPet = { pet: "book\u0000title" };
      assert.equal((await call("PATCH", defaults, a.cookie, invalidPet)).statusCode, 400);
      assert.equal((await call("POST", path + "/appearance", b.cookie, invalidPet)).statusCode, 400);
      const petLook = { title: "달빛 서점", color: "#abC123", art: "#1234ab" };
      const blue = { clothes: "blue", palette: "personal", pet: "book-1", petLook };
      const green = { clothes: "green" }, frog = { top: "frog" };
      assert.deepEqual((await call("PATCH", defaults, a.cookie, { pet: "", petLook })).json(),
        { appearance: { pet: "" } });
      assert.equal((await call("PATCH", defaults, a.cookie,
        { pet: "book-1", petLook: { ...petLook, color: "red" } })).statusCode, 400);
      assert.equal((await call("POST", path + "/appearance", b.cookie,
        { pet: "book-1", petLook: { ...petLook, title: "bad\u0000title" } })).statusCode, 400);
      const longTitle = "📚".repeat(81);
      const trimmed = await call("PATCH", defaults, a.cookie,
        { ...blue, petLook: { ...petLook, title: "  " + longTitle, inventory: ["book-2"] } });
      assert.deepEqual(trimmed.json().appearance.petLook, { ...petLook, title: "📚".repeat(80) });
      assert.deepEqual((await call("PATCH", defaults, a.cookie, blue)).json(), { appearance: blue });
      assert.deepEqual((await call("GET", defaults, b.cookie)).json(), { appearance: null });
      await call("PATCH", defaults, b.cookie, green);

      // Old memberships keep both their room outfit and their legacy empty appearance.
      const oldRoom = (await call("POST", path + "/join", a.cookie, {})).json().room;
      assert.equal(oldRoom.members.find((m: any) => m.id === a.id).appearance, null);
      assert.deepEqual(oldRoom.members.find((m: any) => m.id === b.id).appearance,
        { hairstyle: "bob", top: "frog", skinShade: 75 });

      const newRoom = (await call("POST", "/exchanges", a.cookie,
        { title: "옷장", name: "A", capacity: 2, appearance: frog })).json().room;
      rooms.push(newRoom.id);
      const newPath = "/exchanges/" + newRoom.code;
      assert.deepEqual(newRoom.members[0].appearance, blue);
      const joined = (await call("POST", newPath + "/join", b.cookie,
        { name: "B", appearance: frog })).json().room;
      assert.deepEqual(joined.members[0].appearance, blue);
      assert.deepEqual(joined.members[1].appearance, green);
      await call("POST", newPath + "/appearance", a.cookie, frog);
      assert.deepEqual((await call("GET", defaults, a.cookie)).json(), { appearance: blue });
      await call("PATCH", defaults, b.cookie, blue);
      const retried = (await call("POST", newPath + "/join", b.cookie, {})).json().room;
      assert.deepEqual(retried.members.map((m: any) => m.appearance), [frog, green]);

      const fourth = await actor();
      async function startTwo(capacity: number) {
        const created = (await call("POST", "/exchanges", a.cookie, { title: "늦은 참가", capacity })).json().room;
        rooms.push(created.id);
        const url = "/exchanges/" + created.code;
        assert.equal((await call("POST", url + "/join", b.cookie, {})).statusCode, 200);
        assert.equal((await call("POST", url + "/start", a.cookie, {})).statusCode, 200);
        return url;
      }
      // Changing text or sending an old client payload must preserve the stored cover.
      const settings = { title: "표지", author: "저자", capacity: 3, theme: "plum" };
      const pixels = Buffer.alloc(240 * 330 * 3, 175).toString("base64");
      assert.equal((await call("POST", newPath + "/settings", b.cookie, { ...settings, coverPixels: pixels })).statusCode, 403);
      const painted = await call("POST", newPath + "/settings", a.cookie, { ...settings, coverPixels: pixels });
      assert.equal(painted.statusCode, 200, painted.body);
      const asset = painted.json().room.coverUrl.replace("/api/v1", "");
      assert.equal((await call("GET", asset)).statusCode, 401);
      const original = await call("GET", asset, b.cookie);
      assert.equal(original.headers["content-type"], "image/png");
      assert.equal(original.rawPayload.readUInt32BE(20), 330);
      assert.equal((await call("POST", newPath + "/settings", a.cookie, { ...settings, coverPixels: "bad" })).statusCode, 400);
      assert.equal((await call("POST", newPath + "/settings", a.cookie, settings)).json().room.coverUrl, painted.json().room.coverUrl);
      const replaced = await call("POST", newPath + "/settings", a.cookie, { ...settings, coverPixels: Buffer.alloc(240 * 330 * 3, 125).toString("base64") });
      assert.notEqual(replaced.json().room.coverUrl, painted.json().room.coverUrl);
      assert.equal((await call("GET", asset, a.cookie)).statusCode, 404);
      assert.equal((await call("POST", newPath + "/settings", a.cookie, { ...settings, coverPixels: null })).json().room.coverUrl, null);
      assert.equal(await db.roomCover.count({ where: { roomId: newRoom.id } }), 0);

      const lastSeat = await startTwo(3);
      const contenders = await Promise.all([c, fourth].map(user => call("POST", lastSeat + "/join", user.cookie, {})));
      assert.deepEqual(contenders.map(r => r.statusCode).sort(), [200, 409]);
      const joinedRoom = contenders.find(r => r.statusCode === 200)!.json().room;
      assert.deepEqual(joinedRoom.members.map((m: any) => m.id), [a.id, b.id, contenders[0]!.statusCode === 200 ? c.id : fourth.id]);
      assert.ok(joinedRoom.members[0].receivedAt);
      assert.equal(joinedRoom.members[2].receivedAt, null);

      const race = await startTwo(4);
      await call("POST", race + "/finish", a.cookie, { rating: 5 });
      const [lastReader, lateJoin] = await Promise.all([
        call("POST", race + "/finish", b.cookie, { rating: 5 }),
        call("POST", race + "/join", c.cookie, {}),
      ]);
      assert.equal(lastReader.statusCode, 200);
      const afterRace = (await call("GET", race, a.cookie)).json().room;
      if (afterRace.completedAt) {
        assert.equal(lateJoin.statusCode, 409);
        assert.equal(afterRace.members.length, 2);
      } else {
        assert.equal(lateJoin.statusCode, 200);
        assert.equal(afterRace.members[2].id, c.id);
        assert.ok(afterRace.members[2].receivedAt);
        assert.ok((await call("POST", race + "/finish", c.cookie, { rating: 5 })).json().room.completedAt);
      }
      assert.equal((await call("POST", race + "/join", fourth.cookie, {})).statusCode, 409);

      const leavePath = await startTwo(3);
      const leave = (user: typeof a, deleteIfLast = false) =>
        call("POST", leavePath + "/leave", user.cookie, { deleteIfLast });
      assert.equal((await leave(c, true)).statusCode, 403);
      assert.deepEqual((await leave(a)).json(), { deleted: false });
      const afterExit = (await call("GET", leavePath, b.cookie)).json().room;
      assert.equal(afterExit.isHost, true);
      assert.ok(afterExit.members[0].receivedAt);
      assert.equal(afterExit.members[0].recordSlot, 1);
      assert.equal(afterExit.departed[0].id, a.id);
      assert.equal((await call("GET", leavePath, a.cookie)).json().room.me, -1);
      const late = (await call("POST", leavePath + "/join", c.cookie, {})).json().room;
      assert.equal(late.members[1].recordSlot, 2);
      const results = await Promise.all([leave(b), leave(c)]);
      assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]);
      const last = results[0]!.statusCode === 409 ? b : c;
      assert.deepEqual((await leave(last, true)).json(), { deleted: true });
      assert.equal((await call("GET", leavePath, last.cookie)).statusCode, 404);
      assert.equal(await db.roomDeparture.count({ where: { roomId: afterExit.id } }), 0);
      assert.equal(await db.bookTransfer.count({ where: { roomId: afterExit.id } }), 0);

      const publicRoom = (await call("POST", "/rooms", b.cookie,
        { title: "서재", bookTitle: "책", visibility: "PUBLIC" })).json().room;
      rooms.push(publicRoom.id);
      const publicPath = "/rooms/" + publicRoom.id;
      assert.deepEqual((await call("GET", publicPath, b.cookie)).json().room.members[0].appearance, blue);
      assert.deepEqual((await call("POST", publicPath + "/join", a.cookie, {})).json().member.appearance, blue);
      await call("PATCH", defaults, a.cookie, green);
      assert.deepEqual((await call("POST", publicPath + "/join", a.cookie, {})).json().member.appearance, blue);
    } finally {
      await app.close();
      await db.room.deleteMany({ where: { id: { in: rooms } } });
      await db.user.deleteMany({ where: { id: { in: users } } });
      await db.$disconnect();
    }
  },
);
