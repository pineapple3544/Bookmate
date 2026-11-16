import { registerRecordSync } from "./record-sync.js";
import { registerRealtime } from "./realtime.js";
import { randomBytes, createHash, scrypt, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient, Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;
import { ApiFailure } from "./errors.js";
export { ApiFailure } from "./errors.js";
import { registerExchanges } from "./exchanges.js";
const fail = (status: number, code: string): never => {
  throw new ApiFailure(status, code);
};
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const publicUser = { id: true, nickname: true } as const;
const idSchema = { type: "string", format: "uuid" };
const text = (maxLength: number) => ({
  type: "string",
  minLength: 1,
  maxLength,
});
const object = (properties: object, required: string[]) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
});
const params = object({ roomId: idSchema }, ["roomId"]);
const memberKey = (roomId: string, userId: string) => ({
  roomId_userId: { roomId, userId },
});
const roomJson = <T extends { hostEpoch: bigint }>(room: T) => ({
  ...room,
  hostEpoch: String(room.hostEpoch),
});
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(
      password,
      salt,
      64,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
}
async function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${(await derive(password, salt)).toString("hex")}`;
}
async function passwordMatches(password: string, encoded: string) {
  const [format, salt, key] = encoded.split(":");
  const actual = await derive(password, salt ?? "dummy-password-salt");
  if (format !== "scrypt" || !key) return false;
  const expected = Buffer.from(key, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export async function registerCore(
  app: FastifyInstance,
  db: PrismaClient,
  origins: string[],
  secure: boolean,
) {
  const cookieName = secure ? "__Host-bookmate_session" : "bookmate_session";
  const cookie = (token: string, age: number) =>
    `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? "; Secure" : ""}`;
  function token(req: FastifyRequest) {
    return (
      (req.headers.cookie ?? "")
        .split(";")
        .map((x) => x.trim())
        .find((x) => x.startsWith(cookieName + "="))
        ?.slice(cookieName.length + 1) ?? ""
    );
  }
  async function userId(req: FastifyRequest) {
    const raw = token(req);
    if (!/^[a-f0-9]{64}$/.test(raw)) return fail(401, "UNAUTHENTICATED");
    const session = await db.session.findUnique({
      where: { tokenHash: hash(raw) },
    });
    if (!session || session.expiresAt.getTime() <= Date.now())
      return fail(401, "UNAUTHENTICATED");
    return session.userId;
  }
  async function member(tx: Tx, roomId: string, uid: string, admin = false) {
    const value = await tx.roomMember.findUnique({
      where: memberKey(roomId, uid),
    });
    if (!value) return fail(403, "NOT_A_MEMBER");
    if (admin && value.role !== "ADMIN") return fail(403, "ADMIN_REQUIRED");
    return value;
  }
  async function lock(tx: Tx, roomId: string) {
    const found = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM "Room" WHERE id = ${roomId}::uuid FOR UPDATE`;
    if (!found.length) fail(404, "ROOM_NOT_FOUND");
    return (await tx.room.findUnique({ where: { id: roomId } }))!;
  }
  // Exact Origin validation is the CSRF gate for all cookie-authenticated mutations,
  // including login. No wildcard or request Host inference is used.
  app.addHook("onRequest", async (req, reply) => {
    if (
      !req.url.startsWith("/api/v1/") ||
      req.url.startsWith("/api/v1/prototype/")
    )
      return;
    reply.header("Cache-Control", "no-store");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      (!req.headers.origin || !origins.includes(req.headers.origin))
    )
      fail(403, "ORIGIN_DENIED");
  });
  const realtime = registerRealtime(app, db, userId, origins);
  registerExchanges(app, db, userId);
  registerRecordSync(app, db, userId);
  const credentials = object(
    {
      email: { type: "string", format: "email", maxLength: 254 },
      password: { type: "string", minLength: 10, maxLength: 128 },
      nickname: text(40),
    },
    ["email", "password"],
  );
  const authLimit = { rateLimit: { max: 15, timeWindow: "10 minutes" } };
  app.post<{ Body: { email: string; password: string; nickname?: string } }>(
    "/api/v1/auth/register",
    {
      config: authLimit,
      schema: {
        body: { ...credentials, required: ["email", "password", "nickname"] },
      },
    },
    async (req, reply) => {
      const email = req.body.email.trim().toLowerCase(),
        nickname = req.body.nickname!.trim();
      if (!nickname) fail(400, "INVALID_NICKNAME");
      const encoded = await passwordHash(req.body.password);
      const user = await db.user.create({
        data: { email, nickname, passwordHash: encoded },
        select: { ...publicUser, email: true },
      });
      return reply.code(201).send({ user });
    },
  );
  app.post<{ Body: { email: string; password: string } }>(
    "/api/v1/auth/login",
    { config: authLimit, schema: { body: credentials } },
    async (req, reply) => {
      const user = await db.user.findUnique({
        where: { email: req.body.email.trim().toLowerCase() },
      });
      if (
        !(await passwordMatches(req.body.password, user?.passwordHash ?? "")) ||
        !user
      )
        return fail(401, "INVALID_CREDENTIALS");
      const raw = randomBytes(32).toString("hex");
      await db.$transaction(async (tx) => {
        await tx.session.deleteMany({
          where: {
            OR: [
              { tokenHash: hash(token(req)) },
              { expiresAt: { lte: new Date() } },
            ],
          },
        });
        await tx.session.create({
          data: {
            tokenHash: hash(raw),
            userId: user.id,
            expiresAt: new Date(Date.now() + 7 * 86400000),
          },
        });
      });
      reply.header("Set-Cookie", cookie(raw, 7 * 86400));
      return {
        user: { id: user.id, email: user.email, nickname: user.nickname },
      };
    },
  );
  app.get("/api/v1/auth/me", async (req) => ({
    user: await db.user.findUnique({
      where: { id: await userId(req) },
      select: { ...publicUser, email: true },
    }),
  }));
  app.post("/api/v1/auth/logout", async (req, reply) => {
    await db.session.deleteMany({ where: { tokenHash: hash(token(req)) } });
    return reply.header("Set-Cookie", cookie("", 0)).code(204).send();
  });
  app.get<{
    Querystring: { q?: string; scope?: "mine" | "public"; before?: string };
  }>(
    "/api/v1/rooms",
    {
      schema: {
        querystring: object(
          {
            q: { type: "string", maxLength: 100 },
            scope: { enum: ["mine", "public"] },
            before: idSchema,
          },
          [],
        ),
      },
    },
    async (req) => {
      const uid = await userId(req);
      const rooms = await db.room.findMany({
        where: {
          ...(req.query.scope === "public"
            ? { visibility: "PUBLIC" as const }
            : { members: { some: { userId: uid } } }),
          ...(req.query.q
            ? { title: { contains: req.query.q, mode: "insensitive" as const } }
            : {}),
          ...(req.query.before ? { id: { lt: req.query.before } } : {}),
        },
        orderBy: { id: "desc" },
        take: 51,
        select: {
          id: true,
          title: true,
          bookTitle: true,
          visibility: true,
          maxMembers: true,
          version: true,
          _count: { select: { members: true } },
        },
      });
      return {
        rooms: rooms.slice(0, 50),
        nextCursor: rooms.length > 50 ? rooms[49]!.id : null,
      };
    },
  );
  app.post<{
    Body: {
      title: string;
      bookTitle: string;
      visibility?: "PUBLIC" | "PRIVATE";
      maxMembers?: number;
    };
  }>(
    "/api/v1/rooms",
    {
      schema: {
        body: object(
          {
            title: text(100),
            bookTitle: text(200),
            visibility: { enum: ["PUBLIC", "PRIVATE"] },
            maxMembers: { type: "integer", minimum: 2, maximum: 12 },
          },
          ["title", "bookTitle"],
        ),
      },
    },
    async (req, reply) => {
      const uid = await userId(req),
        title = req.body.title.trim(),
        bookTitle = req.body.bookTitle.trim();
      if (!title || !bookTitle) fail(400, "INVALID_TITLE");
      const room = await db.room.create({
        data: {
          title,
          bookTitle,
          visibility: req.body.visibility ?? "PRIVATE",
          maxMembers: req.body.maxMembers ?? 4,
          bookHolderId: uid,
          members: {
            create: {
              userId: uid,
              role: "ADMIN",
              readingOrder: 1,
              readingStatus: "READING",
              readingStartedAt: new Date(),
            },
          },
        },
      });
      return reply.code(201).send({ room: roomJson(room) });
    },
  );
  app.get<{ Params: { roomId: string } }>(
    "/api/v1/rooms/:roomId",
    { schema: { params } },
    async (req) => {
      const uid = await userId(req);
      await member(db, req.params.roomId, uid);
      const room = await db.room.findUnique({
        where: { id: req.params.roomId },
        include: {
          members: {
            orderBy: { readingOrder: "asc" },
            include: { user: { select: publicUser } },
          },
        },
      });
      if (!room) return fail(404, "ROOM_NOT_FOUND");
      return { room: roomJson(room) };
    },
  );
  app.patch<{
    Params: { roomId: string };
    Body: {
      version: number;
      title?: string;
      maxMembers?: number;
      visibility?: "PUBLIC" | "PRIVATE";
    };
  }>(
    "/api/v1/rooms/:roomId",
    {
      schema: {
        params,
        body: object(
          {
            version: { type: "integer", minimum: 0, maximum: 2147483646 },
            title: text(100),
            maxMembers: { type: "integer", minimum: 2, maximum: 12 },
            visibility: { enum: ["PUBLIC", "PRIVATE"] },
          },
          ["version"],
        ),
      },
    },
    async (req) => {
      const uid = await userId(req),
        id = req.params.roomId;
      return db.$transaction(async (tx) => {
        const room = await lock(tx, id);
        await member(tx, id, uid, true);
        if (room.exchangeCode) fail(409, "USE_EXCHANGE_WORKFLOW");
        if (room.version !== req.body.version) fail(409, "VERSION_CONFLICT");
        if (
          req.body.maxMembers &&
          req.body.maxMembers <
            (await tx.roomMember.count({ where: { roomId: id } }))
        )
          fail(409, "ROOM_CAPACITY");
        if (req.body.title !== undefined && !req.body.title.trim())
          fail(400, "INVALID_TITLE");
        const { version, ...data } = req.body;
        return {
          room: roomJson(
            await tx.room.update({
              where: { id },
              data: {
                ...data,
                ...(data.title ? { title: data.title.trim() } : {}),
                version: { increment: 1 },
              },
            }),
          ),
        };
      });
    },
  );
  app.delete<{ Params: { roomId: string } }>(
    "/api/v1/rooms/:roomId",
    { schema: { params } },
    async (req, reply) => {
      const uid = await userId(req),
        id = req.params.roomId;
      await db.$transaction(async (tx) => {
        await lock(tx, id);
        await member(tx, id, uid, true);
        await tx.room.delete({ where: { id } });
      });
      realtime.remove(id);
      return reply.code(204).send();
    },
  );
  app.post<{ Params: { roomId: string }; Body: { inviteToken?: string } }>(
    "/api/v1/rooms/:roomId/join",
    {
      schema: {
        params,
        body: object(
          { inviteToken: { type: "string", pattern: "^[a-f0-9]{64}$" } },
          [],
        ),
      },
    },
    async (req) => {
      const uid = await userId(req),
        id = req.params.roomId;
      return db.$transaction(async (tx) => {
        const room = await lock(tx, id);
        if (room.exchangeCode) fail(409, "USE_EXCHANGE_WORKFLOW");
        const existing = await tx.roomMember.findUnique({
          where: memberKey(id, uid),
        });
        if (existing) return { member: existing };
        if (room.visibility === "PRIVATE") {
          const invite = await tx.roomInvite.findUnique({
            where: { tokenHash: hash(req.body.inviteToken ?? "") },
          });
          if (
            !invite ||
            invite.roomId !== id ||
            invite.revoked ||
            invite.expiresAt.getTime() <= Date.now() ||
            invite.uses >= invite.maxUses
          )
            fail(403, "INVALID_INVITE");
          await tx.roomInvite.update({
            where: { id: invite!.id },
            data: { uses: { increment: 1 } },
          });
        }
        if (
          (await tx.roomMember.count({ where: { roomId: id } })) >=
          room.maxMembers
        )
          fail(409, "ROOM_FULL");
        const order = await tx.roomMember.aggregate({
          where: { roomId: id },
          _max: { readingOrder: true },
        });
        const value = await tx.roomMember.create({
          data: {
            roomId: id,
            userId: uid,
            readingOrder: (order._max.readingOrder ?? 0) + 1,
          },
        });
        await tx.room.update({
          where: { id },
          data: { version: { increment: 1 } },
        });
        return { member: value };
      });
    },
  );
  app.post<{ Params: { roomId: string }; Body: { maxUses?: number } }>(
    "/api/v1/rooms/:roomId/invites",
    {
      schema: {
        params,
        body: object(
          { maxUses: { type: "integer", minimum: 1, maximum: 12 } },
          [],
        ),
      },
    },
    async (req, reply) => {
      const uid = await userId(req),
        id = req.params.roomId,
        raw = randomBytes(32).toString("hex");
      const invite = await db.$transaction(async (tx) => {
        await lock(tx, id);
        await member(tx, id, uid, true);
        return tx.roomInvite.create({
          data: {
            roomId: id,
            tokenHash: hash(raw),
            maxUses: req.body.maxUses ?? 1,
            expiresAt: new Date(Date.now() + 7 * 86400000),
          },
        });
      });
      return reply.code(201).send({
        invite: {
          id: invite.id,
          token: raw,
          roomId: id,
          expiresAt: invite.expiresAt,
          maxUses: invite.maxUses,
        },
      });
    },
  );
  app.delete<{ Params: { roomId: string; inviteId: string } }>(
    "/api/v1/rooms/:roomId/invites/:inviteId",
    {
      schema: {
        params: object({ roomId: idSchema, inviteId: idSchema }, [
          "roomId",
          "inviteId",
        ]),
      },
    },
    async (req, reply) => {
      const uid = await userId(req),
        id = req.params.roomId;
      await db.$transaction(async (tx) => {
        await lock(tx, id);
        await member(tx, id, uid, true);
        await tx.roomInvite.updateMany({
          where: { id: req.params.inviteId, roomId: id },
          data: { revoked: true },
        });
      });
      return reply.code(204).send();
    },
  );
  app.delete<{ Params: { roomId: string } }>(
    "/api/v1/rooms/:roomId/membership",
    { schema: { params } },
    async (req, reply) => {
      const uid = await userId(req),
        id = req.params.roomId;
      await db.$transaction(async (tx) => {
        const room = await lock(tx, id),
          m = await member(tx, id, uid);
        if (room.exchangeCode) fail(409, "USE_EXCHANGE_WORKFLOW");
        if (room.bookHolderId === uid) fail(409, "BOOK_HOLDER_CANNOT_LEAVE");
        if (
          m.role === "ADMIN" &&
          (await tx.roomMember.count({
            where: { roomId: id, role: "ADMIN" },
          })) === 1
        )
          fail(409, "LAST_ADMIN");
        await tx.roomMember.delete({ where: memberKey(id, uid) });
        await tx.room.update({
          where: { id },
          data: { version: { increment: 1 } },
        });
      });
      realtime.remove(id, uid);
      return reply.code(204).send();
    },
  );
  app.post<{ Params: { roomId: string }; Body: { userId: string } }>(
    "/api/v1/rooms/:roomId/admins",
    { schema: { params, body: object({ userId: idSchema }, ["userId"]) } },
    async (req) => {
      const uid = await userId(req),
        id = req.params.roomId;
      return db.$transaction(async (tx) => {
        await lock(tx, id);
        await member(tx, id, uid, true);
        await member(tx, id, req.body.userId);
        return {
          member: await tx.roomMember.update({
            where: memberKey(id, req.body.userId),
            data: { role: "ADMIN" },
          }),
        };
      });
    },
  );
  app.post<{ Params: { roomId: string } }>(
    "/api/v1/rooms/:roomId/reading/complete",
    { schema: { params } },
    async (req) => {
      const uid = await userId(req),
        id = req.params.roomId;
      return db.$transaction(async (tx) => {
        const room = await lock(tx, id),
          m = await member(tx, id, uid);
        if (room.exchangeCode) fail(409, "USE_EXCHANGE_WORKFLOW");
        if (m.readingStatus === "COMPLETED") return { member: m };
        if (room.bookHolderId !== uid || m.readingStatus !== "READING")
          fail(409, "NOT_CURRENT_READER");
        const value = await tx.roomMember.update({
          where: memberKey(id, uid),
          data: { readingStatus: "COMPLETED", readingCompletedAt: new Date() },
        });
        await tx.room.update({
          where: { id },
          data: { version: { increment: 1 } },
        });
        return { member: value };
      });
    },
  );
  app.post<{
    Params: { roomId: string };
    Body: { id: string; toUserId: string; version: number };
  }>(
    "/api/v1/rooms/:roomId/transfers",
    {
      schema: {
        params,
        body: object(
          {
            id: idSchema,
            toUserId: idSchema,
            version: { type: "integer", minimum: 0, maximum: 2147483646 },
          },
          ["id", "toUserId", "version"],
        ),
      },
    },
    async (req) => {
      const uid = await userId(req),
        id = req.params.roomId;
      return db.$transaction(async (tx) => {
        const room = await lock(tx, id),
          m = await member(tx, id, uid);
        const previous = await tx.bookTransfer.findUnique({
          where: { id: req.body.id },
        });
        if (previous) {
          if (
            previous.roomId !== id ||
            previous.fromUserId !== uid ||
            previous.toUserId !== req.body.toUserId ||
            previous.version !== req.body.version + 1
          )
            fail(409, "IDEMPOTENCY_CONFLICT");
          return { transfer: previous };
        }
        if (room.exchangeCode) fail(409, "USE_EXCHANGE_WORKFLOW");
        if (room.version !== req.body.version) fail(409, "VERSION_CONFLICT");
        if (room.bookHolderId !== uid || m.readingStatus !== "COMPLETED")
          fail(409, "READING_NOT_COMPLETED");
        const next = await tx.roomMember.findFirst({
          where: {
            roomId: id,
            readingStatus: "WAITING",
            readingOrder: { gt: m.readingOrder },
          },
          orderBy: { readingOrder: "asc" },
        });
        if (!next || next.userId !== req.body.toUserId)
          fail(409, "INVALID_NEXT_READER");
        await tx.roomMember.update({
          where: memberKey(id, req.body.toUserId),
          data: { readingStatus: "READING", readingStartedAt: new Date() },
        });
        await tx.room.update({
          where: { id },
          data: { bookHolderId: req.body.toUserId, version: { increment: 1 } },
        });
        return {
          transfer: await tx.bookTransfer.create({
            data: {
              id: req.body.id,
              roomId: id,
              fromUserId: uid,
              toUserId: req.body.toUserId,
              version: room.version + 1,
            },
          }),
        };
      });
    },
  );
  app.get<{ Params: { roomId: string } }>(
    "/api/v1/rooms/:roomId/transfers",
    { schema: { params } },
    async (req) => {
      const uid = await userId(req);
      await member(db, req.params.roomId, uid);
      return {
        transfers: await db.bookTransfer.findMany({
          where: { roomId: req.params.roomId },
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
      };
    },
  );
  app.get<{
    Params: { roomId: string };
    Querystring: { after?: string; before?: string };
  }>(
    "/api/v1/rooms/:roomId/messages",
    {
      schema: {
        params,
        querystring: object(
          {
            after: { type: "string", pattern: "^[0-9]{1,18}$" },
            before: { type: "string", pattern: "^[0-9]{1,18}$" },
          },
          [],
        ),
      },
    },
    async (req) => {
      const uid = await userId(req);
      await member(db, req.params.roomId, uid);
      const { after, before } = req.query;
      if (after && before) fail(400, "INVALID_CURSOR");
      const rows = await db.chatMessage.findMany({
        where: {
          roomId: req.params.roomId,
          ...(after
            ? { sequence: { gt: BigInt(after) } }
            : before
              ? { sequence: { lt: BigInt(before) } }
              : {}),
        },
        orderBy: { sequence: after ? "asc" : "desc" },
        take: 51,
      });
      const messages = rows.slice(0, 50);
      if (!after) messages.reverse();
      return {
        messages: messages.map((m) => ({ ...m, sequence: String(m.sequence) })),
        hasMore: rows.length > 50,
      };
    },
  );
  app.post<{ Params: { roomId: string }; Body: { id: string; text: string } }>(
    "/api/v1/rooms/:roomId/messages",
    {
      schema: {
        params,
        body: object({ id: idSchema, text: text(500) }, ["id", "text"]),
      },
    },
    async (req, reply) => {
      const uid = await userId(req),
        id = req.params.roomId,
        body = req.body.text.trim();
      if (!body) fail(400, "EMPTY_MESSAGE");
      const message = await db.$transaction(async (tx) => {
        await lock(tx, id);
        await member(tx, id, uid);
        const previous = await tx.chatMessage.findUnique({
          where: { id: req.body.id },
        });
        if (previous) {
          if (
            previous.roomId !== id ||
            previous.senderId !== uid ||
            previous.text !== body
          )
            fail(409, "IDEMPOTENCY_CONFLICT");
          return previous;
        }
        return tx.chatMessage.create({
          data: { id: req.body.id, roomId: id, senderId: uid, text: body },
        });
      });
      return reply
        .code(201)
        .send({ message: { ...message, sequence: String(message.sequence) } });
    },
  );
}
