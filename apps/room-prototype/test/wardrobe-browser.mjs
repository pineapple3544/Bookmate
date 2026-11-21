import assert from "node:assert/strict";
import { chromium } from "playwright";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { config } from "dotenv";
import { createDatabase } from "../../server/dist/db.js";
config({ path: new URL("../../../.env", import.meta.url), quiet: true });
const db = createDatabase(process.env.DATABASE_URL);
const owners = [];
const roomIds = [];

const base = process.env.BASE_URL ?? "http://127.0.0.1:5173";
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL });
async function actor() {
  const id = randomUUID(), raw = randomBytes(32).toString("hex");
  await db.user.create({ data: {
    id, email: id + "@example.test", nickname: "사용자 " + (owners.length + 1),
    passwordHash: "fixture", sessions: { create: {
      tokenHash: createHash("sha256").update(raw).digest("hex"),
      expiresAt: new Date(Date.now() + 3600000),
    } },
  } });
  owners.push(id);
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: "bookmate_session", value: raw, url: base, httpOnly: true, sameSite: "Strict" }]);
  return await context.newPage();
}

async function request(page, path, body) {
  const response = await page.request.fetch(base + "/api/v1" + path, {
    method: body ? "POST" : "GET", headers: { origin: base }, data: body,
  });
  assert.ok(response.ok(), await response.text());
  return response.json();
}
async function create(page, title) {
  const { room } = await request(page, "/exchanges", { title, name: "사용자", capacity: 2 });
  roomIds.push(room.id);
  return "/exchanges/" + room.code;
}
async function assertNameCentered(page, canvasId, nameId) {
  const offset = await page.evaluate(([canvasId, nameId]) => {
    const canvas = document.getElementById(canvasId);
    const name = document.getElementById(nameId).getBoundingClientRect();
    const { width, height } = canvas;
    const pixels = canvas.getContext("2d").getImageData(0, 0, width, height).data;
    // The bottom row through the avatar's shoes gives its body centre independently of the pet and headgear.
    for (let y = height - 1; y >= 0; y--) {
      const xs = [];
      for (let x = 0; x < width * 0.78; x++) if (pixels[4 * (y * width + x) + 3]) xs.push(x);
      if (xs.length) {
        const bounds = canvas.getBoundingClientRect();
        return bounds.left + (xs[0] + xs.at(-1) + 1) / 2 / width * bounds.width - (name.left + name.width / 2);
      }
    }
    throw new Error("Empty avatar portrait");
  }, [canvasId, nameId]);
  assert.ok(Math.abs(offset) < 2.5, canvasId + " nickname offset: " + offset);
}
async function selectHair(page, value) {
  const item = page.locator(`#avatar-form label:has(> input[name="hairstyle"][value="${value}"])`);
  await item.click();
}
async function save(page, path) {
  const response = page.waitForResponse(r => r.url().endsWith(path) && r.request().method() !== "GET");
  await page.locator('#avatar-form [type="submit"]').click();
  assert.ok((await response).ok());
}
async function defaultStyle(page) {
  return (await request(page, "/me/appearance")).appearance;
}
async function assertRoomStyle(page, path, id, name) {
  const {room} = await request(page, path);
  assert.equal(room.members.find(m => m.id === id).appearance?.hairstyle, name);
}

try {
  const page = await browser.newPage({ hasTouch: true, viewport: { width: 390, height: 844 } });
  await page.goto(base + "/room.html");
  await page.locator(".avatar-label").first().waitFor({ state: "attached" });
  const cabinet = page.locator(".world-stage #customize-avatar");
  assert.equal(await cabinet.count(), 1, "the wardrobe belongs to the room");
  const action = page.getByRole("button", { name: /상호작용/ });
  const focus = page.locator(".interaction-focus");
  assert.equal(await action.count(), 1, "one contextual interaction button");
  assert.equal(await action.isDisabled(), true);
  await page.locator("#room").focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter"); // Walk to the cabinet, without opening it.
  await page.waitForFunction(() => document.querySelector(".interaction-focus")?.dataset.target === "wardrobe");
  assert.equal(await page.locator("#avatar-dialog").evaluate(el => el.open), false);
  await page.locator("#chat-input").focus();
  await page.keyboard.press("e");
  assert.equal(await page.locator("#avatar-dialog").evaluate(el => el.open), false);
  await page.locator("#room").focus();
  await page.keyboard.press("e");
  await page.locator("#avatar-dialog[open]").waitFor();
  await page.keyboard.press("Escape");
  await action.tap();
  await page.locator("#avatar-dialog[open]").waitFor();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 900 });
  const roomCanvas = page.locator("#room");
  const bounds = await roomCanvas.boundingBox();
  await page.mouse.click(bounds.x + bounds.width * 384 / 640, bounds.y + bounds.height * 310 / 400);
  await page.waitForFunction(() => document.querySelector(".interaction-focus").dataset.target === "chair-3" &&
    document.querySelector("#action-state").textContent === "이동 가능");
  assert.equal(await focus.isVisible(), true);
  await action.click();
  await page.waitForFunction(() => document.querySelector("#action-state").textContent === "착석");
  assert.equal(await focus.getAttribute("data-target"), "chair-3");
  await roomCanvas.focus();
  await page.keyboard.press("e");
  await page.waitForFunction(() => document.querySelector("#action-state").textContent === "이동 가능");
  await page.mouse.click(bounds.x + bounds.width * 480 / 640, bounds.y + bounds.height * 328 / 400);
  await page.waitForFunction(() => document.querySelector(".interaction-focus").hidden);
  assert.equal(await action.isDisabled(), true);
  await page.getByRole("link", {name:"프로필",exact:true}).click();
  await page.locator("#wardrobe-view #avatar-form").waitFor();
  assert.equal(await page.locator("#account-dialog").count(), 0);
  console.log("PASS proximity focus, explicit chair/wardrobe action, chat key isolation, leaving range and local navigation");
  const host = await actor(), guest = await actor();
  const pet = { id: 'exchange:["은하수","테스트"]', title:"은하수", color:"#9db795", art:"#80586c" };
  const inventoryKey = "bookmate-book-pets-v1:" + owners[0];
  const finished = await db.room.create({ data: { title: "서재 검증", bookTitle: "서재 검증",
    author: "사용자 1", exchangeCode: randomBytes(4).toString("hex").toUpperCase(), completedAt: new Date(),
    members: { create: { userId: owners[0], readingOrder: 1, readingCompletedAt: new Date() } } } });
  roomIds.push(finished.id);
  await host.goto(base);
  await host.evaluate(([key, book]) => localStorage.setItem(key, JSON.stringify([book])), [inventoryKey, pet]);
  await host.getByRole("link", {name:"프로필", exact:true}).click();
  assert.equal(await host.getByLabel("같은 방 참가자에게 프로필 공개").isChecked(), false);
  await host.locator("#profile-books").getByText("서재 검증").waitFor();
  await host.locator("#profile-form").getByLabel("닉네임", {exact:true}).fill("고래");
  await host.getByLabel("자기소개").fill("단편을 읽어요.");
  await host.getByLabel("같은 방 참가자에게 프로필 공개").check();
  const savedProfile = host.waitForResponse(r => r.url().endsWith("/me/profile") && r.request().method() === "PATCH");
  await host.getByRole("button", {name:"프로필 저장"}).click();
  assert.ok((await savedProfile).ok());
  await selectHair(host, "braids");
  await assertNameCentered(host, "avatar-preview", "avatar-owner");
  await host.locator(".avatar-categories").getByRole("button", {name:"펫",exact:true}).click();
  await host.locator("label.avatar-tile").filter({hasText:pet.title}).click();
  await host.route("**/api/v1/me/appearance", route => route.fulfill({
    status:503, contentType:"application/json", body:JSON.stringify({error:{message:"저장 실패"}}),
  }), { times:1 });
  await host.locator('#avatar-form [type="submit"]').click();
  await host.locator("#avatar-status:not([hidden])").waitFor();
  assert.equal(await host.locator('#avatar-form input[name="hairstyle"]:checked').inputValue(), "braids");
  assert.equal(await host.locator('#avatar-form input[name="pet"]:checked').inputValue(), pet.id);
  await save(host, "/me/appearance");
  assert.equal((await defaultStyle(host)).hairstyle, "braids");
  const a = await create(host, "옷장 검증 A");
  await request(guest, a + "/join", {name:"사용자 2"});
  await request(host, a + "/start", {});
  const code = a.split("/").at(-1);
  const initialRoom = (await request(host, a)).room;
  // A membership created before profiles may still have a room-specific alias.
  await db.roomMember.update({ where:{roomId_userId:{roomId:initialRoom.id,userId:owners[0]}},
    data:{displayName:"예전 별칭"} });
  assert.equal((await request(guest, a)).room.members[0].name, "고래");
  await Promise.all([host,guest].map(p => p.goto(base + "/room.html?code=" + code)));
  await assertRoomStyle(guest, a, owners[0], "braids");
  await guest.locator(".pet-book-label").filter({hasText:pet.title}).first().waitFor();
  await guest.waitForFunction(() => document.querySelector(".room-count")?.textContent === "2명 온라인");
  const peerPath = "/rooms/" + (await request(guest, a)).room.id + "/members/" + owners[0] + "/profile";
  const outsider = await actor();
  assert.equal((await outsider.request.get(base + "/api/v1" + peerPath)).status(), 403);
  const ownSeat = guest.locator("#room");
  const scene = await ownSeat.boundingBox();
  await guest.mouse.click(scene.x + scene.width * 264 / 640, scene.y + scene.height * 184 / 400);
  await guest.waitForFunction(() => document.querySelector(".interaction-focus")?.dataset.target === "player-0"
    && document.querySelector("#action-state").textContent === "이동 가능");
  assert.equal(await guest.locator("#peer-profile").evaluate(el => el.open), false);
  await guest.keyboard.press("e");
  await guest.getByRole("heading", {name:"고래", exact:true}).waitFor();
  await guest.getByText("단편을 읽어요.", {exact:true}).waitFor();
  await guest.locator("#peer-books").getByText("서재 검증").waitFor();
  assert.equal(await guest.locator("#peer-current-book").textContent(), "옷장 검증 A");
  assert.equal((await request(guest, "/me/profile")).currentBookTitle, null);
  for (const width of [390, 1440]) {
    await guest.setViewportSize({width, height:900});
    await assertNameCentered(guest, "peer-avatar", "peer-name");
    assert.ok(await guest.evaluate(() => {
      const box = id => document.getElementById(id).getBoundingClientRect();
      const avatar = box("peer-avatar"), bubble = box("peer-bio"), shelf = box("peer-books"), reading = box("peer-current-book");
      return bubble.left >= avatar.right && shelf.top > avatar.bottom && reading.top >= shelf.bottom &&
        document.getElementById("peer-profile").scrollWidth <= document.getElementById("peer-profile").clientWidth;
    }));
  }
  await guest.locator("#peer-books .shelf-book").first().click();
  assert.equal(await guest.locator("#peer-book-detail").textContent(), "서재 검증 · 사용자 1");
  assert.deepEqual((await request(guest, peerPath)).books, [{ title: "서재 검증", author: "사용자 1", theme: "mint" }]);
  await guest.keyboard.press("Escape");
  assert.ok((await host.request.patch(base + "/api/v1/me/profile", {headers:{origin:base},
    data:{nickname:"새 고래", bio:"단편을 읽어요.", profilePublic:false}})).ok());
  assert.deepEqual(await request(guest, peerPath), {profilePublic:false});
  await guest.locator("#interact").click();
  await guest.getByText("비공개 프로필입니다.").waitFor();
  assert.equal(await guest.locator("#peer-books").textContent(), "");
  await guest.waitForFunction(() => document.querySelector(".avatar-label").firstChild.nodeValue === "새 고래");
  await guest.keyboard.press("Escape");
  console.log("PASS owner shelf, opt-in, proximity profile, revocation, outsider access");
  const remotePortrait = guest.locator("canvas.member-avatar").first();
  const before = await remotePortrait.evaluate(c => c.toDataURL());
  await host.setViewportSize({ width: 375, height: 812 });
  const cabinetCenter = await host.waitForFunction(() => {
    const button = document.querySelector(".wardrobe-hit");
    const r = button.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    return button === document.elementFromPoint(x, y) && { x, y };
  });
  const { x, y } = await cabinetCenter.jsonValue();
  await host.touchscreen.tap(x, y);
  await host.waitForFunction(() => document.querySelector(".interaction-focus")?.dataset.target === "wardrobe");
  assert.equal(await host.locator("#avatar-dialog").evaluate(el => el.open), false);
  await host.getByRole("button", {name:/상호작용/}).tap();
  await host.locator("#avatar-dialog[open]").waitFor();
  await selectHair(host, "bun");
  await assertNameCentered(host, "avatar-preview", "avatar-owner");
  await save(host, a + "/appearance");
  await guest.waitForFunction(before => document.querySelector("canvas.member-avatar").toDataURL() !== before, before);
  await assertRoomStyle(guest, a, owners[0], "bun");
  assert.equal((await defaultStyle(host)).hairstyle, "braids");
  const b = await create(guest, "옷장 검증 B");
  await request(host, b + "/join", {name:"사용자 1"});
  await assertRoomStyle(host, b, owners[0], "braids");
  assert.equal((await request(guest, b)).room.members.find(m => m.id === owners[0]).name, "새 고래");
  await host.getByRole("link",{name:"프로필",exact:true}).click();
  // The server default survives browser data loss, including its equipped pet.
  await host.evaluate(key => localStorage.removeItem(key), inventoryKey);
  await host.reload();
  await selectHair(host, "pigtails");
  await save(host, "/me/appearance");
  await selectHair(host, "bun");
  await host.keyboard.press("Escape");
  assert.equal(await host.locator('#avatar-form input[name="hairstyle"]:checked').inputValue(), "pigtails");
  const retained = await defaultStyle(host);
  assert.equal(retained.hairstyle, "pigtails");
  assert.equal(retained.pet, pet.id);
  assert.equal(retained.petLook.color, pet.color);
  await host.reload();
  await host.locator('#avatar-form input[name="hairstyle"][value="pigtails"]:checked').waitFor({ state:"attached" });
  await request(host, b + "/join", {name:"사용자 1"});
  await assertRoomStyle(host, b, owners[0], "braids");
  await assertRoomStyle(guest, a, owners[0], "bun");
  assert.equal(await defaultStyle(guest), null);
  console.log("PASS home default, room-only appearance, remote avatar, new join, repeat join, cancel and reload");
} finally {
  await browser.close();
  await db.room.deleteMany({where:{id:{in:roomIds}}});
  await db.user.deleteMany({where:{id:{in:owners}}});
  await db.$disconnect();
}
