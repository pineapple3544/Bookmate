import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { config } from "dotenv";
import { createDatabase } from "../../server/dist/db.js";

config({ path: new URL("../../../.env", import.meta.url), quiet: true });
const base = process.env.BASE_URL ?? "http://127.0.0.1:5173";
const db = createDatabase(process.env.DATABASE_URL);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_CHANNEL
    ? { channel: process.env.BROWSER_CHANNEL }
    : {}),
});
const accounts = Array.from({ length: 10 }, () => ({
  id: randomUUID(),
  cookie: randomBytes(32).toString("hex"),
}));
const roomId = randomUUID();
const code = randomBytes(4).toString("hex").toUpperCase();
const pages = [],
  errors = [];
try {
  // Seed isolated sessions so this concurrency test does not consume the login test's rate limit.
  await db.$transaction(async (tx) => {
    await tx.user.createMany({
      data: accounts.map(({ id }, i) => ({
        id,
        email: `${id}@example.test`,
        nickname: `사용자 ${i + 1}`,
        passwordHash: "fixture",
      })),
    });
    await tx.session.createMany({
      data: accounts.map(({ id, cookie }) => ({
        userId: id,
        tokenHash: createHash("sha256").update(cookie).digest("hex"),
        expiresAt: new Date(Date.now() + 3600000),
      })),
    });
    const now = new Date();
    await tx.room.create({
      data: {
        id: roomId,
        title: "10인 이동 검증",
        bookTitle: "10인 이동 검증",
        maxMembers: 10,
        exchangeCode: code,
        exchangeOwnerId: accounts[0].id,
        startedAt: now,
        bookHolderId: accounts[1].id,
        members: {
          create: accounts.map(({ id }, i) => ({
            userId: id,
            role: i === 0 ? "ADMIN" : "MEMBER",
            readingOrder: i + 1,
            readingStatus:
              i === 0 ? "COMPLETED" : i === 1 ? "READING" : "WAITING",
            readingStartedAt: i < 2 ? now : null,
            readingCompletedAt: i === 0 ? now : null,
          })),
        },
      },
    });
  });
  for (const account of accounts) {
    const context = await browser.newContext();
    await context.addCookies([
      {
        name: "bookmate_session",
        value: account.cookie,
        url: base,
        httpOnly: true,
        sameSite: "Strict",
      },
    ]);
    const page = await context.newPage();
    pages.push(page);
    page.on("pageerror", (err) => errors.push(err.message));
    // Instrument the real room socket. Deterministic coordinates let every observer verify every sender.
    await page.addInitScript(() => {
      const NativeWebSocket = window.WebSocket;
      window.WebSocket = class extends NativeWebSocket {
        constructor(...args) {
          super(...args);
          if (!String(args[0]).endsWith("/live")) return;
          window.roomProbe ??= { opens: 0, closes: 0, positions: {} };
          const probe = window.roomProbe;
          probe.socket = this;
          this.addEventListener("open", () => probe.opens++);
          this.addEventListener("close", () => probe.closes++);
          this.addEventListener("message", (e) => {
            const msg = JSON.parse(e.data);
            if (msg.type === "move")
              probe.positions[msg.userId] = [msg.x, msg.y];
          });
        }
      };
    });
    await page.goto(`${base}/room.html?code=${code}`);
  }
  await Promise.all(
    pages.map((p) =>
      p.waitForFunction(
        () =>
          document.querySelector(".room-count")?.textContent === "10명 온라인",
      ),
    ),
  );
  await pages[1].waitForFunction(
    () =>
      Number(document.querySelector("#record-sync-status")?.dataset.peers) >= 1,
  );
  const movement = Promise.all(
    pages.map((p, index) =>
      p.evaluate(async (i) => {
        for (let n = 0; n < 40; n++) {
          window.roomProbe.socket.send(
            JSON.stringify({
              type: "move",
              x: 50 + 40 * i + n,
              y: 200 + i,
              seat: null,
            }),
          );
          await new Promise((r) => setTimeout(r, 100));
        }
      }, index),
    ),
  );
  const message = "동시 이동 " + randomUUID();
  await Promise.all([
    movement,
    (async () => {
      await pages[0].locator("#chat-input").fill(message);
      await pages[0].locator("#chat-send").click();
      await pages[0].evaluate(async (text) => {
        const { recordRequest } = await import("./records.js");
        await recordRequest("note", { key: [0, 3], text, drawing: "" });
      }, message);
    })(),
  ]);
  const ids = accounts.map((a) => a.id);
  await Promise.all(
    pages.map(async (p, viewer) => {
      await p.waitForFunction(
        (ids) =>
          ids.every((id, i) => {
            const xy = window.roomProbe.positions[id];
            return xy?.[0] === 89 + 40 * i && xy[1] === 200 + i;
          }),
        ids,
      );
      await p.waitForFunction(
        (viewer) =>
          [...document.querySelectorAll(".avatar-label")].every(
            (el, i) =>
              i === viewer ||
              (Math.abs(parseFloat(el.style.left) * 6.4 - (89 + 40 * i)) <
                0.1 &&
                Math.abs(parseFloat(el.style.top) * 4 + 37 - (200 + i)) < 0.1),
          ),
        viewer,
      );
      await p
        .getByText(message, { exact: true })
        .first()
        .waitFor({ state: "attached", timeout: 30000 });
      assert.deepEqual(
        await p.evaluate(() => [
          window.roomProbe.opens,
          window.roomProbe.closes,
        ]),
        [1, 0],
      );
    }),
  );
  await pages[1].locator("#record").click();
  await pages[1]
    .locator("#record-posts")
    .getByText(message, { exact: true })
    .waitFor({ state: "attached" });
  async function checkPresence(viewers, absent) {
    await Promise.all(viewers.map(p => p.waitForFunction(absent => {
      const portraits = [...document.querySelectorAll(".member-avatar")];
      const labels = [...document.querySelectorAll(".avatar-label")];
      return [portraits, labels].every(group => group.length === 10 &&
        group.every((el, i) => el.classList.contains("offline") === (i === absent))) &&
        document.querySelector(".room-count").textContent === (absent < 0 ? 10 : 9) + "명 온라인";
    }, absent)));
  }
  await checkPresence(pages, -1);
  const returning = pages.at(-1);
  const roomUrl = returning.url();
  await returning.goto("about:blank");
  await checkPresence(pages.slice(0, -1), 9);
  await returning.goto(roomUrl);
  await checkPresence(pages, -1);
  await returning.locator(".chat-message p").filter({ hasText: message }).first()
    .waitFor({ state: "attached" });
  // With 44 pixels between chairs and a 36-pixel reach, both chairs can be usable.
  const reader = pages[0];
  const canvas = reader.locator("#room");
  await canvas.focus();
  async function holdUntil(key, condition) {
    await reader.keyboard.down(key);
    try {
      await reader.waitForFunction(condition, undefined, { timeout: 5000 });
    } finally {
      await reader.keyboard.up(key);
    }
  }
  await canvas.press("e");
  await reader.waitForFunction(() => document.querySelector("#action-state").textContent === "이동 가능");
  await holdUntil("ArrowDown", () => parseFloat(document.querySelector(".avatar-label.active").style.top) * 4 + 37 >= 183);
  await holdUntil("ArrowRight", () => parseFloat(document.querySelector(".avatar-label.active").style.left) * 6.4 >= 236);
  const focusMark = reader.locator(".interaction-focus:not([hidden])");
  assert.equal(await focusMark.count(), 1);
  assert.equal(await focusMark.getAttribute("data-target"), "chair-0");
  await holdUntil("ArrowRight", () => document.querySelector(".interaction-focus")?.dataset.target === "chair-2");
  assert.equal(await focusMark.count(), 1);
  assert.equal(await focusMark.getAttribute("data-target"), "chair-2");
  await canvas.press("e");
  await reader.waitForFunction(() => document.querySelector("#action-state").textContent === "착석");
  const seated = await reader.evaluate(code => {
    const state = JSON.parse(localStorage.getItem("bookmate-pixel-prototype-v1:" + code));
    return state.users[state.selected].seat;
  }, code);
  assert.equal("chair-" + seated, await focusMark.getAttribute("data-target"));
  assert.equal(seated, 2);
  console.log("PASS ten-reader room: a single highlight switched between adjacent chairs; E seated the avatar in the highlighted chair");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: 10 authenticated Chrome contexts sent 400 moves; all 100 final positions matched, 10/10 got chat, zero reconnects; eligible reader received P2P note",
  );
} finally {
  await browser.close();
  await db.room.deleteMany({ where: { id: roomId } });
  await db.user.deleteMany({
    where: { id: { in: accounts.map((a) => a.id) } },
  });
  await db.$disconnect();
}
