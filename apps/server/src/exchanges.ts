import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient, Prisma } from "@prisma/client";
import { ApiFailure } from "./errors.js";
type Tx = Prisma.TransactionClient;
const fail = (status: number, message: string): never => {
  throw new ApiFailure(status, "EXCHANGE_ERROR", message);
};
const included = {
  members: {
    orderBy: { readingOrder: "asc" as const },
    include: { user: { select: { id: true, nickname: true } } },
  },
};
function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function appearance(input: any): Prisma.InputJsonObject {
  const result: Record<string, string | number> = {};
  for (const key of [
    "hairstyle",
    "hair",
    "skin",
    "top",
    "clothes",
    "bottom",
    "bottomColor",
    "shoes",
    "accessory",
    "expression",
    "pet",
  ]) {
    if (typeof input?.[key] === "string")
      result[key] = input[key].slice(0, key === "pet" ? 350 : 40);
  }
  if (typeof input?.skinShade === "number" && Number.isFinite(input.skinShade))
    result.skinShade = Math.max(0, Math.min(100, input.skinShade));
  return result;
}
function view(room: any, uid: string) {
  const me = room.members.findIndex((m: any) => m.userId === uid);
  return {
    id: room.id,
    code: room.exchangeCode,
    title: room.bookTitle,
    author: room.author,
    theme: room.theme,
    capacity: room.maxMembers,
    createdAt: room.createdAt,
    startedAt: room.startedAt,
    completedAt: room.completedAt,
    version: room.version,
    me,
    isHost: room.exchangeOwnerId === uid,
    members: room.members.map((m: any, index: number) => ({
      id: m.userId,
      name: m.displayName ?? m.user.nickname,
      isHost: room.exchangeOwnerId === m.userId,
      ...(me >= 0
        ? {
            receivedAt: m.readingStartedAt,
            finishedAt: m.readingCompletedAt,
            appearance: m.appearance,
            ...(room.completedAt || index === me
              ? { rating: m.rating, review: m.review, quote: m.quote }
              : {}),
          }
        : {}),
    })),
  };
}
export function registerExchanges(
  app: FastifyInstance,
  db: PrismaClient,
  authenticate: (req: FastifyRequest) => Promise<string>,
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
  const options = (input: any, minimum = 2) => {
    const title = clean(input.title, 80),
      author = clean(input.author, 50),
      name = clean(input.name, 24),
      capacity = Number(input.capacity);
    if (
      !title ||
      !name ||
      !Number.isInteger(capacity) ||
      capacity < minimum ||
      capacity > 10
    )
      fail(400, "책 제목, 닉네임과 참여 인원을 확인해 주세요.");
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
    return { title, author, name, capacity, theme };
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
      schema: {
        body: {
          type: "object",
          required: ["title", "name", "capacity"],
          properties: {
            title: { type: "string", maxLength: 80 },
            author: { type: "string", maxLength: 50 },
            name: { type: "string", maxLength: 24 },
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
      const room = await db.room.create({
        data: {
          title: o.title,
          bookTitle: o.title,
          author: o.author,
          theme: o.theme,
          maxMembers: o.capacity,
          exchangeCode: randomBytes(4).toString("hex").toUpperCase(),
          exchangeOwnerId: uid,
          members: {
            create: {
              userId: uid,
              role: "ADMIN",
              displayName: o.name,
              readingOrder: 1,
            },
          },
        },
        include: included,
      });
      return reply.code(201).send({ room: view(room, uid) });
    },
  );
  const params = {
    type: "object",
    required: ["code"],
    properties: { code: { type: "string", pattern: "^[A-F0-9]{8}$" } },
  };
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
                "order",
                "appearance",
                "finish",
                "review",
              ],
            },
          },
        },
        body: { type: "object" },
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
          if (person) return view(room, uid);
          if (room.startedAt || members.length >= room.maxMembers)
            fail(409, "이미 시작했거나 인원이 찬 방이에요.");
          const name = clean(input.name, 24);
          if (!name) fail(400, "닉네임을 입력해 주세요.");
          if (members.some((m) => (m.displayName ?? m.user.nickname) === name))
            fail(409, "이미 사용 중인 닉네임이에요.");
          await tx.roomMember.create({
            data: {
              roomId: room.id,
              userId: uid,
              displayName: name,
              readingOrder: (members.at(-1)?.readingOrder ?? 0) + 1,
            },
          });
        } else {
          if (!person) return fail(403, "먼저 방에 참가해 주세요.");
          if (
            ["start", "settings", "order"].includes(action) &&
            room.exchangeOwnerId !== uid
          )
            fail(403, "방장만 변경할 수 있어요.");
          if (action === "start") {
            if (room.startedAt) return view(room, uid);
            if (members.length !== room.maxMembers)
              fail(409, "참여 인원이 모두 모이면 시작할 수 있어요.");
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
          } else if (action === "settings") {
            if (room.startedAt)
              fail(409, "교환독서를 시작한 뒤에는 방 옵션을 수정할 수 없어요.");
            const o = options(input, Math.max(2, members.length));
            if (
              members.some(
                (m) =>
                  m.userId !== uid &&
                  (m.displayName ?? m.user.nickname) === o.name,
              )
            )
              fail(409, "이미 사용 중인 닉네임이에요.");
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
            await tx.roomMember.update({
              where: { roomId_userId: { roomId: room.id, userId: uid } },
              data: { displayName: o.name },
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
