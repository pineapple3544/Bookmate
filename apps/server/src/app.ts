import websocket from "@fastify/websocket";
import rateLimit from "@fastify/rate-limit";
import { ApiFailure, registerCore } from "./core.js";
import type { PrismaClient } from "@prisma/client";
import Fastify, { type FastifyError } from "fastify";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import type {
  ApiError,
  HealthResponse,
  ReadyResponse,
} from "@bookmate/contracts";

import { registerChat, type ChatStore } from "./chat.js";

interface AppOptions {
  db?: PrismaClient;
  secureCookies?: boolean;
  chatStore?: ChatStore;
  checkDatabase: () => Promise<void>;
  origins?: string[];
  logger?: boolean | { level: string };
}

export async function buildApp(options: AppOptions) {
  const app = Fastify({
    logger: options.logger
      ? {
          ...(typeof options.logger === "object" ? options.logger : {}),
          redact: [
            "req.headers.cookie",
            "req.headers.authorization",
            "res.headers.set-cookie",
          ],
        }
      : false,
    bodyLimit: 64 * 1024,
    requestTimeout: 10000,
  });
  await app.register(websocket, { options: { maxPayload: 16 * 1024 } });
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
  await app.register(cors, {
    origin: options.origins ?? [],
    credentials: true,
  });
  await app.register(swagger, {
    openapi: {
      info: { title: "Bookmate API", version: "0.1.0" },
      tags: [{ name: "health", description: "Service health" }],
    },
  });
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error instanceof ApiFailure)
      return reply
        .code(error.statusCode)
        .send({
          error: {
            code: error.code,
            message: error.message,
            requestId: request.id,
          },
        });
    if (error.code === "P2002")
      return reply
        .code(409)
        .send({
          error: {
            code: "CONFLICT",
            message: "Resource already exists",
            requestId: request.id,
          },
        });
    const status =
      error.statusCode && error.statusCode >= 400 && error.statusCode < 500
        ? error.statusCode
        : 500;
    if (status >= 500) request.log.error({ err: error }, "Request failed");
    const body: ApiError = {
      error: {
        code:
          status === 429
            ? "RATE_LIMITED"
            : status < 500
              ? "BAD_REQUEST"
              : "INTERNAL_ERROR",
        message:
          status < 500 ? "Invalid request" : "An internal error occurred",
        requestId: request.id,
      },
    };
    return reply.code(status).send(body);
  });
  app.setNotFoundHandler((request, reply) => {
    const body: ApiError = {
      error: {
        code: "NOT_FOUND",
        message: "Route not found",
        requestId: request.id,
      },
    };
    return reply.code(404).send(body);
  });
  app.get(
    "/health",
    {
      schema: {
        tags: ["health"],
        response: {
          200: {
            type: "object",
            required: ["status"],
            properties: { status: { type: "string", const: "ok" } },
          },
        },
      },
    },
    async (): Promise<HealthResponse> => ({ status: "ok" }),
  );
  app.get(
    "/health/ready",
    {
      schema: {
        tags: ["health"],
        response: {
          200: {
            type: "object",
            required: ["status"],
            properties: { status: { type: "string", const: "ready" } },
          },
          503: {
            type: "object",
            required: ["error"],
            properties: {
              error: {
                type: "object",
                required: ["code", "message", "requestId"],
                properties: {
                  code: { type: "string" },
                  message: { type: "string" },
                  requestId: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        await options.checkDatabase();
        const body: ReadyResponse = { status: "ready" };
        return body;
      } catch (error) {
        request.log.error({ err: error }, "Database readiness check failed");
        const body: ApiError = {
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database is unavailable",
            requestId: request.id,
          },
        };
        return reply.code(503).send(body);
      }
    },
  );
  app.get("/openapi.json", { schema: { hide: true } }, async () =>
    app.swagger(),
  );
  if (options.db)
    await registerCore(
      app,
      options.db,
      options.origins ?? [],
      options.secureCookies ?? false,
    );
  if (options.chatStore) registerChat(app, options.chatStore);
  return app;
}
