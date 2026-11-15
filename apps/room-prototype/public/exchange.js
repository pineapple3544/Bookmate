import { serverMode, ensureAccount } from "./account.js";
import { exchangeCode as code, exchangeRequest, exchangeUrl, myExchanges, themes } from "./exchange-client.js";
import { drawAvatar, normalizeAppearance } from "./avatar.js";
import { ratingStars, setupRating } from "./rating.js";

const $ = selector => document.querySelector(selector);
const status = $("#exchange-status");
const saveToast = $("#save-toast");
let saveAnimation;
function notifySaved(message) {
  saveAnimation?.cancel();
  saveToast.textContent = message;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  saveAnimation = saveToast.animate([
    { opacity: 1, offset: 0 },
    { opacity: 1, offset: reducedMotion ? 1 : 0.72 },
    { opacity: reducedMotion ? 1 : 0, offset: 1 },
  ], { duration: 1600 });
  saveAnimation.onfinish = () => { saveToast.textContent = ""; };
}
const screen = new URLSearchParams(location.search).get("screen") ?? (code ? "waiting" : "home");
document.querySelector('.bookmate-nav [data-screen="' + (["create", "shelf"].includes(screen) ? screen : "home") + '"]')
  .setAttribute("aria-current", "page");
for (const button of document.querySelectorAll("[data-close]")) {
  button.onclick = () => button.closest("dialog").close();
}
function node(tag, text = "", className = "") {
  const element = document.createElement(tag);
  element.textContent = text;
  element.className = className;
  return element;
}
function link(text, href, style = "secondary") {
  const anchor = node("a", text, "button " + style);
  anchor.href = href;
  return anchor;
}
function book(room, subtitle) {
  const wrap = node("div", "", "exchange-book");
  const cover = node("span", room.title, "exchange-cover");
  cover.setAttribute("aria-hidden", "true");
  cover.style.backgroundColor = themes[room.theme];
  const details = node("div");
  details.append(node("h2", room.title), node("p", [room.author, subtitle].filter(Boolean).join(" · "), "muted"));
  wrap.append(cover, details);
  return wrap;
}
function form(selector, action, feedback = status) {
  const element = $(selector);
  element.addEventListener("submit", async event => {
    event.preventDefault();
    const submit = element.querySelector("button");
    submit.disabled = true;
    feedback.textContent = "";
    try {
      await action(Object.fromEntries(new FormData(element)));
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
}
const date = value => new Date(value).toLocaleDateString("ko-KR", { dateStyle: "medium", timeZone: "Asia/Seoul" });
const calendarDay = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeZone: "Asia/Seoul" });
function duration(person) {
  const start = Date.parse(calendarDay.format(new Date(person.receivedAt)));
  const end = Date.parse(calendarDay.format(new Date(person.finishedAt)));
  const days = Math.round((end - start) / 86400000);
  return days === 0 ? "당일" : days + "일";
}
async function home() {
  $("#home-view").hidden = false;
  form("#code-form", ({ code }) => { location.href = exchangeUrl(code.trim().toUpperCase()); });
  const list = $("#room-list");
  const results = await Promise.allSettled((await myExchanges()).map(code => exchangeRequest(code)));
  const rooms = results.flatMap(result => result.status === "fulfilled" && result.value.me >= 0 && !result.value.demo ? [result.value] : []);
  if (results.some(result => result.status === "rejected")) status.textContent = "일부 방을 불러오지 못했어요.";
  if (!rooms.length) list.append(node("p", "방을 만들거나 초대 코드로 참가해 보세요.", "muted"));
  for (const room of rooms.sort((a,b) => b.createdAt.localeCompare(a.createdAt))) {
    const destination = room.completedAt ? exchangeUrl(room.code, "history")
      : room.startedAt ? "/room.html?code=" + room.code + (!serverMode ? "&local=1" : "") : exchangeUrl(room.code);
    const card = node("a", "", "exchange-card room-card");
    card.href = destination;
    const done = room.members.filter(person => person.finishedAt).length;
    const subtitle = room.completedAt ? "교환독서 완료" : room.startedAt ? done + "/" + room.capacity + "명 완독" : "대기 중";
    card.append(book(room, subtitle));
    list.append(card);
  }
}
function waiting(initial) {
  $("#waiting-view").hidden = false;
  const settings = $("#room-settings");
  const settingsStatus = $("#room-settings-status");
  const settingsForm = $("#create-form");
  settingsForm.querySelector('[type="submit"]').textContent = "변경사항 저장";
  settingsStatus.after(settingsForm);
  const updateCover = setupRoomOptions(settingsForm);
  let refreshing = false;
  let changing = false;
  let revision = 0;
  let renderedRoom;
  const roster = $("#waiting-members");
  let drag;
  async function saveOrder(room, from, to) {
    if (changing || from === to) return;
    const previous = room.members.map(person => person.id);
    const order = [...previous];
    order.splice(to, 0, order.splice(from, 1)[0]);
    try {
      await changeRoom("order", { previous, order });
      roster.children[to]?.querySelector("button")?.focus({ preventScroll: true });
    } catch (error) {
      status.textContent = error.message;
    }
  }
  function addReorderHandle(row, room, index) {
    const handle = node("button", "☰", "member-drag");
    handle.type = "button";
    handle.setAttribute("aria-label", room.members[index].name + " 순서 이동");
    handle.title = "드래그하거나 위·아래 방향키로 이동";
    handle.onkeydown = event => {
      const offset = { ArrowUp: -1, ArrowDown: 1 }[event.key];
      if (!offset) return;
      event.preventDefault();
      const target = index + offset;
      if (target >= 0 && target < room.members.length) void saveOrder(room, index, target);
    };
    handle.onpointerdown = event => {
      if (event.button !== 0 || !event.isPrimary || changing || drag) return;
      handle.setPointerCapture(event.pointerId);
      drag = { pointer: event.pointerId, target: index };
      row.classList.add("drag-source");
    };
    handle.onpointermove = event => {
      if (event.pointerId !== drag?.pointer) return;
      const rows = [...roster.children];
      let closest = Infinity;
      rows.forEach((item, position) => {
        const bounds = item.getBoundingClientRect();
        const distance = Math.abs(event.clientY - (bounds.top + bounds.height / 2));
        if (distance < closest) {
          closest = distance;
          drag.target = position;
        }
      });
      rows.forEach((item, position) => {
        item.classList.toggle("drop-before", position === drag.target && drag.target < index);
        item.classList.toggle("drop-after", position === drag.target && drag.target > index);
      });
    };
    function endDrag(event) {
      if (event.pointerId !== drag?.pointer) return;
      const { target } = drag;
      drag = undefined;
      for (const item of roster.children) item.classList.remove("drag-source", "drop-before", "drop-after");
      if (event.type === "pointerup") void saveOrder(room, index, target);
    }
    handle.onpointerup = handle.onpointercancel = handle.onlostpointercapture = endDrag;
    row.append(handle);
  }
  async function changeRoom(action, data) {
    changing = true;
    revision++;
    try {
      render(await exchangeRequest(code, action, data));
    } finally {
      changing = false;
    }
  }
  form("#create-form", async data => {
    await changeRoom("settings", data);
    settings.close();
    notifySaved("방 옵션을 저장했어요.");
  }, settingsStatus);
  const invite = new URL(exchangeUrl(code), location.origin).href;
  $("#invite-link").value = invite;
  $("#show-code").textContent = code;
  const inviteStatus = $("#invite-status");
  $("#copy-code").onclick = async () => {
    try {
      await navigator.clipboard.writeText(code);
      inviteStatus.textContent = "초대 코드를 복사했어요.";
    } catch {
      const range = document.createRange();
      range.selectNodeContents($("#show-code"));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      inviteStatus.textContent = document.execCommand("copy")
        ? "초대 코드를 복사했어요." : "선택된 초대 코드를 복사해 주세요.";
    }
  };
  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(invite);
      inviteStatus.textContent = "초대 링크를 복사했어요.";
    } catch {
      $("#invite-link").focus();
      $("#invite-link").select();
      inviteStatus.textContent = "선택된 초대 링크를 복사해 친구에게 보내세요.";
    }
  }
  $("#copy-invite").onclick = copyInvite;
  $("#share-invite").onclick = async () => {
    if (!navigator.share) return copyInvite();
    try { await navigator.share({ title: initial.title + " 교환독서", url: invite }); }
    catch (error) { if (error.name !== "AbortError") await copyInvite(); }
  };
  form("#join-form", data => changeRoom("join", data));
  function render(room) {
    if (JSON.stringify(renderedRoom) === JSON.stringify(room)) return;
    renderedRoom = room;
    $("#waiting-book").replaceChildren(book(room, "독서방"));
    $("#invite-panel").hidden = room.me < 0;
    $("#join-form").hidden = room.me >= 0 || room.startedAt || room.members.length >= room.capacity;
    $("#waiting-count").textContent = "참가자 " + room.members.length + "/" + room.capacity;
    roster.replaceChildren(...room.members.map((person, index) => {
      const row = node("li", "", "waiting-member");
      row.append(node("strong", person.name, "waiting-name"));
      if (person.isHost) row.append(node("span", "방장", "waiting-host"));
      if (room.isHost && !room.startedAt && room.members.length > 1) addReorderHandle(row, room, index);
      return row;
    }));
    const actions = $("#waiting-actions");
    const hadEditFocus = document.activeElement?.id === "edit-room";
    actions.replaceChildren();
    if (room.me < 0 && $("#join-form").hidden) actions.append(node("p", "이미 시작했거나 인원이 찬 방이에요."));
    if (room.me < 0) return;
    if (room.startedAt) {
      actions.append(link("독서방 입장", "/room.html?code=" + code + (!serverMode ? "&local=1" : ""), "primary"));
      return;
    }
    if (!room.isHost) return actions.append(node("p", "방장이 시작하면 독서방에 입장할 수 있어요.", "muted"));
    const edit = node("button", "방 옵션 수정", "button secondary");
    edit.id = "edit-room";
    edit.type = "button";
    edit.onclick = () => {
      const { title, author, capacity, theme } = room;
      for (const [key, value] of Object.entries({ title, author, capacity, theme, name: room.members[room.me].name })) {
        settingsForm.elements.namedItem(key).value = value;
      }
      settingsStatus.textContent = "";
      updateCover();
      settings.showModal();
    };
    const start = node("button", "교환독서 시작", "button primary");
    start.disabled = room.members.length !== room.capacity;
    start.onclick = async () => {
      if (changing || drag) return;
      start.disabled = true;
      try { await changeRoom("start", {}); }
      catch (error) { status.textContent = error.message; start.disabled = false; }
    };
    actions.append(edit, start);
    if (hadEditFocus) edit.focus();
  }
  render(initial);
  const timer = setInterval(async () => {
    if (refreshing || changing || drag) return;
    refreshing = true;
    const current = revision;
    try {
      const room = await exchangeRequest(code);
      if (current === revision && !drag) render(room);
    } catch (error) {
      if (current === revision) status.textContent = error.message;
    } finally {
      refreshing = false;
    }
  }, 2500);
  addEventListener("pagehide", () => clearInterval(timer), { once: true });
}
function history(room) {
  $("#history-view").hidden = false;
  $("#history-book").append(book(room, "완료 " + date(room.completedAt)));
  ticket(room);
  const reviews = $("#history-list");
  const position = $("#history-position");
  const previous = $("#history-prev");
  const next = $("#history-next");
  const count = room.members.length;
  let index = 0;
  function showReview() {
    const person = room.members[index];
    const card = node("article", "", "exchange-card history-reader");
    const heading = node("div", "", "reader-heading");
    const face = node("canvas", "", "reader-face");
    face.width = 76;
    face.height = 56;
    face.setAttribute("aria-hidden", "true");
    drawAvatar(face.getContext("2d"), 10, 24, index, normalizeAppearance(person.appearance), { scale: 2 });
    heading.append(face, node("h3", person.name));
    const dates = node("p", "", "reader-dates");
    dates.append(node("span", date(person.receivedAt) + " → " + date(person.finishedAt)),
      node("span", "독서 기간 " + duration(person), "duration-chip"));
    const stars = node("p", "", "reader-stars");
    stars.append(ratingStars(person.rating));
    stars.setAttribute("role", "img");
    stars.setAttribute("aria-label", "별점 " + person.rating + "점");
    card.append(heading, dates, stars, node("p", person.review || "한줄평을 아직 남기지 않았어요."));
    if (person.quote) card.append(node("blockquote", person.quote));
    reviews.replaceChildren(card);
    position.textContent = (index + 1) + " / " + count;
  }
  previous.disabled = next.disabled = count < 2;
  previous.onclick = () => {
    index = (index - 1 + count) % count;
    showReview();
  };
  next.onclick = () => {
    index = (index + 1) % count;
    showReview();
  };
  showReview();
}

function ticket(room) {
  const canvas = $("#ticket-preview");
  const ctx = canvas.getContext("2d");
  const ink = "#fff6e6";
  const muted = "#ddc7ac";
  ctx.fillStyle = "#342622";
  ctx.beginPath();
  ctx.roundRect(0, 0, 960, 540, 34);
  ctx.fill();
  ctx.strokeStyle = "#806353";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(17, 17, 926, 506, 23);
  ctx.stroke();
  ctx.fillStyle = themes[room.theme];
  ctx.beginPath();
  ctx.roundRect(59, 53, 166, 216, [5, 16, 16, 5]);
  ctx.fill();
  ctx.fillStyle = "#0003";
  ctx.fillRect(59, 53, 12, 216);
  function lines(value, width, size, family) {
    ctx.font = size + "px " + family;
    const rows = [];
    let row = "";
    for (const char of value) {
      if (ctx.measureText(row + char).width > width) {
        rows.push(row);
        row = "";
      }
      row += char;
    }
    return [...rows, row];
  }
  function text(value, x, y, size, width, limit, fill = ink, family = "sans-serif") {
    const rows = lines(value, width, size, family);
    ctx.fillStyle = fill;
    for (const [i, row] of rows.slice(0, limit).entries()) {
      ctx.fillText(row + (i === limit - 1 && rows.length > limit ? "…" : ""), x, y + i * size * 1.3, width);
    }
  }
  text(room.title, 81, 108, 21, 126, 4, "#3c2921", "serif");
  text("✦", 124, 241, 35, 70, 1, "#3c2921");
  text("EXCHANGE READING", 266, 88, 23, 600, 1, muted);
  text(room.title, 266, 149, 43, 628, 2, ink, "serif");
  text(room.author, 266, 245, 25, 620, 1, muted);
  ctx.setLineDash([8, 10]);
  ctx.strokeStyle = "#ab8e79";
  ctx.beginPath();
  ctx.moveTo(48, 301);
  ctx.lineTo(912, 301);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalCompositeOperation = "destination-out";
  for (const x of [0, 960]) {
    ctx.beginPath();
    ctx.arc(x, 301, 20, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
  text("READERS", 59, 353, 21, 520, 1, muted);
  text(room.members.map(person => person.name).join(" · "), 59, 392, 20, 610, 5);
  text("COMPLETED", 707, 353, 21, 195, 1, muted);
  text(date(room.completedAt), 707, 392, 23, 195, 1);
  $("#ticket-download").onclick = () => canvas.toBlob(blob => {
    if (!blob) { status.textContent = "티켓 이미지를 만들지 못했어요."; return; }
    const url = URL.createObjectURL(blob);
    const anchor = link("", url);
    anchor.download = "Bookmate-" + code + ".png";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, "image/png");
}

async function shelf() {
  $("#shelf-view").hidden = false;
  const books = $("#shelf-books");
  const editor = $("#shelf-review");
  const setRating = setupRating(editor);
  const actions = $("#shelf-actions");
  const editorDialog = $("#shelf-editor");
  const reviewStatus = $("#shelf-review-status");
  const historyLink = $("#shelf-history");
  const results = await Promise.allSettled((await myExchanges()).map(code => exchangeRequest(code)));
  const rooms = results.flatMap(result => result.status === "fulfilled" &&
    result.value.me >= 0 && result.value.completedAt ? [result.value] : []);
  rooms.sort((a, b) => b.members[b.me].finishedAt.localeCompare(a.members[a.me].finishedAt));
  let selected;
  if (results.some(result => result.status === "rejected")) status.textContent = "일부 책을 불러오지 못했어요.";
  if (!rooms.length) books.before(node("p", "완독한 책이 여기에 꽂혀요.", "muted"));
  const buttons = rooms.map((room, index) => {
    const button = node("button", "", "shelf-book");
    button.type = "button";
    button.style.setProperty("--spine", themes[room.theme]);
    button.style.setProperty("--book-height", [154, 170, 160, 180][index % 4] + "px");
    button.title = room.title;
    button.append(node("span", room.title));
    button.onclick = () => {
      selected = room;
      $("#shelf-title").textContent = room.title;
      historyLink.href = exchangeUrl(room.code, "history");
      actions.showModal();
    };
    books.append(button);
    return button;
  });
  $("#edit-shelf-review").onclick = () => {
    const me = selected.members[selected.me];
    $("#shelf-editor-title").textContent = selected.title + " 감상평 수정";
    setRating(me.rating);
    editor.elements.review.value = me.review ?? "";
    editor.elements.quote.value = me.quote ?? "";
    reviewStatus.textContent = "";
    actions.close();
    editorDialog.showModal();
  };
  editor.onsubmit = async event => {
    event.preventDefault();
    const room = selected;
    const submit = editor.querySelector("button");
    submit.disabled = true;
    try {
      Object.assign(room, await exchangeRequest(room.code, "review", Object.fromEntries(new FormData(editor))));
      editorDialog.close();
      notifySaved("감상과 별점을 저장했어요.");
    } catch (error) {
      reviewStatus.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  };
  const initial = rooms.findIndex(room => room.code === code);
  if (initial >= 0) buttons[initial].click();
}

function setupRoomOptions(create) {
  const names = { mint: "세이지", plum: "라벤더", rust: "살구", blue: "하늘", butter: "버터", rose: "장미", cocoa: "코코아" };
  for (const [theme, color] of Object.entries(themes)) {
    const label = node("label", "", "theme-option");
    const radio = node("input");
    Object.assign(radio, { type: "radio", name: "theme", value: theme, checked: theme === "mint" });
    radio.setAttribute("aria-label", names[theme]);
    const circle = node("span");
    circle.style.backgroundColor = color;
    label.append(radio, circle);
    $("#theme-options").append(label);
  }
  function updateCover() {
    const data = new FormData(create);
    $("#cover-preview").style.backgroundColor = themes[data.get("theme")];
    $("#cover-title").textContent = data.get("title").trim() || "책 제목";
    $("#cover-author").textContent = data.get("author").trim() || "저자";
  }
  create.addEventListener("input", updateCover);
  create.addEventListener("change", updateCover);
  updateCover();
  return updateCover;
}

function createRoom() {
  $("#create-view").hidden = false;
  setupRoomOptions($("#create-form"));
  form("#create-form", async data => { location.href = exchangeUrl((await exchangeRequest("", "", data)).code); });
}

async function openDemo() {
  const state = new URLSearchParams(location.search).get("state");
  const key = "bookmate-demo:" + state;
  let room;
  const previous = localStorage.getItem(key);
  if (previous) {
    try { room = await exchangeRequest(previous); } catch { /* The server may have reset. */ }
  }
  if (!room?.isHost || room.demo !== state ||
      (state === "reading" && room.members.some(person => person.finishedAt)) ||
      (state === "waiting" && room.members.length !== 1) ||
      (state === "ready" && (room.startedAt || room.members.length !== room.capacity))) {
    room = await exchangeRequest("", "", { demo: state });
    localStorage.setItem(key, room.code);
  }
  location.replace(state === "reading" ? "/room.html?code=" + room.code + (!serverMode ? "&local=1" : "")
    : exchangeUrl(room.code, state === "complete" ? "history" : "waiting"));
}

try {
  if (screen === "demo" && serverMode) {
    const url=new URL(location.href);url.searchParams.set("local","1");location.replace(url.href);
  } else {
  if(serverMode) await ensureAccount();
  if (screen === "home") await home();
  else if (screen === "shelf") await shelf();
  else if (screen === "create") createRoom();
  else if (screen === "demo") await openDemo();
  else if (["waiting", "history", "ticket"].includes(screen) && /^[A-F0-9]{8}$/.test(code)) {
    const room = await exchangeRequest(code);
    if (screen === "waiting") waiting(room);
    else if (room.me < 0 || !room.completedAt) location.replace(exchangeUrl(code));
    else if (screen === "ticket") location.replace(exchangeUrl(code, "history"));
    else history(room);
  } else {
    await home();
  }
  }
} catch (error) {
  status.textContent = error.message;
}
