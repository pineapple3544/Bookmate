import { createRecords } from "./records.js";
import { localMode } from "./local-transport.js";
import { createChat } from "./chat.js";
const canvas = document.querySelector("#room");
const ctx = canvas.getContext("2d");
const stage = document.createElement("div");
stage.className = "world-stage";
canvas.before(stage);
stage.append(canvas);
const mobileLayout = matchMedia("(max-width: 520px)");
const panelDefinitions = [
  [".book-section", "책 정보"],
  [".members-section", "참가자"],
  [".note-section", "내 기록"],
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
const storageKey = "bookmate-pixel-prototype-v1";
const colors = ["#8da99b", "#b58b72", "#819bb1", "#b7a6c7"];
const seats = [
  { x: 240, y: 192 },
  { x: 384, y: 192 },
  { x: 240, y: 304 },
  { x: 384, y: 304 },
];
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
    selected: 0,
    holder: 0,
    motion: !matchMedia("(prefers-reduced-motion: reduce)").matches,
    users: [
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
    saved.selected < 4 &&
    Number.isInteger(saved.holder) &&
    saved.holder >= 0 &&
    saved.holder < 4 &&
    typeof saved.motion === "boolean" &&
    saved.users?.length === 4 &&
    saved.users.every(
      (u) =>
        Number.isFinite(u.x) &&
        u.x >= 24 &&
        u.x <= 616 &&
        Number.isFinite(u.y) &&
        u.y >= 160 &&
        u.y <= 376 &&
        (u.seat === null ||
          (Number.isInteger(u.seat) && u.seat >= 0 && u.seat < 4)) &&
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
const slotPrefix = "bookmate-local-user-v1:";
const channel =
  localMode && typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("bookmate-room-v1")
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
      (Number.isInteger(user.seat) && user.seat >= 0 && user.seat < 4)) &&
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
        slot < 4 &&
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
      data.slot < 4 &&
      data.slot !== state.selected &&
      validUser(data.user)
    ) {
      state.users[data.slot] = data.user;
      update();
    }
  };
let lastBroadcast = 0;
function broadcastUser() {
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
function room() {
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
  // Window and stepped, pixel-built evening silhouette.
  rect(26, 25, 120, 105, "#a88b60");
  rect(32, 30, 108, 94, "#303a58");
  rect(32, 90, 108, 34, "#55546c");
  for (let i = 0; i < 9; i++) {
    const h = 12 + ((i * 11) % 32);
    rect(34 + i * 12, 124 - h, 10, h, "#263343");
    rect(37 + i * 12, 128 - h, 2, 3, "#bca66c");
  }
  [
    [45, 42],
    [119, 52],
    [88, 38],
    [105, 70],
  ].forEach(([x, y]) => rect(x, y, 2, 2, "#c5c5bb"));
  rect(83, 30, 4, 94, "#9e845d");
  rect(32, 77, 108, 4, "#9e845d");
  rect(20, 22, 15, 108, "#b09272");
  rect(137, 22, 14, 108, "#b09272");
  for (let x = 22; x < 36; x += 5) rect(x, 24, 2, 102, "#c7ad8d");
  rect(22, 127, 130, 5, "#c1a078");
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
const sprite = [
  "....hhhhhh....",
  "...hhhhhhhh...",
  "..hhhhhhhhhh..",
  "..hhsssssshh..",
  "..hssssssssh..",
  "..hsskssks sh..".replaceAll(" ", ""),
  "...ssssssss...",
  "....ssssss....",
  "...cccccccc...",
  "..sccccccccs..",
  "..ssccccccss..",
  "....cccccc....",
  "....pppppp....",
  "....pp..pp....",
  "...bbb..bbb...",
];
function avatar(user, index, time, miniature = false) {
  const x = Math.round(user.x),
    y = Math.round(user.y);
  const step =
    !miniature && state.motion && walking && index === state.selected
      ? Math.sin(time / 90) * 2
      : 0;
  const palette = {
    h: ["#352d30", "#493a2c", "#242e37", "#59463c"][index],
    s: "#d6af8d",
    k: "#242b2d",
    c: colors[index],
    p: "#39454a",
    b: "#272d30",
  };
  rect(x - 13, y + 1, 26, 5, "#27382d70");
  if (index === state.selected && !miniature)
    outline(x - 17, y - 3, 34, 10, "#82d9b0", 2);
  sprite.forEach((row, ry) =>
    [...row].forEach((pixel, rx) => {
      if (palette[pixel])
        rect(
          x - 14 + rx * 2,
          y - 30 + ry * 2 + (ry > 11 ? step : 0),
          2,
          2,
          palette[pixel],
        );
    }),
  );
  if (user.seat !== null) {
    rect(x - 12, y - 12, 11, 9, "#d9d6ac");
    rect(x + 1, y - 12, 11, 9, "#eee4c1");
    rect(x - 1, y - 12, 2, 10, "#6a7c64");
  }
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
  element.textContent = "사용자 " + (index + 1);
  stage.append(element);
  return element;
});
function label(user, index) {
  const element = avatarLabels[index];
  element.classList.toggle("offline", !onlineSlots.has(index));
  element.style.left = (user.x / 640) * 100 + "%";
  element.style.top = ((user.y - 37) / 400) * 100 + "%";
  element.classList.toggle("active", index === state.selected);
  if (index === state.holder) {
    rect(user.x - 6, user.y - 60, 5, 7, "#82d9b0");
    rect(user.x + 1, user.y - 60, 5, 7, "#a6efd0");
  }
}
function draw(time) {
  if (mobileLayout.matches) {
    const viewportWidth = canvas.parentElement.parentElement.clientWidth;
    const stageWidth = stage.clientWidth;
    const desiredOffset =
      (state.users[state.selected].x / 640) * stageWidth - viewportWidth / 2;
    const offset = -Math.max(
      0,
      Math.min(stageWidth - viewportWidth, desiredOffset),
    );
    stage.dataset.offsetX = String(offset);
    stage.style.transform = "translate3d(" + offset + "px, 0, 0)";
  } else {
    stage.dataset.offsetX = "0";
    stage.style.transform = "translate3d(0, 0, 0)";
  }
  ctx.imageSmoothingEnabled = false;
  room();
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
  objects.push({ y: 276, draw: table });
  objects.sort((a, b) => a.y - b.y).forEach((object) => object.draw());
  state.users.forEach(label);
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
function update() {
  const user = state.users[state.selected];
  $("#chat-sender").textContent = "사용자 " + (state.selected + 1);
  $(".room-count").textContent = onlineSlots.size + "명 온라인";
  $("#selected-label").textContent = "사용자 " + (state.selected + 1);
  $("#action-state").textContent =
    user.seat !== null ? "착석" : walking ? "이동 중" : "이동 가능";
  $("#sit").textContent = user.seat !== null ? "일어나기" : "앉기";
  $("#holder").textContent = "사용자 " + (state.holder + 1);
  $("#note-preview").textContent = user.note;
  $("#note-page").textContent = "p. " + user.page;
  $("#complete").textContent = user.done ? "완료됨" : "독서 완료";
  $("#complete").disabled = user.done;
  $("#motion").checked = state.motion;
  const members = $("#members");
  members.replaceChildren();
  state.users.forEach((member, index) => {
    const button = document.createElement("button");
    button.className = "member" + (index === state.selected ? " selected" : "");
    button.setAttribute("aria-pressed", String(index === state.selected));
    const mini = document.createElement("span");
    mini.className =
      "member-avatar" + (onlineSlots.has(index) ? "" : " offline");
    mini.style.background = colors[index];
    mini.style.clipPath =
      "polygon(25% 0,75% 0,75% 15%,90% 15%,90% 50%,75% 50%,75% 65%,100% 65%,100% 100%,0 100%,0 65%,25% 65%,25% 50%,10% 50%,10% 15%,25% 15%)";
    const name = document.createElement("span");
    name.className = "member-name";
    name.textContent = "사용자 " + (index + 1);
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
    const offset = user.seat < 2 ? -24 : 24;
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
const records = createRecords({
  getSelected: () => state.selected,
  getUser: () => state.users[state.selected],
  onSave(page, note) {
    Object.assign(state.users[state.selected], { page, note });
    save();
    update();
  },
  notify: toast,
});
$("#record").addEventListener("click", records.open);
$("#note-preview").addEventListener("click", records.open);
$("#complete").addEventListener("click", () => {
  state.users[state.selected].done = true;
  save();
  update();
  toast("완료됨");
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
const chat = createChat({
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
update();
requestAnimationFrame(tick);
