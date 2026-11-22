import { createServer, request as proxyRequest } from "node:http";
import { readFile } from "node:fs/promises";
import { exchangeApi } from "./exchange-api.js";
const apiOrigin = new URL(process.env.API_ORIGIN || "http://127.0.0.1:3000");
const routes = new Map([
  ["/", ["home.html", "text/html; charset=utf-8"]],
  ["/home.html", ["home.html", "text/html; charset=utf-8"]],
  ["/room.html", ["index.html", "text/html; charset=utf-8"]],
  ["/exchange.js", ["exchange.js", "text/javascript; charset=utf-8"]],
  ["/profile.js", ["profile.js", "text/javascript; charset=utf-8"]],
  ["/rating.js", ["rating.js", "text/javascript; charset=utf-8"]],
  [
    "/exchange-client.js",
    ["exchange-client.js", "text/javascript; charset=utf-8"],
  ],
  ["/exchange.css", ["exchange.css", "text/css; charset=utf-8"]],
  ["/room.css", ["room.css", "text/css; charset=utf-8"]],
  ["/comment-book.png", ["comment-book.png", "image/png"]],
  ["/avatar-shop-awning.png", ["avatar-shop-awning.png", "image/png"]],
  ["/room.js", ["room.js", "text/javascript; charset=utf-8"]],
  ["/interaction.js", ["interaction.js", "text/javascript; charset=utf-8"]],
  ["/wardrobe.js", ["wardrobe.js", "text/javascript; charset=utf-8"]],
  ["/avatar.js", ["avatar.js", "text/javascript; charset=utf-8"]],
  ["/chat.js", ["chat.js", "text/javascript; charset=utf-8"]],
]);
routes.set("/local-transport.js", [
  "local-transport.js",
  "text/javascript; charset=utf-8",
]);
routes.set("/account.js", ["account.js", "text/javascript; charset=utf-8"]);
routes.set("/live-client.js", [
  "live-client.js",
  "text/javascript; charset=utf-8",
]);
routes.set("/legacy-notes.js", [
  "legacy-notes.js",
  "text/javascript; charset=utf-8",
]);
routes.set("/records.js", ["records.js", "text/javascript; charset=utf-8"]);
for(const name of ["motion-peers","record-bridge","record-storage","record-protocol","shared-records","p2p-records"])routes.set("/"+name+".js",[name+".js","text/javascript; charset=utf-8"]);
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname === "/runtime-config.json") {
    response.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    response.end(
      JSON.stringify({
        server: Boolean(process.env.API_ORIGIN),
        localExchange: process.env.NODE_ENV !== "production",
      }),
    );
    return;
  }
  if (url.pathname.startsWith("/api/exchanges")) {
    if (process.env.NODE_ENV === "production") {
      response.writeHead(404).end();
      return;
    }
    await exchangeApi(request, response, url);
    return;
  }
  if (url.pathname.startsWith("/api/v1/")) {
    if (
      !["GET", "POST", "PATCH", "DELETE", "OPTIONS"].includes(request.method)
    ) {
      response.writeHead(405).end();
      return;
    }
    const upstream = proxyRequest(
      new URL(url.pathname + url.search, apiOrigin),
      {
        method: request.method,
        headers: {
          ...(request.headers["content-type"]
            ? { "content-type": request.headers["content-type"] }
            : {}),
          ...(request.headers.cookie ? { cookie: request.headers.cookie } : {}),
          ...(request.headers.origin ? { origin: request.headers.origin } : {}),
        },
        timeout: 10000,
      },
      (result) => {
        response.writeHead(result.statusCode ?? 502, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          ...(result.headers["set-cookie"]
            ? { "set-cookie": result.headers["set-cookie"] }
            : {}),
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
  const route = routes.get(
    url.pathname === "/" && url.searchParams.get("mode") === "server"
      ? "/room.html"
      : url.pathname,
  );
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
// Same-origin WebSocket tunnel for local frontend integration.
server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url, "http://localhost");
  if (!/^\/api\/v1\/rooms\/[a-f0-9-]{36}\/live$/.test(url.pathname)) {
    socket.destroy();
    return;
  }
  const upstream = proxyRequest(new URL(url.pathname, apiOrigin), {
    headers: request.headers,
    timeout: 10000,
  });
  upstream.on("upgrade", (response, remote, remoteHead) => {
    upstream.setTimeout(0);
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        response.rawHeaders.reduce(
          (text, value, index, headers) =>
            index % 2
              ? text
              : text + value + ": " + headers[index + 1] + "\r\n",
          "",
        ) +
        "\r\n",
    );
    if (head.length) remote.write(head);
    if (remoteHead.length) socket.write(remoteHead);
    remote.on("error", () => socket.destroy());
    socket.on("error", () => remote.destroy());
    socket.on("close", () => remote.destroy());
    remote.on("close", () => socket.destroy());
    socket.pipe(remote).pipe(socket);
  });
  upstream.on("response", (response) => {
    socket.end(
      `HTTP/1.1 ${response.statusCode ?? 502} Rejected\r\nConnection: close\r\n\r\n`,
    );
    response.resume();
  });
  upstream.on("timeout", () => upstream.destroy());
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
  upstream.end();
});
server.listen(
  Number(process.env.PORT ?? 5173),
  process.env.HOST ?? "127.0.0.1",
  () => {
    console.log("Room prototype http://localhost:" + server.address().port);
  },
);
