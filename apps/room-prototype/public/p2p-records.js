import { apiRequest } from "./account.js";
import { MAX_BODY } from "./record-protocol.js";
const CHUNK = 16 * 1024,
  uuid = /^[a-f0-9-]{36}$/;
export function connectRecords({ room, live, store }) {
  const peers = new Map();
  let snapshot,
    config,
    stopped = false,
    inflight,
    announcing;
  const me = room.members[room.me].id;
  let configurationTime = 0,
    configurationPending;
  const count = () =>
    [...peers.values()].filter((p) => p.channel?.readyState === "open").length;
  function report(error = "") {
    const pending = [...peers.values()].some(
      (p) =>
        p.channel?.readyState === "open" &&
        store.inventory().some((id) => !p.inventory.has(id)),
    );
    store.report(count(), error, inflight || pending ? 1 : 0);
  }
  function drop(id, expected) {
    const p = peers.get(id);
    if (!p || (expected && p !== expected)) return;
    peers.delete(id);
    p.pc.close();
    p.receive = null;
    if (inflight?.peer === id) inflight = null;
    report();
  }
  function reset() {
    for (const id of [...peers.keys()]) drop(id);
  }
  async function settings() {
    if (configurationPending) return configurationPending;
    if (config && Date.now() - configurationTime < 30 * 60 * 1000)
      return config;
    configurationPending = apiRequest(`/api/v1/rooms/${room.id}/rtc-config`)
      .then((value) => {
        config = value;
        configurationTime = Date.now();
        return value;
      })
      .finally(() => (configurationPending = null));
    return configurationPending;
  }
  const valid = (p) => !stopped && peers.get(p.id) === p && store.isAllowed();
  function send(p, value) {
    if (p.channel?.readyState !== "open") return false;
    p.channel.send(JSON.stringify(value));
    return true;
  }
  function announce(p) {
    if (!valid(p) || p.channel?.readyState !== "open") return;
    const ids = store.inventory();
    for (let i = 0; i < ids.length; i += 100)
      send(p, { type: "have", ids: ids.slice(i, i + 100) });
  }
  function announceAll() {
    clearTimeout(announcing);
    announcing = setTimeout(() => {
      for (const p of peers.values()) announce(p);
      requestNext();
    }, 100);
  }
  function requestNext() {
    if (inflight || !store.isAllowed()) return;
    for (const id of store.missing())
      for (const p of peers.values())
        if (p.channel?.readyState === "open" && p.inventory.has(id)) {
          inflight = { id, peer: p.id, touched: Date.now() };
          send(p, { type: "want", id });
          report();
          return;
        }
    report();
  }
  async function drain(p) {
    const started = Date.now();
    while (p.channel.bufferedAmount > 256 * 1024) {
      if (
        !valid(p) ||
        p.channel.readyState !== "open" ||
        Date.now() - started > 30000
      )
        throw Error("전송 연결 끊김");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  async function upload(p, id) {
    if (!valid(p)) return;
    const body = store.get(id),
      m = store.metadata(id);
    if (!body || !m) return;
    const data = new TextEncoder().encode(body);
    send(p, { type: "body", id, bytes: data.length });
    for (let offset = 0; offset < data.length; offset += CHUNK) {
      await drain(p);
      if (!valid(p) || p.channel.readyState !== "open")
        throw Error("전송 연결 끊김");
      p.channel.send(data.slice(offset, offset + CHUNK));
    }
  }
  function channel(p, ch) {
    if (p.channel) {
      ch.close();
      return;
    }
    p.channel = ch;
    ch.binaryType = "arraybuffer";
    ch.bufferedAmountLowThreshold = 128 * 1024;
    ch.onopen = () => {
      announce(p);
      requestNext();
      report();
    };
    ch.onclose = () => drop(p.id, p);
    ch.onerror = () => drop(p.id, p);
    p.queue = Promise.resolve();
    p.sendQueue = Promise.resolve();
    p.sending = new Set();
    ch.onmessage = (e) => {
      p.queue = p.queue
        .then(async () => {
          if (!valid(p)) return;
          if (e.data instanceof ArrayBuffer) {
            const rx = p.receive;
            if (
              !rx ||
              !e.data.byteLength ||
              e.data.byteLength > CHUNK ||
              rx.offset + e.data.byteLength > rx.data.length
            )
              throw Error("Invalid record chunk");
            rx.data.set(new Uint8Array(e.data), rx.offset);
            rx.offset += e.data.byteLength;
            if (inflight) inflight.touched = Date.now();
            if (rx.offset === rx.data.length) {
              p.receive = null;
              const completedRequest = inflight;
              await store.accept(
                rx.id,
                new TextDecoder("utf-8", { fatal: true }).decode(rx.data),
              );
              if (inflight === completedRequest) inflight = null;
              announceAll();
              requestNext();
            }
            return;
          }
          if (typeof e.data !== "string" || e.data.length > 8192)
            throw Error("Invalid record frame");
          const msg = JSON.parse(e.data);
          if (msg.type === "have") {
            if (
              !Array.isArray(msg.ids) ||
              msg.ids.length > 100 ||
              msg.ids.some((id) => typeof id !== "string" || !uuid.test(id))
            )
              throw Error("Invalid inventory");
            for (const id of msg.ids) p.inventory.add(id);
            if (p.inventory.size > 2048) throw Error("Inventory limit");
            if (msg.ids.some((id) => !store.metadata(id)))
              void store
                .pull()
                .then(requestNext)
                .catch(() => {});
            requestNext();
          } else if (msg.type === "want") {
            if (typeof msg.id !== "string" || !uuid.test(msg.id))
              throw Error("Invalid request");
            if (p.sending.has(msg.id)) return;
            if (p.sending.size >= 16) throw Error("Request limit");
            p.sending.add(msg.id);
            p.sendQueue = p.sendQueue
              .then(() => upload(p, msg.id))
              .catch(() => drop(p.id, p))
              .finally(() => p.sending.delete(msg.id));
          } else if (msg.type === "body") {
            const m = store.metadata(msg.id);
            if (
              p.receive ||
              inflight?.id !== msg.id ||
              inflight.peer !== p.id ||
              !m ||
              msg.bytes !== m.bytes ||
              msg.bytes > MAX_BODY ||
              msg.bytes < 1
            )
              throw Error("Unexpected record body");
            p.receive = {
              id: msg.id,
              data: new Uint8Array(msg.bytes),
              offset: 0,
            };
            inflight.touched = Date.now();
          } else throw Error("Invalid record message");
        })
        .catch(() => {
          drop(p.id, p);
          report("기록 전송 재시도 중");
        });
    };
  }
  async function make(id, initiator, connectionId) {
    const rtc = await settings();
    if (!snapshot || stopped || peers.has(id)) return peers.get(id);
    const peer = snapshot.peers?.find((p) => p.peerId === id);
    if (
      !peer ||
      !snapshot.recordReaders.includes(peer.userId) ||
      !snapshot.recordReaders.includes(me)
    )
      return;
    const p = {
      id,
      connectionId: connectionId ?? crypto.randomUUID(),
      pc: new RTCPeerConnection({
        iceServers: rtc.iceServers,
        iceTransportPolicy: rtc.iceTransportPolicy,
      }),
      inventory: new Set(),
      candidates: [],
      created: Date.now(),
    };
    peers.set(id, p);
    p.pc.onicecandidate = (e) => {
      if (e.candidate && peers.get(id) === p)
        live.signal(id, "ice", {
          connectionId: p.connectionId,
          candidate: e.candidate.toJSON(),
        });
    };
    p.pc.onconnectionstatechange = () => {
      if (["failed", "closed"].includes(p.pc.connectionState)) drop(id, p);
    };
    p.pc.ondatachannel = (e) => channel(p, e.channel);
    if (initiator) {
      channel(
        p,
        p.pc.createDataChannel("bookmate-records-v1", { ordered: true }),
      );
      await p.pc.setLocalDescription(await p.pc.createOffer());
      live.signal(id, "offer", {
        connectionId: p.connectionId,
        description: p.pc.localDescription.toJSON(),
      });
    }
    return p;
  }
  let signals = Promise.resolve();
  async function signal(msg) {
    if (
      !snapshot ||
      msg.hostEpoch !== snapshot.hostEpoch ||
      !snapshot.peers.some(
        (p) => p.peerId === msg.fromPeerId && p.userId === msg.fromUserId,
      ) ||
      !snapshot.recordReaders.includes(msg.fromUserId) ||
      !snapshot.recordReaders.includes(me)
    )
      return;
    const id = msg.fromPeerId,
      data = msg.payload;
    if (!data || typeof data.connectionId !== "string") return;
    let p = peers.get(id);
    if (msg.kind === "offer") {
      if (id >= snapshot.selfPeerId) return;
      if (p && p.connectionId !== data.connectionId) drop(id);
      p = await make(id, false, data.connectionId);
      if (!p) return;
      await p.pc.setRemoteDescription(data.description);
      for (const c of p.candidates) await p.pc.addIceCandidate(c);
      p.candidates = [];
      await p.pc.setLocalDescription(await p.pc.createAnswer());
      live.signal(id, "answer", {
        connectionId: p.connectionId,
        description: p.pc.localDescription.toJSON(),
      });
    } else if (p && p.connectionId === data.connectionId) {
      if (msg.kind === "answer") {
        await p.pc.setRemoteDescription(data.description);
        for (const c of p.candidates) await p.pc.addIceCandidate(c);
        p.candidates = [];
      } else if (msg.kind === "ice") {
        if (p.pc.remoteDescription) await p.pc.addIceCandidate(data.candidate);
        else if (p.candidates.length < 64) p.candidates.push(data.candidate);
      }
    }
  }
  let maintaining = false;
  async function maintain() {
    if (maintaining || stopped) return;
    maintaining = true;
    try {
      if (!snapshot?.recordReaders?.includes(me) || !store.isAllowed()) {
        reset();
        return;
      }
      const allowed = new Set(
        snapshot.peers
          .filter((p) => snapshot.recordReaders.includes(p.userId))
          .map((p) => p.peerId),
      );
      for (const [id, p] of peers) {
        if (
          !allowed.has(id) ||
          (p.channel?.readyState !== "open" && Date.now() - p.created > 20000)
        )
          drop(id);
      }
      if (inflight && Date.now() - inflight.touched > 30000)
        drop(inflight.peer);
      for (const id of allowed)
        if (
          id !== snapshot.selfPeerId &&
          !peers.has(id) &&
          snapshot.selfPeerId < id
        )
          await make(id, true);
      requestNext();
    } catch {
      report("P2P 연결 재시도 중");
    } finally {
      maintaining = false;
    }
  }
  const unsubscribe = live.subscribe((msg) => {
    if (msg.type === "presence") {
      if (
        snapshot &&
        (snapshot.hostEpoch !== msg.hostEpoch ||
          snapshot.selfPeerId !== msg.selfPeerId)
      )
        reset();
      snapshot = msg;
      void maintain();
    }
    if (msg.type === "disconnected") {
      snapshot = null;
      reset();
    }
    if (msg.type === "signal")
      signals = signals
        .then(() => signal(msg))
        .catch(() => {
          const current = peers.get(msg.fromPeerId);
          if (current?.connectionId === msg.payload?.connectionId)
            drop(msg.fromPeerId, current);
        });
  });
  const unlisten = store.subscribe(announceAll),
    timer = setInterval(() => {
      void maintain();
    }, 1000);
  const close = () => {
    stopped = true;
    clearInterval(timer);
    clearTimeout(announcing);
    unsubscribe();
    unlisten();
    reset();
  };
  window.addEventListener("pagehide", close, { once: true });
  return { close };
}
