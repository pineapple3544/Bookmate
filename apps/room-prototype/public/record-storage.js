import { openDatabase } from "./local-transport.js";

async function transaction(names, mode, run) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, mode);
    const result = run(tx);
    tx.oncomplete = () => resolve(result?.result);
    tx.onabort = () => reject(tx.error ?? Error("브라우저 저장 실패"));
  });
}

export function storage(name, method, value) {
  const mode = ["get", "getAll", "getAllKeys"].includes(method) ? "readonly" : "readwrite";
  return transaction(name, mode, (tx) => tx.objectStore(name)[method](value));
}

// Capture keys before the first server read. Previous versions staged bodies
// without headers. Current pending writes are protected by their outbox entry.
export async function unstagedKeys() {
  let bodies, pending;
  await transaction(["recordBodies", "recordOutbox"], "readonly", (tx) => {
    bodies = tx.objectStore("recordBodies").getAllKeys();
    pending = tx.objectStore("recordOutbox").getAllKeys();
  });
  const staged = new Set(pending.result);
  return bodies.result.filter((id) => !staged.has(id));
}

export function stage(header, body) {
  return transaction(["recordBodies", "recordOutbox"], "readwrite", (tx) => {
    if (body !== undefined) tx.objectStore("recordBodies").put({ id: header.id, body });
    tx.objectStore("recordOutbox").put(header);
  });
}

export function discard(id) {
  return transaction(["recordBodies", "recordOutbox"], "readwrite", (tx) => {
    tx.objectStore("recordBodies").delete(id);
    tx.objectStore("recordOutbox").delete(id);
  });
}

export async function cacheBody(id, body) {
  let accepted = false;
  await transaction(["recordBodies", "recordRedactions"], "readwrite", (tx) => {
    const check = tx.objectStore("recordRedactions").getKey(id);
    check.onsuccess = () => {
      if (check.result !== undefined) return;
      tx.objectStore("recordBodies").put({ id, body });
      accepted = true;
    };
  });
  return accepted;
}

export function redact(ids, tombstones) {
  return transaction(["recordBodies", "recordOutbox", "recordRedactions", "records", "recordImports"], "readwrite", (tx) => {
    for (const id of ids) {
      tx.objectStore("recordRedactions").put({ id });
      tx.objectStore("recordBodies").delete(id);
      tx.objectStore("recordOutbox").delete(id);
    }
    const byPage = new Map();
    for (const m of tombstones) {
      const key = m.slot + ":" + m.page;
      if (!byPage.has(key)) byPage.set(key, []);
      byPage.get(key).push(m);
    }
    const records = tx.objectStore("records");
    for (const [key, events] of byPage) {
      const page = [events[0].slot, events[0].page];
      if (events.some((m) => m.kind === "delete")) {
        records.delete(page);
        continue;
      }
      const progress = tx.objectStore("recordImports").get("legacy:" + key);
      const read = records.get(page);
      read.onsuccess = () => {
        const row = read.result;
        if (!row) return;
        for (const m of events) {
          if (m.kind === "delete-note") {
            delete row.text;
            delete row.drawing;
          } else if ((row.id ?? progress.result?.postId) === m.postId && row.replies) {
            row.replies = row.replies.map((reply, i) => ({
              ...reply, id: reply.id ?? progress.result?.replyIds?.[i],
            })).filter((reply) => reply.id !== m.replyId);
          }
        }
        if (row.photo || row.text || row.drawing) records.put(row);
        else records.delete(page);
      };
    }
  });
}
