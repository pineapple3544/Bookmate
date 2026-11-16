import { apiRequest } from "./account.js";
import { openDatabase } from "./local-transport.js";
import {
  encodeBody,
  decodeBody,
  digestBody,
  validateBody,
  materialize,
} from "./record-protocol.js";
export function createSharedRecords(room) {
  const path = `/api/v1/rooms/${room.id}/record-ops`,
    meta = new Map(),
    bodies = new Map(),
    decoded = new Map(),
    listeners = new Set();
  let cursor = "0",
    pulling,
    writing = Promise.resolve(),
    stopped = false,
    allowed = false,
    records = [],
    revision = 0,
    migrating = false,
    lastPull = 0;
  const status = document.createElement("p");
  status.id = "record-sync-status";
  status.setAttribute("role", "status");
  status.className = "record-hint";
  document.querySelector("#record-feed").prepend(status);
  let peers = 0,
    lastError = "",
    transferring = 0;
  function report() {
    const missing = [...meta.keys()].filter((id) => !decoded.has(id)).length;
    status.dataset.missing = String(missing);
    status.dataset.peers = String(peers);
    status.textContent =
      lastError ||
      (!allowed
        ? "기록 공유 대기"
        : missing
          ? `기록 ${missing}개 수신 대기`
          : transferring
            ? "기록 전송 중"
            : peers
              ? `P2P 연결 ${peers}명 · 동기화됨`
              : "다른 참가자 연결 대기");
  }
  function notify() {
    revision++;
    report();
    window.dispatchEvent(new Event("bookmate-records-updated"));
    for (const fn of listeners) fn();
  }
  async function storage(name, method, value) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(
        name,
        ["getAll", "get"].includes(method) ? "readonly" : "readwrite",
      );
      const req = tx.objectStore(name)[method](value);
      let result;
      req.onsuccess = () => (result = req.result);
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error ?? Error("브라우저 저장 실패"));
    });
  }
  function rebuild() {
    records = materialize(
      [...meta.values()].map((m) => ({ meta: m, data: decoded.get(m.id) })),
    );
    notify();
  }
  async function verify(m, body) {
    if (
      new TextEncoder().encode(body).length !== m.bytes ||
      (await digestBody(body)) !== m.digest
    )
      throw Error("기록 무결성 검사 실패");
    const data = decodeBody(body);
    validateBody(m, data);
    return data;
  }
  let projectionDirty = false;
  const loaded = storage("recordBodies", "getAll").then((rows) => {
    for (const row of rows) bodies.set(row.id, row.body);
  });
  async function pull(force = false) {
    if (pulling) return pulling;
    if (!force && allowed && Date.now() - lastPull < 1000) return;
    pulling = (async () => {
      await loaded;
      let more = true;
      while (more) {
        const result = await apiRequest(path + "?after=" + cursor);
        allowed = true;
        lastError = "";
        for (const m of result.operations) {
          meta.set(m.id, m);
          cursor = m.sequence;
          projectionDirty = true;
        }
        more = result.hasMore;
      }
      // Re-read bodies absent from memory: another tab may have persisted them.
      for (const m of meta.values())
        if (!decoded.has(m.id)) {
          const stored =
            bodies.get(m.id) ??
            (await storage("recordBodies", "get", m.id))?.body;
          if (stored !== undefined) {
            try {
              decoded.set(m.id, await verify(m, stored));
              bodies.set(m.id, stored);
              projectionDirty = true;
            } catch {
              bodies.delete(m.id);
              await storage("recordBodies", "delete", m.id);
            }
          }
        }
      lastPull = Date.now();
      if (projectionDirty) {
        projectionDirty = false;
        rebuild();
      } else report();
    })()
      .catch((error) => {
        allowed = false;
        lastError = error.message;
        report();
        throw error;
      })
      .finally(() => (pulling = null));
    return pulling;
  }
  async function commit(method, value) {
    await pull(true);
    const body = await encodeBody(method, value),
      id = crypto.randomUUID();
    const header = {
      id,
      kind: method,
      slot: value.key[0],
      page: value.key[1],
      digest: await digestBody(body),
      bytes: new TextEncoder().encode(body).length,
      ...(method === "publish"
        ? { postId: value.post.id }
        : value.postId
          ? { postId: value.postId }
          : {}),
      ...(method === "reply"
        ? { replyId: value.reply.id }
        : value.replyId
          ? { replyId: value.replyId }
          : {}),
    };
    validateBody({ ...header, actorSlot: room.me }, decodeBody(body));
    await storage("recordBodies", "put", { id, body });
    bodies.set(id, body);
    try {
      await apiRequest(path, "POST", header);
    } catch (error) {
      try {
        await apiRequest(path, "POST", header);
      } catch {
        throw error;
      }
    }
    await pull(true);
    if (!meta.has(id)) await pull(true);
    return records.find(
      (r) => r.slot === value.key[0] && r.page === value.key[1],
    );
  }
  async function request(method, value) {
    if (["get", "list"].includes(method)) {
      await pull();
      return method === "list"
        ? records
        : records.find((r) => r.slot === value[0] && r.page === value[1]);
    }
    const job = writing.then(() => commit(method, value));
    writing = job.catch(() => {});
    return job;
  }
  async function migratePageRecords() {
    const old = await storage("records", "getAll");
    for (const record of old) {
      if (stopped) return;
      if (record.slot !== room.me) continue;
      const key = [record.slot, record.page],
        id = "legacy:" + key.join(":");
      let progress = await storage("recordImports", "get", id);
      if (progress?.done || (progress && !Object.hasOwn(progress, "done")))
        continue;
      await pull(true);
      if (!progress) {
        // Another browser already authored this page; never resurrect its old cache.
        if (
          [...meta.values()].some(
            (m) => m.slot === record.slot && m.page === record.page,
          )
        ) {
          await storage("recordImports", "put", { id, done: true });
          continue;
        }
        progress = {
          id,
          done: false,
          postId: record.id ?? crypto.randomUUID(),
          replyIds: (record.replies ?? []).map(
            (reply) => reply.id ?? crypto.randomUUID(),
          ),
        };
        await storage("recordImports", "put", progress);
      }
      if (
        [...meta.values()].some(
          (m) =>
            m.slot === record.slot &&
            m.page === record.page &&
            m.kind === "delete",
        )
      ) {
        await storage("recordImports", "put", { ...progress, done: true });
        continue;
      }
      async function ensure(method, value) {
        const digest = await digestBody(await encodeBody(method, value));
        if (
          ![...meta.values()].some(
            (m) =>
              m.kind === method &&
              m.slot === record.slot &&
              m.page === record.page &&
              m.digest === digest,
          )
        )
          await request(method, value);
      }
      if (record.photo)
        await ensure("publish", {
          key,
          post: {
            id: progress.postId,
            slot: record.slot,
            page: record.page,
            photo: record.photo,
          },
        });
      if (record.text || record.drawing)
        await ensure("note", {
          key,
          text: record.text ?? "",
          drawing: record.drawing ?? "",
        });
      if (record.photo) {
        for (const layer of record.annotations ?? [])
          await ensure("annotate", { key, postId: progress.postId, layer });
        for (const [index, reply] of (record.replies ?? []).entries())
          if (reply.slot === room.me)
            await ensure("reply", {
              key,
              postId: progress.postId,
              reply: { ...reply, id: progress.replyIds[index] },
            });
      }
      await storage("recordImports", "put", { ...progress, done: true });
    }
  }
  async function migrate() {
    if (migrating || !allowed || stopped) return;
    migrating = true;
    try {
      if (navigator.locks)
        await navigator.locks.request(
          "bookmate-import:" + room.id + ":" + room.me,
          migratePageRecords,
        );
      else await migratePageRecords();
    } catch (error) {
      lastError = "이전 기록 공유 대기: " + error.message;
      report();
    } finally {
      migrating = false;
    }
  }
  const timer = setInterval(() => {
    if (!stopped)
      void pull()
        .then(migrate)
        .catch(() => {});
  }, 10000);
  void pull()
    .then(migrate)
    .catch(() => {});
  window.addEventListener(
    "pagehide",
    () => {
      stopped = true;
      clearInterval(timer);
    },
    { once: true },
  );
  return {
    request,
    pull,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async accept(id, body) {
      await pull(!meta.has(id));
      const m = meta.get(id);
      if (!m) throw Error("등록되지 않은 기록");
      const data = await verify(m, body);
      await storage("recordBodies", "put", { id, body });
      bodies.set(id, body);
      decoded.set(id, data);
      rebuild();
    },
    has: (id) => decoded.has(id),
    get: (id) => (decoded.has(id) ? bodies.get(id) : undefined),
    metadata: (id) => meta.get(id),
    missing: () => [...meta.keys()].filter((id) => !decoded.has(id)),
    inventory: () => [...decoded.keys()],
    isAllowed: () => allowed,
    report(count, error = "", active = 0) {
      peers = count;
      transferring = active;
      lastError = error;
      report();
    },
    get revision() {
      return revision;
    },
  };
}
