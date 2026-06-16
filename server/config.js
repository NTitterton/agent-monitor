import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const configPath = resolve(new URL("../agent-monitor.config.json", import.meta.url).pathname);

export async function readConfig() {
  try {
    return JSON.parse(await readFile(configPath, "utf8"));
  } catch {
    return {};
  }
}
