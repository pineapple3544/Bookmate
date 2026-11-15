import { chromium } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { createDatabase } from "../../server/dist/db.js";
config({ path: new URL("../../../.env", import.meta.url), quiet: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_CHANNEL
    ? { channel: process.env.BROWSER_CHANNEL }
    : {}),
});
const base = process.env.BASE_URL ?? "http://127.0.0.1:5173";
const db = createDatabase(process.env.DATABASE_URL);
const contexts = [],
  emails = [],
  errors = [],
  legacyCalls = [];
async function actor(n, path = "/") {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  contexts.push(context);
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.url().includes("/api/exchanges"))
      legacyCalls.push(request.url());
  });
  const email = randomUUID() + "@example.com";
  emails.push(email);
  await page.goto(base + path);
  await page.locator("#account-dialog").waitFor();
  await page.locator("#account-switch").click();
  await page.locator('#account-form [name="email"]').fill(email);
  await page
    .locator('#account-form [name="password"]')
    .fill("integration-password");
  await page.locator('#account-form [name="nickname"]').fill("사용자 " + n);
  await page.locator('#account-form [type="submit"]').click();
  await page.locator("#account-dialog").waitFor({ state: "detached" });
  return page;
}
async function finish(page, rating, review) {
  await page.locator("#complete").click();
  await page.locator('#finish-form [name="rating"]').fill(String(rating));
  await page.locator('#finish-form [name="review"]').fill(review);
  await page.locator('#finish-form [type="submit"]').click();
  await page.waitForFunction(
    () => !document.querySelector("#finish-dialog").open,
  );
}
try {
  const a = await actor(1);
  await a.goto(base + "/?screen=create");
  await a.locator('#create-form [name="title"]').fill("임시 문구1");
  await a.locator('#create-form [name="author"]').fill("임시 문구2");
  await a.locator('#create-form [name="name"]').fill("사용자 1");
  await a.locator('#create-form [name="capacity"]').selectOption("2");
  await a.locator('#create-form [type="submit"]').click();
  await a.waitForURL(/code=[A-F0-9]{8}/);
  const code = new URL(a.url()).searchParams.get("code");
  const b = await actor(2, "/?code=" + code);
  await b.locator('#join-form [name="name"]').fill("사용자 2");
  await b.locator("#join-form button").click();
  await a.waitForFunction(
    () => document.querySelector("#waiting-count").textContent === "참가자 2/2",
  );
  await a.locator(".member-drag").nth(1).press("ArrowUp");
  await a.waitForFunction(
    () => document.querySelector(".waiting-name").textContent === "사용자 2",
  );
  await a.locator(".member-drag").nth(0).press("ArrowDown");
  await a.waitForFunction(
    () => document.querySelector(".waiting-name").textContent === "사용자 1",
  );
  await a.getByRole("button", { name: "교환독서 시작", exact: true }).click();
  await a.getByRole("link", { name: "독서방 입장", exact: true }).click();
  await b.goto(base + "/room.html?code=" + code);
  await a.waitForFunction(
    () => document.querySelector(".room-count").textContent === "2명 온라인",
  );
  await b.waitForFunction(() => !document.querySelector("#chat-send").disabled);
  assert.equal(await b.locator("#complete").isDisabled(), true);
  await a.locator("#chat-input").fill("임시 문구3");
  await a.locator("#chat-send").click();
  await b.waitForFunction(() =>
    [...document.querySelectorAll(".chat-message p")].some(
      (p) => p.textContent === "임시 문구3",
    ),
  );
  await b.waitForSelector(".speech-bubble");
  await a.locator('[data-direction="up"]').click();
  await a.waitForFunction(
    () => document.querySelector("#action-state").textContent === "이동 가능",
  );
  const position = await a
    .locator(".avatar-label")
    .first()
    .evaluate((el) => el.style.top);
  await b.waitForFunction(
    (position) =>
      document.querySelector(".avatar-label").style.top === position,
    position,
  );
  await finish(a, 4.5, "임시 문구4");
  await b.waitForFunction(() => !document.querySelector("#complete").disabled);
  await finish(b, 5, "임시 문구5");
  await a.goto(base + "/?screen=shelf");
  await a.locator(".shelf-book").click();
  await a.locator("#edit-shelf-review").click();
  await a.locator('#shelf-review [name="review"]').fill("임시 문구6");
  await a.locator("#shelf-review button").click();
  await a.waitForFunction(() => !document.querySelector("#shelf-editor").open);
  await b.goto(base + "/?code=" + code + "&screen=history");
  await b.waitForFunction(() =>
    document.querySelector("#history-list").textContent.includes("임시 문구6"),
  );
  const downloadPromise = b.waitForEvent("download");
  await b.locator("#ticket-download").click();
  const download = await downloadPromise;
  assert.ok(download.suggestedFilename().endsWith(".png"));
  assert.equal(await download.failure(), null);
  for (const width of [390, 1440]) {
    await b.setViewportSize({ width, height: 900 });
    assert.ok(
      await b.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  }
  await a.goto(base + "/room.html?code=" + code);
  await a.waitForFunction(() => !document.querySelector("#chat-send").disabled);
  await a.waitForFunction(() =>
    [...document.querySelectorAll(".chat-message p")].some(
      (p) => p.textContent === "임시 문구3",
    ),
  );
  assert.equal(await a.locator(".speech-bubble").count(), 0);
  await a.locator("#account-logout").click();
  await a.locator("#account-dialog").waitFor();
  assert.deepEqual(errors, []);
  assert.deepEqual(legacyCalls, []);
  console.log(
    "PASS UI: two real accounts, create/join/reorder/start, cross-context chat/presence/movement, finish/transfer, shelf/review/history/PNG, reload/logout, mobile layout",
  );
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
  const users = await db.user.findMany({
    where: { email: { in: emails } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await db.room.deleteMany({ where: { exchangeOwnerId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
}
