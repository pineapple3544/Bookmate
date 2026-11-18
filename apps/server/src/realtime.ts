import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { WebSocket } from "ws";

type Session = { userId: string; tokenHash: string; expiresAt: Date };
type Position = { x: number; y: number; seat: number | null };
type Signal = {
  hostEpoch: string;
  kind: "offer" | "answer" | "ice";
  targetUserId?: string;
  targetPeerId?: string;
  payload: object;
};
type Peer = {
  id: string;
  socket: WebSocket;
  uid: string;
  tokenHash: string;
  expires: number;
  authorized: boolean;
  alive: boolean;
  count: number;
  window: number;
  signals: Signal[];
};
type RoomState = {
  id: string;
  peers: Set<Peer>;
  host: string | null;
  epoch: string;
  refreshing: boolean;
  dirty: boolean;
  announce: boolean;
  positions: Map<string, Position>;
  moves: Map<string, { sender: Peer; position: Position }>;
  moveTimer?: NodeJS.Timeout;
};

function live(peer: Peer) {
  return (
    peer.authorized && peer.socket.readyState === 1 && Date.now() < peer.expires
  );
}

function send(peer: Peer, value: unknown) {
  if (!live(peer)) return;
  if (peer.socket.bufferedAmount > 1024 * 1024) {
    peer.socket.close(1013, "Slow connection");
    return;
  }
  peer.socket.send(JSON.stringify(value));
}

// A short room-wide tick retains only the last input for each player, including
// the final seat/stop event. Movement never enters the authorization/host queue.
function move(state: RoomState, sender: Peer, position: Position) {
  state.moves.set(sender.uid, { sender, position });
  if (state.moveTimer) return;
  state.moveTimer = setTimeout(() => {
    delete state.moveTimer;
    for (const { sender, position } of state.moves.values()) {
      if (!state.peers.has(sender) || !live(sender)) continue;
      state.positions.set(sender.uid, position);
      for (const recipient of state.peers)
        send(recipient, { type: "move", userId: sender.uid, ...position });
    }
    state.moves.clear();
  }, 40);
}

function relay(
  state: RoomState,
  sender: Peer,
  message: Signal,
  readers: Set<string>,
) {
  if (!state.peers.has(sender) || !live(sender)) return;
  if (
    message.hostEpoch !== state.epoch ||
    ![...state.peers].some((p) => p.uid === state.host && live(p))
  ) {
    send(sender, { type: "error", code: "STALE_EPOCH" });
    return;
  }
  const targets = [...state.peers].filter(
    (p) =>
      live(p) &&
      (message.targetPeerId
        ? p.id === message.targetPeerId && p.id !== sender.id
        : p.uid === message.targetUserId && p.uid !== sender.uid),
  );
  if (!targets.length) {
    send(sender, { type: "error", code: "PEER_OFFLINE" });
    return;
  }
  if (
    message.targetPeerId &&
    (!readers.has(sender.uid) || targets.some((p) => !readers.has(p.uid)))
  ) {
    send(sender, { type: "error", code: "RECORDS_LOCKED" });
    return;
  }
  for (const recipient of targets)
    send(recipient, {
      type: "signal",
      fromUserId: sender.uid,
      fromPeerId: sender.id,
      hostEpoch: state.epoch,
      kind: message.kind,
      payload: message.payload,
    });
}

// One API process owns realtime connections. Persistent epochs fence old hosts
// across restarts; horizontal scaling requires a shared lease/broker first.
export function registerRealtime(
  app: FastifyInstance,
  db: PrismaClient,
  authenticate: (request: FastifyRequest) => Promise<Session>,
  origins: string[],
) {
  const rooms = new Map<string, RoomState>();
  const admissions = new WeakMap<FastifyRequest, Session>();
  function discard(state: RoomState, peer: Peer, reason?: string) {
    state.peers.delete(peer);
    peer.authorized = false;
    peer.signals.length = 0;
    if (state.moves.get(peer.uid)?.sender === peer)
      state.moves.delete(peer.uid);
    if (![...state.peers].some((p) => p.uid === peer.uid))
      state.positions.delete(peer.uid);
    if (reason) peer.socket.close(1008, reason);
    if (!state.peers.size) {
      clearTimeout(state.moveTimer);
      if (rooms.get(state.id) === state) rooms.delete(state.id);
    }
  }

  async function refresh(state: RoomState, announce: boolean) {
    const peers = [...state.peers];
    const signals = peers.map(
      (peer) => [peer, peer.signals.splice(0)] as const,
    );
    const [sessions, members] = await Promise.all([
      db.session.findMany({
        where: {
          tokenHash: { in: peers.map((p) => p.tokenHash) },
          expiresAt: { gt: new Date() },
        },
        select: { tokenHash: true, userId: true, expiresAt: true },
      }),
      db.roomMember.findMany({
        where: { roomId: state.id },
        select: { userId: true, readingStatus: true },
      }),
    ]);
    const sessionsByHash = new Map(sessions.map((s) => [s.tokenHash, s]));
    const memberIds = new Set(members.map((m) => m.userId));
    const readers = new Set(
      members.filter((m) => m.readingStatus !== "WAITING").map((m) => m.userId),
    );
    for (const peer of peers) {
      if (!state.peers.has(peer)) continue; // A logout/leave may have finished during the query.
      const session = sessionsByHash.get(peer.tokenHash);
      if (
        !session ||
        session.userId !== peer.uid ||
        session.expiresAt.getTime() <= Date.now() ||
        !memberIds.has(peer.uid) ||
        peer.socket.readyState !== 1
      ) {
        discard(state, peer, "Session or membership expired");
        announce = true;
      } else {
        peer.expires = session.expiresAt.getTime();
        peer.authorized = true;
      }
    }
    const online = () => [
      ...new Set([...state.peers].filter(live).map((p) => p.uid)),
    ];
    const ids = online();
    if (!ids.length) return;
    const host = state.host && ids.includes(state.host) ? state.host : ids[0]!;
    if (host !== state.host) {
      const room = await db.room.update({
        where: { id: state.id },
        data: { hostEpoch: { increment: 1 } },
        select: { hostEpoch: true },
      });
      state.epoch = String(room.hostEpoch);
      state.host = host;
      announce = true;
    }
    if (announce && online().includes(host)) {
      const connected = [...state.peers].filter(live);
      const value = {
        type: "presence",
        onlineUserIds: online(),
        hostUserId: host,
        hostEpoch: state.epoch,
        positions: Object.fromEntries(state.positions),
        recordReaders: [...readers],
        peers: connected.map((p) => ({ peerId: p.id, userId: p.uid })),
      };
      for (const peer of connected)
        send(peer, { ...value, selfPeerId: peer.id });
    }
    for (const [peer, messages] of signals)
      for (const message of messages) relay(state, peer, message, readers);
  }

  // At most one batch is in flight. Changes during its database read schedule
  // one more batch; each socket has its own bounded, ordered signal buffer.
  function schedule(state: RoomState, announce = true) {
    if (!state.peers.size) return;
    state.announce ||= announce;
    state.dirty = true;
    if (state.refreshing) return;
    state.refreshing = true;
    setImmediate(async () => {
      try {
        while (state.dirty && state.peers.size) {
          state.dirty = false;
          const announce = state.announce;
          state.announce = false;
          await refresh(state, announce);
        }
      } catch (error) {
        app.log.error({ err: error }, "Realtime authorization failed");
        for (const peer of state.peers)
          discard(state, peer, "Authorization unavailable");
      } finally {
        state.refreshing = false;
      }
    });
  }

  app.get<{ Params: { roomId: string } }>(
    "/api/v1/rooms/:roomId/live",
    {
      websocket: true,
      schema: {
        params: {
          type: "object",
          required: ["roomId"],
          properties: { roomId: { type: "string", format: "uuid" } },
        },
      },
      preValidation: async (req, reply) => {
        if (!req.headers.origin || !origins.includes(req.headers.origin))
          return reply.code(403).send({ error: { code: "ORIGIN_DENIED" } });
        const session = await authenticate(req);
        if (
          !(await db.roomMember.findUnique({
            where: {
              roomId_userId: {
                roomId: req.params.roomId,
                userId: session.userId,
              },
            },
          }))
        )
          return reply.code(403).send({ error: { code: "NOT_A_MEMBER" } });
        admissions.set(req, session);
      },
    },
    (socket, req) => {
      const id = req.params.roomId;
      const session = admissions.get(req)!;
      let state = rooms.get(id);
      if (!state) {
        state = {
          id,
          peers: new Set(),
          host: null,
          epoch: "0",
          refreshing: false,
          dirty: false,
          announce: false,
          positions: new Map(),
          moves: new Map(),
        };
        rooms.set(id, state);
      }
      if (state.peers.size >= 24) {
        socket.close(1013, "Room connection limit");
        return;
      }
      const current = state;
      const peer: Peer = {
        id: randomUUID(),
        socket,
        uid: session.userId,
        tokenHash: session.tokenHash,
        expires: session.expiresAt.getTime(),
        authorized: false,
        alive: true,
        count: 0,
        window: Date.now(),
        signals: [],
      };
      current.peers.add(peer);
      socket.on("error", () => {});
      socket.on("pong", () => {
        peer.alive = true;
      });
      socket.on("close", () => {
        if (!current.peers.has(peer)) return;
        discard(current, peer);
        schedule(current);
      });
      socket.on("message", (data) => {
        if (Date.now() >= peer.expires) {
          discard(current, peer, "Session expired");
          schedule(current);
          return;
        }
        if (!live(peer)) return;
        if (Date.now() - peer.window >= 1000) {
          peer.window = Date.now();
          peer.count = 0;
        }
        if (++peer.count > 30) {
          socket.close(1008, "Rate limit");
          return;
        }
        let message;
        try {
          message = JSON.parse(data.toString());
        } catch {
          /* invalid JSON */
        }
        if (message?.type === "move") {
          const { x, y, seat = null } = message;
          if (
            !Number.isFinite(x) ||
            x < 24 ||
            x > 616 ||
            !Number.isFinite(y) ||
            y < 160 ||
            y > 376 ||
            (seat !== null &&
              (!Number.isInteger(seat) || seat < 0 || seat > 11))
          ) {
            send(peer, { type: "error", code: "INVALID_POSITION" });
            return;
          }
          move(current, peer, { x, y, seat });
        } else if (message?.type === "signal") {
          if (
            !["offer", "answer", "ice"].includes(message.kind) ||
            (typeof message.targetUserId !== "string" &&
              typeof message.targetPeerId !== "string") ||
            typeof message.payload !== "object" ||
            !message.payload
          ) {
            send(peer, { type: "error", code: "INVALID_SIGNAL" });
            return;
          }
          if (peer.signals.length >= 64) {
            socket.close(1013, "Signal limit");
            return;
          }
          peer.signals.push(message);
          schedule(current, false);
        } else {
          send(peer, { type: "error", code: "INVALID_MESSAGE" });
        }
      });
      schedule(current);
    },
  );
  const timer = setInterval(() => {
    for (const state of rooms.values()) {
      for (const peer of state.peers) {
        if (!peer.alive) {
          peer.socket.terminate();
          discard(state, peer);
        } else if (peer.socket.readyState === 1) {
          peer.alive = false;
          peer.socket.ping();
        }
      }
      schedule(state);
    }
  }, 10000);
  timer.unref();
  app.addHook("onClose", async () => {
    clearInterval(timer);
    for (const state of rooms.values()) {
      clearTimeout(state.moveTimer);
      for (const peer of state.peers) {
        peer.socket.terminate();
        discard(state, peer);
      }
    }
  });
  return {
    remove(id: string, uid?: string) {
      const state = rooms.get(id);
      if (!state) return;
      for (const peer of state.peers)
        if (!uid || peer.uid === uid) discard(state, peer, "Membership ended");
      schedule(state);
    },
    revokeSession(tokenHash: string) {
      for (const state of rooms.values()) {
        let removed = false;
        for (const peer of state.peers)
          if (peer.tokenHash === tokenHash) {
            discard(state, peer, "Session ended");
            removed = true;
          }
        if (removed) schedule(state);
      }
    },
  };
}
