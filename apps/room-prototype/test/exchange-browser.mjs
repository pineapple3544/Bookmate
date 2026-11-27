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
  const fixture = await a.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 720; canvas.height = 330;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#22bb66"; ctx.fillRect(0, 0, 360, 330);
    ctx.fillStyle = "#4b31cf"; ctx.fillRect(360, 0, 360, 330);
    return canvas.toDataURL().split(",")[1];
  });
  await a.locator("#cover-file").setInputFiles({name:"book.png", mimeType:"image/png", buffer:Buffer.from(fixture,"base64")});
  const preview = a.locator("#cover-preview");
  await preview.locator("canvas").waitFor();
  const boundsCover = await preview.boundingBox();
  await a.mouse.move(boundsCover.x + 10, boundsCover.y + 50);
  await a.mouse.down(); await a.mouse.move(boundsCover.x + boundsCover.width - 5, boundsCover.y + 50); await a.mouse.up();
  const sample = await preview.locator("canvas").evaluate(el => [...el.getContext("2d").getImageData(120, 30, 1, 1).data]);
  assert.deepEqual(sample, [34,187,102,255]);
  const visibility = a.locator('#create-form [name="visibility"]');
  assert.equal(await visibility.inputValue(), "PRIVATE");
  await visibility.selectOption("PUBLIC");
  await a.locator('#create-form [name="capacity"]').selectOption("4");
  await a.locator('#create-form [type="submit"]').click();
  await a.waitForURL(/code=[A-F0-9]{8}/);
  const code = new URL(a.url()).searchParams.get("code");
  await a.waitForURL(/room\.html/);
  await a.locator("#invite-manage").waitFor();
  const coverUrl = await a.locator(".book-detail .cover-photo img").getAttribute("src");
  const serverCover = await a.request.get(base + coverUrl);
  assert.equal(serverCover.headers()["content-type"], "image/png");
  assert.equal((await serverCover.body()).readUInt32BE(16), 240);
  assert.ok(await a.locator("#start-exchange").isDisabled());
  assert.equal(await a.locator("#holder").textContent(), "시작 전");
  await a.goto(base + "/");
  await a.locator(".room-card img").waitFor();
  assert.equal(await a.locator(".room-card img").getAttribute("src"), coverUrl);
  await a.locator(".room-card").click();
  for (const width of [390, 1280]) {
    await a.setViewportSize({ width, height: 900 });
    const centered = await a.locator("#invite-manage").evaluate(el => {
      const range = document.createRange(); range.selectNodeContents(el);
      const text = range.getBoundingClientRect(), box = el.getBoundingClientRect();
      return [Math.abs(text.left + text.width / 2 - box.left - box.width / 2),
        Math.abs(text.top + text.height / 2 - box.top - box.height / 2)];
    });
    assert.ok(centered.every(offset => offset <= 2), "center invite label at " + width + ": " + centered);
    assert.equal(await a.locator("#invite-manage").textContent(), "초대 / 방 관리");
  }
  const b = await actor(2);
  const room = (await (await a.request.get(base + "/api/v1/exchanges/" + code)).json()).room;
  const listing = "/api/v1/exchanges/public";
  const button = page => page.locator('[data-join-room="' + room.id + '"]');
  const discover = async page => (await (await page.request.get(base + listing)).json()).rooms;
  const publicJoin = page => page.request.post(base + listing + "/" + room.id + "/join", {data:{}, headers:{origin:base}});
  const publicCard = b.locator(".public-room").filter({has:button(b)});
  await button(b).waitFor();
  assert.equal(await publicCard.locator(".online-count").innerText(), "1명 온라인");
  assert.doesNotMatch(await publicCard.innerText(), /참가 \d+\/\d+/);
  assert.ok(!JSON.stringify(await discover(b)).includes(code));
  assert.equal((await b.request.get(base + await publicCard.locator("img").getAttribute("src"))).status(), 200);
  // A second tab belongs to the same reader. Closing just one must leave the room listed.
  const extra = await a.context().newPage();
  await extra.goto(base + "/room.html?code=" + code);
  await extra.waitForFunction(() => document.querySelector(".room-count").textContent === "1명 온라인");
  assert.equal((await discover(b)).find(r => r.id === room.id).online, 1);
  await extra.close();
  await a.locator("#invite-manage").click();
  await button(b).waitFor({state:"detached"});
  assert.equal((await publicJoin(b)).status(), 409);
  await a.getByRole("link", {name:"독서방 입장", exact:true}).click();
  await button(b).waitFor();
  await a.locator("#invite-manage").click();
  await a.selectOption("#visibility-select", "PRIVATE");
  await a.waitForFunction(() => !document.querySelector("#visibility-select").disabled);
  await a.getByRole("link", {name:"독서방 입장", exact:true}).click();
  await a.waitForFunction(() => document.querySelector(".room-count").textContent === "1명 온라인");
  assert.equal((await publicJoin(b)).status(), 409);
  await b.goto(base + "/?code=" + code);
  await b.locator("#join-form").waitFor();
  assert.equal(await b.locator('#join-form [name="name"]').count(), 0);
  await b.goto(base + "/");
  await b.locator("#invite-code").fill(code.toLowerCase());
  await b.locator("#code-form button").click();
  await b.locator("#join-form button").click();
  await b.waitForURL(/room\.html/);
  await b.locator(".book-detail .cover-photo img").waitFor();
  assert.equal(await b.locator(".book-detail .cover-photo img").getAttribute("src"), coverUrl);
  await a.waitForFunction(() => document.querySelectorAll(".member").length === 2);
  await a.locator("#invite-manage").click();
  await a.waitForFunction(
    () => document.querySelector("#waiting-count").textContent === "참가자 2/4",
  );
  await a.locator("#edit-room").click();
  assert.equal(await a.locator("#cover-preview img").getAttribute("src"), coverUrl);
  await a.locator("#cover-remove").click();
  assert.equal(await a.locator("#cover-preview .cover-photo").count(), 0);
  await a.locator("#room-settings [data-close]").click();
  await a.locator("#edit-room").click();
  assert.equal(await a.locator("#cover-preview img").getAttribute("src"), coverUrl);
  await a.locator("#room-settings [data-close]").click();
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
  // A host can publish a room even after reading starts.
  await a.locator("#invite-manage").click();
  await a.selectOption("#visibility-select", "PUBLIC");
  await a.waitForFunction(() => !document.querySelector("#visibility-select").disabled);
  await a.getByRole("link", {name:"독서방 입장", exact:true}).click();
  const c = await actor(3);
  await button(c).waitFor();
  await a.evaluate(watchDoor);
  await c.addInitScript(watchDoor);
  await button(c).click();
  await c.waitForURL(/room\.html/);
  for (const page of [a, c]) {
    await page.waitForFunction(() => window.entryPixels?.has("35,44,41") && window.entrySteps.size >= 4);
  }
  await a.waitForFunction(() => document.querySelectorAll(".member").length === 3);
  assert.equal(await a.locator(".member-name").last().textContent(), "사용자 3");
  assert.equal(await a.locator("#holder").textContent(), "사용자 2");
  await b.waitForFunction(() => document.querySelector(".room-count").textContent === "3명 온라인");
  const outsider = await actor(4);
  assert.ok((await discover(outsider)).some(r => r.id === room.id), "one remaining seat before completion");
  assert.equal((await b.request.post(base + "/api/v1/exchanges/" + code + "/visibility",
    { data:{visibility:"PRIVATE"}, headers:{origin:base} })).status(), 403);
  await finish(b, 5, "임시 문구5");
  await c.locator("#complete").waitFor();
  await finish(c, 4, "마지막 독자");
  assert.ok(!(await discover(outsider)).some(r => r.id === room.id), "completed with a spare seat");
  assert.equal((await publicJoin(outsider)).status(), 409);
  await a.goto(base + "/?screen=shelf");
  await a.locator(".shelf-book").click();
  assert.equal(await a.locator("#shelf-cover img").getAttribute("src"), coverUrl);
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
  assert.deepEqual(await b.locator("#ticket-preview").evaluate(el => [...el.getContext("2d").getImageData(125, 83, 1, 1).data]), [34,187,102,255]);
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
  // Two strangers tap the same final public seat. Only one membership is created.
  const small = (await (await outsider.request.post(base + "/api/v1/exchanges", {
    data: { title: "한 자리", capacity: 2, visibility: "PUBLIC" }, headers: { origin: base },
  })).json()).room;
  await outsider.goto(base + "/room.html?code=" + small.code);
  await outsider.waitForFunction(() => document.querySelector(".room-count").textContent === "1명 온라인");
  const race = await Promise.all([a, b].map(page => page.request.post(base + listing + "/" + small.id + "/join",
    { data:{}, headers:{origin:base} })));
  assert.deepEqual(race.map(r => r.status()).sort(), [200, 409]);
  assert.ok(!(await discover(c)).some(r => r.id === small.id), "full room with an online host");
  const homeTab = await outsider.context().newPage();
  await homeTab.goto(base);
  const online = homeTab.locator('[data-room-online="' + small.code + '"]');
  await homeTab.waitForFunction(code => document.querySelector('[data-room-online="' + code + '"]')?.textContent === "1명 온라인", small.code);
  const dot = await online.evaluate(el => {
    const style = getComputedStyle(el, "::before");
    return [style.backgroundColor, style.borderRadius, style.width, getComputedStyle(el).color];
  });
  assert.deepEqual(dot, ["rgb(54, 129, 86)", "50%", "8px", "rgb(73, 51, 38)"]);
  await outsider.goto(base + "/?screen=create");
  await outsider.locator('#create-form [name="title"]').fill("문 테스트");
  await outsider.locator('#create-form [type="submit"]').click();
  await outsider.waitForURL("**/room.html?**");
  const soloCode = new URL(outsider.url()).searchParams.get("code");
  const door = outsider.locator('.interaction-focus[data-target="door"]');
  await door.waitFor();
  await outsider.keyboard.press("e");
  await outsider.locator("#exit-dialog[open]").waitFor();
  await outsider.locator("#exit-home").click();
  await outsider.waitForURL(base + "/");
  const soloLabel = outsider.locator('[data-room-online="' + soloCode + '"]');
  await soloLabel.waitFor();
  assert.equal(await soloLabel.textContent(), "0명 온라인");
  await soloLabel.click();
  await door.waitFor();
  await outsider.locator("#interact").click();
  await outsider.locator("#exit-leave").click();
  assert.match(await outsider.locator("#exit-question").innerText(), /마지막 참가자/);
  await outsider.locator("#exit-home").click();
  await outsider.locator("#exit-leave").click();
  await outsider.getByRole("button", {name:"방과 기록 삭제"}).click();
  await outsider.waitForURL(base + "/");
  await outsider.locator('[data-room-online="' + small.code + '"]').waitFor();
  assert.equal(await soloLabel.count(), 0);
  await homeTab.close();
  assert.deepEqual(errors, []);
  assert.deepEqual(legacyCalls, []);
  console.log(
    "PASS UI: four accounts, public directory, visibility, offline/full/completed rejection, final-seat race, centered desktop/mobile controls, door entry, late join, create/join/reorder/start, cross-context chat/presence/movement, finish/transfer, shelf/review/history/PNG, reload/logout, mobile layout",
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
