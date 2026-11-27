import { apiRequest } from "./account.js";
import { storage, unstagedKeys, stage, discard, cacheBody, redact } from "./record-storage.js";
import {
  encodeBody,
  decodeBody,
  digestBody,
  validateBody,
  materialize,
  liveBodyIds,
  isTombstone,
} from "./record-protocol.js";
export function createSharedRecords(room) {
  const recordSlot = room.members[room.me].recordSlot ?? room.me;
  const path = `/api/v1/rooms/${room.id}/record-ops`,
    meta = new Map(),
    available = new Set(),
    decoded = new Map(),
    listeners = new Set();
  let cursor = "0",
    pulling,
    live = new Set(),
    initialKeys,
    writing = Promise.resolve(),
    stopped = false,
    allowed = false,
    viewGeneration = 0,
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
    const missing = [...live].filter((id) => !available.has(id)).length;
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
  // Availability comes from keys only. Read and verify individual bodies
  // when the user views a page or a peer requests its bytes.
  async function readBody(id) {
    if (!live.has(id) || !available.has(id)) return;
    const row = await storage("recordBodies", "get", id);
    if (row) {
      try {
        const data = await verify(meta.get(id), row.body);
        if (live.has(id)) return { body: row.body, data };
        return;
      } catch {
        await storage("recordBodies", "delete", id);
      }
    }
    available.delete(id);
    decoded.delete(id);
    notify();
  }
  async function view(key) {
    const generation = viewGeneration;
    const rows = [];
    for (const m of meta.values()) {
      if (key && (key[0] !== m.slot || key[1] !== m.page)) continue;
      let data = decoded.get(m.id);
      if (!data && live.has(m.id) && available.has(m.id)) {
        data = (await readBody(m.id))?.data;
        if (data && generation === viewGeneration && document.querySelector("#record-feed").open)
          decoded.set(m.id, data);
      }
      rows.push({ meta: m, data });
    }
    const result = materialize(rows);
    return key ? result[0] : result;
  }
  let projectionDirty = false;
  const retired = new Set(), pendingTombstones = [];
  async function pull(force = false) {
    if (pulling) return pulling;
    if (!force && allowed && Date.now() - lastPull < 1000) return;
    pulling = (async () => {
      if (cursor === "0" && initialKeys === undefined) initialKeys = await unstagedKeys();
      let more = true;
      while (more) {
        const result = await apiRequest(path + "?after=" + cursor);
        for (const m of result.operations) {
          meta.set(m.id, m);
          cursor = m.sequence;
          if (isTombstone(m.kind)) pendingTombstones.push(m);
          projectionDirty = true;
        }
        if (result.operations.length) {
          const next = liveBodyIds(meta.values());
          for (const id of [...live, ...result.operations.map((m) => m.id)]) {
            if (!next.has(id)) {
              retired.add(id);
              available.delete(id);
              decoded.delete(id);
            }
          }
          live = next;
        }
        more = result.hasMore;
      }
      if (retired.size || pendingTombstones.length) {
        await redact(retired, pendingTombstones);
        retired.clear();
        pendingTombstones.length = 0;
      }
      if (initialKeys) {
        for (const id of initialKeys)
          if (!meta.has(id)) await discard(id);
        initialKeys = null;
      }
      const keys = new Set(await storage("recordBodies", "getAllKeys"));
      for (const id of live) {
        if (keys.has(id) === available.has(id)) continue;
        if (keys.has(id)) available.add(id);
        else {
          available.delete(id);
          decoded.delete(id);
        }
        projectionDirty = true;
      }
      allowed = true;
      lastError = "";
      lastPull = Date.now();
      if (projectionDirty) {
        projectionDirty = false;
        notify();
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

  function registered(header) {
    const m = meta.get(header.id);
    return m?.actorSlot === recordSlot && m.kind === header.kind &&
      m.slot === header.slot && m.page === header.page &&
      (m.postId ?? null) === (header.postId ?? null) &&
      (m.replyId ?? null) === (header.replyId ?? null) &&
      (m.digest === header.digest || (isTombstone(m.kind) && m.bytes === 0));
  }
  async function submit(header, uncertain = false) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await apiRequest(path, "POST", header);
        break;
      } catch (error) {
        if (error.status >= 400 && error.status < 500 && error.status !== 408) {
          if (uncertain) {
            // An earlier transmission may already have committed. Only discard
            // once a fresh authorized read confirms the operation is absent.
            if (pulling) await pulling;
            await pull(true);
            if (registered(header)) break;
          }
          await discard(header.id);
          throw error;
        }
        uncertain = true;
        if (attempt === 1) throw error;
      }
    }
    await storage("recordOutbox", "delete", header.id);
  }
  async function recover() {
    const pending = await storage("recordOutbox", "getAll");
    if (!pending.length) return pending;
    await pull(true);
    for (const header of pending) {
      if (registered(header)) await storage("recordOutbox", "delete", header.id);
      else await submit(header, true);
    }
    await pull(true);
    return pending;
  }
  function enqueue(work) {
    const job = writing.then(work);
    writing = job.catch(() => {});
    return job;
  }
  async function commit(method, value, recovered) {
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
    validateBody({ ...header, actorSlot: recordSlot }, decodeBody(body));
    // A caller can retry while recovery is finishing. An identical staged
    // operation already has a durable ID and has just been acknowledged.
    if (recovered.some((pending) => pending.kind === method && pending.digest === header.digest))
      return view(value.key);
    await stage(header, isTombstone(method) ? undefined : body);
    await submit(header);
    await pull(true);
    if (!meta.has(id)) await pull(true);
    return view(value.key);
  }
  async function request(method, value) {
    if (["get", "list"].includes(method)) {
      await pull();
      return view(method === "list" ? undefined : value);
    }
    return enqueue(async () => {
      const recovered = await recover();
      return commit(method, value, recovered);
    });
  }
  async function migratePageRecords() {
    const keys = await storage("records", "getAllKeys");
    for (const key of keys) {
      if (stopped) return;
      if (key[0] !== recordSlot) continue;
      const id = "legacy:" + key.join(":");
      let progress = await storage("recordImports", "get", id);
      if (progress?.done || (progress && !Object.hasOwn(progress, "done")))
        continue;
      await pull(true);
      const record = await storage("records", "get", key);
      if (!record) continue;
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
          if (reply.slot === recordSlot)
            await ensure("reply", {
              key,
              postId: progress.postId,
              reply: { ...reply, id: reply.id ?? progress.replyIds[index] },
            });
      }
      await storage("recordImports", "put", { ...progress, done: true });
    }
  }
  async function migrate() {
    if (migrating || !allowed || stopped) return;
    migrating = true;
    try {
      await enqueue(recover);
      if (navigator.locks)
        await navigator.locks.request(
          "bookmate-import:" + room.id + ":" + recordSlot,
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
      await pull(true);
      const m = meta.get(id);
      if (!live.has(id)) throw Error("등록되지 않았거나 삭제된 기록");
      await verify(m, body);
      if (!live.has(id) || !(await cacheBody(id, body)) || !live.has(id))
        throw Error("삭제된 기록");
      available.add(id);
      notify();
    },
    isLive: (id) => live.has(id),
    has: (id) => live.has(id) && available.has(id),
    get: async (id) => (await readBody(id))?.body,
    releaseView() {
      viewGeneration++;
      decoded.clear();
    },
    metadata: (id) => meta.get(id),
    missing: () => [...live].filter((id) => !available.has(id)),
    inventory: () => [...available],
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
