"use client";

// Access tokens for orders placed (or looked up) in this browser, keyed by order code.
const KEY = "su-store-order-tokens";

function read(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveOrderToken(orderCode: string, token: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...read(), [orderCode]: token }));
  } catch {
    // storage blocked: the order link (?t=) still works
  }
}

export function getOrderToken(orderCode: string): string | undefined {
  return read()[orderCode];
}

export function orderPageHref(orderCode: string, token: string) {
  return `/order/${orderCode}?t=${token}`;
}
