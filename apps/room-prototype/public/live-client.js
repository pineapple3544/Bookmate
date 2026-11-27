import { apiRequest } from "./account.js";
import { createMotionPeers } from "./motion-peers.js";
export function createLiveRoom({ room, refreshMembers, onPosition, onPresence, onStatus, onSeat, onSeatConflict }) {
  const subscribers = new Set();
  let snapshot;
  const emit = (data) => {
    for (const fn of subscribers) fn(data);
  };
  const deferredPositions = new Map();
  let socket,
    timer,
    stopped = false,
    delay = 500,
    online = [],
    lastPosition;
  const slot = id => {
    const index = room.members.findIndex(member => member.id === id);
    return index < 0 ? undefined : index;
  };
  const departedName = id => room.departed?.find(person => person.id === id)?.name;
  const message = m => ({ ...m, senderSlot: slot(m.senderId), senderName: slot(m.senderId) === undefined ? departedName(m.senderId) : undefined });
  const sequences = new Map(), seats = new Map();
  let sequence = 0, checkpoint = 0, requestedSeat, claimSeq = 0;
  function send(frame) {
    if (snapshot && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
  }
  function position(peerId, data, snap = false) {
    const endpoint = snapshot?.peers.find(p => p.peerId === peerId);
    if (!endpoint || endpoint.userId === room.members[room.me].id || !data ||
        !Number.isSafeInteger(data.seq) || data.seq <= (sequences.get(peerId) ?? 0) ||
        !Number.isFinite(data.x) || data.x < 24 || data.x > 616 ||
        !Number.isFinite(data.y) || data.y < 160 || data.y > 376) return;
    const index = slot(endpoint.userId);
    if (index === undefined) {
      if (data.seq > (deferredPositions.get(peerId)?.seq ?? 0)) deferredPositions.set(peerId, data);
      return;
    }
    sequences.set(peerId, data.seq);
    onPosition(index, { x: data.x, y: data.y, seat: seats.get(index) ?? null }, snap);
  }
  const motion = createMotionPeers({
    getConfig: () => apiRequest(`/api/v1/rooms/${room.id}/motion-rtc-config`),
    signal: (targetPeerId, connectionId, payload) => send({ type: "motion-signal", targetPeerId, connectionId, kind: payload.type, payload }),
    receive: position,
    recover(id) {
      if (lastPosition) send({ type: "move", seq: ++sequence, x: lastPosition.x, y: lastPosition.y, targets: [id] });
    },
  });
  function publish(user, final = false) {
    lastPosition = { x: user.x, y: user.y, seat: user.seat };
    if (!snapshot) return;
    const packet = { x: user.x, y: user.y, seq: ++sequence };
    const encoded = JSON.stringify(packet);
    const targets = snapshot.peers.filter(p => p.peerId !== snapshot.selfPeerId && !motion.send(p.peerId, encoded)).map(p => p.peerId);
    const claim = requestedSeat !== user.seat;
    if (claim || targets.length || final || performance.now() - checkpoint >= 1000) {
      if (claim) { requestedSeat = user.seat; claimSeq = sequence; }
      send({ type: "move", ...packet, targets, ...(claim ? {seat: user.seat} : {}) });
      checkpoint = performance.now();
    }
  }
  function connect() {
    if (stopped) return;
    onStatus("연결 중");
    const url = new URL(`/api/v1/rooms/${room.id}/live`, location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(url);
    socket.onopen = () => {
      delay = 500;
      onStatus("서버");

    };
    socket.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      const first = !snapshot;
      if (data.type === "presence") {
        snapshot = data;
        motion.update(data);
        const ids = new Set(data.peers.map(p => p.peerId));
        for (const id of sequences.keys()) if (!ids.has(id)) sequences.delete(id);
      }
      emit(data);
      if (data.type === "presence") {
        const previousOnline = online;
        online = data.onlineUserIds.map(slot).filter((i) => i !== undefined);
        onPresence(online);
        for (const index of previousOnline) if (!online.includes(index)) seats.delete(index);
        for (const [id, value] of Object.entries(data.positions)) {
          const index = slot(id);
          if (index === undefined || index === room.me) continue;
          seats.set(index, value.seat);
          if (value.seq) position(value.fromPeerId, value, !previousOnline.includes(index));
          else onPosition(index, value, !previousOnline.includes(index));
        }
        if (data.onlineUserIds.some(id => slot(id) === undefined)) {
          refreshMembers().then(() => {
            if (!snapshot) return;
            online = snapshot.onlineUserIds.map(slot).filter(i => i !== undefined);
            onPresence(online);
            for (const [id, value] of Object.entries(snapshot.positions)) {
              const index = slot(id);
              if (index === undefined || index === room.me || previousOnline.includes(index)) continue;
              seats.set(index, value.seat);
              if (value.seq) position(value.fromPeerId, value, true);
              else onPosition(index, value, true);
            }
            for (const [peerId, packet] of deferredPositions) position(peerId, packet, true);
            deferredPositions.clear();
          }).catch(() => {});
        }
        if (first && lastPosition) publish(lastPosition, true);
      } else if (data.type === "motion-signal") {
        motion.handle(data);
      } else if (data.type === "seat") {
        const index = slot(data.userId);
        if (index === undefined) return;
        if (index === room.me && data.fromPeerId === snapshot?.selfPeerId) {
          if (data.seq !== undefined && data.seq < claimSeq) return;
          requestedSeat = data.seat;
          if (lastPosition) lastPosition.seat = data.seat;
        }
        seats.set(index, data.seat);
        onSeat(index, data.seat);
      } else if (data.type === "error" && data.code === "SEAT_OCCUPIED") {
        onSeatConflict();
      } else if (data.type === "move" && data.seq !== undefined) {
        position(data.fromPeerId, data);
      } else if (data.type === "move" && slot(data.userId) !== undefined)
        onPosition(slot(data.userId), data);
    };
    socket.onclose = (event) => {
      snapshot = undefined;
      motion.update(null);
      deferredPositions.clear();
      sequences.clear();
      seats.clear();
      requestedSeat = undefined;
      emit({ type: "disconnected" });
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
    subscribe(fn) {
      subscribers.add(fn);
      if (snapshot) fn(snapshot);
      return () => subscribers.delete(fn);
    },
    signal(targetPeerId, kind, payload) {
      if (socket?.readyState !== WebSocket.OPEN || !snapshot) return false;
      socket.send(
        JSON.stringify({
          type: "signal",
          targetPeerId,
          kind,
          payload,
          hostEpoch: snapshot.hostEpoch,
        }),
      );
      return true;
    },
    publish,
    async request(url, options = {}) {
      if (url.endsWith("/presence")) return { onlineSlots: online };
      const query = new URL(url, location.href).search;
      const body = options.body ? JSON.parse(options.body) : undefined;
      const data = await apiRequest(
        `/api/v1/rooms/${room.id}/messages` + query,
        options.method ?? "GET",
        body ? { id: body.id, text: body.text } : undefined,
      );
      if (data.messages?.some(m => slot(m.senderId) === undefined && !departedName(m.senderId))) await refreshMembers();
      return {
        ...data,
        ...(data.message ? { message: message(data.message) } : {}),
        ...(data.messages
          ? {
              messages: data.messages.map(message),
            }
          : {}),
        serverTime: data.serverTime ?? new Date().toISOString(),
        onlineSlots: online,
      };
    },
    close,
  };
}
