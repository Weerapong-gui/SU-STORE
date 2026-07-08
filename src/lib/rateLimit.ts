import fs from "fs";
import path from "path";

const WINDOW_MS = 60_000;
const PERSIST_PATH = path.join(process.cwd(), "data", "rate-limit.json");

type Entry = { count: number; resetAt: number };
type Store = Record<string, Entry>;

const store: Store = {};
let loaded = false;

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = fs.readFileSync(PERSIST_PATH, "utf8");
    const data = JSON.parse(raw) as Store;
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
  const now = Date.now();
  const entry = store[key];
  if (!entry || now > entry.resetAt) {
    // Opportunistically drop expired entries so `store` (and the persisted file) stay
    // bounded instead of accumulating one permanent entry per unique IP ever seen.
    for (const k of Object.keys(store)) {
      if (store[k].resetAt <= now) delete store[k];
    }
    store[key] = { count: 1, resetAt: now + WINDOW_MS };
    persist();
    return false;
  }
  if (entry.count >= max) return true;
  entry.count++;
  persist();
  return false;
}

export function getRateLimitKey(request: Request, suffix = ""): string {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";
  return suffix ? `${ip}:${suffix}` : ip;
}
