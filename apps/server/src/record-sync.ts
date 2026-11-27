import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { createHash, createHmac } from "node:crypto";
import { ApiFailure } from "./errors.js";
function fail(status: number, code: string): never {
  throw new ApiFailure(status, code);
}
const kinds = [
  "publish",
  "reply",
  "edit-reply",
  "delete-reply",
  "annotate",
  "delete",
  "note",
  "delete-note",
];
const tombstoneKinds = new Set(["delete", "delete-reply", "delete-note"]);
const emptyDigest = createHash("sha256").update("").digest("hex");
const maxRoomOperations = 2048;
const maxRoomBytes = 256 * 1024 * 1024;
const uuid = { type: "string", format: "uuid" };
export function registerRecordSync(
  app: FastifyInstance,
  db: PrismaClient,
  authenticate: (req: FastifyRequest) => Promise<string>,
) {
  const base = "/api/v1/rooms/:roomId";
  const params = {
    type: "object",
    required: ["roomId"],
    properties: { roomId: uuid },
  };
  async function access(client: any, roomId: string, uid: string) {
    const room = await client.room.findUnique({
      where: { id: roomId },
      select: { exchangeCode: true, startedAt: true },
    });
    const members = await client.roomMember.findMany({
      where: { roomId },
      orderBy: { readingOrder: "asc" },
    });
    const me = members.findIndex((m: any) => m.userId === uid);
    if (me < 0) fail(403, "NOT_A_MEMBER");
    if (!room?.exchangeCode || !room.startedAt)
      fail(409, "EXCHANGE_NOT_STARTED");
    if (members[me].readingStatus === "WAITING") fail(403, "RECORDS_LOCKED");
    return { me: members[me].readingOrder - 1 };
  }
  const json = (op: any) => ({ ...op, sequence: String(op.sequence) });
  app.get<{ Params: { roomId: string }; Querystring: { after?: string } }>(
    base + "/record-ops",
    {
      schema: {
        params,
        querystring: {
          type: "object",
          properties: { after: { type: "string", pattern: "^[0-9]{1,19}$" } },
        },
      },
    },
    async (req) => {
      const uid = await authenticate(req);
      await access(db, req.params.roomId, uid);
      const after = BigInt(req.query.after ?? "0");
      if (after > 9223372036854775807n) fail(400, "INVALID_CURSOR");
      const operations = await db.recordOperation.findMany({
        where: {
          roomId: req.params.roomId,
          sequence: { gt: after },
        },
        orderBy: { sequence: "asc" },
        take: 201,
      });
      return {
        operations: operations.slice(0, 200).map(json),
        hasMore: operations.length > 200,
      };
    },
  );
  app.post<{
    Params: { roomId: string };
    Body: {
      id: string;
      kind: string;
      slot: number;
      page: number;
      postId?: string;
      replyId?: string;
      digest: string;
      bytes: number;
    };
  }>(
    base + "/record-ops",
    {
      schema: {
        params,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["id", "kind", "slot", "page", "digest", "bytes"],
          properties: {
            id: uuid,
            kind: { enum: kinds },
            slot: { type: "integer", minimum: 0, maximum: 2147483646 },
            page: { type: "integer", minimum: 1, maximum: 99999 },
            postId: uuid,
            replyId: uuid,
            digest: { type: "string", pattern: "^[a-f0-9]{64}$" },
            bytes: { type: "integer", minimum: 1, maximum: 22 * 1024 * 1024 },
          },
        },
      },
    },
    async (req, reply) => {
      const uid = await authenticate(req),
        body = req.body,
        roomId = req.params.roomId;
      return db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Room" WHERE id = ${roomId}::uuid FOR UPDATE`;
        const { me } = await access(tx, roomId, uid);
        if (body.slot !== me &&
            !await tx.roomMember.findFirst({ where: { roomId, readingOrder: body.slot + 1 }, select: { userId: true } }) &&
            !await tx.roomDeparture.findFirst({ where: { roomId, recordSlot: body.slot }, select: { id: true } }))
          fail(400, "INVALID_SLOT");
        const previous = await tx.recordOperation.findUnique({
          where: { id: body.id },
        });
        if (previous) {
          // An overflow tombstone has no client payload. Only its target,
          // author, room and operation kind participate in retry matching.
          const differentBody =
            previous.bytes !== 0 &&
            (previous.digest !== body.digest || previous.bytes !== body.bytes);
          if (
            previous.roomId !== roomId ||
            previous.authorId !== uid ||
            differentBody ||
            ["kind", "slot", "page", "postId", "replyId"].some(
              (key) =>
                ((previous as any)[key] ?? null) !==
                ((body as any)[key] ?? null),
            )
          )
            fail(409, "OPERATION_CONFLICT");
          return { operation: json(previous) };
        }
        if (
          ["publish", "delete", "note", "delete-note"].includes(body.kind) &&
          body.slot !== me
        )
          fail(403, "NOT_RECORD_OWNER");
        const history = await tx.recordOperation.findMany({
          where: { roomId, slot: body.slot, page: body.page },
          orderBy: { sequence: "asc" },
        });
        let post: string | null = null;
        let hasNote = false;
        for (const op of history) {
          if (op.kind === "publish") post = op.postId;
          if (op.kind === "delete") post = null;
          if (op.kind === "note") hasNote = true;
          if (op.kind === "delete-note" || op.kind === "delete")
            hasNote = false;
        }
        if (body.kind === "delete-note" && !hasNote) fail(409, "NOTE_MISSING");
        if (body.kind === "publish") {
          if (post) fail(409, "POST_EXISTS");
          if (!body.postId) fail(400, "POST_ID_REQUIRED");
        } else if (!["note", "delete-note"].includes(body.kind)) {
          if (!post || post !== body.postId) fail(409, "POST_CHANGED");
          if (["reply", "edit-reply", "delete-reply"].includes(body.kind)) {
            if (!body.replyId) fail(400, "REPLY_ID_REQUIRED");
            const previousReply = history.filter(
              (op) => op.postId === post && op.replyId === body.replyId,
            );
            if (body.kind === "reply") {
              if (previousReply.length) fail(409, "REPLY_EXISTS");
            } else {
              const original = previousReply.find((op) => op.kind === "reply");
              if (
                !original ||
                previousReply.some((op) => op.kind === "delete-reply")
              )
                fail(409, "REPLY_MISSING");
              if (original.authorId !== uid) fail(403, "NOT_REPLY_OWNER");
            }
          }
        }
        const usage = await tx.recordOperation.aggregate({
          where: { roomId },
          _count: true,
          _sum: { bytes: true },
        });
        const exceedsQuota =
          usage._count >= maxRoomOperations ||
          (usage._sum.bytes ?? 0) + body.bytes > maxRoomBytes;
        if (exceedsQuota && !tombstoneKinds.has(body.kind))
          fail(409, "ROOM_RECORD_LIMIT");
        // The room lock and the live-target checks allow at most one extra
        // tombstone per admitted publish, reply or note. Keep every sequence
        // for offline clients, but admit no more payload bytes above quota.
        const operation = await tx.recordOperation.create({
          data: {
            ...body,
            ...(exceedsQuota ? { bytes: 0, digest: emptyDigest } : {}),
            roomId,
            authorId: uid,
            actorSlot: me,
          },
        });
        reply.code(201);
        return { operation: json(operation) };
      });
    },
  );
  for (const motion of [false, true]) app.get<{ Params: { roomId: string } }>(
    base + (motion ? "/motion-rtc-config" : "/rtc-config"),
    { schema: { params } },
    async (req, reply) => {
      const uid = await authenticate(req);
      if (!motion) await access(db, req.params.roomId, uid);
      else if (!(await db.roomMember.findUnique({
        where: { roomId_userId: { roomId: req.params.roomId, userId: uid } },
        select: { userId: true },
      }))) fail(403, "NOT_A_MEMBER");
      const iceServers: any[] = [];
      const stun = (process.env.RTC_STUN_URLS ?? "").split(",").filter(Boolean);
      if (stun.length) iceServers.push({ urls: stun });
      const turn = (process.env.RTC_TURN_URLS ?? "").split(",").filter(Boolean),
        secret = process.env.RTC_TURN_SECRET;
      if (turn.length && secret) {
        const username = `${Math.floor(Date.now() / 1000) + 3600}:${uid}`;
        iceServers.push({
          urls: turn,
          username,
          credential: createHmac("sha1", secret)
            .update(username)
            .digest("base64"),
        });
      }
      reply.header("Cache-Control", "no-store");
      return {
        iceServers,
        iceTransportPolicy:
          process.env.RTC_RELAY_ONLY === "true" ? "relay" : "all",
        turnConfigured: !!(turn.length && secret),
      };
    },
  );
}
