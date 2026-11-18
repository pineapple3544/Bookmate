import { chromium } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { createDatabase } from "../../server/dist/db.js";
config({ path: new URL("../../../.env", import.meta.url), quiet: true });
const base = process.env.BASE_URL ?? "http://127.0.0.1:5173",
  db = createDatabase(process.env.DATABASE_URL);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_CHANNEL
    ? { channel: process.env.BROWSER_CHANNEL }
    : {}),
});
const contexts = [],
  ids = [],
  errors = [],
  metadataBodies = [];
let roomId;
async function actor(n) {
  const context = await browser.newContext();
  contexts.push(context);
  const data = {
    email: randomUUID() + "@example.com",
    password: "p2p-browser-password",
    nickname: "사용자 " + n,
  };
  let response = await context.request.post(base + "/api/v1/auth/register", {
    data,
    headers: { origin: base },
  });
  assert.equal(response.status(), 201, await response.text());
  ids.push((await response.json()).user.id);
  response = await context.request.post(base + "/api/v1/auth/login", {
    data,
    headers: { origin: base },
  });
  assert.equal(response.status(), 200);
  return { context, data, id: ids.at(-1) };
}
async function api(actor, path, data) {
  const response =
    data === undefined
      ? await actor.context.request.get(base + "/api/v1" + path)
      : await actor.context.request.post(base + "/api/v1" + path, {
          data,
          headers: { origin: base },
        });
  assert.ok(response.ok(), await response.text());
  return response.json();
}
async function open(actor, code) {
  const page = await actor.context.newPage();
  page.setDefaultTimeout(60000);
  await page.addInitScript(() => {
    window.recordFrames = [];
    const capture = (direction, data) => {
      if (typeof data !== "string") return;
      const frame = JSON.parse(data);
      window.recordFrames.push({ direction, ...frame });
    };
    const observe = (channel) => {
      if (channel.label === "bookmate-records-v1")
        channel.addEventListener("message", (e) => capture("receive", e.data));
    };
    const create = RTCPeerConnection.prototype.createDataChannel;
    RTCPeerConnection.prototype.createDataChannel = function (...args) {
      const channel = create.apply(this, args);
      observe(channel);
      return channel;
    };
    window.RTCPeerConnection = new Proxy(RTCPeerConnection, {
      construct(target, args) {
        const pc = Reflect.construct(target, args);
        pc.addEventListener("datachannel", (e) => observe(e.channel));
        return pc;
      },
    });
    const send = RTCDataChannel.prototype.send;
    RTCDataChannel.prototype.send = function (data) {
      if (this.label === "bookmate-records-v1") capture("send", data);
      return send.call(this, data);
    };
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().includes("/record-ops") && r.method() === "POST")
      metadataBodies.push(r.postData());
  });
  await page.goto(base + "/room.html?code=" + code);
  await page.waitForSelector("#record-sync-status", { state: "attached" });
  return page;
}
const all = (page) =>
  page.evaluate(async () => {
    const { recordRequest } = await import("./records.js");
    return recordRequest("list");
  });
async function cacheState(page) {
  return page.evaluate(async () => {
    const { getSharedRecords } = await import("./record-bridge.js");
    const { openDatabase } = await import("./local-transport.js");
    const store = getSharedRecords();
    await store.pull(true);
    const db = await openDatabase();
    const keys = (name) => new Promise((resolve, reject) => {
      const req = db.transaction(name).objectStore(name).getAllKeys();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return {
      bodies: await keys("recordBodies"), pending: await keys("recordOutbox"),
      legacy: await keys("records"), inventory: store.inventory(), missing: store.missing(),
      frames: window.recordFrames,
    };
  });
}
async function assertErased(page, ids, fresh = false) {
  const state = await cacheState(page);
  for (const id of ids) {
    for (const field of ["bodies", "pending", "inventory", "missing"])
      assert.ok(!state[field].includes(id), field + " contains deleted " + id);
    if (fresh)
      assert.ok(!state.frames.some((f) => f.id === id || f.ids?.includes(id)),
        "RTC advertised, requested or sent deleted " + id);
  }
  return state;
}
async function waitRecords(page, predicate) {
  const deadline =
    Date.now() + (predicate.includes("legacy resume") ? 20000 : 90000);
  while (Date.now() < deadline) {
    const ok = await page.evaluate(async (predicate) => {
      try {
        const { recordRequest } = await import("./records.js");
        return Boolean(
          new Function("rows", "return " + predicate)(
            await recordRequest("list"),
          ),
        );
      } catch {
        return false;
      }
    }, predicate);
    if (ok) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw Error(
    "Record sync timeout: " +
      predicate +
      " / " +
      (await page.locator("#record-sync-status").textContent()),
  );
}
try {
  const a = await actor(1),
    b = await actor(2),
    c = await actor(3);
  const room = (
    await api(a, "/exchanges", {
      title: "P2P test",
      name: "사용자 1",
      capacity: 3,
      theme: "mint",
    })
  ).room;
  roomId = room.id;
  for (const [person, name] of [
    [b, "사용자 2"],
    [c, "사용자 3"],
  ])
    await api(person, "/exchanges/" + room.code + "/join", { name });
  await api(a, "/exchanges/" + room.code + "/start", {});
  let pa = await open(a, room.code),
    pb = await open(b, room.code);
  // Interrupt legacy import after its photo was registered, then resume on reload.
  let blockNotes = true,
    noteFailures = 0;
  const interruptedIds = [];
  await pa.route("**/record-ops", async (route) => {
    const req = route.request();
    if (
      req.method() === "POST" &&
      req.postDataJSON().kind === "note" &&
      req.postDataJSON().page === 5 &&
      blockNotes
    ) {
      noteFailures++;
      interruptedIds.push(req.postDataJSON().id);
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "API_UNAVAILABLE" } }),
      });
      return;
    }
    await route.continue();
  });
  await pa.evaluate(async () => {
    const { openDatabase } = await import("./local-transport.js");
    const db = await openDatabase(),
      canvas = document.createElement("canvas");
    canvas.width = canvas.height = 2;
    const drawing = canvas.toDataURL("image/png"),
      photo = await (await fetch(drawing)).blob();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("records", "readwrite");
      tx.objectStore("records").put({
        id: crypto.randomUUID(),
        slot: 0,
        page: 5,
        photo,
        text: "legacy resume",
        drawing,
        annotations: [drawing],
        replies: [
          {
            id: crypto.randomUUID(),
            slot: 0,
            text: "legacy reply",
            createdAt: new Date().toISOString(),
          },
        ],
      });
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
  });
  await waitRecords(pa, "rows.some(r=>r.page===5 && r.photo)");
  for (let i = 0; i < 40 && noteFailures < 2; i++)
    await new Promise((r) => setTimeout(r, 100));
  assert.equal(noteFailures, 2);
  blockNotes = false;
  await pa.reload();
  await pa.waitForSelector("#record-sync-status", { state: "attached" });
  await waitRecords(
    pa,
    'rows.some(r=>r.page===5 && r.text==="legacy resume" && r.replies.length===1 && r.annotations.length===1)',
  );
  await pa.evaluate(async () => {
    const { recordRequest } = await import("./records.js");
    const r = (await recordRequest("list")).find((r) => r.page === 5);
    await recordRequest("delete", { key: [0, 5], postId: r.id });
  });
  const legacyHistory = (await api(a, "/rooms/" + room.id + "/record-ops")).operations;
  assert.equal(new Set(interruptedIds).size, 1);
  assert.equal(legacyHistory.find((m) => m.kind === "note" && m.page === 5).id, interruptedIds[0]);
  const legacyIds = legacyHistory.filter((m) => m.page === 5).map((m) => m.id);
  const purged = await assertErased(pa, legacyIds);
  assert.ok(!purged.legacy.some(([slot, page]) => slot === 0 && page === 5));
  // This tab must discover shared IndexedDB writes without any DataChannel.
  const sameTab = await a.context.newPage();
  await sameTab.addInitScript(() => {
    window.bodyReads = 0;
    for (const method of ["get", "getAll", "openCursor"]) {
      const original = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function (...args) {
        if (this.name === "recordBodies") window.bodyReads++;
        return original.apply(this, args);
      };
    }
  });
  await sameTab.route("**/rtc-config", (route) => route.abort());
  await sameTab.goto(base + "/room.html?code=" + room.code);
  await sameTab.waitForSelector("#record-sync-status", { state: "attached" });
  const locked = await b.context.request.get(
    base + "/api/v1/rooms/" + room.id + "/record-ops",
  );
  assert.equal(locked.status(), 403);
  const photo = await pa.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    const x = c.getContext("2d"),
      d = x.createImageData(512, 512);
    for (let i = 0; i < d.data.length; i += 65536)
      crypto.getRandomValues(d.data.subarray(i, i + 65536));
    x.putImageData(d, 0, 0);
    return c.toDataURL("image/png").split(",")[1];
  });
  await pa.locator("#record").click();
  await pa.locator("#record-publish").click();
  await pa.locator("#page").fill("3");
  await pa.locator("#record-photo").setInputFiles({
    name: "record.png",
    mimeType: "image/png",
    buffer: Buffer.from(photo, "base64"),
  });
  await pa.locator('#record-form [type="submit"]').click();
  await pa.locator("#record-dialog").waitFor({ state: "hidden" });
  await pa.evaluate(async () => {
    const { recordRequest } = await import("./records.js");
    await recordRequest("note", {
      key: [0, 3],
      text: "P2P note",
      drawing:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
    });
  });
  // A second multi-chunk photo on this page is a definitive POST_EXISTS.
  // Its staged body and header must both disappear, including after a retry.
  // Simulate a committed note whose response was lost, followed by a
  // definitive failure on the idempotent retry. The only body must survive.
  let lostAttempts = 0;
  const loseAcknowledgement = async (route) => {
    const req = route.request();
    if (req.method() !== "POST" || req.postDataJSON().page !== 6) return route.fallback();
    if (++lostAttempts === 1) {
      const response = await route.fetch();
      assert.equal(response.status(), 201);
      await route.abort();
    } else {
      await route.fulfill({ status: 409, json: { error: { code: "OPERATION_CONFLICT" } } });
    }
  };
  await pa.route("**/record-ops", loseAcknowledgement);
  await pa.evaluate(async () => {
    const { recordRequest } = await import("./records.js");
    const result = await recordRequest("note", { key: [0, 6], text: "lost ACK", drawing: "" });
    if (result.text !== "lost ACK") throw Error("Lost committed body");
  });
  await pa.unroute("**/record-ops", loseAcknowledgement);
  assert.equal(lostAttempts, 2);
  await pa.evaluate(async () => {
    const { recordRequest } = await import("./records.js");
    await recordRequest("delete-note", { key: [0, 6] });
  });
  const beforeReject = await cacheState(pa);
  await pa.evaluate(async () => {
    const { recordRequest } = await import("./records.js");
    const r = (await recordRequest("list")).find((r) => r.page === 3);
    for (let i = 0; i < 2; i++) {
      let status;
      try {
        await recordRequest("publish", {
          key: [0, 3], post: { id: crypto.randomUUID(), slot: 0, page: 3, photo: r.photo },
        });
      } catch (e) { status = e.status; }
      if (status !== 409) throw Error("Expected definitive rejection, got " + status);
    }
  });
  const afterReject = await cacheState(pa);
  assert.deepEqual(afterReject.bodies, beforeReject.bodies);
  assert.deepEqual(afterReject.pending, []);
  await sameTab.reload();
  await sameTab.waitForSelector("#record-sync-status", { state: "attached" });
  await sameTab.evaluate(async () => {
    const { getSharedRecords } = await import("./record-bridge.js");
    await getSharedRecords().pull(true);
  });
  assert.equal(await sameTab.evaluate(() => window.bodyReads), 0,
    "cached room reentry must not load photo bodies before display or RTC upload");
  await waitRecords(
    sameTab,
    'rows.some(r=>r.page===3 && r.photo && r.text==="P2P note")',
  );
  assert.equal(
    await sameTab.locator("#record-sync-status").getAttribute("data-peers"),
    "0",
  );
  await sameTab.close();
  await api(a, "/exchanges/" + room.code + "/finish", { rating: 4 });
  await waitRecords(
    pb,
    'rows.length===1 && rows[0].photo && rows[0].text==="P2P note"',
  );

  await assertErased(pb, legacyIds, true);
  const received = await pb.evaluate(async () => {
    const { recordRequest } = await import("./records.js");
    const [r] = await recordRequest("list");
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.readAsDataURL(r.photo);
    });
  });
  assert.equal(received, photo);
  await pb.locator("#record").click();
  await pb.locator(".record-open-post").click();
  await pb.locator("#reply-text").fill("P2P reply");
  await pb.locator("#reply-photo").setInputFiles({
    name: "reply.png",
    mimeType: "image/png",
    buffer: Buffer.from(photo, "base64"),
  });
  await pb.locator('.record-reply [type="submit"]').click();
  await pb.waitForSelector(".record-comment");
  await pb.locator("#reply-attach").click();
  await pb.locator("#toggle-drawing").click();
  await pb.locator("#drawing").scrollIntoViewIfNeeded();
  const box = await pb.locator("#drawing").boundingBox();
  await pb.mouse.move(box.x + 30, box.y + 30);
  await pb.mouse.down();
  await pb.mouse.move(box.x + 100, box.y + 80, { steps: 8 });
  await pb.mouse.up();
  await pb.locator("#save-drawing").click();
  await waitRecords(
    pa,
    "rows[0]?.replies.length===1 && rows[0]?.annotations.length===1",
  );
  const tamperRejected = await pb.evaluate(async () => {
    const { getSharedRecords } = await import("./record-bridge.js");
    const store = getSharedRecords(),
      id = store.inventory()[0];
    try {
      await store.accept(id, (await store.get(id)) + " ");
      return false;
    } catch {
      return true;
    }
  });
  assert.ok(tamperRejected);
  console.log(
    "PASS P2P: photo chunks, reply attachment, canvas overlay, text note and reader gate",
  );
  await pa.close();
  await api(b, "/exchanges/" + room.code + "/finish", { rating: 4 });
  const pc = await open(c, room.code);
  await waitRecords(
    pc,
    'rows[0]?.replies.length===1 && rows[0]?.annotations.length===1 && rows[0]?.text==="P2P note"',
  );
  await pb.evaluate(async () => {
    const { recordRequest } = await import("./records.js");
    const [r] = await recordRequest("list");
    await recordRequest("edit-reply", {
      key: [0, 3],
      postId: r.id,
      replyId: r.replies[0].id,
      author: 1,
      text: "P2P edited",
    });
  });
  await waitRecords(pc, 'rows[0]?.replies[0]?.text==="P2P edited"');
  await pb.evaluate(async () => {
    const { recordRequest } = await import("./records.js");
    const [r] = await recordRequest("list");
    await recordRequest("delete-reply", {
      key: [0, 3],
      postId: r.id,
      replyId: r.replies[0].id,
      author: 1,
    });
  });
  await waitRecords(pc, "rows[0]?.replies.length===0");
  await b.context.setOffline(true);
  await pc.evaluate(async () => {
    const { recordRequest } = await import("./records.js");
    await recordRequest("note", {
      key: [2, 4],
      text: "reconnect note",
      drawing: "",
    });
  });
  await new Promise((resolve) => setTimeout(resolve, 4500));
  await b.context.setOffline(false);
  await waitRecords(pb, 'rows.some(r=>r.text==="reconnect note")');
  pc.once("dialog",dialog=>dialog.accept());
  await pc.locator("#record").click();
  await pc.getByRole("button",{name:"p. 4 게시물 삭제",exact:true}).click();
  await waitRecords(pb, "rows.length===1");
  await pb.reload();
  await waitRecords(
    pb,
    "rows[0]?.replies.length===0 && rows[0]?.annotations.length===1",
  );
  // A's fresh browser has no IndexedDB: surviving replicas must seed it.
  const fresh = await browser.newContext();
  contexts.push(fresh);
  a.context = fresh;
  const relogin = await fresh.request.post(base + "/api/v1/auth/login", {
    data: a.data,
    headers: { origin: base },
  });
  assert.equal(relogin.status(), 200, await relogin.text());
  pa = await open(a, room.code);
  await waitRecords(
    pa,
    "rows[0]?.annotations.length===1 && rows[0]?.replies.length===0",
  );
  const history = (await api(a, "/rooms/" + room.id + "/record-ops")).operations;
  const retired = history.filter((m) =>
    m.page === 5 || m.page === 4 || ["reply", "edit-reply", "delete-reply"].includes(m.kind),
  ).map((m) => m.id);
  const restored = await assertErased(pa, retired, true);
  assert.ok(restored.frames.some((f) => f.type === "body" && f.direction === "receive"));
  const tab = await open(a, room.code);
  await tab.waitForFunction(
    () =>
      Number(document.querySelector("#record-sync-status").dataset.peers) > 0,
  );
  await pa.evaluate(async () => {
    const { recordRequest } = await import("./records.js");
    const [r] = await recordRequest("list");
    await recordRequest("delete", { key: [0, 3], postId: r.id });
  });
  await waitRecords(pc, "rows.length===0");
  await waitRecords(pb, "rows.length===0");
  await pc.reload();
  await waitRecords(pc, "rows.length===0");
  assert.equal((await all(pc)).length, 0);
  const allIds = (await api(a, "/rooms/" + room.id + "/record-ops")).operations.map((m) => m.id);
  for (const page of [pa, pb, pc, tab]) await assertErased(page, allIds);
  // A clean replica joining after a full-page deletion exchanges a surviving
  // new note over RTC without even advertising or requesting retired IDs.
  await pc.evaluate(async () => {
    const { recordRequest } = await import("./records.js");
    await recordRequest("note", { key: [2, 8], text: "survivor", drawing: "" });
  });
  const late = await browser.newContext();
  contexts.push(late);
  const lateLogin = await late.request.post(base + "/api/v1/auth/login", {
    data: a.data, headers: { origin: base },
  });
  assert.equal(lateLogin.status(), 200);
  const latePage = await open({ context: late }, room.code);
  await waitRecords(latePage, 'rows.length===1 && rows[0].text==="survivor"');
  const lateState = await assertErased(latePage, allIds, true);
  assert.ok(lateState.frames.some((f) => f.type === "body" && f.direction === "receive"));
  assert.equal(lateState.bodies.length, 1);
  assert.ok(metadataBodies.length >= 6);
  assert.ok(
    metadataBodies.every(
      (body) =>
        body.length < 2048 &&
        !body.includes("P2P reply") &&
        !body.includes("$blob"),
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS P2P: original author offline, third-peer historical sync, new browser restore, edits/deletes, reload, multiple tabs; HTTP carries metadata only",
  );
} finally {
  for (const c of contexts) await c.close();
  await browser.close();
  if (roomId) await db.room.deleteMany({ where: { id: roomId } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
}
