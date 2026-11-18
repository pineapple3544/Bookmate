import { chromium } from "playwright";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const folder = await mkdtemp(join(tmpdir(), "bookmate-legacy-test-"));
const child = spawn(
  process.execPath,
  [fileURLToPath(new URL("../server.js", import.meta.url))],
  {
    env: {
      ...process.env,
      API_ORIGIN: "",
      HOST: "127.0.0.1",
      PORT: "0",
      EXCHANGE_DATA_FILE: join(folder, "exchanges.json"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let browser;
try {
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Local server startup timeout")),
      10000,
    );
    child.once("error", reject);
    child.once("exit", (code) =>
      reject(new Error("Local server exited " + code)),
    );
    child.stdout.on("data", (chunk) => {
      const match = String(chunk).match(/localhost:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve("http://127.0.0.1:" + match[1]);
      }
    });
  });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_CHANNEL
      ? { channel: process.env.BROWSER_CHANNEL }
      : {}),
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base + "/?screen=demo&state=complete");
  await page.locator("#history-list .history-reader").waitFor();
  assert.equal(await page.locator("#account-dialog").count(), 0);
  const result = page.waitForEvent("download");
  await page.locator("#ticket-download").click();
  assert.equal(await (await result).failure(), null);
  await page.goto(base + "/?screen=demo&state=ready");
  await page
    .getByRole("button", { name: "교환독서 시작", exact: true })
    .click();
  await page.getByRole("link", { name: "독서방 입장", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".member").length === 4,
  );
  assert.ok(page.url().includes("local=1"));
  await page.locator("#chat-panel").evaluate((el) => (el.open = true));
  await page.waitForFunction(
    () => !document.querySelector("#chat-send").disabled,
  );
  await page.locator("#chat-input").fill("임시 문구1");
  await page.locator("#chat-send").click();
  await page.waitForFunction(
    () =>
      document.querySelector(".chat-message p")?.textContent === "임시 문구1",
  );
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.goto(base + "/?screen=profile");
  await page.locator("#profile-books").getByText("달빛 서점").waitFor();
  await page.locator("#profile-form [name=nickname]").fill("단풍");
  await page.getByLabel("자기소개").fill("그림책을 읽어요.");
  await page.getByLabel("같은 방 참가자에게 프로필 공개").check();
  const saved = page.waitForResponse(r => r.url().endsWith("/exchanges/profile") && r.request().method() === "PATCH");
  await page.getByRole("button", {name:"프로필 저장"}).click();
  assert.ok((await saved).ok());
  const code = await page.evaluate(async () => {
    const {exchangeRequest} = await import("./exchange-client.js");
    const room = await exchangeRequest("", "", {title:"같이 읽기", capacity:2});
    return room.code;
  });
  const visitor = await browser.newPage();
  await visitor.goto(base + "/?code=" + code);
  await visitor.locator("#join-form button").click();
  await visitor.locator("#join-form").waitFor({state:"hidden"});
  const profile = await visitor.evaluate(async code => {
    const {exchangeRequest} = await import("./exchange-client.js");
    const {peerProfile} = await import("./profile.js");
    const room = await exchangeRequest(code);
    if (room.members[0].name !== "단풍") throw new Error("legacy membership nickname mismatch");
    return peerProfile(room, 0);
  }, code);
  assert.equal(profile.bio, "그림책을 읽어요.");
  assert.equal(profile.currentBookTitle, "햇살 책모임");
  assert.equal(profile.books[0].title, "달빛 서점");
  assert.deepEqual(errors, []);
  console.log(
    "PASS standalone without API/DB: local JSON exchange, demo start/history/ticket, room/chat, mobile layout",
  );
} finally {
  await browser?.close();
  if (child.exitCode === null) {
    const ended = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await ended;
  }
  // Only the unique temporary directory created by this test is removed.
  await rm(join(folder, "exchanges.json"), { force: true });
  await rm(join(folder, "exchanges.json.tmp"), { force: true });
  await rmdir(folder);
}
