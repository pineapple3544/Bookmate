import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizeAppearance, normalizePetLook } from "./public/avatar.js";
import { isRating } from "./public/rating.js";

const dataFile = process.env.EXCHANGE_DATA_FILE
  ?? fileURLToPath(new URL("../../.bookmate-exchanges.json", import.meta.url));
const legacyDataFile = new URL("./.bookmate-exchanges.json", import.meta.url);

function readRooms(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return {};
  }
}

let rooms = process.env.EXCHANGE_DATA_FILE
  ? readRooms(dataFile)
  : { ...readRooms(legacyDataFile), ...readRooms(dataFile) };

function reject(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
function clean(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}
function roomOptions(input, minimum = 2) {
  const title = clean(input.title, 80);
  const author = clean(input.author, 50);
  const capacity = Number(input.capacity);
  if (!title || !Number.isInteger(capacity) || capacity < 2 || capacity > 10) {
    reject("책 제목과 참여 인원을 확인해 주세요.");
  }
  if (capacity < minimum) reject("참여 인원은 이미 참가한 인원보다 적게 설정할 수 없어요.", 409);
  const theme = ["mint", "plum", "rust", "blue", "butter", "rose", "cocoa"].includes(input.theme)
    ? input.theme : "mint";
  return { title, author, capacity, theme };
}
function roomAppearance(value) {
  const pet = typeof value.pet === "string" ? Array.from(value.pet).slice(0, 350).join("") : "";
  const petLook = pet && value.petLook ? normalizePetLook(value.petLook) : null;
  if (pet && value.petLook && !petLook) reject("펫 정보를 확인해 주세요.");
  return { ...normalizeAppearance(value), pet, ...(petLook ? { petLook } : {}) };
}
function member(name, appearance) {
  return {
    id: randomUUID(), token: randomBytes(24).toString("hex"), name,
    ...(appearance && typeof appearance === "object" ? { appearance: roomAppearance(appearance) } : {}),
  };
}
function inviteCode() {
  let code;
  do { code = randomBytes(4).toString("hex").toUpperCase(); } while (rooms[code]);
  return code;
}
const demoBooks = {
  complete: { title: "달빛 서점", author: "체험용 도서", theme: "plum" },
  reading: { title: "숲속 우체국", author: "체험용 도서", theme: "mint" },
  waiting: { title: "귤빛 오후", author: "체험용 도서", theme: "rust" },
  ready: { title: "햇살 책모임", author: "체험용 도서", theme: "butter" },
};
function demoRoom(state, appearance, profileId) {
  if (!Object.hasOwn(demoBooks, state)) reject("체험 독서방을 찾을 수 없어요.", 404);
  const host = { ...member("소이", appearance), profileId };
  const time = days => new Date(Date.now() - days * 86400000).toISOString();
  const room = {
    ...demoBooks[state], code: inviteCode(), capacity: state === "ready" ? 4 : 2, demo: state,
    createdAt: time(7), members: [host],
  };
  if (state === "ready") {
    room.members.push(member("밤톨"), member("솔잎"), member("구름"));
  } else if (state !== "waiting") {
    const friend = member("밤톨");
    room.members.push(friend);
    room.startedAt = host.receivedAt = time(6);
    if (state === "complete") {
      host.finishedAt = friend.receivedAt = time(3);
      friend.finishedAt = room.completedAt = time(1);
      Object.assign(host, { rating: 5, review: "책을 덮고 나서도 달빛 아래 서점이 떠올랐어요.", quote: "어떤 문장은 밤이 깊어야 읽힌다." });
      Object.assign(friend, { rating: 4, review: "서로 다른 마음이 한 권의 책에 모이는 이야기가 좋았어요." });
    }
  }
  save(room);
  return { room: view(room, host.token), token: host.token };
}
function previewProfile(id) {
  const profile = rooms.profiles?.[id] ?? { nickname: "소이", bio: "", profilePublic: false };
  const books = Object.values(rooms).filter(room => room.completedAt && room.members?.some(m => m.profileId === id))
    .sort((a, b) => b.members.find(m => m.profileId === id).finishedAt.localeCompare(a.members.find(m => m.profileId === id).finishedAt))
    .map(({ title, author, theme }) => ({ title, author, theme }));
  const current = Object.values(rooms).flatMap(room => {
    if (!room.startedAt || room.completedAt) return [];
    const member = room.members.find(m => m.profileId === id);
    return member?.receivedAt && !member.finishedAt ? [{ title: room.title, since: member.receivedAt }] : [];
  }).sort((a, b) => b.since.localeCompare(a.since))[0];
  return { ...profile, books, currentBookTitle: current?.title ?? null };
}
function view(room, token) {
  const me = room.members.findIndex(person => person.token === token);
  const { members, hostId = members[0].id, ...details } = room;
  return {
    ...(me >= 0 ? details : {
      code: room.code, title: room.title, author: room.author, theme: room.theme,
      capacity: room.capacity, startedAt: room.startedAt,
    }), me, isHost: me >= 0 && members[me].id === hostId,
    members: members.map(({ token: secret, profileId, ...person }, index) =>
      me >= 0 ? { ...person, name: (profileId ? rooms.profiles?.[profileId]?.nickname ?? "소이" : person.name), review: room.completedAt || index === me ? person.review : undefined,
        quote: room.completedAt || index === me ? person.quote : undefined,
        rating: room.completedAt || index === me ? person.rating : undefined, isHost: person.id === hostId }
        : { name: (profileId ? rooms.profiles?.[profileId]?.nickname ?? "소이" : person.name), isHost: person.id === hostId }),
  };
}
function save(room) {
  persist({ ...rooms, [room.code]: room });
}
function persist(next) {
  writeFileSync(dataFile + ".tmp", JSON.stringify(next), { mode: 0o600 });
  renameSync(dataFile + ".tmp", dataFile);
  rooms = next;
}
async function body(request) {
  let data = "";
  for await (const chunk of request) {
    data += chunk;
    if (data.length > 10_000) reject("입력 내용이 너무 길어요.", 413);
  }
  try {
    return JSON.parse(data);
  } catch {
    reject("입력 내용을 확인해 주세요.");
  }
}

export async function exchangeApi(request, response, url) {
  const send = (status, value) => {
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify(value));
  };
  try {
    const key = request.headers["x-bookmate-profile"];
    const profileId = typeof key === "string" && /^[a-f0-9-]{36}$/.test(key)
      ? createHash("sha256").update(key).digest("hex") : undefined;
    const token = request.headers.authorization?.replace(/^Bearer /, "");
    if (url.pathname === "/api/exchanges/profile" && profileId) {
      if (request.method === "GET") return send(200, previewProfile(profileId));
      if (request.method !== "PATCH") reject("지원하지 않는 요청이에요.", 405);
      const data = await body(request);
      const nickname = clean(data.nickname, 40);
      if (!nickname || typeof data.bio !== "string" || data.bio.length > 300 ||
          typeof data.profilePublic !== "boolean") reject("프로필을 확인해 주세요.");
      const profile = { nickname, bio: data.bio.trim(), profilePublic: data.profilePublic };
      persist({ ...rooms, profiles: { ...rooms.profiles, [profileId]: profile } });
      return send(200, profile);
    }
    const peer = /^\/api\/exchanges\/([A-F0-9]{8})\/members\/([0-9a-f-]{36})\/profile$/.exec(url.pathname);
    if (peer && request.method === "GET") {
      const room = rooms[peer[1]];
      if (!room?.members.some(m => m.token === token)) reject("먼저 방에 참가해 주세요.", 403);
      const target = room.members.find(m => m.id === peer[2]);
      if (!target) reject("참가자를 찾을 수 없어요.", 404);
      return send(200, rooms.profiles?.[target.profileId]?.profilePublic
        ? previewProfile(target.profileId) : { profilePublic: false });
    }
    const match = /^\/api\/exchanges(?:\/([A-F0-9]{8})(?:\/(join|start|finish|review|appearance|settings|order))?)?$/.exec(url.pathname);
    if (!match) reject("방을 찾을 수 없어요.", 404);
    const [, code, action] = match;
    if (request.method === "GET" && code && !action) {
      if (!rooms[code]) reject("방을 찾을 수 없어요.", 404);
      const room = rooms[code];
      const owner = room.members.find(m => m.token === token);
      if (owner && !owner.profileId && profileId) {
        save({ ...room, members: room.members.map(m => m === owner ? { ...m, profileId } : m) });
      }
      return send(200, view(rooms[code], token));
    }
    if (request.method !== "POST" || (code && !action)) reject("지원하지 않는 요청이에요.", 405);
    const input = await body(request);
    if (!input || typeof input !== "object") reject("입력 내용을 확인해 주세요.");
    if (!code) {
      if (typeof input.demo === "string") return send(201, demoRoom(input.demo, input.appearance, profileId));
      const options = roomOptions(input);
      const host = { ...member("소이", input.appearance), profileId };
      const room = { ...options, code: inviteCode(), members: [host], createdAt: new Date().toISOString() };
      save(room);
      return send(201, { room: view(room, host.token), token: host.token });
    }
    if (!rooms[code]) reject("방을 찾을 수 없어요.", 404);
    const room = structuredClone(rooms[code]);
    const me = room.members.findIndex(person => person.token === token);
    const now = new Date().toISOString();
    if (action === "join") {
      if (me >= 0) return send(200, { room: view(room, token), token });
      if (room.startedAt || room.members.length >= room.capacity) reject("이미 시작했거나 인원이 찬 방이에요.", 409);
      const person = { ...member("소이", input.appearance), profileId };
      room.members.push(person);
      save(room);
      return send(201, { room: view(room, person.token), token: person.token });
    }
    if (me < 0) reject("먼저 방에 참가해 주세요.", 403);
    const hostId = room.hostId ?? room.members[0].id;
    const isHost = room.members[me].id === hostId;
    if (action === "start") {
      if (!isHost) reject("방장만 시작할 수 있어요.", 403);
      if (room.startedAt) return send(200, view(room, token));
      if (room.members.length !== room.capacity) reject("참여 인원이 모두 모이면 시작할 수 있어요.", 409);
      room.startedAt = now;
      room.members[0].receivedAt = now;
    } else if (action === "settings") {
      if (!isHost) reject("방장만 방 옵션을 수정할 수 있어요.", 403);
      if (room.startedAt) reject("교환독서를 시작한 뒤에는 방 옵션을 수정할 수 없어요.", 409);
      Object.assign(room, roomOptions(input, room.members.length));
    } else if (action === "order") {
      if (!isHost) reject("방장만 독서 순서를 바꿀 수 있어요.", 403);
      if (room.startedAt) reject("교환독서를 시작한 뒤에는 순서를 바꿀 수 없어요.", 409);
      const byId = new Map(room.members.map(person => [person.id, person]));
      if (JSON.stringify(input.previous) !== JSON.stringify([...byId.keys()])) {
        reject("참가자 목록이 바뀌었어요. 새 목록에서 다시 시도해 주세요.", 409);
      }
      if (!Array.isArray(input.order) || input.order.length !== byId.size ||
          new Set(input.order).size !== byId.size || input.order.some(id => !byId.has(id))) {
        reject("참가자 순서를 확인해 주세요.");
      }
      room.hostId = hostId;
      room.members = input.order.map(id => byId.get(id));
    } else if (action === "appearance") {
      room.members[me].appearance = roomAppearance(input);
    } else {
      const person = room.members[me];
      if (action === "finish" && person.finishedAt) return send(200, view(room, token));
      if (action === "finish" && !person.receivedAt) reject("책을 받을 차례가 되면 완독을 기록할 수 있어요.", 409);
      if (action === "review" && !person.finishedAt) reject("완독한 책의 감상을 수정할 수 있어요.", 409);
      const rating = Number(input.rating);
      const review = clean(input.review, 160);
      if (!isRating(rating)) reject("별점을 선택해 주세요.");
      Object.assign(person, { rating, review, quote: clean(input.quote, 160) });
      if (action === "finish") {
        if (input.appearance) person.appearance = roomAppearance(input.appearance);
        person.finishedAt = now;
        const next = room.members[me + 1];
        if (next) next.receivedAt = now;
        else room.completedAt = now;
      }
    }
    save(room);
    return send(200, view(room, token));
  } catch (error) {
    if (!error.status) console.error(error);
    return send(error.status ?? 500, { message: error.status ? error.message : "방 데이터를 저장하지 못했어요." });
  }
}
