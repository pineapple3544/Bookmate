export const MAX_BODY = 22 * 1024 * 1024;
const types = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
  "image/gif",
  "image/bmp",
]);
const bytes = (value) => new TextEncoder().encode(value);
export async function digestBody(body) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes(body)))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
async function pack(value) {
  if (value instanceof Blob) {
    if (!types.has(value.type) || value.size > 15 * 1024 * 1024)
      throw Error("사진 크기 또는 형식을 확인해 주세요.");
    const data = new Uint8Array(await value.arrayBuffer());
    let raw = "";
    for (let i = 0; i < data.length; i += 8192)
      raw += String.fromCharCode(...data.subarray(i, i + 8192));
    return { $blob: btoa(raw), type: value.type };
  }
  if (Array.isArray(value)) return Promise.all(value.map(pack));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value))
      if (v !== undefined) out[k] = await pack(v);
    return out;
  }
  return value;
}
export async function encodeBody(method, value) {
  if (isTombstone(method)) {
    const { key, postId, replyId, author } = value;
    value = { key, postId, replyId, author };
  }
  const body = JSON.stringify({ method, value: await pack(value) });
  if (bytes(body).length > MAX_BODY) throw Error("기록 전송 크기 초과");
  return body;
}
export function decodeBody(body) {
  if (typeof body !== "string" || bytes(body).length > MAX_BODY)
    throw Error("Invalid body size");
  return JSON.parse(body, (key, value) => {
    if (value && typeof value === "object" && Object.hasOwn(value, "$blob")) {
      if (
        !types.has(value.type) ||
        typeof value.$blob !== "string" ||
        value.$blob.length > 20 * 1024 * 1024 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(value.$blob)
      )
        throw Error("Invalid image");
      const raw = atob(value.$blob);
      return new Blob([Uint8Array.from(raw, (c) => c.charCodeAt(0))], {
        type: value.type,
      });
    }
    return value;
  });
}
function text(value, max) {
  if (typeof value !== "string" || value.length > max)
    throw Error("Invalid text");
}
function media(value) {
  if (value instanceof Blob) {
    if (!types.has(value.type) || value.size > 15 * 1024 * 1024)
      throw Error("Invalid image");
    return;
  }
  if (
    typeof value !== "string" ||
    !/^data:image\/png;base64,[A-Za-z0-9+/]*={0,2}$/.test(value) ||
    value.length > 20 * 1024 * 1024
  )
    throw Error("Invalid drawing");
}
export function validateBody(meta, data) {
  const v = data?.value;
  if (
    data?.method !== meta.kind ||
    !v ||
    v.key?.[0] !== meta.slot ||
    v.key?.[1] !== meta.page
  )
    throw Error("Metadata mismatch");
  if (
    ["publish", "note", "delete-note", "delete"].includes(meta.kind) &&
    meta.actorSlot !== meta.slot
  )
    throw Error("Invalid author");
  if (meta.kind === "publish") {
    if (
      v.post?.id !== meta.postId ||
      v.post.slot !== meta.actorSlot ||
      v.post.page !== meta.page
    )
      throw Error("Invalid post");
    media(v.post.photo);
  } else if (meta.kind === "note") {
    text(v.text, 2000);
    if (v.drawing) media(v.drawing);
  } else if (meta.kind !== "delete-note") {
    if (v.postId !== meta.postId) throw Error("Invalid target");
    if (meta.kind === "reply") {
      if (v.reply?.id !== meta.replyId || v.reply.slot !== meta.actorSlot)
        throw Error("Invalid reply author");
      text(v.reply.text, 1000);
      if (v.reply.photo) media(v.reply.photo);
      if (v.reply.drawing) media(v.reply.drawing);
    }
    if (
      ["edit-reply", "delete-reply"].includes(meta.kind) &&
      (v.replyId !== meta.replyId || v.author !== meta.actorSlot)
    )
      throw Error("Invalid reply edit");
    if (meta.kind === "edit-reply") text(v.text, 1000);
    if (meta.kind === "annotate") media(v.layer);
  }
}
export function isTombstone(kind) {
  return kind === "delete" || kind === "delete-note" || kind === "delete-reply";
}

// The server supplies operations in sequence order. A later publication on the
// same page starts a new lifetime, even if the author reuses an identifier.
export function liveBodyIds(operations) {
  const live = new Set(), pages = new Set(), notes = new Set(), replies = new Set();
  for (const m of Array.from(operations).reverse()) {
    const page = m.slot + ":" + m.page;
    const reply = page + ":" + m.postId + ":" + m.replyId;
    if (m.kind === "delete") pages.add(page);
    else if (m.kind === "delete-note") notes.add(page);
    else if (m.kind === "delete-reply") replies.add(reply);
    else if (!pages.has(page) &&
      !(m.kind === "note" && notes.has(page)) &&
      !(["reply", "edit-reply"].includes(m.kind) && replies.has(reply))) {
      live.add(m.id);
    }
  }
  return live;
}
export function materialize(rows) {
  const records = new Map();
  for (const { meta: m, data } of [...rows].sort((a, b) =>
    BigInt(a.meta.sequence) < BigInt(b.meta.sequence) ? -1 : 1,
  )) {
    const key = m.slot + ":" + m.page,
      v = data?.value;
    let current = records.get(key);
    if (m.kind === "delete") {
      records.delete(key);
      continue;
    }
    if (m.kind === "delete-note") {
      if (current) {
        delete current.text;
        delete current.drawing;
        if (!current.photo) records.delete(key);
      }
      continue;
    }
    if (m.kind === "delete-reply") {
      if (current?.id === m.postId)
        current.replies = current.replies.filter((r) => r.id !== m.replyId);
      continue;
    }
    if (!v) continue;
    if (m.kind === "publish") {
      current = {
        ...current,
        slot: m.slot,
        page: m.page,
        id: m.postId,
        photo: v.post.photo,
        replies: [],
        annotations: [],
        updatedAt: m.createdAt,
      };
      records.set(key, current);
    } else if (m.kind === "note") {
      current = {
        ...current,
        slot: m.slot,
        page: m.page,
        text: v.text,
        drawing: v.drawing,
        updatedAt: m.createdAt,
      };
      records.set(key, current);
    } else if (current?.id === m.postId) {
      if (m.kind === "reply")
        current.replies.push({
          id: m.replyId,
          slot: m.actorSlot,
          text: v.reply.text,
          photo: v.reply.photo,
          drawing: v.reply.drawing,
          createdAt: m.createdAt,
        });
      if (m.kind === "edit-reply") {
        const reply = current.replies.find(
          (r) => r.id === m.replyId && r.slot === m.actorSlot,
        );
        if (reply) reply.text = v.text;
      }
      if (m.kind === "annotate") current.annotations.push(v.layer);
    }
  }
  return [...records.values()];
}
