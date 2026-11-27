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
  assert.equal(await page.getByRole("link", { name: "로컬 체험방" }).count(), 0);
  await page.locator("#account-switch").click();
  assert.equal(await page.locator('#account-form [name="nickname"]').count(), 0);
  await page.locator('#account-form [name="email"]').fill(email);
  await page
    .locator('#account-form [name="password"]')
    .fill("integration-password");
  await page.locator('#account-form [type="submit"]').click();
  await page.locator("#account-dialog").waitFor({ state: "detached" });
  const destination = page.url();
  await page.goto(base + "/?screen=profile");
  await page.locator('#profile-form [name="nickname"]').fill("사용자 " + n);
  const saved = page.waitForResponse(r => r.url().endsWith("/me/profile") && r.request().method() === "PATCH");
  await page.getByRole("button", {name:"프로필 저장"}).click();
  assert.ok((await saved).ok());
  await page.goto(destination);
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
  await a.locator("#home-view").waitFor();
  assert.equal(await a.locator('#home-view a[href*="screen=demo"], #home-view a[href="/room.html"]').count(), 0);
  assert.ok(await a.locator("#invite-code").isVisible());
  // A signed-in user may be returning from the local preview.
  await a.goto(base + "/?local=1");
  await a.locator("#home-view").waitFor();
  await a.locator('.bookmate-nav [data-screen="create"]').click();
  await a.locator("#create-view").waitFor();
  assert.equal(new URL(a.url()).searchParams.has("local"), false,
    "creating a shared room from the preview must return to the authenticated server");
  assert.equal(await a.locator('#create-form [name="name"]').count(), 0);
  await a.locator('#create-form [name="title"]').fill("임시 문구1");
  await a.locator('#create-form [name="author"]').fill("임시 문구2");
  await a.locator('#create-form [name="capacity"]').selectOption("4");
  await a.locator('#create-form [type="submit"]').click();
  await a.waitForURL(/code=[A-F0-9]{8}/);
  const code = new URL(a.url()).searchParams.get("code");
  await a.waitForURL(/room\.html/);
  await a.locator("#invite-manage").waitFor();
  assert.ok(await a.locator("#start-exchange").isDisabled());
  assert.equal(await a.locator("#holder").textContent(), "시작 전");
  const b = await actor(2, "/?code=" + code);
  await b.locator("#join-form").waitFor();
  assert.equal(await b.locator('#join-form [name="name"]').count(), 0);
  await b.goto(base + "/");
  await b.locator("#invite-code").fill(code.toLowerCase());
  await b.locator("#code-form button").click();
  await b.locator("#join-form button").click();
  await b.waitForURL(/room\.html/);
  await a.waitForFunction(() => document.querySelectorAll(".member").length === 2);
  await a.locator("#invite-manage").click();
  await a.waitForFunction(
    () => document.querySelector("#waiting-count").textContent === "참가자 2/4",
  );
  await a.locator(".member-drag").nth(1).press("ArrowUp");
  await a.waitForFunction(
    () => document.querySelector(".waiting-name").textContent === "사용자 2",
  );
  await a.locator(".member-drag").nth(0).press("ArrowDown");
  await a.waitForFunction(
    () => document.querySelector(".waiting-name").textContent === "사용자 1",
  );
  await a.getByRole("link", { name: "독서방 입장", exact: true }).click();
  await a.locator("#start-exchange").click();
  await a.locator("#complete").waitFor();
  let receivedMoves = 0;
  b.on("websocket", socket => socket.on("framereceived", ({ payload }) => {
    if (socket.url().endsWith("/live") && JSON.parse(payload).type === "move") receivedMoves++;
  }));
  await b.addInitScript(() => {
    window.directMoves = 0;
    function observe(channel) {
      if (channel.label === "bookmate-motion")
        channel.addEventListener("message", () => window.directMoves++);
    }
    window.RTCPeerConnection = class extends RTCPeerConnection {
      constructor(...args) {
        super(...args);
        this.addEventListener("datachannel", event => observe(event.channel));
      }
      createDataChannel(...args) {
        const channel = super.createDataChannel(...args);
        observe(channel);
        return channel;
      }
    };
  });
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
  // Measure the observer's rendered coordinates during an actual 208-pixel walk.
  const beforeWalk = receivedMoves + await b.evaluate(() => window.directMoves);
  await b.evaluate(() => {
    const label = document.querySelector(".avatar-label");
    window.walkPositions = new Set();
    function sample() {
      window.walkPositions.add(label.style.left);
      if (label.style.left !== "70%") requestAnimationFrame(sample);
    }
    sample();
  });
  const bounds = await a.locator("#room").boundingBox();
  await a.mouse.click(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.46);
  await b.waitForFunction(() => window.walkPositions.has("70%"));
  // The canvas rounds x to whole pixels in its 640-pixel world.
  const rendered = await b.evaluate(() =>
    new Set([...window.walkPositions].map(left => Math.round(parseFloat(left) * 6.4))).size
  );
  const packets = receivedMoves + await b.evaluate(() => window.directMoves) - beforeWalk;
  console.log("Observer walk:", packets, "move packets,", rendered, "distinct on-screen positions");
  assert.ok(packets > 0 && rendered > packets + 5, "observer should render intermediate positions between packets");
  await finish(a, 4.5, "임시 문구4");
  await b.waitForFunction(() => !document.querySelector("#complete").disabled);
  // Observe the actual painted door and the last avatar, on both sides of entry.
  function watchDoor() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", watchDoor, { once: true });
      return;
    }
    const canvas = document.querySelector("#room");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    window.entryPixels = new Set();
    window.entrySteps = new Set();
    function sample() {
      const pixel = ctx.getImageData(530, 108, 1, 1).data;
      window.entryPixels.add([...pixel].slice(0, 3).join(","));
      const labels = document.querySelectorAll(".avatar-label");
      if (labels.length === 3) window.entrySteps.add(labels[2].style.top);
      if (window.entrySteps.size < 30) requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  }
  const c = await actor(3, "/?code=" + code);
  await a.evaluate(watchDoor);
  await c.addInitScript(watchDoor);
  await c.locator("#join-form button").click();
  await c.waitForURL(/room\.html/);
  for (const page of [a, c]) {
    await page.waitForFunction(() => window.entryPixels?.has("35,44,41") && window.entrySteps.size >= 4);
  }
  await a.waitForFunction(() => document.querySelectorAll(".member").length === 3);
  assert.equal(await a.locator(".member-name").last().textContent(), "사용자 3");
  assert.equal(await a.locator("#holder").textContent(), "사용자 2");
  await b.waitForFunction(() => document.querySelector(".room-count").textContent === "3명 온라인");
  await finish(b, 5, "임시 문구5");
  await c.locator("#complete").waitFor();
  await finish(c, 4, "마지막 독자");
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
  await a.locator('#account-form [name="email"]').fill(emails[0]);
  await a.locator('#account-form [name="password"]').fill("integration-password");
  const login = a.getByRole("button", {name:"로그인",exact:true});
  await login.hover();
  assert.ok(await login.evaluate(el => {
    const style = getComputedStyle(el);
    return Number(style.opacity) > 0 && style.color !== style.backgroundColor && style.backgroundColor !== "rgba(0, 0, 0, 0)";
  }), "login button stays visible on hover");
  await login.click();
  await a.locator("#account-dialog").waitFor({state:"detached"});
  assert.deepEqual(errors, []);
  assert.deepEqual(legacyCalls, []);
  console.log(
    "PASS UI: three real accounts, door entry, late join, create/join/reorder/start, cross-context chat/presence/movement, finish/transfer, shelf/review/history/PNG, reload/logout, mobile layout",
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
