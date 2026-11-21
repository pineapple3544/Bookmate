import { serverMode, account } from "./account.js";
// Local transport shares data only within this browser profile and origin.
export const localMode =
  new URLSearchParams(location.search).get("mode") !== "server" && !(serverMode && new URLSearchParams(location.search).has("code"));
const code = new URLSearchParams(location.search).get("code");
const roomSuffix = /^[A-F0-9]{8}$/i.test(code ?? "") ? ":" + code.toUpperCase() : "";
const presencePrefix = "bookmate-presence-v1" + roomSuffix + ":";
let database;
export function openDatabase() {
  if (!database)
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open("bookmate-local-v1" + roomSuffix + (serverMode && account && roomSuffix ? ":" + account.id : ""), 4);
      request.onupgradeneeded = () => {
        for(const name of ["recordBodies","recordImports","recordOutbox","recordRedactions"]){if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name,{keyPath:"id"});}
        if (!request.result.objectStoreNames.contains("records"))
          request.result.createObjectStore("records", {
            keyPath: ["slot", "page"],
          });
        if (request.result.objectStoreNames.contains("messages")) return;
        const messages = request.result.createObjectStore("messages", {
          keyPath: "sequence",
          autoIncrement: true,
        });
        messages.createIndex("id", "id", { unique: true });
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => {
          request.result.close();
          database = undefined;
        };
        resolve(request.result);
      };
      request.onerror = () => {
        database = undefined;
        reject(request.error);
      };
      request.onblocked = () => {
        database = undefined;
        reject(new Error("Storage blocked"));
      };
    });
  return database;
}
function onlineSlots() {
  const slots = new Set();
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (!key?.startsWith(presencePrefix)) continue;
    try {
      const value = JSON.parse(localStorage.getItem(key));
      if (
        Date.now() - value.time < 25000 &&
        Number.isInteger(value.slot) &&
        value.slot >= 0 &&
        value.slot < (roomSuffix ? 10 : 4)
      )
        slots.add(value.slot);
      else localStorage.removeItem(key);
    } catch {
      /* Ignore malformed presence from old tabs. */
    }
  }
  return [...slots];
}
function serialize(message) {
  return { ...message, sequence: String(message.sequence) };
}
export async function localRequest(url, options = {}) {
  const parsed = new URL(url, location.href);
  const serverTime = new Date().toISOString();
  if (parsed.pathname.endsWith("/presence")) {
    const body = JSON.parse(options.body);
    const key = presencePrefix + body.sessionId;
    if (body.active)
      localStorage.setItem(
        key,
        JSON.stringify({ slot: body.senderSlot, time: Date.now() }),
      );
    else localStorage.removeItem(key);
    return { onlineSlots: onlineSlots(), serverTime };
  }
  const db = await openDatabase();
  if (options.method === "POST") {
    const body = JSON.parse(options.body);
    if (
      typeof body.text !== "string" ||
      !body.text.trim() ||
      body.text.trim().length > 500 ||
      !Number.isInteger(body.senderSlot) ||
      body.senderSlot < 0 ||
      body.senderSlot >= (roomSuffix ? 10 : 4) ||
      typeof body.id !== "string"
    )
      throw new Error("Invalid message");
    return new Promise((resolve, reject) => {
      const tx = db.transaction("messages", "readwrite");
      const store = tx.objectStore("messages");
      let message;
      const lookup = store.index("id").get(body.id);
      lookup.onsuccess = () => {
        if (lookup.result) {
          message = lookup.result;
          return;
        }
        message = {
          id: body.id,
          text: body.text.trim(),
          senderSlot: body.senderSlot,
          createdAt: serverTime,
        };
        const add = store.add(message);
        add.onsuccess = () => {
          message.sequence = add.result;
        };
      };
      tx.oncomplete = () =>
        resolve({ message: serialize(message), serverTime });
      tx.onabort = () => reject(tx.error ?? new Error("Storage failed"));
      tx.onerror = () => {};
    });
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction("messages", "readonly");
    const after = parsed.searchParams.get("after");
    const before = parsed.searchParams.get("before");
    const range =
      after !== null
        ? IDBKeyRange.lowerBound(Number(after), true)
        : before !== null
          ? IDBKeyRange.upperBound(Number(before), true)
          : null;
    const direction = after !== null ? "next" : "prev";
    const result = [];
    const request = tx.objectStore("messages").openCursor(range, direction);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || result.length === 51) return;
      result.push(serialize(cursor.value));
      cursor.continue();
    };
    tx.oncomplete = () => {
      const hasMore = result.length > 50;
      const messages = result.slice(0, 50);
      if (direction === "prev") messages.reverse();
      try {
        resolve({ messages, hasMore, serverTime, onlineSlots: onlineSlots() });
      } catch (error) {
        reject(error);
      }
    };
    tx.onabort = () => reject(tx.error ?? new Error("Storage failed"));
  });
}
