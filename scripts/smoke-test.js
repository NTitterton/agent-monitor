import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const port = 5199;
const apiBase = `http://127.0.0.1:${port}`;
const allowedOrigin = "https://zo.computer";
const apiToken = "smoke-token";

const tempDir = await mkdtemp(join(tmpdir(), "agent-monitor-smoke-"));
const configPath = join(tempDir, "agent-monitor.config.json");
const statePath = join(tempDir, "agent-state.json");

await writeFile(
  configPath,
  `${JSON.stringify(
    {
      apiToken,
      allowedOrigins: [allowedOrigin]
    },
    null,
    2
  )}\n`
);

let server = await startServer();

try {
  await assertStatus("/", 200);
  await assertStatus("/embed-standalone.html", 200);
  await assertStatus("/embed/agent-monitor-widget.js", 200);

  const sameOriginAgents = await request("/api/agents");
  assert(sameOriginAgents.status === 200, "same-origin API request should succeed");
  assert(Array.isArray(sameOriginAgents.body.agents), "agent list should be an array");

  const unauthorized = await request("/api/agents", {
    headers: { Origin: allowedOrigin }
  });
  assert(unauthorized.status === 401, "cross-origin request without token should be unauthorized");

  const preflight = await rawRequest("/api/agents", {
    method: "OPTIONS",
    headers: {
      Origin: allowedOrigin,
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "X-Agent-Monitor-Token"
    }
  });
  assert(preflight.status === 204, "preflight should return 204");
  assert(
    preflight.headers.get("access-control-allow-origin") === allowedOrigin,
    "preflight should allow configured origin"
  );

  const authorized = await request("/api/agents", {
    headers: {
      Origin: allowedOrigin,
      "X-Agent-Monitor-Token": apiToken
    }
  });
  assert(authorized.status === 200, "cross-origin request with token should succeed");

  const action = await request("/api/agents/local-codex-1/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "interrupt", prompt: "smoke test" })
  });
  assert(action.status === 200, "lifecycle action should succeed");
  assert(
    action.body.agents.find((agent) => agent.id === "local-codex-1")?.status === "waiting",
    "interrupt should move local-codex-1 to waiting"
  );
  assert(action.body.history[0]?.prompt === "smoke test", "action prompt should be recorded");
  assert(
    action.body.agents.find((agent) => agent.id === "local-codex-1")?.logs?.[0]?.message.includes("smoke test"),
    "lifecycle action should append an agent log"
  );

  const detail = await request("/api/agents/local-codex-1");
  assert(detail.status === 200, "agent detail should succeed");
  assert(detail.body.agent.id === "local-codex-1", "agent detail should return requested agent");
  assert(detail.body.children[0]?.id === "openai-research-2", "agent detail should include children");
  assert(detail.body.history[0]?.prompt === "smoke test", "agent detail should include agent history");
  assert(detail.body.agent.logs[0]?.source === "operator", "agent detail should include logs");

  await stopServer(server);
  server = await startServer();

  const persisted = await request("/api/agents");
  assert(
    persisted.body.agents.find((agent) => agent.id === "local-codex-1")?.status === "waiting",
    "agent status should persist after restart"
  );
  assert(persisted.body.history[0]?.prompt === "smoke test", "history should persist after restart");
  assert(
    persisted.body.agents.find((agent) => agent.id === "local-codex-1")?.logs?.[0]?.source === "operator",
    "agent logs should persist after restart"
  );

  const stateFile = JSON.parse(await readFile(statePath, "utf8"));
  assert(stateFile.history.length > 0, "state file should contain history");
  assert(stateFile.agents.find((agent) => agent.id === "local-codex-1")?.logs?.length > 0, "state file should contain logs");

  console.log("Smoke test passed");
} finally {
  await stopServer(server);
}

async function startServer() {
  const child = spawn("node", ["server/index.js"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: {
      ...process.env,
      AGENT_MONITOR_CONFIG: configPath,
      AGENT_MONITOR_STATE: statePath,
      PORT: String(port)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });

  await waitFor(async () => {
    if (child.exitCode !== null) {
      throw new Error(`server exited early:\n${output}`);
    }
    const response = await rawRequest("/api/providers").catch(() => null);
    return response?.status === 200;
  });

  return child;
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;

  child.kill("SIGTERM");
  await new Promise((resolve) => {
    child.once("exit", resolve);
    setTimeout(resolve, 1500);
  });
}

async function assertStatus(pathname, status) {
  const response = await rawRequest(pathname);
  assert(response.status === status, `${pathname} should return ${status}, got ${response.status}`);
}

async function request(pathname, options = {}) {
  const response = await rawRequest(pathname, options);
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text ? JSON.parse(text) : null
  };
}

async function rawRequest(pathname, options = {}) {
  return fetch(`${apiBase}${pathname}`, options);
}

async function waitFor(check) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5000) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("timed out waiting for server");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
