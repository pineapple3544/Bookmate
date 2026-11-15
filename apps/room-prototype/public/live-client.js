import { apiRequest } from "./account.js";
export function createLiveRoom({ room, onPosition, onPresence, onStatus }) {
  const indices = new Map(room.members.map((m, i) => [m.id, i]));
  let socket,
    timer,
    stopped = false,
    delay = 500,
    online = [],
    lastPosition;
  const slot = (id) => indices.get(id);
  const message = (m) => ({ ...m, senderSlot: slot(m.senderId) });
  function connect() {
    if (stopped) return;
    onStatus("연결 중");
    const url = new URL(`/api/v1/rooms/${room.id}/live`, location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(url);
    socket.onopen = () => {
      delay = 500;
      onStatus("서버");
      if (lastPosition)
        socket.send(JSON.stringify({ type: "move", ...lastPosition }));
    };
    socket.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (data.type === "presence") {
        online = data.onlineUserIds.map(slot).filter((i) => i !== undefined);
        onPresence(online);
        for (const [id, position] of Object.entries(data.positions))
          if (slot(id) !== undefined) onPosition(slot(id), position);
      } else if (data.type === "move" && slot(data.userId) !== undefined)
        onPosition(slot(data.userId), data);
    };
    socket.onclose = (event) => {
      online = [];
      onPresence([]);
      onStatus(event.code === 1008 ? "재접속 필요" : "연결 끊김");
      if (!stopped && event.code !== 1008) {
        timer = setTimeout(connect, delay);
        delay = Math.min(10000, delay * 2);
      }
    };
    socket.onerror = () => socket.close();
  }
  connect();
  const close = () => {
    stopped = true;
    clearTimeout(timer);
    socket?.close();
  };
  window.addEventListener("pagehide", close, { once: true });
  return {
    publish(user) {
      lastPosition = { x: user.x, y: user.y, seat: user.seat };
      if (socket?.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: "move", ...lastPosition }));
    },
    async request(url, options = {}) {
      if (url.endsWith("/presence")) return { onlineSlots: online };
      const query = new URL(url, location.href).search;
      const body = options.body ? JSON.parse(options.body) : undefined;
      const data = await apiRequest(
        `/api/v1/rooms/${room.id}/messages` + query,
        options.method ?? "GET",
        body ? { id: body.id, text: body.text } : undefined,
      );
      return {
        ...data,
        ...(data.message ? { message: message(data.message) } : {}),
        ...(data.messages
          ? {
              messages: data.messages
                .filter((m) => slot(m.senderId) !== undefined)
                .map(message),
            }
          : {}),
        serverTime: data.serverTime ?? new Date().toISOString(),
        onlineSlots: online,
      };
    },
    close,
  };
}
