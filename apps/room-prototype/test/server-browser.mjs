import { chromium } from "playwright";
import { config } from "dotenv";
import { createDatabase } from "../../server/dist/db.js";
config({ path: new URL("../../../.env", import.meta.url), quiet: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_CHANNEL
    ? { channel: process.env.BROWSER_CHANNEL }
    : {}),
});
const context = await browser.newContext();
const page = await context.newPage();
try {
  await page.goto(process.env.BASE_URL ?? "http://127.0.0.1:5173");
  await page.evaluate(async () => {
    const email = crypto.randomUUID() + "@example.com";
    async function request(path, method = "GET", body) {
      const response = await fetch("/api/v1" + path, {
        method,
        credentials: "include",
        ...(body
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }
          : {}),
      });
      if (!response.ok)
        throw new Error(
          path + ": " + response.status + " " + (await response.text()),
        );
      return response.status === 204 ? null : response.json();
    }
    const { user } = await request("/auth/register", "POST", {
      email,
      password: "browser-test-password",
      nickname: "사용자 1",
    });
    window.testUserId = user.id;
    await request("/auth/login", "POST", {
      email,
      password: "browser-test-password",
    });
    if (document.cookie.includes("bookmate_session"))
      throw new Error("Session exposed to JavaScript");
    const me = await request("/auth/me");
    if (me.user.id !== user.id) throw new Error("Cookie proxy failed");
    const { room } = await request("/rooms", "POST", {
      title: "임시 문구1",
      bookTitle: "임시 문구2",
    });
    window.testRoomId = room.id;
    const ws = new WebSocket(
      location.origin.replace(/^http/, "ws") +
        "/api/v1/rooms/" +
        room.id +
        "/live",
    );
    const presence = await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Proxy websocket timeout")),
        5000,
      );
      ws.onmessage = (event) => {
        clearTimeout(timeout);
        resolve(JSON.parse(event.data));
      };
      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("Proxy websocket failed"));
      };
    });
    if (presence.hostUserId !== user.id) throw new Error("Host mismatch");
    ws.close();
    await request("/rooms/" + room.id + "/messages", "POST", {
      id: crypto.randomUUID(),
      text: "임시 문구1",
    });
    const chat = await request("/rooms/" + room.id + "/messages");
    if (chat.messages.length !== 1) throw new Error("Chat mismatch");
    await request("/rooms/" + room.id, "DELETE");
    await request("/auth/logout", "POST");
    if ((await fetch("/api/v1/auth/me")).status !== 401)
      throw new Error("Logout did not revoke session");
  });
  console.log(
    "PASS real browser: cookie login/CSRF, room/chat HTTP proxy, WebSocket proxy, host election, bodyless delete/logout",
  );
} finally {
  const ids = await page
    .evaluate(() => ({ userId: window.testUserId, roomId: window.testRoomId }))
    .catch(() => ({}));
  await context.close();
  await browser.close();
  const db = createDatabase(process.env.DATABASE_URL);
  try {
    if (ids.roomId) await db.room.deleteMany({ where: { id: ids.roomId } });
    if (ids.userId) await db.user.deleteMany({ where: { id: ids.userId } });
  } finally {
    await db.$disconnect();
  }
}
