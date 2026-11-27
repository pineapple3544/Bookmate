import { randomBytes, randomUUID } from "node:crypto";
import { appearance, appearanceSchema, inheritedAppearance } from "./appearance.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient, Prisma } from "@prisma/client";
import { ApiFailure } from "./errors.js";
import { coverPayloadLimit, encodeCover } from "../../room-prototype/cover-image.mjs";
type Tx = Prisma.TransactionClient;
const fail = (status: number, message: string): never => {
  throw new ApiFailure(status, "EXCHANGE_ERROR", message);
};
function checkedCover(value: unknown) {
  return encodeCover(value) ?? fail(400, "표지 이미지를 확인해 주세요.");
}
const included = {
  cover: { select: { hash: true } },
  members: {
    orderBy: { readingOrder: "asc" as const },
    include: { user: { select: { id: true, nickname: true } } },
  },
};
function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
export function visibleReview(
  member: {
    userId: string;
    rating: number | null;
    review: string;
    quote: string;
  },
  viewerId: string,
  completedAt: Date | null,
) {
  if (!completedAt && member.userId !== viewerId) return {};
  return { rating: member.rating, review: member.review, quote: member.quote };
}
function view(room: any, uid: string) {
  const me = room.members.findIndex((m: any) => m.userId === uid);
  return {
    id: room.id,
    code: room.exchangeCode,
    title: room.bookTitle,
    author: room.author,
    theme: room.theme,
    coverUrl: room.cover ? "/api/v1/exchanges/" + room.exchangeCode + "/covers/" + room.cover.hash : null,
    visibility: room.visibility,
    capacity: room.maxMembers,
    createdAt: room.createdAt,
    startedAt: room.startedAt,
    completedAt: room.completedAt,
    version: room.version,
    me,
    isHost: room.exchangeOwnerId === uid,
    members: room.members.map((m: any) => ({
      id: m.userId,
      name: m.user.nickname,
      isHost: room.exchangeOwnerId === m.userId,
      ...(me >= 0
        ? {
            receivedAt: m.readingStartedAt,
            finishedAt: m.readingCompletedAt,
            appearance: m.appearance,
            ...visibleReview(m, uid, room.completedAt),
          }
        : {}),
    })),
  };
}
export function registerExchanges(
  app: FastifyInstance,
  db: PrismaClient,
  authenticate: (req: FastifyRequest) => Promise<string>,
  presence: { roomIds(): string[]; onlineCount(id: string): number },
) {
  async function load(tx: Tx, code: string, lock = false) {
    if (lock)
      await tx.$queryRaw`SELECT id FROM "Room" WHERE "exchangeCode"=${code} FOR UPDATE`;
    const room = await tx.room.findUnique({
      where: { exchangeCode: code },
      include: included,
    });
    if (!room) return fail(404, "방을 찾을 수 없어요.");
    return room;
  }
  async function join(tx: Tx, room: Awaited<ReturnType<typeof load>>, uid: string) {
    if (room.members.some(person => person.userId === uid)) return view(room, uid);
    if (room.completedAt || room.members.length >= room.maxMembers)
      fail(409, "완독했거나 인원이 찬 방이에요.");
    await tx.roomMember.create({
      data: { roomId: room.id, userId: uid, appearance: await inheritedAppearance(tx, uid),
        readingOrder: (room.members.at(-1)?.readingOrder ?? 0) + 1 },
    });
    const updated = await tx.room.update({ where: { id: room.id }, data: { version: { increment: 1 } }, include: included });
    return view(updated, uid);
  }

  app.get("/api/v1/exchanges/public", async req => {
    const uid = await authenticate(req);
    const ids = presence.roomIds();
    if (!ids.length) return { rooms: [] };
    const rows = await db.room.findMany({
      where: { id: { in: ids }, visibility: "PUBLIC", exchangeCode: { not: null },
        completedAt: null, members: { none: { userId: uid } } },
      select: { id: true, bookTitle: true, author: true, theme: true, maxMembers: true,
        cover: { select: { hash: true } }, _count: { select: { members: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return { rooms: rows.flatMap(room => {
      const online = presence.onlineCount(room.id);
      if (!online || room._count.members >= room.maxMembers) return [];
      return [{ id: room.id, title: room.bookTitle, author: room.author, theme: room.theme,
        coverUrl: room.cover ? "/api/v1/exchanges/public/" + room.id + "/covers/" + room.cover.hash : null,
        online, joined: room._count.members, capacity: room.maxMembers }];
    }) };
  });
  const publicId = { type: "string", format: "uuid" };
  app.get<{ Params: { id: string; hash: string } }>("/api/v1/exchanges/public/:id/covers/:hash",
    { schema: { params: { type: "object", properties: { id: publicId, hash: { type: "string", pattern: "^[a-f0-9]{64}$" } } } } },
    async (req, reply) => {
      await authenticate(req);
      const { id, hash } = req.params;
      if (!presence.onlineCount(id)) return reply.code(404).send();
      const room = await db.room.findFirst({ where: { id, visibility: "PUBLIC", completedAt: null,
        exchangeCode: { not: null }, cover: { is: { hash } } },
        select: { cover: { select: { image: true } }, _count: { select: { members: true } }, maxMembers: true } });
      if (!room?.cover || room._count.members >= room.maxMembers) return reply.code(404).send();
      return reply.type("image/png").header("Cache-Control", "private, no-store")
        .header("X-Content-Type-Options", "nosniff").send(Buffer.from(room.cover.image));
    });
  app.post<{ Params: { id: string } }>("/api/v1/exchanges/public/:id/join",
    { schema: { params: { type: "object", properties: { id: publicId } } } }, async req => {
      const uid = await authenticate(req);
      const room = await db.$transaction(async tx => {
        const { id } = req.params;
        await tx.$queryRaw`SELECT id FROM "Room" WHERE id = ${id}::uuid FOR UPDATE`;
        const room = await tx.room.findUnique({ where: { id }, include: included });
        if (!room?.exchangeCode) return fail(404, "참가할 수 없는 방이에요.");
        if (!room.members.some(person => person.userId === uid) &&
            (room.visibility !== "PUBLIC" || !presence.onlineCount(id)))
          return fail(409, "현재 공개 목록에서 참가할 수 없는 방이에요.");
        return join(tx, room, uid);
      });
      return { room };
    });

  const options = (input: any, minimum = 2) => {
    const title = clean(input.title, 80),
      author = clean(input.author, 50),
      capacity = Number(input.capacity);
    if (
      !title ||
      !Number.isInteger(capacity) ||
      capacity < minimum ||
      capacity > 10
    )
      fail(400, "책 제목과 참여 인원을 확인해 주세요.");
    const theme = [
      "mint",
      "plum",
      "rust",
      "blue",
      "butter",
      "rose",
      "cocoa",
    ].includes(input.theme)
      ? input.theme
      : "mint";
    return { title, author, capacity, theme };
  };
  app.get<{ Querystring: { before?: string } }>(
    "/api/v1/exchanges",
    {
      schema: {
        querystring: {
          type: "object",
          properties: { before: { type: "string", format: "uuid" } },
        },
      },
    },
    async (req) => {
      const uid = await authenticate(req);
      const rows = await db.room.findMany({
        where: {
          exchangeCode: { not: null },
          members: { some: { userId: uid } },
          ...(req.query.before ? { id: { lt: req.query.before } } : {}),
        },
        select: { id: true, exchangeCode: true },
        take: 101,
        orderBy: { id: "desc" },
      });
      return {
        codes: rows.slice(0, 100).map((r) => r.exchangeCode),
        nextCursor: rows.length > 100 ? rows[99]!.id : null,
      };
    },
  );
  app.post<{ Body: Record<string, any> }>(
    "/api/v1/exchanges",
    {
      bodyLimit: coverPayloadLimit,
      schema: {
        body: {
          type: "object",
          required: ["title", "capacity"],
          properties: {
            visibility: { enum: ["PUBLIC", "PRIVATE"] },
            coverPixels: { type: ["string", "null"] },
            title: { type: "string", maxLength: 80 },
            author: { type: "string", maxLength: 50 },
            capacity: {
              anyOf: [{ type: "integer" }, { type: "string", maxLength: 2 }],
            },
            theme: { type: "string", maxLength: 12 },
          },
        },
      },
    },
    async (req, reply) => {
      const uid = await authenticate(req),
        o = options(req.body);
      const cover = req.body.coverPixels == null ? undefined : checkedCover(req.body.coverPixels);
      const room = await db.$transaction(async (tx) => {
        return tx.room.create({
          data: {
            title: o.title,
            bookTitle: o.title,
            visibility: req.body.visibility ?? "PRIVATE",
            ...(cover ? { cover: { create: cover } } : {}),
            author: o.author,
            theme: o.theme,
            maxMembers: o.capacity,
            exchangeCode: randomBytes(4).toString("hex").toUpperCase(),
            exchangeOwnerId: uid,
            members: {
              create: {
                userId: uid,
                role: "ADMIN",
                appearance: await inheritedAppearance(tx, uid),
                readingOrder: 1,
              },
            },
          },
          include: included,
        });
      });
      return reply.code(201).send({ room: view(room, uid) });
    },
  );
  const params = {
    type: "object",
    required: ["code"],
    properties: { code: { type: "string", pattern: "^[A-F0-9]{8}$" } },
  };
  app.get<{ Params: { code: string; hash: string } }>(
    "/api/v1/exchanges/:code/covers/:hash", async (req, reply) => {
      await authenticate(req);
      const { code, hash } = req.params;
      if (!/^[A-F0-9]{8}$/.test(code) || !/^[a-f0-9]{64}$/.test(hash)) return reply.code(404).send();
      const cover = await db.roomCover.findFirst({
        where: { room: { exchangeCode: code }, hash }, select: { image: true },
      });
      if (!cover) return reply.code(404).send();
      return reply.type("image/png").header("Cache-Control", "private, max-age=3600")
        .header("X-Content-Type-Options", "nosniff").send(Buffer.from(cover.image));
    },
  );
  app.get<{ Params: { code: string } }>(
    "/api/v1/exchanges/:code",
    {
      schema: { params },
      config: { rateLimit: { max: 180, timeWindow: "1 minute" } },
    },
    async (req) => {
      const uid = await authenticate(req);
      return { room: view(await load(db, req.params.code), uid) };
    },
  );
  app.post<{
    Params: { code: string; action: string };
    Body: Record<string, any>;
  }>(
    "/api/v1/exchanges/:code/:action",
    {
      bodyLimit: coverPayloadLimit,
      schema: {
        params: {
          ...params,
          required: ["code", "action"],
          properties: {
            ...params.properties,
            action: {
              enum: [
                "join",
                "start",
                "settings",
                "visibility",
                "order",
                "appearance",
                "finish",
                "review",
              ],
            },
          },
        },
        body: {
          type: "object",
          properties: { ...appearanceSchema.properties, appearance: appearanceSchema, visibility: { enum: ["PUBLIC", "PRIVATE"] } },
        },
      },
    },
    async (req) => {
      const uid = await authenticate(req),
        input = req.body,
        action = req.params.action;
      const result = await db.$transaction(async (tx) => {
        const room = await load(tx, req.params.code, true),
          members = room.members;
        const me = members.findIndex((m) => m.userId === uid),
          person = members[me];
        if (action === "join") {
          return join(tx, room, uid);
        } else {
          if (!person) return fail(403, "먼저 방에 참가해 주세요.");
          if (
            ["start", "settings", "order", "visibility"].includes(action) &&
            room.exchangeOwnerId !== uid
          )
            fail(403, "방장만 변경할 수 있어요.");
          if (action === "start") {
            if (room.startedAt) return view(room, uid);
            if (members.length < 2)
              fail(409, "두 명부터 교환독서를 시작할 수 있어요.");
            await tx.room.update({
              where: { id: room.id },
              data: { startedAt: new Date(), bookHolderId: members[0]!.userId },
            });
            await tx.roomMember.update({
              where: {
                roomId_userId: { roomId: room.id, userId: members[0]!.userId },
              },
              data: { readingStatus: "READING", readingStartedAt: new Date() },
            });
          } else if (action === "visibility") {
            if (!input.visibility || room.completedAt) fail(409, "공개 설정을 변경할 수 없어요.");
            await tx.room.update({ where: { id: room.id }, data: { visibility: input.visibility } });
          } else if (action === "settings") {
            if (room.startedAt)
              fail(409, "교환독서를 시작한 뒤에는 방 옵션을 수정할 수 없어요.");
            const o = options(input, Math.max(2, members.length));
            if (input.coverPixels === null) {
              await tx.roomCover.deleteMany({ where: { roomId: room.id } });
            } else if (input.coverPixels !== undefined) {
              const cover = checkedCover(input.coverPixels);
              await tx.roomCover.upsert({ where: { roomId: room.id },
                create: { roomId: room.id, ...cover }, update: cover });
            }
            await tx.room.update({
              where: { id: room.id },
              data: {
                title: o.title,
                bookTitle: o.title,
                author: o.author,
                theme: o.theme,
                maxMembers: o.capacity,
              },
            });
          } else if (action === "order") {
            if (room.startedAt)
              fail(409, "교환독서를 시작한 뒤에는 순서를 바꿀 수 없어요.");
            const ids = members.map((m) => m.userId);
            if (JSON.stringify(input.previous) !== JSON.stringify(ids))
              fail(409, "참가자 목록이 바뀌었어요. 다시 확인해 주세요.");
            if (
              !Array.isArray(input.order) ||
              input.order.length !== ids.length ||
              new Set(input.order).size !== ids.length ||
              input.order.some((id: any) => !ids.includes(id))
            )
              fail(400, "참가자 순서를 확인해 주세요.");
            await tx.roomMember.updateMany({
              where: { roomId: room.id },
              data: { readingOrder: { increment: 100 } },
            });
            for (const [index, id] of (input.order as string[]).entries())
              await tx.roomMember.update({
                where: { roomId_userId: { roomId: room.id, userId: id } },
                data: { readingOrder: index + 1 },
              });
          } else if (action === "appearance") {
            await tx.roomMember.update({
              where: { roomId_userId: { roomId: room.id, userId: uid } },
              data: { appearance: appearance(input) },
            });
          } else {
            if (action === "finish" && person.readingStatus === "COMPLETED")
              return view(room, uid);
            if (
              action === "finish" &&
              (!room.startedAt ||
                room.bookHolderId !== uid ||
                person.readingStatus !== "READING")
            )
              fail(409, "책을 받을 차례가 되면 완독을 기록할 수 있어요.");
            if (action === "review" && person.readingStatus !== "COMPLETED")
              fail(409, "완독한 책의 감상을 수정할 수 있어요.");
            const rating = Number(input.rating);
            if (
              !Number.isFinite(rating) ||
              rating < 0.5 ||
              rating > 5 ||
              !Number.isInteger(rating * 2)
            )
              fail(400, "별점을 선택해 주세요.");
            await tx.roomMember.update({
              where: { roomId_userId: { roomId: room.id, userId: uid } },
              data: {
                rating,
                review: clean(input.review, 160),
                quote: clean(input.quote, 160),
                ...(input.appearance
                  ? { appearance: appearance(input.appearance) }
                  : {}),
                ...(action === "finish"
                  ? {
                      readingStatus: "COMPLETED",
                      readingCompletedAt: new Date(),
                    }
                  : {}),
              },
            });
            if (action === "finish") {
              const next = members[me + 1];
              if (next) {
                await tx.roomMember.update({
                  where: {
                    roomId_userId: { roomId: room.id, userId: next.userId },
                  },
                  data: {
                    readingStatus: "READING",
                    readingStartedAt: new Date(),
                  },
                });
                await tx.room.update({
                  where: { id: room.id },
                  data: { bookHolderId: next.userId },
                });
                await tx.bookTransfer.create({
                  data: {
                    id: randomUUID(),
                    roomId: room.id,
                    fromUserId: uid,
                    toUserId: next.userId,
                    version: room.version + 1,
                  },
                });
              } else
                await tx.room.update({
                  where: { id: room.id },
                  data: { completedAt: new Date() },
                });
            }
          }
        }
        await tx.room.update({
          where: { id: room.id },
          data: { version: { increment: 1 } },
        });
        return view(await load(tx, req.params.code), uid);
      });
      return { room: result };
    },
  );
}
