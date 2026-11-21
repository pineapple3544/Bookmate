import { createPresenceStore } from "./presence.js";
import type { FastifyInstance } from "fastify";
import type { PrismaClient, PrototypeChatMessage } from "@prisma/client";

export const PROTOTYPE_ROOM_ID = "00000000-0000-4000-8000-000000000001";
export interface ChatInput {
  id: string;
  senderSlot: number;
  text: string;
}
export interface ChatQuery {
  before?: string;
  after?: string;
}
export interface ChatMessage extends ChatInput {
  sequence: string;
  createdAt: string;
}
export interface ChatPage {
  messages: ChatMessage[];
  hasMore: boolean;
}
export interface ChatStore {
  roomExists(): Promise<boolean>;
  list(query: ChatQuery): Promise<ChatPage>;
  send(input: ChatInput): Promise<ChatMessage>;
}
function fail(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}
function serialize(message: PrototypeChatMessage): ChatMessage {
  return {
    id: message.id,
    senderSlot: message.senderSlot,
    text: message.text,
    sequence: message.sequence.toString(),
    createdAt: message.createdAt.toISOString(),
  };
}
export function createChatStore(
  db: PrismaClient,
  roomId = PROTOTYPE_ROOM_ID,
): ChatStore {
  return {
    async roomExists() {
      return Boolean(
        await db.room.findUnique({
          where: { id: roomId },
          select: { id: true },
        }),
      );
    },
    async list(query) {
      if (
        !(await db.room.findUnique({
          where: { id: roomId },
          select: { id: true },
        }))
      ) {
        fail(404, "Room not found");
      }
      const rows = await db.prototypeChatMessage.findMany({
        where: {
          roomId,
          ...(query.after ? { sequence: { gt: BigInt(query.after) } } : {}),
          ...(query.before ? { sequence: { lt: BigInt(query.before) } } : {}),
        },
        orderBy: { sequence: query.after ? "asc" : "desc" },
        take: 51,
      });
      const page = rows.slice(0, 50);
      if (!query.after) page.reverse();
      return { messages: page.map(serialize), hasMore: rows.length > 50 };
    },
    async send(input) {
      return db.$transaction(async (transaction) => {
        // Serialize writes per room so an incremental reader cannot skip a later-committing message.
        const rooms = await transaction.$queryRaw<
          Array<{ id: string }>
        >`SELECT id FROM "Room" WHERE id = ${roomId}::uuid FOR UPDATE`;
        if (!rooms.length) fail(404, "Room not found");
        const existing = await transaction.prototypeChatMessage.findUnique({
          where: { id: input.id },
        });
        if (existing) {
          if (
            existing.roomId !== roomId ||
            existing.senderSlot !== input.senderSlot ||
            existing.text !== input.text
          ) {
            fail(409, "Message ID already used");
          }
          return serialize(existing);
        }
        return serialize(
          await transaction.prototypeChatMessage.create({
            data: { ...input, roomId },
          }),
        );
      });
    },
  };
}
export function registerChat(app: FastifyInstance, store: ChatStore) {
  const url = "/api/v1/prototype/chat";
  const presence = createPresenceStore();
  app.get<{ Querystring: ChatQuery }>(
    url,
    {
      schema: {
        tags: ["prototype-chat"],
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            before: { type: "string", pattern: "^[0-9]{1,18}$" },
            after: { type: "string", pattern: "^[0-9]{1,18}$" },
          },
        },
      },
    },
    async (request, reply) => {
      if (request.query.before && request.query.after)
        fail(400, "Use one cursor");
      reply.header("Cache-Control", "no-store");
      return {
        ...(await store.list(request.query)),
        onlineSlots: presence.onlineSlots(),
        serverTime: new Date().toISOString(),
      };
    },
  );
  app.post<{ Body: ChatInput }>(
    url,
    {
      schema: {
        tags: ["prototype-chat"],
        body: {
          type: "object",
          additionalProperties: false,
          required: ["id", "senderSlot", "text"],
          properties: {
            id: { type: "string", format: "uuid" },
            senderSlot: { type: "integer", minimum: 0, maximum: 3 },
            text: { type: "string", minLength: 1, maxLength: 500 },
          },
        },
      },
    },
    async (request, reply) => {
      const text = request.body.text.trim();
      if (!text) fail(400, "Message is empty");
      const message = await store.send({ ...request.body, text });
      reply.header("Cache-Control", "no-store");
      return { message, serverTime: new Date().toISOString() };
    },
  );
  app.post<{
    Body: { sessionId: string; senderSlot: number; active: boolean };
  }>(
    url + "/presence",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["sessionId", "senderSlot", "active"],
          properties: {
            sessionId: { type: "string", format: "uuid" },
            senderSlot: { type: "integer", minimum: 0, maximum: 3 },
            active: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      if (!(await store.roomExists())) fail(404, "Room not found");
      reply.header("Cache-Control", "no-store");
      const { sessionId, senderSlot, active } = request.body;
      return { onlineSlots: presence.update(sessionId, senderSlot, active) };
    },
  );
}
