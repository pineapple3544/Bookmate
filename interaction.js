/* Bookmate - 1차 JavaScript Interaction
 * 서버 인증/DB 저장/실시간 동기화는 구현 전입니다.
 * 데모 상태는 한 브라우저의 localStorage에만 저장됩니다.
 */
(() => {
  "use strict";
  const STORAGE_KEY = "bookmate_interaction_demo_v1";
  const PAGE = location.pathname.split("/").pop() || "index.html";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  // 테스트용 참여자. 실제 연동에서는 방 API가 제공하는 ID/이름/순서로 교체합니다.
  const DEMO_MEMBERS = [
    { id: "nakyeon", name: "낙연" },
    { id: "soi", name: "soiewer" }, // HTML 화면들의 '나' 닉네임과 맞춤
    { id: "minji", name: "민지" },
    { id: "subin", name: "수빈" }
  ];
  const defaults = () => ({
    readerIndex: 2, records: [], reviews: {}, comments: {},
    waitingOrder: ["nakyeon", "soi", "minji"], createdRoom: null
  });
  function loadState() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return { ...defaults(), ...raw };
    } catch { return defaults(); }
  }
  const state = loadState();
  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); return true; }
    catch { toast("브라우저에 임시 저장할 수 없습니다."); return false; }
  }
  function node(tag, content, cls = "") {
    const item = document.createElement(tag);
    if (content !== undefined) item.textContent = content;
    if (cls) item.className = cls;
    return item;
  }
  function toast(message) {
    let item = $("#bm-toast");
    if (!item) {
      item = node("div");
      item.id = "bm-toast";
      item.setAttribute("role", "status");
      item.setAttribute("aria-live", "polite");
      document.body.appendChild(item);
    }
    item.textContent = message;
    item.classList.add("bm-visible");
    clearTimeout(toast.timeout);
    toast.timeout = setTimeout(() => item.classList.remove("bm-visible"), 3500);
  }
  // 데모 안내 문구는 페이지당 한 번만 붙이고, 진행 상태를 처음으로 되돌리는 버튼을 함께 둡니다.
  function demoLabel(root) {
    if (!root || $(".bm-demo-caption")) return;
    const caption = node("p", "1차 데모: 변경 사항은 이 브라우저에만 저장됩니다. ", "bm-demo-caption");
    const reset = node("button", "데모 초기화", "bm-demo-reset");
    reset.type = "button";
    reset.addEventListener("click", () => {
      if (!window.confirm("데모 진행 상태(전달 현황, 감상평, 댓글, 기록, 만든 방)를 처음으로 되돌릴까요?")) return;
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* 저장소 접근 불가 시 무시 */ }
      location.reload();
    });
    caption.appendChild(reset);
    root.appendChild(caption);
  }
  function memberById(id) {
    return DEMO_MEMBERS.find(member => member.id === id);
  }
  function currentViewerId() {
    const id = new URLSearchParams(location.search).get("viewer");
    if (memberById(id)) return id;
    if (PAGE === "room-reading.html") return "minji";
    if (PAGE === "room-waiting-view.html") return "subin";
    return "soi";
  }
  // 전달 현황에 따라 각 참여자가 봐야 할 화면(완독/읽는 중/대기)을 고릅니다.
  function viewerPage(id) {
    const index = DEMO_MEMBERS.findIndex(member => member.id === id);
    const page = index < state.readerIndex ? "room-done.html"
      : index === state.readerIndex ? "room-reading.html" : "room-waiting-view.html";
    return page + "?viewer=" + encodeURIComponent(id);
  }
  function viewLabel(id) {
    return id === "soi" ? "나 (soiewer)" : (memberById(id)?.name || id) + " 시점";
  }
  // 상단 '시점' 메뉴를 현재 진행 상태에 맞는 링크로 다시 만듭니다.
  // (기존에는 고정 링크라서 책을 넘긴 뒤 다음 사람 시점으로 이어 갈 수 없었습니다.)
  function initViewMenu(viewer) {
    const view = $("details.view");
    const summary = $("summary", view || document), menu = $(".menu", view || document);
    if (!view || !summary || !menu) return;
    summary.textContent = viewLabel(viewer);
    menu.replaceChildren(...DEMO_MEMBERS.map(member => {
      const link = node("a", viewLabel(member.id));
      link.href = viewerPage(member.id);
      if (member.id === viewer) link.setAttribute("aria-current", "page");
      return link;
    }));
  }
  async function copyValue(value) {
    try {
      await navigator.clipboard.writeText(value);
      toast("복사했습니다.");
    } catch {
      const input = node("textarea");
      input.value = value;
      input.style.cssText = "position:fixed;opacity:0;pointer-events:none";
      document.body.appendChild(input);
      input.select();
      const ok = document.execCommand && document.execCommand("copy");
      input.remove();
      if (ok) toast("복사했습니다.");
      else window.prompt("아래 내용을 직접 복사해 주세요.", value);
    }
  }

  function initLogin() {
    if (PAGE !== "index.html") return;
    const form = $("#signup");
    if (!form) return;
    // 로그인 모드에서는 닉네임 칸이 숨겨져 있으므로, 보이는 칸만 required로 둡니다.
    // (숨은 required 칸이 있으면 브라우저가 제출 자체를 막아 로그인 버튼이 동작하지 않습니다.)
    const syncRequired = () => {
      const signupMode = location.hash === "#signup";
      $$("input", form).forEach(input => {
        const signupOnly = input.closest(".signup-only");
        input.required = !signupOnly || signupMode;
      });
    };
    syncRequired();
    window.addEventListener("hashchange", syncRequired);
    form.addEventListener("submit", event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      // 로그인/회원가입은 서버 인증이 필요하므로 이 브랜치에서는 화면 이동만 합니다.
      location.href = "home.html";
    });
    demoLabel(form);
  }

  function initHome() {
    if (PAGE !== "home.html") return;
    const inviteForm = $('form[action="waiting.html"]');
    inviteForm?.addEventListener("submit", event => {
      event.preventDefault();
      const code = $("input", inviteForm).value.trim().toUpperCase();
      if (!code) return toast("초대 코드를 입력해 주세요.");
      if (code === "RAK8FK") location.href = "waiting.html";
      else if (state.createdRoom?.code === code) location.href = "waiting.html?demo=new";
      else toast("등록되지 않은 데모 초대 코드입니다.");
    });
    // 방 만들기에서 만든 방을 홈 목록 맨 위에 보여 줍니다.
    const room = state.createdRoom;
    if (room && inviteForm) {
      const card = node("a", undefined, "card room d-flex flex-row align-items-center gap-3 text-decoration-none");
      card.href = "waiting.html?demo=new";
      const cover = node("div", undefined, "cover flex-shrink-0 " + room.color);
      cover.append(node("span", room.title), node("span", room.author));
      const body = node("div", undefined, "flex-grow-1 min-w-0");
      body.append(node("h2", room.title, "serif fs-6 mb-1 text-dark"),
                  node("p", "대기실 · " + room.members.length + "/" + room.capacity + "명 모임 · 코드 " + room.code, "xs muted mb-0"));
      card.append(cover, body);
      inviteForm.after(card);
    }
    const roomLink = $('a[href="room-reading.html"]');
    if (roomLink && state.readerIndex !== 2) {
      const count = Math.min(4, state.readerIndex);
      const sub = $(".xs.muted", roomLink);
      const fill = $(".bar i", roomLink);
      if (sub) sub.textContent = (count === 4 ? "모두 완독" : memberById(DEMO_MEMBERS[count].id).name + "님이 읽는 중") + " · " + count + "/4 완독";
      if (fill) fill.style.width = 25 * count + "%";
    }
  }

  function initCreateRoom() {
    if (PAGE !== "create.html") return;
    const form = $(".create form");
    const [title, author] = $$("input.input", form);
    const selection = $(".stepper select", form);
    const swatches = $(".stepper", form);
    const book = $$(".preview .cover span", form);
    if (!form || !title || !author || !selection || !swatches) return;
    const original = $$("span", swatches);
    [-1, 1].forEach((offset, i) => {
      if (!original[i]) return;
      const button = node("button", offset === -1 ? "−" : "+", "bm-step-button");
      button.type = "button";
      button.setAttribute("aria-label", offset === -1 ? "참여 인원 줄이기" : "참여 인원 늘리기");
      button.addEventListener("click", () => {
        selection.selectedIndex = Math.max(0, Math.min(selection.options.length - 1, selection.selectedIndex + offset));
      });
      original[i].replaceWith(button);
    });
    function preview() {
      if (book[0]) book[0].textContent = title.value.trim() || "태도에 관하여";
      if (book[1]) book[1].textContent = author.value.trim() || "임경선";
    }
    title.addEventListener("input", preview);
    author.addEventListener("input", preview);
    form.addEventListener("submit", event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const code = Math.random().toString(36).slice(2, 8).toUpperCase();
      state.createdRoom = {
        title: title.value.trim(),
        author: author.value.trim(),
        capacity: Number(selection.value.replace(/\D/g, "")),
        color: ($('input[name="c"]:checked', form)?.id || "c-plum").replace("c-", ""),
        code, members: ["soi"]
      };
      if (saveState()) location.href = "waiting.html?demo=new";
    });
    demoLabel(form);
  }

  function initWaitingRoom() {
    if (PAGE !== "waiting.html") return;
    // ?demo=new 또는 복사한 초대 링크(?code=XXXXXX)로 들어오면 새로 만든 방을 보여 줍니다.
    const params = new URLSearchParams(location.search);
    const linkCode = (params.get("code") || "").toUpperCase();
    const room = state.createdRoom && (params.get("demo") === "new" || linkCode === state.createdRoom.code)
      ? state.createdRoom : null;
    const code = room?.code || "RAK8FK";
    const codeBlock = $(".code");
    const rows = $(".member")?.parentElement;
    if (!codeBlock || !rows) return;
    if (codeBlock.firstChild?.nodeType === Node.TEXT_NODE) codeBlock.firstChild.textContent = code + " ";
    const cover = $(".cover.md");
    if (room) {
      const heading = $(".top h1"), title = $(".pad h2"), author = $(".pad h2 + p");
      if (heading) heading.textContent = room.title;
      if (title) title.textContent = room.title;
      if (author) author.textContent = room.author;
      if (cover) {
        cover.classList.remove("red", "green", "navy", "ochre", "plum");
        cover.classList.add(room.color);
        const parts = $$("span", cover);
        if (parts[0]) parts[0].textContent = room.title;
        if (parts[1]) parts[1].textContent = room.author;
      }
    }
    codeBlock.setAttribute("role", "button");
    codeBlock.setAttribute("aria-label", "초대 코드 복사");
    codeBlock.tabIndex = 0;
    codeBlock.addEventListener("click", () => copyValue(code));
    codeBlock.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); copyValue(code); }
    });
    $$("button").find(btn => btn.textContent.includes("초대 링크 복사"))
      ?.addEventListener("click", () => copyValue(new URL("waiting.html?code=" + encodeURIComponent(code), location.href).href));
    const order = room ? [...room.members] : [...state.waitingOrder];
    const info = rows.parentElement.querySelector("p");
    const start = $('a[href="room-reading.html"]');
    function renderOrder() {
      rows.replaceChildren();
      order.forEach((id, index) => {
        const row = node("div", undefined, "member");
        const actions = node("span", undefined, "bm-order-actions");
        [-1, 1].forEach(offset => {
          const button = node("button", offset === -1 ? "↑" : "↓", "bm-order-button");
          button.type = "button";
          button.disabled = index + offset < 0 || index + offset >= order.length;
          button.setAttribute("aria-label", (memberById(id)?.name || id) + (offset < 0 ? " 위로 이동" : " 아래로 이동"));
          button.addEventListener("click", () => {
            [order[index], order[index + offset]] = [order[index + offset], order[index]];
            if (room) room.members = [...order];
            else state.waitingOrder = [...order];
            if (saveState()) renderOrder();
          });
          actions.appendChild(button);
        });
        const name = (memberById(id)?.name || id) + (id === "soi" ? " (나)" : "");
        row.append(node("span", String(index + 1), "num"), node("span", name, "grow"));
        if (id === "soi") row.appendChild(node("span", "방장", "badge b-read")); // 기존 왕관 아이콘 대신 표시
        row.appendChild(actions);
        rows.appendChild(row);
      });
      if (info) info.textContent = "멤버 " + order.length + "/" + (room?.capacity || 3);
    }
    renderOrder();
    start?.addEventListener("click", event => {
      if (room && order.length < room.capacity) {
        event.preventDefault();
        toast("초대·참여 동기화는 백엔드 연결 후 가능합니다. 현재는 방 생성 데모입니다.");
      }
    });
    demoLabel($(".pad.stack"));
  }

  function initRoomStatus() {
    if (!["room-reading.html", "room-done.html", "room-waiting-view.html"].includes(PAGE)) return;
    const viewer = currentViewerId();
    const activeMember = DEMO_MEMBERS[state.readerIndex];
    initViewMenu(viewer);
    const counter = $(".card .hrow .xs.muted");
    if (counter) counter.textContent = Math.min(4, state.readerIndex) + "/4 완독";
    $$(".steps li").forEach((li, index) => {
      const person = DEMO_MEMBERS[index];
      const done = index < state.readerIndex;
      const reading = index === state.readerIndex;
      const name = $(".grow", li), n = $(".num", li), badge = $(".badge", li);
      if (name) {
        name.textContent = person.name + (person.id === viewer ? " (나)" : "");
        name.classList.toggle("me", person.id === viewer);
      }
      if (n) {
        n.classList.toggle("done", done);
        n.classList.toggle("read", reading);
        n.textContent = String(index + 1);
      }
      if (badge) {
        badge.className = "badge " + (done ? "b-done" : reading ? "b-read" : "b-wait");
        badge.textContent = done ? "완독" : reading ? "읽는 중" : "대기";
      }
    });
    if (PAGE === "room-waiting-view.html") {
      // 앞사람이 책을 넘겨 줘서 내 차례가 되면 '대기' 안내 대신 독서 화면으로 가는 버튼을 보여 줍니다.
      const notice = $(".pad.stack > .card:last-of-type");
      if (notice && viewer === activeMember?.id) {
        const go = node("a", "책 받고 읽기 시작하기", "btn accent mt-2");
        go.href = viewerPage(viewer);
        notice.replaceChildren(node("p", "내 차례가 됐어요", "fw-medium"),
                               node("p", "앞사람이 책을 전달했어요. 이제 기록을 남길 수 있어요.", "sm muted"), go);
      }
    }
    if (PAGE !== "room-reading.html") return;
    const hold = $(".hold");
    if (viewer !== activeMember?.id) {
      const finished = state.readerIndex >= DEMO_MEMBERS.length;
      const go = node("a", finished ? "완료 화면 보기" : "내 화면으로 가기", "btn line mt-3");
      go.href = finished ? "room-complete.html" : viewerPage(viewer);
      hold?.replaceChildren(
        node("h3", finished ? "교환 독서가 완료됐어요" : "지금은 내 독서 차례가 아니에요"),
        node("p", "진행 상태를 확인해 주세요. 실제 사용자 판단은 서버 인증 후 처리됩니다."),
        go
      );
      // 내 차례가 아니면 기록 올리기·전달 버튼을 쓸 수 없게 숨깁니다.
      const upload = $("#panel-record details.toggle");
      if (upload) upload.hidden = true;
    } else {
      const next = DEMO_MEMBERS[state.readerIndex + 1];
      const link = $('a[href="#confirm"]'), question = $("#confirm .box p");
      if (link) link.textContent = next ? next.name + "님에게 전달하기" : "마지막 독서 완료하기";
      if (question) question.textContent = next ? next.name + "님에게 책을 전달할까요? 완독 처리돼요." : "마지막 독서를 완료할까요?";
    }
    demoLabel($(".pad.stack"));
  }

  function initHandoff() {
    if (PAGE !== "room-reading.html") return;
    const button = $('#confirm a[href="room-done.html"]');
    if (!button) return;
    button.addEventListener("click", event => {
      event.preventDefault();
      const reader = DEMO_MEMBERS[state.readerIndex];
      if (!reader || reader.id !== currentViewerId()) return toast("현재 독서자만 전달할 수 있습니다.");
      // 확인은 화면의 #confirm 모달에서 이미 받았으므로 브라우저 confirm 창을 한 번 더 띄우지 않습니다.
      state.readerIndex = Math.min(DEMO_MEMBERS.length, state.readerIndex + 1);
      if (saveState()) location.href = state.readerIndex === DEMO_MEMBERS.length ?
        "room-complete.html" : "room-done.html?viewer=" + encodeURIComponent(reader.id);
    });
  }

  function initReviews() {
    if (!["room-reading.html", "room-done.html"].includes(PAGE)) return;
    const panel = PAGE === "room-reading.html" ? $("#panel-review") : $(".panel.p2");
    if (!panel) return;
    const saveButton = $$("button", panel).find(btn => btn.textContent.includes("감상평 저장"));
    const fields = $$("input.input, textarea.input", panel);
    const ratings = $$('input[type="radio"][name="s"]', panel);
    if (!saveButton || fields.length < 2) return;
    const key = "작별하지 않는다/" + currentViewerId();
    const saved = state.reviews[key];
    if (saved) {
      const selected = ratings.find(r => r.id === "s" + saved.stars);
      if (selected) selected.checked = true;
      fields[0].value = saved.oneLine;
      fields[1].value = saved.quote;
    }
    saveButton.addEventListener("click", () => {
      const chosen = ratings.find(r => r.checked);
      const oneLine = fields[0].value.trim(), quote = fields[1].value.trim();
      if (!chosen || !oneLine || !quote) return toast("별점, 한줄평, 기억에 남는 문장을 모두 입력해 주세요.");
      state.reviews[key] = { stars: Number(chosen.id.slice(1)), oneLine, quote };
      if (saveState()) toast("감상평을 임시 저장했어요.");
    });
    demoLabel(panel);
  }

  function initComments() {
    if (!["room-done.html", "room-complete.html"].includes(PAGE)) return;
    $$("form").filter(form => $('input[placeholder="댓글 달기"]', form)).forEach((form, index) => {
      const input = $('input[placeholder="댓글 달기"]', form);
      const key = PAGE + "/" + index;
      const list = node("div", undefined, "bm-comments");
      form.before(list);
      function render() {
        list.replaceChildren();
        (state.comments[key] || []).forEach(entry => {
          const row = node("div", undefined, "bm-comment");
          const edit = node("button", "수정", "bm-comment-action");
          const remove = node("button", "삭제", "bm-comment-action");
          edit.type = remove.type = "button";
          edit.addEventListener("click", () => {
            const content = window.prompt("댓글 수정", entry.text);
            if (content === null) return;
            if (!content.trim()) return toast("빈 댓글은 저장할 수 없습니다.");
            entry.text = content.trim();
            if (saveState()) render();
          });
          remove.addEventListener("click", () => {
            if (!window.confirm("댓글을 삭제할까요?")) return;
            state.comments[key] = state.comments[key].filter(c => c.id !== entry.id);
            if (saveState()) render();
          });
          row.append(node("span", "나: " + entry.text, "grow"), edit, remove);
          list.appendChild(row);
        });
      }
      render();
      form.addEventListener("submit", e => {
        e.preventDefault();
        if (!input.value.trim()) return toast("댓글을 입력해 주세요.");
        state.comments[key] = state.comments[key] || [];
        state.comments[key].push({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
          text: input.value.trim()
        });
        if (saveState()) { input.value = ""; render(); }
      });
    });
    demoLabel($(".pad.stack"));
  }

  function initRecords() {
    if (PAGE !== "room-reading.html") return;
    const panel = $("#panel-record");
    const photo = $(".photo", panel), file = $('input[type="file"]', panel);
    const drawing = $(".draw", panel), toggle = $("#drawOn");
    const details = $("details.toggle", panel);
    const number = $('input[placeholder^="예:"]', panel);
    const comment = $("textarea.input", panel);
    const upload = $$("a", panel).find(a => a.textContent.trim() === "올리기");
    const cancel = $$("a", panel).find(a => a.textContent.trim() === "취소");
    if (!photo || !file || !drawing || !toggle || !details || !number || !comment || !upload) return;

    const preview = document.createElement("img");
    preview.className = "bm-photo-preview";
    preview.alt = "선택한 책 페이지 사진";
    preview.hidden = true;
    photo.appendChild(preview);
    const canvas = document.createElement("canvas");
    canvas.width = 720; canvas.height = 540;
    canvas.className = "bm-drawing-canvas";
    drawing.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    let image = null, url = null, painting = false;

    function clearCanvas() {
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (image?.complete && image.naturalWidth) {
        const ratio = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
        const width = image.naturalWidth * ratio, height = image.naturalHeight * ratio;
        ctx.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
      }
    }
    function position(event) {
      const rect = canvas.getBoundingClientRect();
      return [(event.clientX - rect.left) * canvas.width / rect.width,
              (event.clientY - rect.top) * canvas.height / rect.height];
    }
    canvas.addEventListener("pointerdown", e => {
      if (!ctx) return;
      painting = true;
      const [x, y] = position(e);
      ctx.beginPath(); ctx.moveTo(x, y);
      ctx.lineWidth = 4; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.strokeStyle = "#c2602f";
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    canvas.addEventListener("pointermove", e => {
      if (!painting || !ctx) return;
      const [x, y] = position(e);
      ctx.lineTo(x, y); ctx.stroke();
    });
    ["pointerup", "pointercancel", "lostpointercapture"].forEach(type =>
      canvas.addEventListener(type, () => { painting = false; }));

    const actions = node("div", undefined, "bm-canvas-actions");
    const erase = node("button", "그림 지우기", "btn line");
    const exportPng = node("button", "그림 PNG 저장", "btn line");
    erase.type = exportPng.type = "button";
    erase.addEventListener("click", clearCanvas);
    exportPng.addEventListener("click", () => {
      const a = node("a");
      a.href = canvas.toDataURL("image/png");
      a.download = "bookmate-page.png";
      a.click();
    });
    actions.append(erase, exportPng);
    drawing.after(actions);
    actions.hidden = true;
    toggle.addEventListener("change", () => { actions.hidden = !toggle.checked; });

    function resetFile() {
      if (url) URL.revokeObjectURL(url);
      url = null; image = null; file.value = "";
      preview.removeAttribute("src"); preview.hidden = true;
      clearCanvas();
    }
    file.addEventListener("change", () => {
      const selected = file.files?.[0];
      if (!selected) return;
      if (!selected.type.startsWith("image/") || selected.size > 5 * 1024 * 1024) {
        resetFile();
        return toast("5MB 이하의 이미지 파일만 선택할 수 있습니다.");
      }
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(selected);
      preview.src = url; preview.hidden = false;
      image = new Image();
      image.onload = clearCanvas;
      image.src = url;
    });
    window.addEventListener("pagehide", () => { if (url) URL.revokeObjectURL(url); });

    const tab = $('.custom-tab-btn[data-target="#panel-record"]');
    const baseCount = $$(":scope > .card", panel).length; // HTML에 미리 들어 있는 기록 수
    function showRecord(record) {
      const card = node("div", undefined, "card bm-record");
      card.append(node("p", record.page + " · " + record.author + " · 데모 기록", "sm muted"),
                  node("p", record.comment));
      panel.appendChild(card);
      if (tab) tab.textContent = "기록 " + (baseCount + $$(".bm-record", panel).length);
    }
    state.records.filter(record => record.book === "작별하지 않는다").forEach(showRecord);
    upload.textContent = "기록 임시 저장";
    upload.addEventListener("click", e => {
      e.preventDefault();
      const pageValue = number.value.trim(), text = comment.value.trim();
      if (!pageValue || (!text && !file.files?.length)) return toast("페이지 번호와 코멘트 또는 사진을 입력해 주세요.");
      const record = {
        book: "작별하지 않는다", author: DEMO_MEMBERS.find(m => m.id === currentViewerId())?.name || "사용자",
        page: pageValue, comment: text || "사진 기록"
      };
      state.records.push(record);
      if (!saveState()) return;
      showRecord(record);
      number.value = ""; comment.value = "";
      toggle.checked = false; actions.hidden = true;
      resetFile(); details.open = false;
      toast("텍스트 기록을 임시 저장했습니다. 사진·그림 파일은 별도 저장이 필요합니다.");
    });
    cancel?.addEventListener("click", e => { e.preventDefault(); details.open = false; });
    demoLabel(panel);
  }

  function drawWrapped(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
    let line = "", printed = 0;
    for (const ch of [...text]) {
      if (line && ctx.measureText(line + ch).width > maxWidth) {
        ctx.fillText(line, x, y + printed * lineHeight);
        printed++; if (printed >= maxLines) return;
        line = ch;
      } else line += ch;
    }
    if (line && printed < maxLines) ctx.fillText(line, x, y + printed * lineHeight);
  }
  function initTicket() {
    if (PAGE !== "ticket.html") return;
    const button = $$("button").find(b => b.textContent.includes("PNG 이미지로 저장"));
    const card = $(".ticket");
    if (!button || !card) return;
    button.addEventListener("click", async () => {
      if (document.fonts?.ready) await document.fonts.ready;
      const canvas = document.createElement("canvas");
      canvas.width = 1080; canvas.height = 600;
      const ctx = canvas.getContext("2d");
      if (!ctx) return toast("이미지를 생성할 수 없습니다.");
      ctx.fillStyle = "#232b3b"; ctx.fillRect(0, 0, 1080, 600);
      ctx.fillStyle = "#2b3c5c"; ctx.fillRect(65, 60, 150, 230);
      ctx.fillStyle = "#fdf6ea"; ctx.font = '30px "Noto Serif KR", serif';
      drawWrapped(ctx, $(".cover span", card)?.textContent || "아몬드", 80, 110, 120, 40, 3);
      ctx.font = '20px "Noto Sans KR", sans-serif';
      ctx.fillText("EXCHANGE READING", 260, 110);
      ctx.font = 'bold 50px "Noto Serif KR", serif';
      drawWrapped(ctx, $("h2", card)?.textContent || "완료 티켓", 260, 180, 750, 58, 2);
      ctx.font = '23px "Noto Sans KR", sans-serif';
      ctx.fillText($("h2 + p", card)?.textContent || "", 260, 250);
      ctx.strokeStyle = "#ffffff80"; ctx.setLineDash([12, 12]);
      ctx.beginPath(); ctx.moveTo(60, 320); ctx.lineTo(1020, 320); ctx.stroke();
      ctx.setLineDash([]);
      const chosen = $('input[name="q"]:checked')?.id || "q1";
      const selected = $("." + chosen, card) || $(".q1", card);
      ctx.fillStyle = "#fdf6ea"; ctx.font = '30px "Noto Serif KR", serif';
      drawWrapped(ctx, $("p", selected)?.textContent || "", 75, 400, 925, 42, 2);
      ctx.font = '22px "Noto Sans KR", sans-serif';
      ctx.fillText($("p + p", selected)?.textContent || "", 75, 505);
      const footer = $$("span", card).slice(-2);
      ctx.font = '19px "Noto Sans KR", sans-serif';
      ctx.fillText(footer[0]?.textContent || "", 75, 565);
      ctx.textAlign = "right";
      ctx.fillText(footer[1]?.textContent || "", 1000, 565);
      canvas.toBlob(blob => {
        if (!blob) return toast("PNG 이미지 생성에 실패했습니다.");
        const url = URL.createObjectURL(blob);
        const link = node("a");
        link.href = url; link.download = "bookmate-ticket.png";
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2500);
        toast("PNG 티켓을 다운로드했습니다.");
      }, "image/png");
    });
  }

  initLogin();
  initHome();
  initCreateRoom();
  initWaitingRoom();
  initRoomStatus();
  initHandoff();
  initReviews();
  initComments();
  initRecords();
  initTicket();
})();
