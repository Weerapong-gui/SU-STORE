const WINDOW_MS = 60_000;
const store = new Map<string, { count: number; resetAt: number }>();

export function isRateLimited(key: string, max: number): boolean {
  const now = Date.now();
  const entry = store.get(key);
  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  if (entry.count >= max) return true;
  entry.count++;
  return false;
}

export function getRateLimitKey(request: Request, suffix = ""): string {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";
  return suffix ? `${ip}:${suffix}` : ip;
}
