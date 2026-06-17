import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { createBackgroundScanner } from "./backgroundScanner.js";
import { readConfig, readPublicConfig, updateConfig } from "./config.js";
import { createProviderRegistry } from "./providerRegistry.js";

const rootDir = resolve(new URL("..", import.meta.url).pathname);
const port = Number(process.env.PORT || 5173);
const registry = createProviderRegistry();
const scanner = createBackgroundScanner({ registry });

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

    if (request.method === "OPTIONS") {
      if (url.pathname.startsWith("/api/")) {
        return sendOptions(request, response);
      }

      return sendText(request, response, "Not found", 404);
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      return sendJson(request, response, withApiMeta({
        name: "Agent Monitor",
        status: "ok",
        port
      }));
    }

    if (url.pathname.startsWith("/api/") && !(await isAuthorized(request))) {
      return sendJson(request, response, { error: "Unauthorized" }, 401);
    }

    if (url.pathname === "/api/snapshot" && request.method === "GET") {
      const agents = await registry.listAgents();
      return sendJson(request, response, withApiMeta({
        agents,
        history: await registry.listHistory(),
        providers: await registry.providers(),
        config: await readPublicConfig(),
        scanner: scanner.status()
      }));
    }

    if (url.pathname === "/api/agents" && request.method === "GET") {
      return sendJson(request, response, withApiMeta({
        agents: await registry.listAgents(),
        history: await registry.listHistory()
      }));
    }

    if (url.pathname === "/api/history" && request.method === "GET") {
      return sendJson(request, response, withApiMeta({ history: await registry.listHistory() }));
    }

    if (url.pathname === "/api/providers" && request.method === "GET") {
      return sendJson(request, response, withApiMeta({ providers: await registry.providers() }));
    }

    const providerTestMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/test$/);
    if (providerTestMatch && request.method === "POST") {
      const result = await registry.testProvider(decodeURIComponent(providerTestMatch[1]));
      if (!result) return sendJson(request, response, { error: "Provider not found" }, 404);
      const payload = await withSnapshotContext({
        provider: result,
        agents: await registry.listAgents(),
        history: await registry.listHistory()
      });
      return sendJson(request, response, payload);
    }

    if (url.pathname === "/api/config" && request.method === "GET") {
      return sendJson(request, response, { config: await readPublicConfig() });
    }

    if (url.pathname === "/api/config" && request.method === "PUT") {
      const body = await readJson(request);
      const config = await updateConfig(body.config || body);
      registry.invalidateSnapshots();
      await scanner.reconfigure();
      return sendJson(request, response, { config });
    }

    if (url.pathname === "/api/scanner" && request.method === "GET") {
      return sendJson(request, response, withApiMeta({ scanner: scanner.status() }));
    }

    const detailMatch = url.pathname.match(/^\/api\/agents\/([^/]+)$/);
    if (detailMatch && request.method === "GET") {
      const detail = await registry.getAgent(decodeURIComponent(detailMatch[1]));
      if (!detail) {
        const payload = await withSnapshotContext({
          error: "Agent not found",
          agents: await registry.listAgents(),
          history: await registry.listHistory()
        });
        return sendJson(request, response, payload, 404);
      }
      return sendJson(request, response, detail);
    }

    const actionMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/actions$/);
    if (actionMatch && request.method === "POST") {
      const body = await readJson(request);
      const result = await registry.performAction(
        decodeURIComponent(actionMatch[1]),
        body.action,
        body.prompt || ""
      );

      if (!result) return sendJson(request, response, { error: "Agent not found" }, 404);
      const payload = await withSnapshotContext(result);
      if (result.error) return sendJson(request, response, payload, result.status || 400);
      return sendJson(request, response, payload);
    }

    if (url.pathname.startsWith("/api/")) {
      return sendJson(request, response, { error: "Not found" }, 404);
    }

    return serveStatic(url.pathname, response);
  } catch (error) {
    const status = error.status || 500;
    const message = status >= 500 ? error.message || "Internal server error" : error.message;
    return sendJson(request, response, { error: message }, status);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Agent Monitor listening at http://127.0.0.1:${port}/`);
});

scanner.start().catch((error) => {
  console.error(`Background scanner failed to start: ${error.message}`);
});

process.on("SIGTERM", () => {
  scanner.stop();
  server.close(() => process.exit(0));
});

async function withSnapshotContext(payload) {
  return withApiMeta({
    ...payload,
    providers: await registry.providers(),
    config: await readPublicConfig(),
    scanner: scanner.status()
  });
}

function withApiMeta(payload) {
  return {
    ...payload,
    snapshotAt: Date.now()
  };
}

async function serveStatic(pathname, response) {
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = normalize(join(rootDir, relativePath));

  if (!filePath.startsWith(rootDir)) {
    return sendText(null, response, "Forbidden", 403);
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) return sendText(null, response, "Not found", 404);

    response.writeHead(200, {
      "Content-Length": fileStat.size,
      "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream"
    });
    createReadStream(filePath).pipe(response);
  } catch {
    sendText(null, response, "Not found", 404);
  }
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Invalid JSON");
    error.status = 400;
    throw error;
  }
}

async function sendOptions(request, response) {
  response.writeHead(204, await responseHeaders(request, {}));
  response.end();
}

async function sendJson(request, response, payload, status = 200) {
  const body = JSON.stringify(payload, null, 2);
  response.writeHead(status, await responseHeaders(request, {
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "application/json; charset=utf-8"
  }));
  response.end(body);
}

async function sendText(request, response, message, status = 200) {
  response.writeHead(status, await responseHeaders(request, {
    "Content-Length": Buffer.byteLength(message),
    "Content-Type": "text/plain; charset=utf-8"
  }));
  response.end(message);
}

async function responseHeaders(request, headers) {
  return {
    ...headers,
    ...(await corsHeaders(request))
  };
}

async function corsHeaders(request) {
  if (!request) return {};

  const origin = request.headers.origin;
  if (!origin) return {};

  const config = await readConfig();
  const allowedOrigins = config.allowedOrigins || [];
  const allowed = allowedOrigins.includes("*") || allowedOrigins.includes(origin);
  if (!allowed) return { Vary: "Origin" };

  return {
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Agent-Monitor-Token",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin"
  };
}

async function isAuthorized(request) {
  const config = await readConfig();
  if (!config.apiToken) return true;

  const origin = request.headers.origin;
  const localOrigin = `http://${request.headers.host}`;
  if (!origin || origin === localOrigin) return true;

  const authHeader = request.headers.authorization || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  const headerToken = request.headers["x-agent-monitor-token"] || "";
  return bearerToken === config.apiToken || headerToken === config.apiToken;
}
