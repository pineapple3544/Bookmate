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
const base = process.env.BASE_URL ?? "http://127.0.0.1:5173";
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
  await b.locator('[data-direction="up"]').click();
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
  await send(b, "임시 문구2");
  await a.waitForFunction(
    () =>
      document.querySelector(".speech-bubble")?.textContent === "임시 문구2",
  );
  await a.waitForFunction(
    () => !document.querySelector(".speech-bubble"),
    {},
    { timeout: 8000 },
  );
  assert.equal(await a.locator(".chat-message").count(), 2);
  await b.close();
  await a.waitForFunction(
    () => document.querySelector(".room-count").textContent === "1명 온라인",
  );
  assert.ok((await a.locator(".member-avatar.offline").count()) === 3);
  // Distinct page records and drawing survive reload; deleting one leaves the other.
  await a.locator("#record").click();
  await a.locator("#page").fill("2");
  await a.locator("#page").blur();
  await a.waitForFunction(
    () => !document.querySelector('#record-form [type="submit"]').disabled,
  );
  await a.locator("#note").fill("임시 문구2");
  const drawing = await a.locator("#drawing").boundingBox();
  await a.mouse.move(drawing.x + 20, drawing.y + 20);
  await a.mouse.down();
  await a.mouse.move(drawing.x + 100, drawing.y + 60, { steps: 10 });
  await a.mouse.up();
  const png = await a.locator("#drawing").evaluate((el) => el.toDataURL());
  await a.locator('#record-form [type="submit"]').click();
  await a.waitForFunction(() => !document.querySelector("#record-dialog").open);
  await a.locator("#record").click();
  await a.locator("#page").fill("3");
  await a.locator("#page").blur();
  await a.waitForFunction(
    () => !document.querySelector('#record-form [type="submit"]').disabled,
  );
  await a.locator("#note").fill("임시 문구3");
  await a.locator('#record-form [type="submit"]').click();
  await a.waitForFunction(() => !document.querySelector("#record-dialog").open);
  await ready(a);
  await a.locator("#record").click();
  await a.waitForFunction(
    () => !document.querySelector('#record-form [type="submit"]').disabled,
  );
  assert.equal(await a.locator("#note").inputValue(), "임시 문구3");
  await a.locator("#page").fill("2");
  await a.locator("#page").blur();
  await a.waitForFunction(
    () =>
      document.querySelector("#note").value === "임시 문구2" &&
      !document.querySelector('#record-form [type="submit"]').disabled,
  );
  assert.equal(
    await a.locator("#drawing").evaluate((el) => el.toDataURL()),
    png,
  );
  await a.locator("#delete-record").click();
  await a.waitForFunction(() => !document.querySelector("#record-dialog").open);
  const surviving = await a.evaluate(async () => {
    const { recordRequest } = await import("./records.js");
    return [
      await recordRequest("get", [0, 2]),
      await recordRequest("get", [0, 3]),
    ];
  });
  assert.equal(surviving[0], undefined);
  assert.equal(surviving[1].text, "임시 문구3");
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
    "PASS: no API; local chat persistence/pagination/retry; two-tab presence/movement; speech fade; page records/drawings/delete; offline send; responsive widths",
  );
} finally {
  await context.close();
  await browser.close();
}
