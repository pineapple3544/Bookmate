import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_CHANNEL
    ? { channel: process.env.BROWSER_CHANNEL }
    : {}),
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
});
const errors = [],
  apiRequests = [];
context.on("page", (page) => {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.url().includes("/api/")) apiRequests.push(request.url());
  });
  page.on("dialog", (dialog) => dialog.accept());
});
const base = new URL(
  "/room.html",
  process.env.BASE_URL ?? "http://127.0.0.1:5173",
).href;
await context.route("**/api/**", (route) => route.abort());
async function ready(page) {
  await page.goto(base);
  await page.waitForFunction(
    () => !document.querySelector("#chat-send").disabled,
  );
}
async function send(page, text) {
  await page.locator("#chat-panel").evaluate((el) => (el.open = true));
  await page.locator("#chat-input").fill(text);
  await page.locator("#chat-send").click();
  await page.waitForFunction(
    (text) =>
      [...document.querySelectorAll(".chat-message p")].some(
        (el) => el.textContent === text,
      ),
    text,
  );
}
try {
  const a = await context.newPage();
  await ready(a);
  const avatar = a.locator(".avatar-label.active");
  const x = () => avatar.evaluate(el => parseFloat(el.style.left) * 6.4);
  async function waitForX(value, sign) {
    await a.waitForFunction(({ value, sign }) =>
      sign * (parseFloat(document.querySelector(".avatar-label.active").style.left) * 6.4 - value) >= 0,
      { value, sign }, { timeout: 2500 });
  }
  async function stoppedX() {
    await a.evaluate(() => new Promise(requestAnimationFrame));
    const released = await x();
    await a.waitForTimeout(160);
    assert.equal(await x(), released, "avatar drifted after release");
    return released;
  }
  const initialX = await x();
  await a.keyboard.down("ArrowRight");
  await waitForX(initialX + 32, 1);
  await a.keyboard.up("ArrowRight");
  const keyboardEnd = await stoppedX();
  const left = await a.locator('[data-direction="left"]').boundingBox();
  await a.mouse.move(left.x + left.width / 2, left.y + left.height / 2);
  await a.mouse.down();
  await a.mouse.move(left.x - 20, left.y - 20);
  await waitForX(keyboardEnd - 32, -1);
  await a.mouse.up();
  const pointerEnd = await stoppedX();
  await a.keyboard.press("ArrowRight");
  const tapEnd = await stoppedX();
  assert.ok(tapEnd > pointerEnd && tapEnd < pointerEnd + 16, "tap should move briefly");
  await a.keyboard.down("ArrowRight");
  await waitForX(tapEnd + 5, 1);
  await a.evaluate(() => window.dispatchEvent(new Event("blur")));
  await stoppedX();
  await a.keyboard.up("ArrowRight");
  const beforeChat = await x();
  await a.locator("#chat-panel").evaluate(el => { el.open = true; });
  await a.locator("#chat-input").focus();
  await a.keyboard.down("ArrowLeft");
  await a.waitForTimeout(150);
  await a.keyboard.up("ArrowLeft");
  assert.equal(await x(), beforeChat, "chat editing must keep arrow keys");
  await a.locator("#room").focus();
  await a.keyboard.down("ArrowLeft");
  await waitForX(beforeChat - 5, -1);
  await a.mouse.move(left.x + left.width / 2, left.y + left.height / 2);
  await a.mouse.down();
  await a.keyboard.up("ArrowLeft");
  const pointerOnly = await x();
  await waitForX(pointerOnly - 12, -1);
  await a.mouse.up();
  await stoppedX();
  console.log("PASS desktop movement: holds, outside release, short tap, overlapping controls, chat and focus loss");
  for (const viewport of [
    { width: 1280, height: 800 }, { width: 1440, height: 900 },
    { width: 375, height: 812 }, { width: 390, height: 844 },
  ]) {
    await a.setViewportSize(viewport);
    for (const selector of ["#interact", "#record", "#complete", "#chat-send"]) {
      const reachable = await a.locator(selector).evaluate(button => {
        const rect = button.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return rect.width >= 44 && rect.height >= 44 && button.contains(hit);
      });
      assert.ok(reachable, `${selector} at ${viewport.width}×${viewport.height}`);
    }
  }
  await send(a, "임시 문구1");
  await a.waitForSelector(".speech-bubble");
  const b = await context.newPage();
  await ready(b);
  assert.equal(
    await b.locator(".speech-bubble").count(),
    0,
    "History must not replay speech",
  );
  await b.locator(".member").nth(1).click();
  await a.waitForFunction(
    () => document.querySelector(".room-count").textContent === "2명 온라인",
  );
  await b.setViewportSize({ width: 375, height: 812 });
  await b.waitForFunction(() => document.querySelectorAll(".avatar-label:not([hidden])").length === 2);
  const other = b.locator(".avatar-label").nth(2);
  const tap = await other.evaluate(el => {
    const room = document.querySelector("#room").getBoundingClientRect();
    return {
      x: room.left + room.width * parseFloat(el.style.left) / 100,
      y: room.top + room.height * (parseFloat(el.style.top) / 100 + 22 / 400),
    };
  });
  await b.mouse.click(tap.x, tap.y);
  await other.waitFor({ state: "visible" });
  assert.equal(await b.locator("#selected-label").textContent(), "사용자 2");
  const directions = b.locator("#movement-toggle");
  assert.equal(await b.locator("#movement").isVisible(), false);
  await directions.press("Enter");
  assert.equal(await directions.getAttribute("aria-expanded"), "true");
  await b.locator('[data-direction="up"]').click();
  await directions.press("Space");
  assert.equal(await b.locator("#movement").isVisible(), false);
  await b.waitForFunction(
    () => document.querySelector("#action-state").textContent === "이동 가능",
  );
  const y = await b
    .locator(".avatar-label")
    .nth(1)
    .evaluate((el) => el.style.top);
  await a.waitForFunction(
    (y) => document.querySelectorAll(".avatar-label")[1].style.top === y,
    y,
  );
  await a.locator(".avatar-label").nth(1).waitFor({ state: "hidden" });
  await send(b, "임시 문구2");
  await a.locator(".avatar-label").nth(1).waitFor({ state: "visible" });
  await a.waitForFunction(
    () =>
      document.querySelector(".speech-bubble")?.textContent === "임시 문구2",
  );
  await a.waitForFunction(
    () => !document.querySelector(".speech-bubble"),
    {},
    { timeout: 8000 },
  );
  await a.locator(".avatar-label").nth(1).waitFor({ state: "hidden" });
  await a.setViewportSize({ width: 1280, height: 900 });
  assert.equal(await a.locator(".chat-message").count(), 2);
  await b.close();
  await a.waitForFunction(
    () => document.querySelector(".room-count").textContent === "1명 온라인",
  );
  assert.ok((await a.locator(".member-avatar.offline").count()) === 3);
  // Publish a photo, then reply with a drawing over the original.
  const image = await a.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 80;
    canvas.height = 60;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#f0dab9";
    ctx.fillRect(0, 0, 80, 60);
    return canvas.toDataURL().split(",")[1];
  });
  const file = {
    name: "page.png",
    mimeType: "image/png",
    buffer: Buffer.from(image, "base64"),
  };
  async function selectPage(number) {
    await a.locator("#page").fill(String(number));
    await a.locator("#page").blur();
    await a.waitForFunction(() => !document.querySelector("#page").disabled);
  }
  async function upload() {
    await a.locator("#record-photo").setInputFiles(file);
    await a.locator('#record-form [type="submit"]').click();
    await a.locator("#record-dialog").waitFor({ state: "hidden" });
  }
  // Restore an earlier text/drawing row, then verify coexistence with photo posts.
  await a.evaluate(async (image) => {
    const { openDatabase } = await import("./local-transport.js");
    const db = await openDatabase();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("records", "readwrite");
      tx.objectStore("records").put({
        slot: 0,
        page: 3,
        text: "임시 문구7",
        drawing: "data:image/png;base64," + image,
      });
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
  }, image);
  await a.locator("#record").click();
  await a.locator("#text-records").click();
  await a.waitForFunction(
    () => !document.querySelector('#text-record-dialog [name="page"]').disabled,
  );
  await a.locator('#text-record-dialog [name="page"]').fill("3");
  await a.locator('#text-record-dialog [name="page"]').blur();
  await a.waitForFunction(
    () =>
      document.querySelector('#text-record-dialog [name="text"]').value ===
      "임시 문구7",
  );
  await a.locator('#text-record-dialog [name="text"]').fill("임시 문구8");
  await a.locator('#text-record-dialog [type="submit"]').click();
  await a.locator("#text-record-dialog").waitFor({ state: "hidden" });
  await a.locator("#record-publish").click();
  await selectPage(2);
  await upload();
  await a.locator(".record-open-post").filter({ hasText: "p. 2" }).click();
  for (const width of [320, 390, 1280]) {
    await a.setViewportSize({width, height:844});
    assert.ok(await a.locator("#reply-text").evaluate(el => {
      const input = el.getBoundingClientRect(), card = el.closest("#record-detail").getBoundingClientRect();
      return input.width > 0 && input.left >= card.left && input.right <= card.right + 1;
    }), "comment field fits at " + width);
  }
  await a.locator("#reply-text").fill("사진 위에 표시했어요.");
  await a.locator("#reply-photo").setInputFiles(file);
  await a.locator("#reply-attach").click();
  await a.locator("#toggle-drawing").click();
  await a.locator("#drawing").scrollIntoViewIfNeeded();
  const drawing = await a.locator("#drawing").boundingBox();
  await a.mouse.move(drawing.x + 20, drawing.y + 20);
  await a.mouse.down();
  await a.mouse.move(drawing.x + 100, drawing.y + 60, { steps: 10 });
  await a.mouse.up();
  const png = await a.locator("#drawing").evaluate((el) => el.toDataURL());
  assert.notEqual(png.split(",")[1], image);
  await a.locator("#save-drawing").click();
  await a.locator(".record-open-post .record-photo-layer").waitFor();
  await a.locator('.record-reply [type="submit"]').click();
  await a.waitForSelector(".record-comment");
  assert.equal(await a.locator(".record-comment img").count(), 1);
  await a.locator("#record-publish").click();
  await selectPage(3);
  await upload();
  await ready(a);
  await a.locator("#record").click();
  const second = a
    .locator(".record-post")
    .filter({ has: a.getByText("p. 2", { exact: true }) });
  const third = a
    .locator(".record-post")
    .filter({ has: a.getByText("p. 3", { exact: true }) });
  await third.getByAltText("p. 3 기록 사진", { exact: true }).waitFor();
  await second.locator(".record-image:not(.record-photo-layer)").waitFor();
  await second.locator(".record-open-post").click();
  assert.equal(
    await a.locator(".record-comment p").textContent(),
    "사진 위에 표시했어요.",
  );
  const photos = await a
    .locator(".record-open-post[aria-pressed='true'] img, #record-detail img")
    .evaluateAll(async (images) => {
      const sources = [];
      for (const img of images) {
        const blob = await (await fetch(img.src)).blob();
        const data = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
        sources.push(data);
      }
      return sources;
    });
  assert.equal(photos[0].split(",")[1], image);
  assert.equal(photos[1], png);
  assert.equal(photos[2].split(",")[1], image);
  await second.getByRole("button", { name: "p. 2 게시물 삭제" }).click();
  await second.waitFor({ state: "detached" });
  const surviving = await a.evaluate(async () => {
    const { recordRequest } = await import("./records.js");
    const records = await Promise.all([
      recordRequest("get", [0, 2]),
      recordRequest("get", [0, 3]),
    ]);
    return records.map((record) => record?.photo.type);
  });
  assert.equal(surviving[0], undefined);
  assert.equal(surviving[1], "image/png");
  await a.locator("#text-records").click();
  await a.waitForFunction(
    () => !document.querySelector('#text-record-dialog [name="page"]').disabled,
  );
  await a.locator('#text-record-dialog [name="page"]').fill("3");
  await a.locator('#text-record-dialog [name="page"]').blur();
  await a.waitForFunction(
    () =>
      document.querySelector('#text-record-dialog [name="text"]').value ===
      "임시 문구8",
  );
  await a.locator("#text-record-dialog [data-delete]").click();
  await a.locator("#text-record-dialog").waitFor({ state: "hidden" });
  const remainingPhoto = await a.evaluate(async () => {
    const { recordRequest } = await import("./records.js");
    const post = await recordRequest("get", [0, 3]);
    return { type: post.photo.type, text: post.text };
  });
  assert.deepEqual(remainingPhoto, { type: "image/png", text: undefined });
  await a.locator("#record-feed .close").click();
  // Concurrent inserts and retry IDs use IndexedDB transaction ordering.
  const results = await a.evaluate(async () => {
    const { localRequest } = await import("./local-transport.js");
    const body = { id: crypto.randomUUID(), senderSlot: 0, text: "임시 문구4" };
    const posts = Array.from({ length: 55 }, (_, i) =>
      localRequest("/api/v1/prototype/chat", {
        method: "POST",
        body: JSON.stringify({
          ...body,
          id: crypto.randomUUID(),
          text: "임시 문구" + (i + 5),
        }),
      }),
    );
    const duplicate = () =>
      localRequest("/api/v1/prototype/chat", {
        method: "POST",
        body: JSON.stringify(body),
      });
    const all = await Promise.all([...posts, duplicate(), duplicate()]);
    return all.map((data) => data.message.sequence);
  });
  assert.equal(results.at(-1), results.at(-2));
  assert.equal(new Set(results).size, 56);
  await ready(a);
  assert.equal(await a.locator(".chat-message").count(), 50);
  assert.equal(await a.locator(".speech-bubble").count(), 0);
  await a.locator("#chat-older").click();
  await a.waitForFunction(
    () => document.querySelectorAll(".chat-message").length === 58,
  );
  await context.setOffline(true);
  await send(a, "임시 문구60");
  await context.setOffline(false);
  for (const width of [320, 390, 768, 1440]) {
    await a.setViewportSize({ width, height: 900 });
    assert.ok(
      await a.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `Overflow at ${width}`,
    );
  }
  assert.deepEqual(apiRequests, []);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: no API; local chat persistence/pagination/retry; two-tab presence/movement; speech fade; page photos/replies/annotations/delete; offline send; responsive widths",
  );
} finally {
  await context.close();
  await browser.close();
}
