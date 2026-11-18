import { createSharedRecords } from "./shared-records.js";
import { setSharedRecords } from "./record-bridge.js";
import { connectRecords } from "./p2p-records.js";
import { serverMode, account } from "./account.js";
import { createLiveRoom } from "./live-client.js";
import { createRecords } from "./records.js";
import { localMode } from "./local-transport.js";
import { createChat } from "./chat.js";
import { isRating, setupRating } from "./rating.js";
import { exchangeCode, exchangeRequest, exchangeUrl, themes } from "./exchange-client.js";
import { avatarOptions, bottomPatterns, colorableBottoms, drawAvatar, drawAvatarOption, lockedAvatarOptions, normalizeAppearance, skinTone } from "./avatar.js";
const canvas = document.querySelector("#room");
const worldContext = canvas.getContext("2d");
const roomBackdrop = document.createElement("canvas");
roomBackdrop.width = canvas.width;
roomBackdrop.height = canvas.height;
const backdropContext = roomBackdrop.getContext("2d");
let ctx = worldContext;
let backdropHour;
const stage = document.createElement("div");
stage.className = "world-stage";
canvas.before(stage);
stage.append(canvas);
const mobileLayout = matchMedia("(max-width: 520px)");
const panelDefinitions = [
  [".book-section", "책 정보"],
  [".members-section", "참가자"],
];
for (const [selector, title] of panelDefinitions) {
  const section = document.querySelector(selector);
  const content = document.createElement("div");
  content.className = "section-content";
  content.id = selector.slice(1) + "-content";
  content.append(...section.childNodes);
  const toggle = document.createElement("button");
  toggle.className = "mobile-section-toggle";
  toggle.type = "button";
  toggle.setAttribute("aria-controls", content.id);
  toggle.setAttribute("aria-expanded", "false");
  toggle.textContent = title;
  toggle.setAttribute("aria-label", title);
  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(expanded));
    section.classList.toggle("expanded", expanded);
  });
  section.append(toggle, content);
}
const $ = (selector) => document.querySelector(selector);
let exchange;
if (exchangeCode) {
  try {
    exchange = await exchangeRequest(exchangeCode);
    if (exchange.me < 0 || !exchange.startedAt) throw new Error("방에 참가한 뒤 입장해 주세요.");
  } catch (error) {
    const message = document.createElement("p");
    message.textContent = error.message;
    const back = document.createElement("a");
    back.href = exchangeUrl(exchangeCode);
    back.textContent = "독서방 참가";
    document.querySelector("main").replaceChildren(message, back);
    throw error;
  }
}
const roomSuffix = exchange ? ":" + exchange.code : "";
const storageKey = "bookmate-pixel-prototype-v1" + roomSuffix;
const memberName = index => exchange?.members[index]?.name ?? "사용자 " + (index + 1);
const bookDetail = $(".book-detail");
const currentBook = {
  id: bookDetail.dataset.bookId,
  title: bookDetail.querySelector("h2").textContent.trim(),
  color: bookDetail.dataset.coverColor,
  art: bookDetail.dataset.coverArt,
};
if (exchange) {
  Object.assign(currentBook, { id: "exchange:" + exchange.title.normalize("NFC") + "\u0000" + exchange.author.normalize("NFC"), title: exchange.title, color: themes[exchange.theme] });
  $(".room-heading h1").textContent = exchange.title;
  bookDetail.querySelector("h2").textContent = exchange.title;
  bookDetail.querySelector(".cover span").textContent = exchange.title;
  bookDetail.querySelector(".cover").style.background = currentBook.color;
}
const petCollectionKey = "bookmate-book-pets-v1" + (serverMode && account ? ":"+account.id : "");
function readPets(value) {
  try {
    const books = JSON.parse(value);
    return Array.isArray(books) ? books.filter(book =>
      typeof book?.id === "string" && typeof book.title === "string" &&
      /^#[0-9a-f]{6}$/i.test(book.color) && /^#[0-9a-f]{6}$/i.test(book.art),
    ) : [];
  } catch {
    return [];
  }
}
let pets = [];
try {
  pets = readPets(localStorage.getItem(petCollectionKey));
} catch {
  // The current session can still use an earned pet if storage is blocked.
}
const capacity = exchange?.members.length ?? 4;
const petTrails = Array.from({ length: capacity }, () => []);
const appearanceKeys = Array.from({ length: capacity }, (_, slot) =>
  "bookmate-avatar-v1" + roomSuffix + ":" + slot,
);
function readAppearance(value) {
  try {
    const saved = JSON.parse(value);
    return { ...normalizeAppearance(saved), pet: typeof saved?.pet === "string" ? saved.pet : "" };
  } catch {
    return normalizeAppearance();
  }
}
const appearances = appearanceKeys.map((key, slot) => {
  try {
    const saved = localStorage.getItem(key);
    const legacy = exchange && slot === exchange.me ? localStorage.getItem("bookmate-avatar-v1:" + slot) : null;
    return readAppearance(saved ?? legacy);
  } catch {
    return normalizeAppearance();
  }
});
const demoSeats = [
  { x: 240, y: 192 },
  { x: 384, y: 192 },
  { x: 240, y: 304 },
  { x: 384, y: 304 },
];
const seats = capacity > demoSeats.length ? Array.from({ length: capacity }, (_, index) => ({
  x: 224 + 44 * Math.floor(index / 2),
  y: index % 2 === 0 ? 192 : 304,
})) : demoSeats.slice(0, capacity);
const obstacles = [
  { x: 0, y: 0, w: 640, h: 154 },
  { x: 0, y: 350, w: 86, h: 50 },
  { x: 18, y: 172, w: 68, h: 70 },
  { x: 104, y: 201, w: 44, h: 36 },
  { x: 560, y: 145, w: 80, h: 62 },
  { x: 208, y: 208, w: 208, h: 80 },
  { x: 554, y: 337, w: 86, h: 63 },
];
function initialState() {
  return {
    selected: exchange?.me ?? 0,
    holder: 0,
    motion: !matchMedia("(prefers-reduced-motion: reduce)").matches,
    users: exchange ? seats.map(({ x, y }, seat) => ({
      x, y, seat, done: false, page: 1, note: "",
    })) : [
      { x: 464, y: 304, seat: null, done: false, page: 1, note: "임시 문구2" },
      { x: 240, y: 192, seat: 0, done: false, page: 1, note: "임시 문구2" },
      { x: 384, y: 192, seat: 1, done: false, page: 1, note: "임시 문구2" },
      { x: 240, y: 304, seat: 2, done: false, page: 1, note: "임시 문구2" },
    ],
  };
}
let state = initialState();
try {
  const saved = JSON.parse(localStorage.getItem(storageKey));
  if (
    saved &&
    Number.isInteger(saved.selected) &&
    saved.selected >= 0 &&
    saved.selected < capacity &&
    Number.isInteger(saved.holder) &&
    saved.holder >= -1 &&
    saved.holder < capacity &&
    typeof saved.motion === "boolean" &&
    saved.users?.length === state.users.length &&
    saved.users.every(
      (u) =>
        Number.isFinite(u.x) &&
        u.x >= 24 &&
        u.x <= 616 &&
        Number.isFinite(u.y) &&
        u.y >= 160 &&
        u.y <= 376 &&
        (u.seat === null ||
          (Number.isInteger(u.seat) && u.seat >= 0 && u.seat < seats.length)) &&
        typeof u.done === "boolean" &&
        typeof u.note === "string" &&
        u.note.length <= 2000 &&
        Number.isInteger(u.page) &&
        u.page >= 1 &&
        u.page <= 99999,
    )
  )
    state = saved;
} catch {
  /* A fresh local prototype works when storage is unavailable. */
}
if (exchange) state.selected = exchange.me;
const slotPrefix = "bookmate-local-user-v1" + roomSuffix + ":";
const channel =
  localMode && typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("bookmate-room-v1" + roomSuffix)
    : null;
function validUser(user) {
  return (
    user &&
    Number.isFinite(user.x) &&
    user.x >= 24 &&
    user.x <= 616 &&
    Number.isFinite(user.y) &&
    user.y >= 160 &&
    user.y <= 376 &&
    (user.seat === null ||
      (Number.isInteger(user.seat) && user.seat >= 0 && user.seat < seats.length)) &&
    typeof user.done === "boolean" &&
    typeof user.note === "string" &&
    user.note.length <= 2000 &&
    Number.isInteger(user.page) &&
    user.page >= 1 &&
    user.page <= 99999
  );
}
if (localMode) {
  state.users.forEach((user, slot) => {
    try {
      const saved = JSON.parse(localStorage.getItem(slotPrefix + slot));
      if (validUser(saved)) state.users[slot] = saved;
    } catch {
      /* Use the existing local state. */
    }
  });
  window.addEventListener("storage", (event) => {
    if (!event.key?.startsWith(slotPrefix)) return;
    const slot = Number(event.key.slice(slotPrefix.length));
    try {
      const user = JSON.parse(event.newValue);
      if (
        Number.isInteger(slot) &&
        slot >= 0 &&
        slot < state.users.length &&
        slot !== state.selected &&
        validUser(user)
      ) {
        state.users[slot] = user;
        update();
      }
    } catch {
      /* Ignore malformed external state. */
    }
  });
}
if (channel)
  channel.onmessage = ({ data }) => {
    if (
      Number.isInteger(data?.slot) &&
      data.slot >= 0 &&
      data.slot < state.users.length &&
      data.slot !== state.selected &&
      validUser(data.user)
    ) {
      state.users[data.slot] = data.user;
      update();
    }
  };
let lastBroadcast = 0;
function broadcastUser() {
  live?.publish(state.users[state.selected]);
  channel?.postMessage({
    slot: state.selected,
    user: state.users[state.selected],
  });
}
const modeLabel = document.querySelector(".local");
if (modeLabel) modeLabel.textContent = localMode ? "로컬" : "서버";
let onlineSlots = new Set();
let path = [];
let pendingSeat = null;
let target = null;
let walking = false;
let lastTime = 0;
let toastTimer;
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 1700);
}
function save() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
    if (localMode)
      localStorage.setItem(
        slotPrefix + state.selected,
        JSON.stringify(state.users[state.selected]),
      );
    broadcastUser();
  } catch {
    toast("저장 실패");
  }
}
function rect(x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}
function outline(x, y, w, h, color, width = 1) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);
}
function shelf(x, y, width, rows = 3) {
  rect(x, y, width, rows * 32 + 14, "#362b26");
  rect(x + 4, y + 4, width - 8, rows * 32 + 5, "#67442f");
  const palette = [
    "#a17552",
    "#a09d77",
    "#54736b",
    "#715453",
    "#b29462",
    "#364b54",
  ];
  for (let row = 0; row < rows; row++) {
    rect(x + 7, y + 7 + row * 32, width - 14, 27, "#302d29");
    for (let n = 0; n < Math.floor((width - 18) / 9); n++) {
      const h = 17 + ((n * 7 + row * 3) % 9);
      rect(
        x + 10 + n * 9,
        y + 33 + row * 32 - h,
        6,
        h,
        palette[(n + row * 2) % palette.length],
      );
      rect(x + 11 + n * 9, y + 37 + row * 32 - h, 4, 1, "#ceb88b");
    }
    rect(x + 4, y + 34 + row * 32, width - 8, 4, "#99704b");
  }
  rect(x, y + rows * 32 + 8, width, 7, "#352d27");
}
function plant(x, y) {
  rect(x - 11, y - 4, 22, 16, "#b8aa85");
  rect(x - 8, y + 12, 16, 3, "#514c3e");
  rect(x - 2, y - 31, 4, 28, "#59613c");
  [
    [-15, -26, 14, 9],
    [1, -37, 16, 10],
    [-9, -43, 11, 14],
    [3, -20, 18, 8],
    [-20, -12, 18, 7],
  ].forEach(([dx, dy, w, h], i) => {
    rect(x + dx, y + dy, w, h, i % 2 ? "#7a8b50" : "#526e4d");
    rect(x + dx + 2, y + dy, w - 4, 2, "#9ca35c");
  });
}
function lamp(x, y) {
  rect(x - 11, y + 9, 22, 4, "#59442d");
  rect(x - 2, y - 23, 4, 32, "#bc8b48");
  rect(x - 9, y - 36, 18, 8, "#ebc878");
  rect(x - 14, y - 28, 28, 10, "#f2d58b");
  rect(x - 18, y - 18, 36, 4, "#d3a858");
  rect(x - 10, y - 28, 4, 10, "#fff0b1");
}
const windowPalettes = {
  morning: ["#e6ac99", "#f4d3a8", "#788d94", "#c4ac91", "#fff0bc"],
  day: ["#7cb9d3", "#bcdee4", "#638581", "#89a39b", "#fff1b6"],
  evening: ["#806c99", "#e8a382", "#444661", "#edbf83", "#ffd399"],
  night: ["#303a58", "#55546c", "#263343", "#bca66c", "#dcded5"],
};
function drawWindow(hour) {
  const period = hour < 5 || hour >= 20 ? "night"
    : hour < 8 ? "morning" : hour < 17 ? "day" : "evening";
  const [sky, horizon, buildings, lights, sun] = windowPalettes[period];
  rect(26, 25, 120, 105, "#a88b60");
  rect(32, 30, 108, 94, sky);
  rect(32, 83, 108, 41, horizon);
  const sunY = { morning: 62, day: 39, evening: 65, night: 39 }[period];
  rect(105, sunY, 12, 12, sun);
  rect(102, sunY + 3, 18, 6, sun);
  if (period === "night") {
    rect(110, sunY - 1, 10, 9, sky);
    for (const [x, y] of [[45, 42], [127, 58], [74, 38], [96, 69]]) {
      rect(x, y, 2, 2, sun);
    }
  } else {
    rect(45, 51, 19, 3, "#fff0dcac");
    rect(49, 48, 9, 3, "#fff0dcac");
    rect(68, 63, 12, 3, "#fff0dcac");
  }
  for (let i = 0; i < 9; i++) {
    const h = 12 + ((i * 11) % 32);
    rect(34 + i * 12, 124 - h, 10, h, buildings);
    rect(37 + i * 12, 128 - h, 2, 3, lights);
  }
  rect(83, 30, 4, 94, "#9e845d");
  rect(32, 77, 108, 4, "#9e845d");
  rect(20, 22, 15, 108, "#b09272");
  rect(137, 22, 14, 108, "#b09272");
  for (let x = 22; x < 36; x += 5) rect(x, 24, 2, 102, "#c7ad8d");
  rect(22, 127, 130, 5, "#c1a078");
}
function room(hour) {
  rect(0, 0, 640, 400, "#79583b");
  for (let row = 0; row < 17; row++) {
    for (let col = -1; col < 12; col++) {
      const x = col * 64 + (row % 2) * 32;
      const y = 150 + row * 16;
      rect(
        x,
        y,
        63,
        15,
        ["#886444", "#916b49", "#9c744e", "#836143"][(row * 3 + col + 13) % 4],
      );
      rect(x + 8, y + 4, 31, 1, "#a17a52");
      rect(x + 29, y + 11, 25, 1, "#73583e");
    }
  }
  rect(0, 0, 640, 145, "#20383b");
  for (let x = 0; x < 640; x += 80) {
    rect(x, 10, 4, 131, "#14292d");
    outline(x + 9, 16, 60, 115, "#355050", 2);
  }
  rect(0, 0, 640, 8, "#10252b");
  rect(0, 8, 640, 3, "#41605b");
  rect(0, 140, 640, 10, "#122b2e");
  rect(0, 150, 640, 4, "#a07850");
  drawWindow(hour);
  shelf(184, 22, 174);
  shelf(372, 22, 166);
  rect(557, 34, 51, 61, "#9b7753");
  rect(561, 38, 43, 53, "#c0b591");
  rect(566, 43, 33, 43, "#506465");
  rect(566, 69, 33, 17, "#82916e");
  plant(583, 153);
  plant(170, 152);
  // Rug.
  rect(171, 178, 290, 160, "#b6a884");
  rect(175, 182, 282, 152, "#53645b");
  outline(183, 190, 266, 136, "#b1a079", 3);
  for (let x = 182; x < 451; x += 12) {
    rect(x, 185, 5, 3, "#c3b18c");
    rect(x, 328, 5, 3, "#c3b18c");
  }
  for (let y = 194; y < 324; y += 14) {
    rect(178, y, 3, 5, "#c3b18c");
    rect(450, y, 3, 5, "#c3b18c");
  }
  // Small side furniture.
  rect(19, 185, 65, 49, "#25312e");
  rect(23, 173, 57, 48, "#60766a");
  rect(29, 178, 44, 25, "#748675");
  rect(28, 208, 47, 20, "#7f8e7c");
  rect(18, 197, 10, 34, "#4b6359");
  rect(74, 197, 11, 34, "#4b6359");
  rect(22, 231, 5, 12, "#453c2b");
  rect(72, 231, 5, 12, "#453c2b");
  rect(104, 201, 44, 9, "#a17a51");
  rect(108, 210, 4, 29, "#4b392a");
  rect(139, 210, 4, 29, "#4b392a");
  lamp(125, 193);
  shelf(0, 349, 75, 1);
  plant(35, 341);
  shelf(565, 345, 75, 1);
  lamp(597, 341);
}
function chair(index) {
  const seat = seats[index];
  rect(seat.x - 15, seat.y - 6, 30, 19, "#3b3027");
  rect(seat.x - 13, seat.y - 9, 26, 16, "#a27a4f");
  rect(seat.x - 16, seat.y - 30, 32, 9, "#916b42");
  rect(seat.x - 15, seat.y - 21, 4, 17, "#674d31");
  rect(seat.x + 11, seat.y - 21, 4, 17, "#674d31");
  rect(seat.x - 12, seat.y + 11, 4, 13, "#493a2a");
  rect(seat.x + 8, seat.y + 11, 4, 13, "#493a2a");
  if (!state.users.some((user) => user.seat === index))
    outline(seat.x - 17, seat.y - 12, 34, 29, "#82d9b0");
}
function avatar(user, index, time) {
  const x = Math.round(user.x),
    y = Math.round(user.y);
  const step =
    state.motion && walking && index === state.selected
      ? Math.round(Math.sin(time / 90) * 2)
      : 0;
  rect(x - 13, y + 1, 26, 5, "#27382d70");
  if (index === state.selected)
    outline(x - 17, y - 3, 34, 10, "#82d9b0", 2);
  drawAvatar(ctx, x - 14, y - 30, index, appearances[index], { step });
  if (user.seat !== null) {
    rect(x - 12, y - 12, 11, 9, "#d9d6ac");
    rect(x + 1, y - 12, 11, 9, "#eee4c1");
    rect(x - 1, y - 12, 2, 10, "#6a7c64");
  }
}
function drawBookPet(context, book, x, y, scale = 1) {
  const fill = (left, top, width, height, color) => {
    context.fillStyle = color;
    context.fillRect(x + left * scale, y + top * scale, width * scale, height * scale);
  };
  fill(0, 0, 14, 17, "#38342e");
  fill(2, 2, 11, 14, book.color);
  fill(11, 2, 2, 14, "#ffebd58c");
  fill(3, 6, 7, 1, book.art);
  fill(3, 8, 4, 1, book.art);
  fill(3, 13, 8, 3, book.art);
  fill(6, 11, 2, 3, book.art);
}
function petPosition(user, index) {
  const trail = petTrails[index];
  const latest = trail.at(-1);
  if (!latest || Math.hypot(latest.x - user.x, latest.y - user.y) > 80) {
    trail.splice(0, trail.length, {
      x: user.x > 570 ? user.x - 25 : user.x + 25,
      y: user.y,
    }, { x: user.x, y: user.y });
  } else if (Math.hypot(latest.x - user.x, latest.y - user.y) >= 1) {
    trail.push({ x: user.x, y: user.y });
  }
  let distance = 24;
  for (let i = trail.length - 1; i > 0; i--) {
    const from = trail[i];
    const to = trail[i - 1];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length >= distance) {
      const fraction = distance / length;
      trail.splice(0, i - 1);
      return { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction };
    }
    distance -= length;
  }
  return trail[0];
}
function table() {
  rect(205, 208, 215, 87, "#3b3028");
  rect(212, 275, 9, 33, "#4d3928");
  rect(399, 275, 9, 33, "#4d3928");
  rect(205, 203, 215, 74, "#b08050");
  rect(209, 207, 207, 65, "#a9794b");
  for (let y = 210; y < 271; y += 15) {
    rect(211, y, 203, 1, "#88613e");
    rect(232, y + 5, 49, 1, "#ba8c58");
  }
  rect(205, 272, 215, 5, "#cc9b62");
  lamp(313, 241);
  rect(343, 238, 25, 5, "#dad5b4");
  rect(341, 235, 27, 3, "#536b5b");
  rect(344, 244, 25, 5, "#a26c50");
  rect(273, 242, 9, 12, "#d3c4a1");
  outline(282, 245, 4, 5, "#d3c4a1", 2);
}
const avatarLabels = state.users.map((_, index) => {
  const element = document.createElement("span");
  element.className = "avatar-label";
  element.textContent = memberName(index);
  stage.append(element);
  return element;
});
const readingBadge = document.createElement("span");
readingBadge.className = "reading-badge";
readingBadge.textContent = "독서중…";
const petLabels = state.users.map(() => {
  const label = document.createElement("span");
  label.className = "pet-book-label";
  label.hidden = true;
  stage.append(label);
  return label;
});
function label(user, index) {
  const element = avatarLabels[index];
  element.classList.toggle("offline", !onlineSlots.has(index));
  element.style.left = (user.x / 640) * 100 + "%";
  element.style.top = ((user.y - 37) / 400) * 100 + "%";
  element.classList.toggle("active", index === state.selected);
  if (index === state.holder && readingBadge.parentElement !== element) element.append(readingBadge);
}
function draw(time) {
  let offset = 0;
  if (mobileLayout.matches) {
    const viewportWidth = canvas.parentElement.parentElement.clientWidth;
    const stageWidth = stage.clientWidth;
    const desiredOffset =
      (state.users[state.selected].x / 640) * stageWidth - viewportWidth / 2;
    offset = -Math.max(
      0,
      Math.min(stageWidth - viewportWidth, desiredOffset),
    );
  }
  if (stage.dataset.offsetX !== String(offset)) {
    stage.dataset.offsetX = String(offset);
    stage.style.transform = "translate3d(" + offset + "px, 0, 0)";
  }
  const hour = new Date().getHours();
  if (backdropHour !== hour) {
    ctx = backdropContext;
    room(hour);
    ctx = worldContext;
    backdropHour = hour;
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(roomBackdrop, 0, 0);
  seats.forEach((_, i) => chair(i));
  const objects = state.users.map((user, index) => ({
    y: user.y,
    draw: () => {
      ctx.save();
      if (!onlineSlots.has(index)) ctx.filter = "grayscale(1)";
      avatar(user, index, time);
      ctx.restore();
    },
  }));
  state.users.forEach((user, index) => {
    const pet = pets.find(book => book.id === appearances[index].pet);
    const label = petLabels[index];
    label.hidden = !pet;
    if (!pet) {
      petTrails[index].length = 0;
      return;
    }
    const { x, y } = petPosition(user, index);
    if (label.textContent !== pet.title) label.textContent = pet.title;
    label.style.left = (x / 640) * 100 + "%";
    label.style.top = ((y + 3) / 400) * 100 + "%";
    objects.push({
      y,
      draw() {
        rect(x - 7, y, 14, 3, "#27382d70");
        drawBookPet(ctx, pet, Math.round(x - 7), Math.round(y - 17));
      },
    });
  });
  objects.push({ y: 276, draw: table });
  objects.sort((a, b) => a.y - b.y).forEach((object) => object.draw());
  state.users.forEach(label);
  readingBadge.hidden = state.holder < 0;
  chat.positionBubbles();
  if (target && walking)
    outline(target.x - 5, target.y - 3, 10, 6, "#a6efd0", 1);
}
function isWalkable(x, y) {
  return (
    x >= 24 &&
    x <= 616 &&
    y >= 160 &&
    y <= 376 &&
    !obstacles.some(
      (o) =>
        x >= o.x - 8 &&
        x <= o.x + o.w + 8 &&
        y >= o.y - 4 &&
        y <= o.y + o.h + 4,
    )
  );
}
function findPath(start, destination) {
  const snap = (value) => Math.round(value / 8) * 8;
  const origin = { x: snap(start.x), y: snap(start.y) };
  const end = { x: snap(destination.x), y: snap(destination.y) };
  if (!isWalkable(end.x, end.y)) return null;
  const key = (p) => p.x + "," + p.y;
  const queue = [origin],
    parents = new Map([[key(origin), null]]);
  for (let head = 0; head < queue.length; head++) {
    const point = queue[head];
    if (key(point) === key(end)) {
      const result = [];
      let node = point;
      while (parents.get(key(node)) !== null) {
        result.push(node);
        node = parents.get(key(node));
      }
      return result.reverse();
    }
    for (const [dx, dy] of [
      [8, 0],
      [-8, 0],
      [0, 8],
      [0, -8],
    ]) {
      const next = { x: point.x + dx, y: point.y + dy };
      if (isWalkable(next.x, next.y) && !parents.has(key(next))) {
        parents.set(key(next), point);
        queue.push(next);
      }
    }
  }
  return null;
}
function moveTo(x, y, seat = null) {
  const user = state.users[state.selected];
  const nextPath = findPath(user, { x, y });
  if (!nextPath) {
    toast("이동 불가");
    return;
  }
  user.seat = null;
  path = nextPath;
  pendingSeat = seat;
  target = { x, y };
  walking = path.length > 0;
  if (!walking) finishMovement();
  update();
}
function finishMovement() {
  walking = false;
  if (pendingSeat !== null) state.users[state.selected].seat = pendingSeat;
  pendingSeat = null;
  target = null;
  save();
  update();
}
function sit(index) {
  if (state.users.some((u, i) => u.seat === index && i !== state.selected)) {
    toast("사용 중");
    return;
  }
  moveTo(seats[index].x, seats[index].y, index);
}
function canOpenRecords() {
  return state.selected === state.holder || state.users[state.selected].done;
}
function update() {
  if (exchange) {
    exchange.members.forEach((person, index) => {
      state.users[index].done = Boolean(person.finishedAt);
      if (person.appearance) appearances[index] = { ...normalizeAppearance(person.appearance), pet: person.appearance.pet ?? appearances[index].pet };
    });
    state.holder = exchange.members.findIndex(person => person.receivedAt && !person.finishedAt);
  } else {
    state.holder = state.users.findIndex(person => !person.done);
  }
  unlockBookPet();
  const user = state.users[state.selected];
  $("#chat-sender").textContent = memberName(state.selected);
  $(".room-count").textContent = onlineSlots.size + "명 온라인";
  $("#selected-label").textContent = memberName(state.selected);
  $("#action-state").textContent =
    user.seat !== null ? "착석" : walking ? "이동 중" : "이동 가능";
  $("#sit").textContent = user.seat !== null ? "일어나기" : "앉기";
  $("#holder").textContent = state.holder >= 0 ? memberName(state.holder) : "모두 완독";
  const isReading = state.selected === state.holder;
  const complete = $("#complete");
  complete.hidden = complete.disabled = !isReading;
  complete.textContent = "책 전달하기";
  const canReadRecords = canOpenRecords();
  $("#record").hidden = !canReadRecords;
  if (!canReadRecords && $("#record-dialog").open) $("#record-dialog").close();
  if (!canReadRecords && $("#record-feed").open) $("#record-feed").close();
  records.sync();
  $("#motion").checked = state.motion;
  const members = $("#members");
  members.replaceChildren();
  state.users.forEach((member, index) => {
    const button = document.createElement("button");
    button.className = "member" + (index === state.selected ? " selected" : "");
    button.setAttribute("aria-pressed", String(index === state.selected));
    const mini = document.createElement("canvas");
    mini.width = 36;
    mini.height = 40;
    mini.setAttribute("aria-hidden", "true");
    mini.className =
      "member-avatar" + (onlineSlots.has(index) ? "" : " offline");
    drawAvatar(mini.getContext("2d"), 4, 10, index, appearances[index]);
    const name = document.createElement("span");
    name.className = "member-name";
    name.textContent = memberName(index);
    const status = document.createElement("span");
    status.className = "member-state";
    status.textContent = !onlineSlots.has(index)
      ? "오프라인"
      : member.done
        ? "완료"
        : member.seat !== null
          ? "착석"
          : "대기";
    button.append(mini, name, status);
    if (exchange && index !== state.selected) button.disabled = true;
    button.addEventListener("click", () => {
      path = [];
      walking = false;
      pendingSeat = null;
      target = null;
      if (localMode) {
        try {
          const saved = JSON.parse(localStorage.getItem(slotPrefix + index));
          if (validUser(saved)) state.users[index] = saved;
        } catch {
          /* Keep current state. */
        }
      }
      state.selected = index;
      void chat.heartbeat();
      save();
      update();
    });
    members.append(button);
  });
}
canvas.addEventListener("pointerdown", (event) => {
  canvas.focus();
  const bounds = canvas.getBoundingClientRect();
  const x = ((event.clientX - bounds.left) * 640) / bounds.width;
  const y = ((event.clientY - bounds.top) * 400) / bounds.height;
  const seat = seats.findIndex(
    (s) => Math.abs(s.x - x) < 22 && y >= s.y - 32 && y <= s.y + 20,
  );
  if (seat >= 0) sit(seat);
  else moveTo(x, y);
});
function step(direction) {
  const [dx, dy] = {
    left: [-16, 0],
    right: [16, 0],
    up: [0, -16],
    down: [0, 16],
  }[direction];
  const user = state.users[state.selected];
  moveTo(user.x + dx, user.y + dy);
}
canvas.addEventListener("keydown", (event) => {
  const direction = {
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowUp: "up",
    ArrowDown: "down",
  }[event.key];
  if (direction) {
    event.preventDefault();
    step(direction);
  }
});
document
  .querySelectorAll("[data-direction]")
  .forEach((button) =>
    button.addEventListener("click", () => step(button.dataset.direction)),
  );
$("#sit").addEventListener("click", () => {
  const user = state.users[state.selected];
  if (user.seat !== null) {
    const offset = seats[user.seat].y < 240 ? -24 : 24;
    moveTo(user.x, user.y + offset);
  } else {
    const available = seats
      .map((seat, index) => ({ ...seat, index }))
      .filter((seat) => !state.users.some((u) => u.seat === seat.index))
      .sort(
        (a, b) =>
          Math.hypot(a.x - user.x, a.y - user.y) -
          Math.hypot(b.x - user.x, b.y - user.y),
      );
    if (available.length) sit(available[0].index);
    else toast("빈자리 없음");
  }
});
const sharedRecords = exchange && serverMode ? createSharedRecords(exchange) : null;
if(sharedRecords)setSharedRecords(sharedRecords);
const records = createRecords({
  getSelected: () => state.selected,
  getUsers: () => state.users,
  canOpen: canOpenRecords,
  memberName,
  onSave(page) {
    state.users[state.selected].page = page;
    save();
    update();
  },
});
function openRecords() {
  if (canOpenRecords()) records.open();
}
$("#record").addEventListener("click", openRecords);
$("#complete").addEventListener("click", () => {
  if (state.selected !== state.holder) return;
  $("#finish-status").textContent = "";
  $("#finish-dialog").showModal();
});
setupRating($("#finish-form"));
$("#finish-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (state.selected !== state.holder || !form.reportValidity()) return;
  const review = Object.fromEntries(new FormData(form));
  const rating = Number(review.rating);
  if (!isRating(rating)) {
    $("#finish-status").textContent = "별점을 선택해 주세요.";
    return;
  }
  if (!exchange) {
    Object.assign(state.users[state.selected], { ...review, rating, done: true });
    const earned = unlockBookPet();
    update();
    save();
    form.reset();
    $("#finish-dialog").close();
    toast(earned ? "교환독서 완료! 책 표지 펫을 얻었어요." : state.holder < 0 ? "모두 완독했어요." : "다음 참가자에게 책을 전달했어요.");
    return;
  }
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    exchange = await exchangeRequest(exchangeCode, "finish", {
      ...review, appearance: appearances[state.selected],
    });
    update();
    form.reset();
    $("#finish-dialog").close();
    toast(exchange.completedAt ? "모두 완독했어요. 히스토리를 열어 보세요." : "다음 참가자에게 책을 전달했어요.");
  } catch (error) {
    $("#finish-status").textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});
function unlockBookPet() {
  if (!state.users.every(user => user.done) || pets.some(book => book.id === currentBook.id)) return false;
  try {
    const saved = readPets(localStorage.getItem(petCollectionKey));
    pets = saved.some(book => book.id === currentBook.id) ? saved : [...saved, currentBook];
    localStorage.setItem(petCollectionKey, JSON.stringify(pets));
  } catch {
    if (!pets.some(book => book.id === currentBook.id)) pets = [...pets, currentBook];
  }
  return true;
}
const avatarDialog = $("#avatar-dialog");
const avatarForm = $("#avatar-form");
const avatarPreview = $("#avatar-preview").getContext("2d");
const avatarStatus = $("#avatar-status");
const categoryBar = $(".avatar-categories");
const optionGroups = $(".avatar-options");
const optionPreviews = [];
const avatarMenus = {
  hair: { title: "헤어", options: ["hairstyle", "hair"] },
  skin: { title: "피부", options: ["skin"] },
  top: { title: "상의", options: ["top", "clothes"] },
  bottom: { title: "하의", options: ["bottom", "bottomColor"] },
  shoes: { title: "신발", options: ["shoes"] },
  accessory: { title: "액세서리", options: ["accessory"] },
  expression: { title: "표정", options: ["expression"] },
  pet: { title: "펫", options: ["pet"] },
};
const optionFields = new Map();
let activeCategory = "hair";
let showTopColors = false;
let editingSlot = 0;

function draftAppearance() {
  return normalizeAppearance(Object.fromEntries(new FormData(avatarForm)));
}
const costumeParts = ["bottom", "bottomColor", "shoes", "accessory"];
const isCostume = top => lockedAvatarOptions(top).includes("bottom");
let previousTop = "tee";
let costumeNoticeAnimation;
const costumeNotice = $("#costume-notice");

function leaveCostume(category) {
  if (!costumeParts.includes(category) || !isCostume(avatarForm.elements.top.value)) return;
  avatarForm.elements.top.value = previousTop;
  costumeNoticeAnimation?.cancel();
  costumeNotice.textContent = "";
  previewAppearance();
}
function previewAppearance() {
  const draft = draftAppearance();
  const locked = lockedAvatarOptions(draft.top);
  const wearingOveralls = draft.bottom === "overalls" && !isCostume(draft.top);
  for (const input of optionFields.get("top").querySelectorAll('input[name="top"]')) {
    input.disabled = wearingOveralls && input.value !== "tee";
  }
  optionFields.get("clothes").hidden = wearingOveralls || !showTopColors || locked.includes("clothes");
  optionFields.get("bottomColor").hidden = !colorableBottoms.has(draft.bottom) || locked.includes("bottomColor");
  avatarPreview.clearRect(0, 0, avatarPreview.canvas.width, avatarPreview.canvas.height);
  drawAvatar(avatarPreview, 30, 39, editingSlot, draft, { scale: 3.6 });
  const pet = pets.find(book => book.id === new FormData(avatarForm).get("pet"));
  if (pet) drawBookPet(avatarPreview, pet, 142, 92, 2);
  $("#avatar-pet-title").textContent = pet?.title ?? "";
  skinShade.style.background = `linear-gradient(90deg, ${skinTone(draft.skin, 0)}, ${skinTone(draft.skin, 50)}, ${skinTone(draft.skin, 100)})`;
  for (const { context, category, value } of optionPreviews) {
    if (avatarMenus[activeCategory].options.includes(category)) {
      drawAvatarOption(context, category, value, editingSlot, draft);
    }
  }
}
function setAppearanceFields(appearance) {
  for (const input of avatarForm.querySelectorAll('input[type="radio"]')) {
    input.checked = input.value === (appearance[input.name] ?? "");
  }
  skinShade.value = appearance.skinShade;
  avatarStatus.hidden = true;
  previewAppearance();
}
function showCategory(category) {
  activeCategory = category;
  optionGroups.scrollTop = 0;
  for (const button of categoryBar.children) {
    button.setAttribute("aria-pressed", String(button.dataset.category === category));
  }
  for (const group of optionGroups.children) group.hidden = group.dataset.category !== category;
  previewAppearance();
}
function addCategory(category, title) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "avatar-category";
  button.dataset.category = category;
  button.textContent = title;
  button.addEventListener("click", () => showCategory(category));
  categoryBar.append(button);
  const group = document.createElement("div");
  group.dataset.category = category;
  optionGroups.append(group);
  return group;
}
function makeTile(tiles, category, value, caption) {
  const tile = document.createElement("label");
  tile.className = "avatar-tile";
  const input = document.createElement("input");
  input.type = "radio";
  input.name = category;
  input.value = value;
  const face = document.createElement("span");
  face.className = "avatar-tile-face";
  tile.append(input, face);
  tiles.append(tile);
  if (caption) {
    const text = document.createElement("span");
    text.textContent = caption;
    face.append(text);
  }
  return { input, face };
}
function addOptionField(category) {
  const { title, items, sections } = avatarOptions[category];
  const group = document.createElement("fieldset");
  group.dataset.option = category;
  const legend = document.createElement("legend");
  legend.textContent = title;
  if (["top", "bottom", "accessory", "expression"].includes(category)) legend.className = "sr-only";
  group.append(legend);
  optionFields.set(category, group);
  for (const [heading, keys] of sections ?? [["", Object.keys(items)]]) {
    if (heading) {
      const label = document.createElement("h3");
      label.className = "avatar-section-heading";
      label.textContent = heading;
      group.append(label);
    }
    const tiles = document.createElement("div");
    tiles.className = "avatar-tiles";
    for (const [index, value] of keys.entries()) {
      const label = items[value];
      const swatchCategory = category === "skin" || category === "shoes" || (category === "bottomColor" && value !== "default");
      const { input, face } = makeTile(tiles, category, value, swatchCategory ? "" : label);
      if (swatchCategory) {
        const swatch = document.createElement("span");
        swatch.className = "skin-swatch";
        swatch.style.background = bottomPatterns[value] ?? label;
        swatch.setAttribute("aria-hidden", "true");
        const toneNames = { peach: "밝은 피부색", sand: "중간 피부색", bronze: "구릿빛", umber: "짙은 갈색", lime: "연두", red: "빨강", gray: "회색", blue: "파랑", violet: "보라" };
        input.setAttribute("aria-label", category === "skin" ? toneNames[value] : category === "bottomColor" ? (Object.hasOwn(bottomPatterns, value) ? label : avatarOptions.clothes.items[value] ?? "검정") : title + " " + (index + 1));
        face.append(swatch);
      } else if (value !== "none" && category !== "bottomColor") {
        const icon = document.createElement("canvas");
        icon.width = icon.height = 40;
        icon.setAttribute("aria-hidden", "true");
        optionPreviews.push({ context: icon.getContext("2d"), category, value });
        face.prepend(icon);
      }
    }
    group.append(tiles);
  }
  return group;
}
for (const [category, { title, options }] of Object.entries(avatarMenus)) {
  const panel = addCategory(category, title);
  for (const option of options) {
    if (option !== "pet") panel.append(addOptionField(option));
  }
}
optionFields.get("top").querySelector(".avatar-tiles").after(optionFields.get("clothes"));
const skinControl = document.createElement("label");
skinControl.className = "skin-control";
skinControl.textContent = "피부색 밝기";
const skinShade = document.createElement("input");
skinShade.type = "range";
skinShade.name = "skinShade";
skinShade.min = "0";
skinShade.max = "100";
skinShade.value = "50";
skinControl.append(skinShade);
optionFields.get("skin").append(skinControl);

const petGroup = optionGroups.querySelector('[data-category="pet"]');
const petTiles = document.createElement("div");
petTiles.className = "avatar-tiles";
const petHint = document.createElement("p");
petHint.className = "pet-empty";
petHint.textContent = "교환독서를 완료하면 나만의 책 펫이 생겨요.";
petGroup.append(petTiles, petHint);
function renderPetOptions(selectedPet = "") {
  petTiles.replaceChildren();
  petHint.hidden = pets.length > 0;
  makeTile(petTiles, "pet", "", "없음").input.checked = !pets.some(book => book.id === selectedPet);
  for (const book of pets) {
    const { input, face } = makeTile(petTiles, "pet", book.id, book.title);
    input.checked = book.id === selectedPet;
    const cover = document.createElement("canvas");
    cover.width = cover.height = 40;
    cover.setAttribute("aria-hidden", "true");
    drawBookPet(cover.getContext("2d"), book, 6, 3, 2);
    face.prepend(cover);
  }
}
$("#customize-avatar").addEventListener("click", () => {
  editingSlot = state.selected;
  previousTop = isCostume(appearances[editingSlot].top) ? "tee" : appearances[editingSlot].top;
  showTopColors = false;
  $("#avatar-owner").textContent = memberName(editingSlot);
  renderPetOptions(appearances[editingSlot].pet);
  setAppearanceFields(appearances[editingSlot]);
  showCategory("hair");
  avatarDialog.showModal();
});
avatarForm.addEventListener("change", event => {
  const { name, value } = event.target;
  if (name === "top") {
    showTopColors = true;
    if (isCostume(value)) {
      costumeNoticeAnimation?.cancel();
      costumeNotice.textContent = "코스튬에는 하의, 신발, 액세서리가 포함돼요.";
      const end = matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 0;
      costumeNoticeAnimation = costumeNotice.animate(
        [{ opacity: 1 }, { opacity: 1, offset: .72 }, { opacity: end }], 1800,
      );
      costumeNoticeAnimation.onfinish = () => { costumeNotice.textContent = ""; };
    } else {
      previousTop = value;
      costumeNoticeAnimation?.cancel();
      costumeNotice.textContent = "";
    }
  } else {
    applyPartSelection(event.target);
  }
  previewAppearance();
});
function applyPartSelection({ name, value }) {
  leaveCostume(name);
  if (name === "bottom" && value === "overalls") {
    avatarForm.elements.top.value = "tee";
    avatarForm.elements.clothes.value = "default";
    previousTop = "tee";
    previewAppearance();
  }
}
avatarForm.addEventListener("click", event => applyPartSelection(event.target));
avatarDialog.addEventListener("close", () => {
  costumeNoticeAnimation?.cancel();
  costumeNotice.textContent = "";
});
optionFields.get("top").addEventListener("click", event => {
  if (event.target.name === "top" && !showTopColors) {
    showTopColors = true;
    previewAppearance();
  }
});
skinShade.addEventListener("input", previewAppearance);
$("#avatar-defaults").addEventListener("click", () => {
  previousTop = "tee";
  costumeNoticeAnimation?.cancel();
  costumeNotice.textContent = "";
  setAppearanceFields({ ...normalizeAppearance(), pet: new FormData(avatarForm).get("pet") ?? "" });
});
avatarForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const pet = new FormData(avatarForm).get("pet");
  const appearance = { ...draftAppearance(), pet: pets.some(book => book.id === pet) ? pet : "" };
  const submit = avatarForm.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    if (exchange) exchange = await exchangeRequest(exchangeCode, "appearance", appearance);
    localStorage.setItem(appearanceKeys[editingSlot], JSON.stringify(appearance));
  } catch {
    avatarStatus.textContent = "캐릭터를 저장하지 못했어요. 브라우저 저장소 설정을 확인해 주세요.";
    avatarStatus.hidden = false;
    return;
  } finally {
    submit.disabled = false;
  }
  appearances[editingSlot] = appearance;
  update();
  avatarDialog.close();
  toast("캐릭터 외형을 저장했어요.");
});
window.addEventListener("storage", (event) => {
  if (event.key === petCollectionKey || event.key === null) {
    pets = readPets(event.newValue);
    if (avatarDialog.open) {
      renderPetOptions(new FormData(avatarForm).get("pet"));
      previewAppearance();
    }
    if (event.key !== null) return;
  }
  if (event.key === null) {
    appearances.fill(normalizeAppearance());
  } else {
    const slot = appearanceKeys.indexOf(event.key);
    if (slot === -1) return;
    appearances[slot] = readAppearance(event.newValue);
  }
  update();
});
$("#settings").addEventListener("click", () =>
  $("#settings-dialog").showModal(),
);
document
  .querySelectorAll(".close")
  .forEach((button) =>
    button.addEventListener("click", () => button.closest("dialog").close()),
  );
$("#motion").addEventListener("change", (event) => {
  state.motion = event.target.checked;
  save();
});
$("#reset").addEventListener("click", () => {
  state = initialState();
  if (localMode) {
    try {
      state.users.forEach((user, slot) =>
        localStorage.setItem(slotPrefix + slot, JSON.stringify(user)),
      );
    } catch {
      toast("저장 실패");
    }
  }
  void chat.heartbeat();
  path = [];
  pendingSeat = null;
  walking = false;
  target = null;
  save();
  update();
  $("#settings-dialog").close();
  toast("초기화됨");
});
function tick(time) {
  const delta = Math.min((time - lastTime) / 1000, 0.05);
  lastTime = time;
  if (path.length) {
    const user = state.users[state.selected],
      next = path[0];
    const distance = Math.hypot(next.x - user.x, next.y - user.y);
    const travel = 105 * delta;
    if (distance <= travel) {
      user.x = next.x;
      user.y = next.y;
      path.shift();
      if (!path.length) finishMovement();
    } else {
      user.x += ((next.x - user.x) / distance) * travel;
      user.y += ((next.y - user.y) / distance) * travel;
    }
  }
  if (walking && time - lastBroadcast >= 100) {
    broadcastUser();
    lastBroadcast = time;
  }
  draw(time);
  requestAnimationFrame(tick);
}
const live = exchange && serverMode ? createLiveRoom({
  room: exchange,
  onPosition(slot, position) {
    if (slot === state.selected) return;
    const user = state.users[slot];
    const seat = position.seat ?? null;
    const seatChanged = user.seat !== seat;
    Object.assign(user, { x: position.x, y: position.y, seat });
    // The animation frame already draws coordinates. Only seating changes the sidebar.
    if (seatChanged) update();
  },
  onPresence(slots){onlineSlots=new Set(slots);update();},
  onStatus(value){if(modeLabel)modeLabel.textContent=value;},
}) : null;
if(live && sharedRecords)connectRecords({room:exchange,live,store:sharedRecords});
const chat = createChat({
  transport: live?.request,
  memberName,
  getSelected: () => state.selected,
  getUsers: () => state.users,
  viewport: document.querySelector(".canvas-wrap"),
  stage,
  onPresence(slots) {
    const next = new Set(slots);
    if (
      next.size === onlineSlots.size &&
      [...next].every((slot) => onlineSlots.has(slot))
    )
      return;
    onlineSlots = next;
    update();
  },
});
window.addEventListener("pagehide", save);
live?.publish(state.users[state.selected]);
update();
if (exchange) {
  $("#reset").hidden = true;
  const refresh = setInterval(async () => {
    try {
      const next = await exchangeRequest(exchangeCode);
      if (JSON.stringify(exchange) !== JSON.stringify(next)) {
        exchange = next;
        update();
      }
    } catch {
      // Retain the last known turn while disconnected.
    }
  }, serverMode ? Math.max(2500, capacity * 1000) : 2500);
  addEventListener("pagehide", () => clearInterval(refresh), { once: true });
}
requestAnimationFrame(tick);
