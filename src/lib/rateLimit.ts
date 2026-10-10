import fs from "fs";
import path from "path";
import { clientIp } from "./clientIp";
import { consume, type RateLimitStore } from "./rateLimitCore";

const PERSIST_PATH = path.join(process.cwd(), "data", "rate-limit.json");

// Persisted so limits survive a container restart.
const store: RateLimitStore = {};
let loaded = false;

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = fs.readFileSync(PERSIST_PATH, "utf8");
    const data = JSON.parse(raw) as RateLimitStore;
    const now = Date.now();
    // drop already-expired entries when loading
    for (const [key, entry] of Object.entries(data)) {
      if (entry.resetAt > now) store[key] = entry;
    }
  } catch {
    // file missing or corrupt — start fresh
  }
}

function persist(): void {
  try {
    fs.mkdirSync(path.dirname(PERSIST_PATH), { recursive: true });
    fs.writeFileSync(PERSIST_PATH, JSON.stringify(store));
  } catch {
    // non-fatal: fall back to in-memory only
  }
}

export function isRateLimited(key: string, max: number): boolean {
  load();
  if (consume(store, key, max) === "limited") return true;
  persist();
  return false;
}

export function getRateLimitKey(request: Request, suffix = ""): string {
  const ip = clientIp(request);
  return suffix ? `${ip}:${suffix}` : ip;
}
