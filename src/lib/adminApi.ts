"use client";

// Browser-side calls to /api/admin/v2/* (proxied to the order-api with the staff cookie).
export class AdminApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function adminFetch<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`/api/admin/v2/${path.replace(/^\//, "")}`, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    cache: "no-store",
  });
  if (res.status === 401) {
    window.location.href = "/admin/login";
    throw new AdminApiError("กรุณาเข้าสู่ระบบใหม่", 401);
  }
  const data = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new AdminApiError(data.message ?? "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง", res.status);
  return data;
}

export function formatBaht(value: number | null | undefined) {
  if (value === null || value === undefined) return "-";
  return `฿${value.toLocaleString("th-TH")}`;
}

export function formatThaiDateTime(iso: string) {
  return new Date(iso).toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
