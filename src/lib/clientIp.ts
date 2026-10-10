// Client IP for rate limiting. Traffic arrives through Cloudflare, which sets
// cf-connecting-ip and *appends* the real address to any x-forwarded-for the client sent,
// so only the last x-forwarded-for entry can be trusted. No Node imports: the edge
// middleware uses this too.
export function clientIp(request: Request): string {
  const cf = request.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean);
  return forwarded?.at(-1) ?? "unknown";
}
