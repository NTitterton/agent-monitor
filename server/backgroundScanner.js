import { readConfig } from "./config.js";

export function createBackgroundScanner({ registry }) {
  let timer = null;
  let running = false;
  let status = {
    enabled: false,
    intervalMs: 15000,
    lastScanAt: null,
    lastFinishedAt: null,
    lastError: null,
    providerCount: 0,
    agentCount: 0,
    errors: 0
  };

  async function start() {
    await reconfigure();
  }

  async function reconfigure(config = null) {
    clear();
    config = config || (await readConfig());
    const refresh = config.snapshotRefresh || {};
    const enabled = refresh.enabled === true || process.env.AGENT_MONITOR_BACKGROUND_SCAN === "1";
    const intervalMs = normalizeInterval(refresh.intervalMs || process.env.AGENT_MONITOR_BACKGROUND_SCAN_MS || 15000);
    status = {
      ...status,
      enabled,
      intervalMs,
      lastError: null
    };

    if (!enabled) return snapshot();

    runOnce();
    timer = setInterval(runOnce, intervalMs);
    timer.unref?.();
    return snapshot();
  }

  async function runOnce() {
    if (running) return;
    running = true;
    status = { ...status, lastScanAt: Date.now(), lastError: null };

    try {
      const result = await registry.refreshSnapshots({
        force: true,
        cacheTtlMs: status.intervalMs
      });
      status = {
        ...status,
        lastFinishedAt: Date.now(),
        providerCount: result.providerCount,
        agentCount: result.agentCount,
        errors: result.errors,
        lastError: result.errors ? `${result.errors} provider scan${result.errors === 1 ? "" : "s"} failed` : null
      };
    } catch (error) {
      status = {
        ...status,
        lastFinishedAt: Date.now(),
        lastError: error.message || "Background scan failed"
      };
    } finally {
      running = false;
    }
  }

  function clear() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function stop() {
    clear();
    status = { ...status, enabled: false };
  }

  function snapshot() {
    return { ...status, running };
  }

  return {
    start,
    reconfigure,
    stop,
    status: snapshot
  };
}

function normalizeInterval(value) {
  const intervalMs = Number(value);
  return Number.isFinite(intervalMs) ? Math.min(Math.max(Math.round(intervalMs), 5000), 300000) : 15000;
}
