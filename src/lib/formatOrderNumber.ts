import { Order } from "@/types/order";

const ORDER_PREFIX = "FP28";

export function formatOrderNumber(order: Pick<Order, "id" | "sequenceNumber" | "roundNumber">) {
  if (order.id.startsWith(ORDER_PREFIX)) {
    return order.id;
  }

  if (typeof order.sequenceNumber === "number") {
    const roundNumber = order.roundNumber ?? 1;
    return `${ORDER_PREFIX}${String(order.sequenceNumber).padStart(4, "0")}${roundNumber}`;
  }

  return order.id;
}
