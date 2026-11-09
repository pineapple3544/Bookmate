import { localMode, localRequest } from "./local-transport.js";
export function createChat({
  getSelected,
  getUsers,
  viewport,
  stage,
  onPresence,
}) {
  const panel = document.querySelector("#chat-panel");
  const list = document.querySelector("#chat-log");
  const form = document.querySelector("#chat-form");
  const input = document.querySelector("#chat-input");
  const sendButton = document.querySelector("#chat-send");
  const status = document.querySelector("#chat-status");
  const older = document.querySelector("#chat-older");
  const badge = document.querySelector("#chat-unread");
  const endpoint = "/api/v1/prototype/chat";
  const sessionId = crypto.randomUUID();
  const messages = new Map();
  const bubbles = new Map();
  let latest = "0",
    earliest = null,
    initialized = false;
  let polling = false,
    loadingOlder = false,
    sending = false,
    unread = 0;
  let pending = null,
    stopped = false,
    presencePending = false;
  const mobile = matchMedia("(max-width: 520px)");
  panel.open = !mobile.matches;
  mobile.addEventListener("change", () => {
    panel.open = !mobile.matches;
  });
  panel.addEventListener("toggle", () => {
    if (panel.open) {
      unread = 0;
      badge.textContent = "";
    }
  });
  async function request(url, options = {}) {
    if (localMode) return localRequest(url, options);
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      const error = new Error("Request failed");
      error.status = response.status;
      throw error;
    }
    return response.json();
  }
  function showBubble(message, serverTime) {
    const remaining =
      6000 - (Date.parse(serverTime) - Date.parse(message.createdAt));
    if (remaining <= 0) return;
    const previous = bubbles.get(message.senderSlot);
    if (previous && BigInt(previous.sequence) >= BigInt(message.sequence))
      return;
    previous?.element.remove();
    clearTimeout(previous?.timer);
    const element = document.createElement("div");
    element.className = "speech-bubble";
    element.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.textContent = message.text;
    element.append(text);
    viewport.append(element);
    const duration = Math.min(6000, remaining);
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      element.animate(
        [
          { opacity: 1, offset: 0 },
          { opacity: 1, offset: Math.max(0, (duration - 1000) / duration) },
          { opacity: 0, offset: 1 },
        ],
        { duration, fill: "forwards" },
      );
    }
    const timer = setTimeout(() => {
      element.remove();
      if (bubbles.get(message.senderSlot)?.element === element)
        bubbles.delete(message.senderSlot);
    }, duration);
    bubbles.set(message.senderSlot, {
      element,
      timer,
      sequence: message.sequence,
    });
    positionBubbles();
  }
  function positionBubbles() {
    const width = viewport.clientWidth;
    const offset = Number(stage.dataset.offsetX) || 0;
    for (const [slot, bubble] of bubbles) {
      const user = getUsers()[slot];
      const x = offset + (user.x / 640) * stage.clientWidth;
      const y = ((user.y - 55) / 400) * stage.clientHeight;
      bubble.element.hidden = x < 0 || x > width;
      const half = bubble.element.offsetWidth / 2;
      bubble.element.style.left =
        Math.max(half + 8, Math.min(width - half - 8, x)) + "px";
      bubble.element.style.top =
        Math.max(bubble.element.offsetHeight + 8, y) + "px";
    }
  }
  function merge(incoming, live, serverTime, prepend = false) {
    const additions = incoming.filter((message) => !messages.has(message.id));
    if (!additions.length) return;
    const atBottom =
      list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    const previousHeight = list.scrollHeight,
      previousTop = list.scrollTop;
    for (const message of additions) {
      messages.set(message.id, message);
      if (live) showBubble(message, serverTime);
    }
    const sorted = [...messages.values()].sort((a, b) =>
      BigInt(a.sequence) < BigInt(b.sequence) ? -1 : 1,
    );
    earliest = sorted[0].sequence;
    const fragment = document.createDocumentFragment();
    for (const message of sorted) {
      const row = document.createElement("div");
      row.className = "chat-message";
      row.dataset.id = message.id;
      const heading = document.createElement("div");
      heading.className = "chat-message-heading";
      const name = document.createElement("strong");
      name.textContent = "사용자 " + (message.senderSlot + 1);
      const time = document.createElement("time");
      time.dateTime = message.createdAt;
      time.textContent = new Date(message.createdAt).toLocaleString("ko-KR", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      heading.append(name, time);
      const text = document.createElement("p");
      text.textContent = message.text;
      row.append(heading, text);
      fragment.append(row);
    }
    list.replaceChildren(fragment);
    if (prepend)
      list.scrollTop = previousTop + list.scrollHeight - previousHeight;
    else if (atBottom || !initialized) list.scrollTop = list.scrollHeight;
    else list.scrollTop = previousTop;
    if (live && !panel.open) {
      unread += additions.length;
      badge.textContent = String(unread);
    }
  }
  async function poll() {
    if (polling || stopped) return;
    polling = true;
    try {
      const wasInitialized = initialized;
      const data = await request(
        endpoint + (wasInitialized ? "?after=" + latest : ""),
      );
      merge(data.messages, wasInitialized, data.serverTime);
      if (!wasInitialized) older.hidden = !data.hasMore;
      if (data.messages.length)
        latest = data.messages[data.messages.length - 1].sequence;
      initialized = true;
      onPresence(data.onlineSlots);
      if (!sending && !pending) status.textContent = "";
      sendButton.disabled = sending;
      if (data.hasMore && wasInitialized) setTimeout(poll, 0);
    } catch (error) {
      status.textContent =
        error.status === 404
          ? "방 없음"
          : localMode
            ? "브라우저 저장소 확인 필요"
            : "연결 대기";
      if (error.status === 404) {
        messages.clear();
        list.replaceChildren();
        for (const bubble of bubbles.values()) {
          clearTimeout(bubble.timer);
          bubble.element.remove();
        }
        bubbles.clear();
        initialized = false;
        latest = "0";
        earliest = null;
        older.hidden = true;
        sendButton.disabled = true;
      }
      onPresence([]);
    } finally {
      polling = false;
    }
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || sending || !initialized) return;
    if (
      !pending ||
      pending.text !== text ||
      pending.senderSlot !== getSelected()
    ) {
      pending = { id: crypto.randomUUID(), senderSlot: getSelected(), text };
    }
    sending = true;
    sendButton.disabled = true;
    input.disabled = true;
    status.textContent = "전송 중";
    try {
      const data = await request(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pending),
      });
      merge([data.message], true, data.serverTime);
      pending = null;
      input.value = "";
      sendButton.textContent = "전송";
      status.textContent = "";
    } catch {
      status.textContent = "전송 실패";
      sendButton.textContent = "재전송";
    } finally {
      sending = false;
      input.disabled = false;
      sendButton.disabled = false;
      input.focus();
    }
  });
  older.addEventListener("click", async () => {
    if (loadingOlder || !earliest) return;
    loadingOlder = true;
    older.disabled = true;
    try {
      const data = await request(endpoint + "?before=" + earliest);
      merge(data.messages, false, data.serverTime, true);
      older.hidden = !data.hasMore;
      status.textContent = "";
    } catch {
      status.textContent = "기록 불러오기 실패";
    } finally {
      loadingOlder = false;
      older.disabled = false;
    }
  });
  input.addEventListener("keydown", (event) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.isComposing &&
      event.keyCode !== 229
    ) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  async function heartbeat() {
    if (presencePending || stopped) return;
    presencePending = true;
    const slot = getSelected();
    try {
      const data = await request(endpoint + "/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, senderSlot: slot, active: true }),
      });
      onPresence(data.onlineSlots);
    } catch {
      onPresence([]);
    } finally {
      presencePending = false;
      if (slot !== getSelected()) void heartbeat();
    }
  }
  const pollTimer = setInterval(poll, 1500);
  const heartbeatTimer = setInterval(heartbeat, 8000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      void heartbeat();
      void poll();
    }
  });
  window.addEventListener("pagehide", () => {
    stopped = true;
    clearInterval(pollTimer);
    clearInterval(heartbeatTimer);
    void (localMode ? localRequest : fetch)(endpoint + "/presence", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        senderSlot: getSelected(),
        active: false,
      }),
    }).catch(() => {});
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) location.reload();
  });
  sendButton.disabled = true;
  void heartbeat();
  void poll();
  return { positionBubbles, heartbeat };
}
