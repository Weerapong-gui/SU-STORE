import { Order } from "@/types/order";

export const ORDER_PREFIX = "FP28";
export const DEFAULT_ORDER_ROUND = 0;

export function getCurrentPhase(): number {
  const thai = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const m = thai.getUTCMonth() + 1;
  const d = thai.getUTCDate();
  if (m === 5 && d >= 18 && d <= 23) return 1;
  if (m === 5 && d >= 25 && d <= 30) return 2;
  if (m === 6 && d >= 1  && d <= 7)  return 3;
  return 0;
}

export function buildOrderCode(sequenceNumber: number, roundNumber = DEFAULT_ORDER_ROUND) {
  return `${ORDER_PREFIX}${String(sequenceNumber).padStart(4, "0")}${roundNumber}`;
}

export function formatOrderNumber(order: Pick<Order, "id" | "sequenceNumber" | "roundNumber">) {
  if (order.id.startsWith(ORDER_PREFIX)) {
    return order.id;
  }

  if (typeof order.sequenceNumber === "number") {
    return buildOrderCode(order.sequenceNumber, order.roundNumber ?? DEFAULT_ORDER_ROUND);
  }

  return order.id;
}
