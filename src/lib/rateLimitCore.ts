// Fixed-window request counting shared by the edge middleware (memory only) and
// src/lib/rateLimit.ts (which also persists to disk). No Node imports here.

export const RATE_LIMIT_WINDOW_MS = 60_000;

export type RateLimitStore = Record<string, { count: number; resetAt: number }>;

/**
 * Counts one request for `key`. Returns "limited" once `max` requests were already
 * made in the current window, otherwise "counted" (the store changed).
 */
export function consume(store: RateLimitStore, key: string, max: number, now = Date.now()): "limited" | "counted" {
  const entry = store[key];
  if (!entry || now > entry.resetAt) {
    // Drop expired entries so the store stays bounded instead of keeping one entry
    // per IP ever seen.
    for (const k of Object.keys(store)) {
      if (store[k].resetAt <= now) delete store[k];
    }
    store[key] = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
    return "counted";
  }
  if (entry.count >= max) return "limited";
  entry.count++;
  return "counted";
}
