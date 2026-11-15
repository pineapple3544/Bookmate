import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { WebSocket } from "ws";

type Peer = {
  socket: WebSocket;
  uid: string;
  request: FastifyRequest;
  alive: boolean;
  count: number;
  window: number;
};
type RoomState = {
  peers: Set<Peer>;
  host: string | null;
  epoch: string;
  queue: Promise<void>;
  pending: number;
  positions: Map<string, { x: number; y: number }>;
};

// One API process owns realtime connections. Persistent epochs fence old hosts
// across restarts; horizontal scaling requires a shared lease/broker first.
export function registerRealtime(
  app: FastifyInstance,
  db: PrismaClient,
  authenticate: (request: FastifyRequest) => Promise<string>,
  origins: string[],
) {
  const rooms = new Map<string, RoomState>();
  const send = (peer: Peer, value: unknown) => {
    if (peer.socket.readyState === 1) peer.socket.send(JSON.stringify(value));
  };
  function enqueue(state: RoomState, job: () => Promise<void>) {
    if (state.pending >= 64) {
      for (const peer of state.peers) peer.socket.close(1013, "Server busy");
      return;
    }
    state.pending++;
    state.queue = state.queue
      .then(job)
      .catch((error) => {
        app.log.error({ err: error }, "Realtime operation failed");
        for (const peer of state.peers)
          peer.socket.close(1011, "Service unavailable");
      })
      .finally(() => {
        state.pending--;
      });
  }
  async function refresh(id: string, state: RoomState) {
    for (const peer of [...state.peers]) {
      let valid = false;
      try {
        valid =
          peer.socket.readyState === 1 &&
          (await authenticate(peer.request)) === peer.uid &&
          !!(await db.roomMember.findUnique({
            where: { roomId_userId: { roomId: id, userId: peer.uid } },
          }));
      } catch {
        valid = false;
      }
      if (!valid) {
        state.peers.delete(peer);
        peer.socket.close(1008, "Session or membership expired");
      }
    }
    const online = [...new Set([...state.peers].map((p) => p.uid))];
    for (const uid of state.positions.keys())
      if (!online.includes(uid)) state.positions.delete(uid);
    const host =
      state.host && online.includes(state.host)
        ? state.host
        : (online[0] ?? null);
    if (host !== state.host) {
      const exists = await db.room.findUnique({
        where: { id },
        select: { id: true },
      });
      if (exists)
        state.epoch = String(
          (
            await db.room.update({
              where: { id },
              data: { hostEpoch: { increment: 1 } },
              select: { hostEpoch: true },
            })
          ).hostEpoch,
        );
      state.host = host;
    }
    return {
      type: "presence",
      onlineUserIds: online,
      hostUserId: state.host,
      hostEpoch: state.epoch,
      positions: Object.fromEntries(state.positions),
    };
  }
  async function announce(id: string, state: RoomState) {
    const value = await refresh(id, state);
    for (const peer of state.peers) send(peer, value);
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
        const uid = await authenticate(req);
        if (
          !(await db.roomMember.findUnique({
            where: {
              roomId_userId: { roomId: req.params.roomId, userId: uid },
            },
          }))
        )
          return reply.code(403).send({ error: { code: "NOT_A_MEMBER" } });
      },
    },
    (socket, req) => {
      const id = req.params.roomId;
      let state = rooms.get(id);
      if (!state) {
        state = {
          peers: new Set(),
          host: null,
          epoch: "0",
          queue: Promise.resolve(),
          pending: 0,
          positions: new Map(),
        };
        rooms.set(id, state);
      }
      if (state.peers.size + state.pending >= 24) {
        socket.close(1013, "Room connection limit");
        return;
      }
      const current = state;
      let peer: Peer | undefined;
      socket.on("error", () => {});
      socket.on("pong", () => {
        if (peer) peer.alive = true;
      });
      socket.on("close", () =>
        enqueue(current, async () => {
          if (peer) current.peers.delete(peer);
          await announce(id, current);
        }),
      );
      // Attach listeners synchronously before awaiting authentication.
      socket.on("message", (data) => {
        if (!peer || !current.peers.has(peer)) return;
        if (Date.now() - peer.window > 1000) {
          peer.window = Date.now();
          peer.count = 0;
        }
        if (++peer.count > 30) {
          socket.close(1008, "Rate limit");
          return;
        }
        let message: any;
        try {
          message = JSON.parse(data.toString());
        } catch {
          send(peer, { type: "error", code: "INVALID_MESSAGE" });
          return;
        }
        if (!message || !["move", "signal"].includes(message.type)) {
          send(peer, { type: "error", code: "INVALID_MESSAGE" });
          return;
        }
        const sender = peer;
        enqueue(current, async () => {
          await refresh(id, current);
          if (!current.peers.has(sender)) return;
          if (message.type === "move") {
            if (
              !Number.isFinite(message.x) ||
              !Number.isFinite(message.y) ||
              message.x < 24 ||
              message.x > 616 ||
              message.y < 160 ||
              message.y > 376
            ) {
              send(sender, { type: "error", code: "INVALID_POSITION" });
              return;
            }
            current.positions.set(sender.uid, { x: message.x, y: message.y });
            for (const recipient of current.peers)
              send(recipient, {
                type: "move",
                userId: sender.uid,
                x: message.x,
                y: message.y,
              });
          } else {
            if (message.hostEpoch !== current.epoch) {
              send(sender, { type: "error", code: "STALE_EPOCH" });
              return;
            }
            if (
              !["offer", "answer", "ice"].includes(message.kind) ||
              typeof message.targetUserId !== "string" ||
              typeof message.payload !== "object" ||
              !message.payload
            ) {
              send(sender, { type: "error", code: "INVALID_SIGNAL" });
              return;
            }
            const targets = [...current.peers].filter(
              (p) => p.uid === message.targetUserId && p.uid !== sender.uid,
            );
            if (!targets.length) {
              send(sender, { type: "error", code: "PEER_OFFLINE" });
              return;
            }
            for (const recipient of targets)
              send(recipient, {
                type: "signal",
                fromUserId: sender.uid,
                hostEpoch: current.epoch,
                kind: message.kind,
                payload: message.payload,
              });
          }
        });
      });
      enqueue(current, async () => {
        const uid = await authenticate(req);
        if (socket.readyState !== 1) return;
        peer = {
          socket,
          uid,
          request: req,
          alive: true,
          count: 0,
          window: Date.now(),
        };
        current.peers.add(peer);
        await announce(id, current);
      });
    },
  );
  const timer = setInterval(() => {
    for (const [id, state] of rooms) {
      if (!state.peers.size && !state.pending) {
        rooms.delete(id);
        continue;
      }
      for (const peer of state.peers) {
        if (!peer.alive) {
          peer.socket.terminate();
          state.peers.delete(peer);
        } else {
          peer.alive = false;
          peer.socket.ping();
        }
      }
      enqueue(state, () => announce(id, state));
    }
  }, 10000);
  timer.unref();
  app.addHook("onClose", async () => {
    clearInterval(timer);
    for (const state of rooms.values())
      for (const peer of state.peers) peer.socket.terminate();
    rooms.clear();
  });
  return {
    remove(id: string, uid?: string) {
      const state = rooms.get(id);
      if (!state) return;
      for (const peer of state.peers)
        if (!uid || peer.uid === uid) {
          peer.socket.close(1008, "Membership ended");
          state.peers.delete(peer);
        }
      enqueue(state, () => announce(id, state));
    },
  };
}
