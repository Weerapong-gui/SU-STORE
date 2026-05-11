import { Order, OrderCustomer, OrderStatus, PaymentStatus } from "@/types/order";

type LegacyCustomer = Partial<OrderCustomer> & {
  firstName?: string;
  lastName?: string;
  nickname?: string;
};

type RawOrder = Partial<Order> &
  Record<string, unknown> & {
    customer?: LegacyCustomer | null;
    slip?: Order["slip"] | null;
    khantokeTicket?: boolean | number | string;
    khantokeTicketClaimedAt?: string | null;
    luckyTicket?: boolean | number | string;
    luckyTicketClaimedAt?: string | null;
  };

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function getOrderCustomerName(customer: LegacyCustomer) {
  const fullName = readString(customer.fullName);
  if (fullName) {
    return fullName;
  }

  const legacyName = [readString(customer.firstName), readString(customer.lastName)]
    .filter(Boolean)
    .join(" ")
    .trim();

  return legacyName || "-";
}

export function normalizeOrderStatus(
  status: unknown,
  paymentStatus?: unknown
): OrderStatus {
  const normalizedStatus = readString(status);
  const normalizedPaymentStatus = readString(paymentStatus);

  if (normalizedStatus === "payment_submitted") {
    return "waiting_confirm";
  }

  if (
    normalizedStatus === "pending_payment" ||
    normalizedStatus === "waiting_confirm" ||
    normalizedStatus === "paid" ||
    normalizedStatus === "preparing" ||
    normalizedStatus === "shipped" ||
    normalizedStatus === "cancelled" ||
    normalizedStatus === "rejected"
  ) {
    return normalizedStatus;
  }

  if (normalizedPaymentStatus === "slip_uploaded" || normalizedPaymentStatus === "waiting_confirm") {
    return "waiting_confirm";
  }

  if (normalizedPaymentStatus === "paid") {
    return "paid";
  }

  if (normalizedPaymentStatus === "rejected") {
    return "rejected";
  }

  return "pending_payment";
}

export function normalizePaymentStatus(
  status: unknown,
  paymentStatus?: unknown
): PaymentStatus {
  const normalizedStatus = readString(status);
  const normalizedPaymentStatus = readString(paymentStatus);

  if (normalizedPaymentStatus === "waiting_confirm" || normalizedPaymentStatus === "slip_uploaded") {
    return "waiting_confirm";
  }

  if (
    normalizedPaymentStatus === "awaiting_payment" ||
    normalizedPaymentStatus === "paid" ||
    normalizedPaymentStatus === "rejected"
  ) {
    return normalizedPaymentStatus;
  }

  if (normalizedStatus === "waiting_confirm") {
    return "waiting_confirm";
  }

  if (normalizedStatus === "paid" || normalizedStatus === "preparing" || normalizedStatus === "shipped") {
    return "paid";
  }

  if (normalizedStatus === "rejected" || normalizedStatus === "cancelled") {
    return "rejected";
  }

  return "awaiting_payment";
}

export function getOrderStatusLabel(status: OrderStatus) {
  switch (status) {
    case "pending_payment":
      return "Awaiting payment";
    case "waiting_confirm":
      return "Waiting for slip confirmation";
    case "paid":
      return "Paid";
    case "preparing":
      return "Preparing order";
    case "shipped":
      return "Shipped";
    case "cancelled":
      return "Cancelled";
    case "rejected":
      return "Slip rejected";
    default:
      return status;
  }
}

export function getKhantokeTicketLabel(hasKhantokeTicket: boolean) {
  return hasKhantokeTicket ? "ได้รับ Khantoke ticket" : "สิทธิ์ Khantoke ticket เต็มแล้ว";
}

export function normalizeOrder(rawOrder: RawOrder) {
  const customer = (rawOrder.customer ?? {}) as LegacyCustomer;
  const rawProduct = (rawOrder.product ?? {}) as Partial<Order["product"]>;
  const sequenceNumber =
    typeof rawOrder.sequenceNumber === "number" ? rawOrder.sequenceNumber : undefined;
  const roundNumber = typeof rawOrder.roundNumber === "number" ? rawOrder.roundNumber : undefined;
  const quantity = typeof rawOrder.quantity === "number" && rawOrder.quantity > 0 ? rawOrder.quantity : 1;
  const totalAmount =
    typeof rawOrder.totalAmount === "number" && rawOrder.totalAmount >= 0 ? rawOrder.totalAmount : 0;
  const rawKhantokeTicket = (rawOrder.khantokeTicket ?? rawOrder.luckyTicket) as unknown;
  const khantokeTicket =
    rawKhantokeTicket === true || rawKhantokeTicket === 1 || rawKhantokeTicket === "1";
  const rawKhantokeTicketClaimedAt =
    rawOrder.khantokeTicketClaimedAt ?? rawOrder.luckyTicketClaimedAt;

  return {
    id: readString(rawOrder.id),
    sequenceNumber,
    roundNumber,
    status: normalizeOrderStatus(rawOrder.status, rawOrder.paymentStatus),
    paymentStatus: normalizePaymentStatus(rawOrder.status, rawOrder.paymentStatus),
    khantokeTicket,
    khantokeTicketClaimedAt:
      typeof rawKhantokeTicketClaimedAt === "string" && rawKhantokeTicketClaimedAt.trim()
        ? rawKhantokeTicketClaimedAt
        : null,
    createdAt: readString(rawOrder.createdAt),
    updatedAt: readString(rawOrder.updatedAt),
    size: readString(rawOrder.size),
    quantity,
    totalAmount,
    product: {
      slug: readString(rawProduct.slug),
      name: readString(rawProduct.name),
      shortName: readString(rawProduct.shortName),
      tagline: readString(rawProduct.tagline),
      price: typeof rawProduct.price === "number" ? rawProduct.price : 0,
      image: readString(rawProduct.image),
      category:
        rawProduct.category === "bundle" ||
        rawProduct.category === "jacket" ||
        rawProduct.category === "headband"
          ? rawProduct.category
          : "single"
    },
    customer: {
      studentCode: readString(customer.studentCode),
      email: readString(customer.email),
      fullName: getOrderCustomerName(customer),
      phone: readString(customer.phone),
      school: readString(customer.school),
      parentPhone: readString(customer.parentPhone)
    },
    slip: rawOrder.slip ?? null
  } satisfies Order;
}
