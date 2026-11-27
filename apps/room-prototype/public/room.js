import { interactionTarget, seatOccupied } from "./interaction.js";
import { createSharedRecords } from "./shared-records.js";
import { setSharedRecords } from "./record-bridge.js";
import { connectRecords } from "./p2p-records.js";
import { peerProfile, renderProfileShelf } from "./profile.js";
import { serverMode, account } from "./account.js";
import { createLiveRoom } from "./live-client.js";
import { createRecords } from "./records.js";
import { localMode } from "./local-transport.js";
import { createChat } from "./chat.js";
import { isRating, setupRating } from "./rating.js";
import { showCover } from "./cover-editor.js";
import { exchangeCode, exchangeRequest, exchangeUrl, themes } from "./exchange-client.js";
import { drawAvatar, normalizeAppearance } from "./avatar.js";
import { appearanceWithPet, bookPetId, createWardrobe, drawBookPet, equippedPet, loadPets, petCollectionKeyFor, readPets } from "./wardrobe.js";
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
const cabinet = document.querySelector("#customize-avatar");
const cabinetBounds = { x: 18, y: 148, width: 68, height: 94 };
const interactionButton = document.querySelector("#interact");
const focusMark = document.createElement("span");
focusMark.className = "interaction-focus";
focusMark.setAttribute("aria-hidden", "true");
focusMark.hidden = true;
stage.append(canvas, cabinet, focusMark);
Object.assign(cabinet.style, {
  left: cabinetBounds.x / canvas.width * 100 + "%",
  top: cabinetBounds.y / canvas.height * 100 + "%",
  width: cabinetBounds.width / canvas.width * 100 + "%",
  height: cabinetBounds.height / canvas.height * 100 + "%",
});
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
    if (exchange.me < 0) throw new Error("방에 참가한 뒤 입장해 주세요.");
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
const memberName = index => exchange?.members[index]?.name ?? (index === 0 ? "소이" : "사용자 " + (index + 1));
const bookDetail = $(".book-detail");
const currentBook = {
  id: bookDetail.dataset.bookId,
  title: bookDetail.querySelector("h2").textContent.trim(),
  color: bookDetail.dataset.coverColor,
  art: bookDetail.dataset.coverArt,
};
if (exchange) {
  Object.assign(currentBook, { id: bookPetId(exchange.title, exchange.author), title: exchange.title, color: themes[exchange.theme] });
  $(".room-heading h1").textContent = exchange.title;
  bookDetail.querySelector("h2").textContent = exchange.title;
  bookDetail.querySelector(".cover span").textContent = exchange.title;
  bookDetail.querySelector(".cover small").textContent = exchange.author;
  showCover(bookDetail.querySelector(".cover"), exchange.coverUrl);
  bookDetail.querySelector(".cover").style.backgroundColor = currentBook.color; // background-image(질감)는 유지
}
const petCollectionKey = petCollectionKeyFor(serverMode && account?.id);
let pets = loadPets(petCollectionKey);
const capacity = exchange?.capacity ?? 4;
const door = { x: 518, y: 152 };
const arrivals = new Map();
const entryKey = "bookmate-entry:" + exchangeCode;
const freshEntry = exchange && sessionStorage.getItem(entryKey) === exchange.members[exchange.me].id;
if (freshEntry) sessionStorage.removeItem(entryKey);
function doorstep(slot) {
  return { x: door.x + (slot % 3 - 1) * 12, y: 184 + Math.floor(slot / 3) * 8, seat: null, done: false, page: 1, note: "" };
}
const petTrails = Array.from({ length: capacity }, () => []);
const appearanceKeys = Array.from({ length: capacity }, (_, slot) =>
  "bookmate-avatar-v1" + roomSuffix + ":" + slot,
);
function readAppearance(value) {
  try {
    return appearanceWithPet(JSON.parse(value));
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
const equippedPets = appearances.map(appearance => equippedPet(appearance, pets));
const demoSeats = [
  { x: 240, y: 192 },
  { x: 384, y: 192 },
  { x: 240, y: 304 },
  { x: 384, y: 304 },
];
const seatLayout = capacity > demoSeats.length ? Array.from({ length: capacity }, (_, index) => ({
  x: 224 + 44 * Math.floor(index / 2),
  y: index % 2 === 0 ? 192 : 304,
})) : demoSeats.slice(0, capacity);
const seats = seatLayout.slice(0, exchange?.members.length ?? capacity);
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
    memberIds: exchange?.members.map(person => person.id),
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
    (!exchange || !saved.memberIds || saved.memberIds.every((id, index) => id === exchange.members[index]?.id)) &&
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
if (exchange) {
  state.selected = exchange.me;
  state.memberIds = exchange.members.map(person => person.id);
  if (freshEntry) {
    state.users[state.selected] = doorstep(state.selected);
    arrivals.set(state.selected, performance.now());
  }
}
// Render remote samples slightly behind arrival time to absorb normal packet jitter.
const movementInterval = 100;
const playbackDelay = movementInterval + 25;
const remotePaths = new Map();
let displayUsers = state.users;

function queuePosition(slot, previous, next, snap = false) {
  const distance = Math.hypot(next.x - previous.x, next.y - previous.y);
  if (snap || (previous.seat !== next.seat && next.seat !== null) || distance > 48) {
    remotePaths.delete(slot);
    return;
  }
  if (!distance && previous.seat === next.seat) return;
  const now = performance.now();
  let samples = remotePaths.get(slot);
  if (!samples || now - samples.at(-1).time > 3 * movementInterval) {
    samples = [{ x: previous.x, y: previous.y, seat: previous.seat, time: now - movementInterval }];
    remotePaths.set(slot, samples);
  }
  // Keep one sample before playback time, even when a background tab skips frames.
  while (samples.length > 1 && samples[1].time <= now - playbackDelay) samples.shift();
  if (samples.length >= 16) samples.splice(1, 1);
  samples.push({ x: next.x, y: next.y, seat: next.seat, time: now });
}

function displayPosition(user, slot, frameTime) {
  const samples = remotePaths.get(slot);
  if (!samples) return user;
  const at = frameTime - playbackDelay;
  while (samples.length > 1 && samples[1].time <= at) samples.shift();
  if (samples.length === 1) {
    remotePaths.delete(slot);
    return user;
  }
  const [from, to] = samples;
  const fraction = Math.max(0, (at - from.time) / Math.max(1, to.time - from.time));
  return { ...user, x: from.x + (to.x - from.x) * fraction,
    y: from.y + (to.y - from.y) * fraction, seat: to.seat === null ? null : from.seat };
}

function receiveLocalUser(slot, user) {
  const previous = state.users[slot];
  queuePosition(slot, previous, user);
  state.users[slot] = user;
  if (previous.seat !== user.seat || previous.done !== user.done ||
      previous.note !== user.note || previous.page !== user.page) update();
}
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
        receiveLocalUser(slot, user);
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
      receiveLocalUser(data.slot, data.user);
    }
  };
let lastBroadcast = 0;
function broadcastUser(final = false) {
  live?.publish(state.users[state.selected], final);
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
const walkSpeed = 105;
const heldDirections = new Map();
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
    broadcastUser(true);
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
function drawWardrobe() {
  ctx.save();
  ctx.translate(cabinetBounds.x, cabinetBounds.y);
  // Carved crown, side panel, and raised feet.
  rect(3, 88, 65, 6, "#403529");
  rect(2, 7, 64, 78, "#422e25");
  rect(5, 84, 7, 9, "#503729");
  rect(55, 84, 7, 9, "#503729");
  rect(0, 4, 68, 6, "#634231");
  rect(3, 1, 62, 4, "#b88859");
  rect(4, 9, 56, 72, "#aa794e");
  rect(60, 10, 4, 71, "#765038");
  rect(6, 12, 51, 58, "#583e32");
  rect(8, 14, 23, 54, "#99714d");
  rect(10, 16, 19, 50, "#795439");
  // A brass hanger on one door and a silvered mirror on the other.
  rect(18, 22, 5, 2, "#eac48a");
  rect(21, 24, 2, 3, "#eac48a");
  rect(18, 26, 4, 2, "#eac48a");
  for (let step = 0; step < 4; step++) {
    rect(16 - step * 2, 28 + step, 3, 2, "#eac48a");
    rect(20 + step * 2, 28 + step, 3, 2, "#eac48a");
  }
  rect(10, 32, 19, 2, "#eac48a");
  rect(33, 14, 22, 54, "#c29668");
  rect(35, 16, 18, 50, "#597476");
  rect(37, 18, 14, 46, "#96adab");
  for (let step = 0; step < 6; step++) {
    rect(38 + step * 2, 37 - step * 2, 3, 4, "#d9e1cc");
  }
  rect(27, 44, 3, 5, "#f2cf86");
  rect(33, 44, 3, 5, "#f2cf86");
  rect(6, 72, 51, 9, "#825b3f");
  rect(26, 74, 10, 2, "#edc17e");
  rect(0, 82, 65, 4, "#654331");
  ctx.restore();
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
  shelf(372, 22, exchange ? 122 : 166);
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
  drawWardrobe();
  rect(104, 201, 44, 9, "#a17a51");
  rect(108, 210, 4, 29, "#4b392a");
  rect(139, 210, 4, 29, "#4b392a");
  lamp(125, 193);
  shelf(0, 349, 75, 1);
  plant(35, 341);
  shelf(565, 345, 75, 1);
  lamp(597, 341);
}
function drawEntrance(time) {
  let opening = 0;
  if (arrivals.size) displayUsers = displayUsers.slice();
  for (const [slot, since] of arrivals) {
    const t = Math.max(0, (time - since) / 900);
    if (t >= 1 || !state.motion || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      arrivals.delete(slot);
      continue;
    }
    opening = Math.max(opening, Math.min(1, t * 5, (1 - t) * 5));
    const user = displayUsers[slot];
    const step = Math.min(1, Math.max(0, (t - 0.14) / 0.66));
    displayUsers[slot] = { ...user, x: door.x + (user.x - door.x) * step,
      y: door.y + (user.y - door.y) * step, seat: null };
  }
  const left = door.x - 17, top = door.y - 55;
  rect(left - 2, top - 3, 38, 58, "#372c25");
  rect(left, top, 34, 55, "#232c29");
  const width = 34 - Math.round(opening * 27);
  rect(left, top, width, 54, "#845b42");
  outline(left + 2, top + 3, width - 5, 45, "#694833");
  rect(left + width - 5, top + 30, 3, 3, "#dbc28c");
  rect(left - 2, door.y, 38, 3, "#b28c63");
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
}
function avatar(user, index, time) {
  const x = Math.round(user.x),
    y = Math.round(user.y);
  const step =
    state.motion && (arrivals.has(index) || (index === state.selected ? walking : remotePaths.has(index) && user.seat === null))
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
function avatarLabel(index) {
  const element = document.createElement("span");
  element.className = "avatar-label";
  element.textContent = memberName(index);
  stage.append(element);
  return element;
}
const avatarLabels = state.users.map((_, index) => avatarLabel(index));
const readingBadge = document.createElement("span");
readingBadge.className = "reading-badge";
readingBadge.textContent = "독서중…";
function petLabel() {
  const label = document.createElement("span");
  label.className = "pet-book-label";
  label.hidden = true;
  stage.append(label);
  return label;
}
const petLabels = state.users.map(petLabel);
const compactLabels = matchMedia("(max-width: 520px), (min-width: 600px) and (max-width: 950px) and (max-height: 500px)");
let inspectedSlot = -1;
function label(user, index) {
  const element = avatarLabels[index];
  element.hidden = compactLabels.matches && index !== state.selected && index !== state.holder && index !== inspectedSlot && !chat.isSpeaking(index);
  element.classList.toggle("offline", !onlineSlots.has(index));
  element.style.left = (user.x / 640) * 100 + "%";
  element.style.top = ((user.y - 37) / 400) * 100 + "%";
  element.classList.toggle("active", index === state.selected);
  if (index === state.holder && readingBadge.parentElement !== element) element.append(readingBadge);
}
let focusedTarget = null;
let focusedSeated = false;
let focusX, focusY, focusedName;
const roomPlayerSlots = exchange ? exchange.members.map((_, slot) => slot) : null;

function currentInteraction() {
  if (pendingSeat !== null) return null;
  return interactionTarget(displayUsers[state.selected], displayUsers, seats, cabinetBounds, roomPlayerSlots ?? onlineSlots);
}

function syncInteractionFocus() {
  const next = currentInteraction();
  const seated = state.users[state.selected].seat !== null;
  const isPlayer = typeof next === "string" && next.startsWith("player-");
  const slot = isPlayer ? Number(next.slice(7)) : null;
  const peer = isPlayer ? displayUsers[slot] : null;
  const peerName = isPlayer ? memberName(slot) : null;
  if (next === focusedTarget && seated === focusedSeated && peer?.x === focusX && peer?.y === focusY && peerName === focusedName) return;
  focusedName = peerName;
  focusX = peer?.x;
  focusY = peer?.y;
  focusedTarget = next;
  focusedSeated = seated;
  interactionButton.disabled = next === null;
  focusMark.hidden = next === null;
  let actionName = "상호작용";
  if (next !== null) {
    const isWardrobe = next === "wardrobe";
    const bounds = peer ? { x: peer.x - 16, y: peer.y - 33, width: 32, height: 38 } : isWardrobe ? cabinetBounds : {
      x: seats[next].x - 19, y: seats[next].y - 32, width: 38, height: 58,
    };
    Object.assign(focusMark.style, {
      left: bounds.x / canvas.width * 100 + "%",
      top: bounds.y / canvas.height * 100 + "%",
      width: bounds.width / canvas.width * 100 + "%",
      height: bounds.height / canvas.height * 100 + "%",
    });
    focusMark.dataset.target = typeof next === "string" ? next : "chair-" + next;
    actionName += " · " + (isPlayer ? peerName + " 프로필 보기" : isWardrobe ? "캐릭터 꾸미기" : seated ? "일어나기" : "의자에 앉기");
  } else {
    delete focusMark.dataset.target;
  }
  interactionButton.setAttribute("aria-label", actionName);
  interactionButton.title = actionName + " (E)";
}

function draw(time) {
  let offset = 0;
  if (mobileLayout.matches) {
    const viewportWidth = canvas.parentElement.parentElement.clientWidth;
    const stageWidth = stage.clientWidth;
    const focalX = document.activeElement === cabinet
      ? cabinetBounds.x + cabinetBounds.width / 2
      : state.users[state.selected].x;
    const desiredOffset = focalX / canvas.width * stageWidth - viewportWidth / 2;
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
  displayUsers = remotePaths.size
    ? state.users.map((user, slot) => displayPosition(user, slot, time))
    : state.users;
  if (exchange) drawEntrance(time);
  syncInteractionFocus();
  const objects = displayUsers.map((user, index) => ({
    y: user.y,
    draw: () => {
      ctx.save();
      if (!onlineSlots.has(index)) ctx.filter = "grayscale(1)";
      avatar(user, index, time);
      ctx.restore();
    },
  }));
  displayUsers.forEach((user, index) => {
    const pet = equippedPets[index];
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
  displayUsers.forEach(label);
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
  heldDirections.clear();
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
  let requestedSeat = null;
  if (pendingSeat !== null) {
    if (seatOccupied(pendingSeat, state.users[state.selected], state.users)) toast("사용 중");
    else if (live) requestedSeat = pendingSeat;
    else state.users[state.selected].seat = pendingSeat;
  }
  pendingSeat = null;
  target = null;
  save();
  if (requestedSeat !== null) live.publish({ ...state.users[state.selected], seat: requestedSeat }, true);
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
function demoReceiptKey() {
  return "bookmate-reading-start:" + (exchange?.code ?? "free") + ":" + (exchange?.members[exchange.me].id ?? state.selected);
}
let startingExchange = false;
function update() {
  if (exchange) {
    exchange.members.forEach((person, index) => {
      const nameNode = avatarLabels[index].firstChild;
      if (nameNode.nodeValue !== person.name) nameNode.nodeValue = person.name;
      state.users[index].done = Boolean(person.finishedAt);
      if (person.appearance) {
        appearances[index] = appearanceWithPet({ ...person.appearance, pet: person.appearance.pet ?? appearances[index].pet });
      }
    });
    state.holder = exchange.members.findIndex(person => person.receivedAt && !person.finishedAt);
  } else {
    state.holder = state.users.findIndex(person => !person.done);
  }
  unlockBookPet();
  appearances.forEach((appearance, index) => { equippedPets[index] = equippedPet(appearance, pets); });
  const user = state.users[state.selected];
  $("#chat-sender").textContent = memberName(state.selected);
  $(".room-count").textContent = onlineSlots.size + "명 온라인";
  $("#selected-label").textContent = memberName(state.selected);
  $("#action-state").textContent =
    user.seat !== null ? "착석" : walking ? "이동 중" : "이동 가능";
  $("#holder").textContent = state.holder >= 0 ? memberName(state.holder)
    : exchange && !exchange.startedAt ? "시작 전" : "모두 완독";
  if (exchange) {
    $("#room-access").hidden = false;
    $("#invite-manage").href = exchangeUrl(exchangeCode);
    $("#invite-manage").textContent = exchange.isHost ? "초대 · 방 관리" : "초대 · 참가자";
    $("#start-exchange").hidden = !exchange.isHost || Boolean(exchange.startedAt);
    $("#start-exchange").disabled = startingExchange || exchange.members.length < 2;
  }
  const isReading = state.selected === state.holder;
  const complete = $("#complete");
  complete.hidden = complete.disabled = !isReading;
  complete.textContent = "책 전달하기";
  const canReadRecords = canOpenRecords();
  $("#record").hidden = !canReadRecords;
  $("#handoff-count").textContent = state.users.filter(member => member.done).length + "/" + state.users.length + " 완독";
  $("#record").textContent = isReading && (!exchange || exchange.demoViewers) && state.selected > 0 && !sessionStorage.getItem(demoReceiptKey())
    ? "책 받고 읽기 시작하기" : "기록하기";
  if (!canReadRecords && $("#record-dialog").open) $("#record-dialog").close();
  if (!canReadRecords && $("#record-feed").open) $("#record-feed").close();
  records.sync();
  $("#motion").checked = state.motion;
  $(".members-section .section-title span").textContent = exchange?.demoViewers ? "시점 선택" : exchange ? "" : "선택";
  const members = $("#members");
  members.replaceChildren();
  state.users.forEach((member, index) => {
    const button = document.createElement("button");
    button.className = "member" + (index === state.selected ? " selected" : "");
    button.classList.toggle("offline", !onlineSlots.has(index));
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
    const switchDemo = exchange?.demoViewers?.includes(exchange.members[index].id) && index !== state.selected;
    if (exchange && index !== state.selected) button.disabled = !switchDemo;
    if (switchDemo) button.setAttribute("aria-label", memberName(index) + " 시점으로 보기");
    button.addEventListener("click", () => {
      if (switchDemo) {
        const url = new URL(location.href);
        url.searchParams.set("viewer", exchange.members[index].id);
        location.assign(url);
        return;
      }
      stopHeldMovement();
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
      remotePaths.delete(index);
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
  if (compactLabels.matches) {
    inspectedSlot = -1;
    // The nearest avatar in front is the one painted last.
    displayUsers.forEach((user, index) => {
      if (Math.abs(user.x - x) > 16 || y < user.y - 34 || y > user.y + 4) return;
      if (inspectedSlot < 0 || user.y >= displayUsers[inspectedSlot].y) inspectedSlot = index;
    });
    if (inspectedSlot >= 0 && inspectedSlot !== state.selected) return;
  }
  const seat = seats.findIndex(
    (s) => Math.abs(s.x - x) < 22 && y >= s.y - 32 && y <= s.y + 20,
  );
  if (seat < 0) {
    moveTo(x, y);
  } else if (state.users[state.selected].seat !== seat) {
    const chair = seats[seat];
    moveTo(chair.x, chair.y + (chair.y < 240 ? -24 : 24));
  }
});
const arrowDirections = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
const directionVectors = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

function advanceHeldMovement(distance) {
  const directions = new Set(heldDirections.values());
  let dx = 0, dy = 0;
  for (const direction of directions) {
    const [x, y] = directionVectors[direction];
    dx += x;
    dy += y;
  }
  const user = state.users[state.selected];
  const scale = distance / (Math.hypot(dx, dy) || 1);
  const x = user.x, y = user.y;
  if (dx && isWalkable(x + dx * scale, y)) user.x += dx * scale;
  if (dy && isWalkable(user.x, y + dy * scale)) user.y += dy * scale;
  const moved = user.x !== x || user.y !== y;
  if (moved) user.seat = null;
  if (walking !== moved) {
    walking = moved;
    update();
  }
}

function holdDirection(source, direction) {
  if (heldDirections.has(source)) return;
  const starting = heldDirections.size === 0;
  heldDirections.set(source, direction);
  if (starting) {
    path = [];
    pendingSeat = null;
    target = null;
    lastTime = performance.now();
    // Give even a tap completed between two animation frames a visible step.
    advanceHeldMovement(1);
  }
}

function releaseDirection(source) {
  if (heldDirections.delete(source) && !heldDirections.size) finishMovement();
}

function stopHeldMovement() {
  if (!heldDirections.size) return;
  heldDirections.clear();
  finishMovement();
}

function editingMovementTarget(target) {
  return target.isContentEditable || target.closest?.("input, textarea, select, dialog");
}

document.addEventListener("keydown", event => {
  if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey ||
      editingMovementTarget(event.target) || document.querySelector("dialog[open]")) return;
  const activation = event.key === " " || event.key === "Enter";
  const direction = activation ? event.target.closest?.("[data-direction]")?.dataset.direction : arrowDirections[event.key];
  if (!direction) return;
  event.preventDefault();
  if (!event.repeat) holdDirection("key:" + event.key, direction);
});
document.addEventListener("keyup", event => {
  const source = "key:" + event.key;
  if (heldDirections.has(source)) {
    event.preventDefault();
    releaseDirection(source);
  }
});
for (const button of document.querySelectorAll("[data-direction]")) {
  button.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    button.setPointerCapture(event.pointerId);
    holdDirection(event.pointerId, button.dataset.direction);
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    button.addEventListener(type, event => releaseDirection(event.pointerId));
  }
  // Assistive technologies can activate a button without any pointer or key events.
  button.addEventListener("click", event => {
    if (event.detail !== 0) return;
    holdDirection("activation", button.dataset.direction);
    releaseDirection("activation");
  });
}
window.addEventListener("blur", stopHeldMovement);
window.addEventListener("pagehide", stopHeldMovement);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopHeldMovement();
});
document.addEventListener("focusin", event => {
  if (editingMovementTarget(event.target)) stopHeldMovement();
});
const movementToggle = $("#movement-toggle");
movementToggle.addEventListener("click", () => {
  const expanded = movementToggle.getAttribute("aria-expanded") === "true";
  if (expanded) stopHeldMovement();
  movementToggle.setAttribute("aria-expanded", String(!expanded));
});
const peerDialog = $("#peer-profile");
let profileRequest = 0;
peerDialog.addEventListener("close", () => { profileRequest++; });
async function openPeerProfile(slot) {
  const request = ++profileRequest;
  const status = $("#peer-status");
  $("#peer-title").textContent = memberName(slot) + " · 프로필";
  $("#peer-content").hidden = true;
  $("#peer-bio").textContent = "";
  $("#peer-name").textContent = "";
  $("#peer-current-book").textContent = "";
  const portrait = $("#peer-avatar");
  const portraitContext = portrait.getContext("2d");
  portraitContext.clearRect(0, 0, portrait.width, portrait.height);
  $("#peer-books").replaceChildren();
  $("#peer-book-detail").textContent = "";
  status.textContent = "불러오는 중…";
  peerDialog.showModal();
  try {
    const profile = await peerProfile(exchange, slot);
    if (request !== profileRequest || !peerDialog.open) return;
    if (!profile.profilePublic) {
      status.textContent = "비공개 프로필입니다.";
      return;
    }
    $("#peer-title").textContent = "프로필";
    $("#peer-name").textContent = profile.nickname;
    $("#peer-current-book").textContent = profile.currentBookTitle || "없음";
    $("#peer-bio").textContent = profile.bio;
    portrait.classList.toggle("offline", !onlineSlots.has(slot));
    drawAvatar(portraitContext, portrait.width / 2 - 14, 15, slot, appearances[slot]);
    renderProfileShelf($("#peer-books"), $("#peer-book-detail"), profile.books);
    $("#peer-content").hidden = false;
    status.textContent = "";
  } catch (error) {
    if (request === profileRequest && peerDialog.open) status.textContent = error.message;
  }
}
function interact(trigger) {
  const user = state.users[state.selected];
  // A late position or occupancy update must never redirect an already displayed action.
  if (focusedTarget === null || currentInteraction() !== focusedTarget ||
      focusedSeated !== (user.seat !== null)) return;
  if (user.seat !== null) {
    const seat = seats[user.seat];
    moveTo(seat.x, seat.y + (seat.y < 240 ? -24 : 24));
  } else if (typeof focusedTarget === "string") {
    const selectedTarget = focusedTarget;
    stopHeldMovement();
    if (walking) {
      path = [];
      finishMovement();
    }
    if (selectedTarget.startsWith("player-")) {
      void openPeerProfile(Number(selectedTarget.slice(7)));
      return;
    }
    const slot = state.selected;
    wardrobe.open({ appearance: appearances[slot], slot, owner: memberName(slot), trigger });
  } else {
    sit(focusedTarget);
  }
}
interactionButton.addEventListener("click", () => interact(interactionButton));
document.addEventListener("keydown", event => {
  if (event.code !== "KeyE" && event.key.toLowerCase() !== "e") return;
  if (event.defaultPrevented || event.repeat || event.isComposing || event.ctrlKey ||
      event.metaKey || event.altKey || event.shiftKey || document.querySelector("dialog[open]") ||
      event.target.isContentEditable || event.target.closest?.("input, textarea, select")) return;
  if (focusedTarget !== null) {
    event.preventDefault();
    interact(event.target === canvas ? canvas : interactionButton);
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
  if (!canOpenRecords()) return;
  if ((!exchange || exchange.demoViewers) && state.selected === state.holder && state.selected > 0) {
    sessionStorage.setItem(demoReceiptKey(), "1");
    $("#record").textContent = "기록하기";
  }
  records.open();
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
    applyExchange(await exchangeRequest(exchangeCode, "finish", {
      ...review, appearance: appearances[state.selected],
    }));
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
const wardrobe = createWardrobe($("#avatar-dialog"), {
  getPets: () => pets,
  async save(appearance, slot) {
    if (exchange) {
      applyExchange(await exchangeRequest(exchangeCode, "appearance", appearance));
    } else {
      localStorage.setItem(appearanceKeys[slot], JSON.stringify(appearance));
    }
    appearances[slot] = appearance;
    update();
  },
  onSaved: () => toast("캐릭터 외형을 저장했어요."),
});
cabinet.addEventListener("click", () => {
  canvas.focus({ preventScroll: true });
  moveTo(cabinetBounds.x + cabinetBounds.width / 2, cabinetBounds.y + cabinetBounds.height + 16);
});
window.addEventListener("storage", (event) => {
  if (event.key === petCollectionKey || event.key === null) {
    pets = readPets(event.newValue);
    wardrobe.refreshPets();
    if (event.key !== null) {
      update();
      return;
    }
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
  remotePaths.clear();
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
  if (heldDirections.size) {
    if (delta > 0) advanceHeldMovement(walkSpeed * delta);
  } else if (path.length) {
    const user = state.users[state.selected],
      next = path[0];
    const distance = Math.hypot(next.x - user.x, next.y - user.y);
    const travel = walkSpeed * delta;
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
  if (walking && time - lastBroadcast >= movementInterval) {
    broadcastUser();
    lastBroadcast = time;
  }
  draw(time);
  requestAnimationFrame(tick);
}
const live = exchange && serverMode ? createLiveRoom({
  room: exchange,
  refreshMembers: refreshExchange,
  onPosition(slot, position, snap) {
    if (slot === state.selected) return;
    const user = state.users[slot];
    const seat = position.seat ?? null;
    const seatChanged = user.seat !== seat;
    queuePosition(slot, user, position, snap);
    Object.assign(user, { x: position.x, y: position.y, seat });
    // The animation frame already draws coordinates. Only seating changes the sidebar.
    if (seatChanged) update();
  },
  onSeatConflict: () => toast("사용 중"),
  onSeat(slot, seat) {
    if (state.users[slot].seat !== seat) {
      state.users[slot].seat = seat;
      if (slot === state.selected) {
        try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* Session still works. */ }
      }
      update();
    }
  },
  onPresence(slots) {
    onlineSlots = new Set(slots);
    for (let i = 0; i < state.users.length; i++)
      if (i !== state.selected && !onlineSlots.has(i)) state.users[i].seat = null;
    for (const slot of remotePaths.keys()) if (!onlineSlots.has(slot)) remotePaths.delete(slot);
    update();
  },
  onStatus(value){if(modeLabel)modeLabel.textContent=value;},
}) : null;
if(live && sharedRecords)connectRecords({room:exchange,live,store:sharedRecords});
const chat = createChat({
  transport: live?.request,
  memberName,
  getSelected: () => state.selected,
  getUsers: () => displayUsers,
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
function applyExchange(next) {
  if (next.version < exchange.version) return;
  if (exchange.capacity !== next.capacity || exchange.title !== next.title ||
      exchange.author !== next.author || exchange.theme !== next.theme || exchange.coverUrl !== next.coverUrl ||
      exchange.members.some((person, i) => person.id !== next.members[i]?.id)) {
    location.reload();
    return;
  }
  const previousCount = exchange.members.length;
  Object.assign(exchange, next);
  for (let slot = previousCount; slot < exchange.members.length; slot++) {
    seats.push(seatLayout[slot]);
    state.users.push(doorstep(slot));
    state.memberIds.push(exchange.members[slot].id);
    avatarLabels.push(avatarLabel(slot));
    petLabels.push(petLabel());
    roomPlayerSlots.push(slot);
    arrivals.set(slot, performance.now());
  }
  update();
}
let fetchingExchange;
function refreshExchange() {
  if (!fetchingExchange) fetchingExchange = exchangeRequest(exchangeCode)
    .then(next => { if (JSON.stringify(exchange) !== JSON.stringify(next)) applyExchange(next); })
    .finally(() => { fetchingExchange = undefined; });
  return fetchingExchange;
}
if (exchange) {
  $("#start-exchange").onclick = async () => {
    if (startingExchange) return;
    startingExchange = true;
    $("#start-exchange").disabled = true;
    try { applyExchange(await exchangeRequest(exchangeCode, "start", {})); }
    catch (error) { toast(error.message); }
    finally { startingExchange = false; update(); }
  };
  $("#reset").hidden = true;
  const refresh = setInterval(async () => {
    try {
      await refreshExchange();
    } catch {
      // Retain the last known turn while disconnected.
    }
  }, serverMode ? Math.max(2500, exchange.members.length * 750) : 2500);
  addEventListener("pagehide", () => clearInterval(refresh), { once: true });
}
requestAnimationFrame(tick);
