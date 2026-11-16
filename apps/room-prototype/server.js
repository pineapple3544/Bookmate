import { createServer, request as proxyRequest } from "node:http";
import { readFile } from "node:fs/promises";
import { exchangeApi } from "./exchange-api.js";
const apiOrigin = new URL(process.env.API_ORIGIN ?? "http://127.0.0.1:3000");
const routes = new Map([
  ["/", ["home.html", "text/html; charset=utf-8"]],
  ["/home.html", ["home.html", "text/html; charset=utf-8"]],
  ["/room.html", ["index.html", "text/html; charset=utf-8"]],
  ["/exchange.js", ["exchange.js", "text/javascript; charset=utf-8"]],
  ["/rating.js", ["rating.js", "text/javascript; charset=utf-8"]],
  ["/exchange-client.js", ["exchange-client.js", "text/javascript; charset=utf-8"]],
  ["/exchange.css", ["exchange.css", "text/css; charset=utf-8"]],
  ["/room.css", ["room.css", "text/css; charset=utf-8"]],
  ["/comment-book.png", ["comment-book.png", "image/png"]],
  ["/avatar-shop-awning.png", ["avatar-shop-awning.png", "image/png"]],
  ["/room.js", ["room.js", "text/javascript; charset=utf-8"]],
  ["/avatar.js", ["avatar.js", "text/javascript; charset=utf-8"]],
  ["/chat.js", ["chat.js", "text/javascript; charset=utf-8"]],
]);
routes.set("/local-transport.js", [
  "local-transport.js",
  "text/javascript; charset=utf-8",
]);
routes.set("/records.js", ["records.js", "text/javascript; charset=utf-8"]);
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname.startsWith("/api/exchanges")) {
    await exchangeApi(request, response, url);
    return;
  }
  if (
    url.pathname === "/api/v1/prototype/chat" ||
    url.pathname === "/api/v1/prototype/chat/presence"
  ) {
    if (!["GET", "POST"].includes(request.method)) {
      response.writeHead(405).end();
      return;
    }
    const upstream = proxyRequest(
      new URL(url.pathname + url.search, apiOrigin),
      {
        method: request.method,
        headers: {
          "content-type": request.headers["content-type"] ?? "application/json",
        },
        timeout: 10000,
      },
      (result) => {
        response.writeHead(result.statusCode ?? 502, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        result.pipe(response);
        result.on("error", () => response.destroy());
      },
    );
    upstream.on("timeout", () => upstream.destroy(new Error("API timeout")));
    upstream.on("error", () => {
      if (!response.headersSent)
        response.writeHead(502, { "content-type": "application/json" });
      if (!response.writableEnded)
        response.end(JSON.stringify({ error: { code: "API_UNAVAILABLE" } }));
    });
    request.on("aborted", () => upstream.destroy());
    request.pipe(upstream);
    return;
  }
  const route = routes.get(url.pathname === "/" && url.searchParams.get("mode") === "server" ? "/room.html" : url.pathname);
  if (!route) {
    response.writeHead(404).end();
    return;
  }
  try {
    const body = await readFile(
      new URL("./public/" + route[0], import.meta.url),
    );
    response.writeHead(200, {
      "Content-Type": route[1],
      "Cache-Control": "no-store",
    });
    response.end(body);
  } catch {
    response.writeHead(500).end();
  }
});
server.listen(
  Number(process.env.PORT ?? 5173),
  process.env.HOST ?? "127.0.0.1",
  () => {
    console.log(
      "Room prototype http://localhost:" + (process.env.PORT ?? 5173),
    );
  },
);
