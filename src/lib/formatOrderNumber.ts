import { Order } from "@/types/order";

export const ORDER_PREFIX = "FP28";
export const DEFAULT_ORDER_ROUND = 1;

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
