import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { createProviderRegistry } from "./providerRegistry.js";

const rootDir = resolve(new URL("..", import.meta.url).pathname);
const port = Number(process.env.PORT || 5173);
const registry = createProviderRegistry();

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname === "/api/agents" && request.method === "GET") {
      return sendJson(response, {
        agents: await registry.listAgents(),
        history: await registry.listHistory()
      });
    }

    if (url.pathname === "/api/history" && request.method === "GET") {
      return sendJson(response, { history: await registry.listHistory() });
    }

    if (url.pathname === "/api/providers" && request.method === "GET") {
      return sendJson(response, { providers: await registry.providers() });
    }

    const actionMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/actions$/);
    if (actionMatch && request.method === "POST") {
      const body = await readJson(request);
      const result = await registry.performAction(
        decodeURIComponent(actionMatch[1]),
        body.action,
        body.prompt || ""
      );

      if (!result) return sendJson(response, { error: "Agent not found" }, 404);
      return sendJson(response, result);
    }

    if (url.pathname.startsWith("/api/")) {
      return sendJson(response, { error: "Not found" }, 404);
    }

    return serveStatic(url.pathname, response);
  } catch (error) {
    return sendJson(response, { error: error.message || "Internal server error" }, 500);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Agent Monitor listening at http://127.0.0.1:${port}/`);
});

async function serveStatic(pathname, response) {
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = normalize(join(rootDir, relativePath));

  if (!filePath.startsWith(rootDir)) {
    return sendText(response, "Forbidden", 403);
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) return sendText(response, "Not found", 404);

    response.writeHead(200, {
      "Content-Length": fileStat.size,
      "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream"
    });
    createReadStream(filePath).pipe(response);
  } catch {
    sendText(response, "Not found", 404);
  }
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, payload, status = 200) {
  const body = JSON.stringify(payload, null, 2);
  response.writeHead(status, {
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(body);
}

function sendText(response, message, status = 200) {
  response.writeHead(status, {
    "Content-Length": Buffer.byteLength(message),
    "Content-Type": "text/plain; charset=utf-8"
  });
  response.end(message);
}
