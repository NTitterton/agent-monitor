import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const defaultConfigPath = resolve(new URL("../agent-monitor.config.json", import.meta.url).pathname);

export async function readConfig() {
  try {
    return JSON.parse(await readFile(configPath(), "utf8"));
  } catch {
    return {};
  }
}

function configPath() {
  return process.env.AGENT_MONITOR_CONFIG
    ? resolve(process.env.AGENT_MONITOR_CONFIG)
    : defaultConfigPath;
}
