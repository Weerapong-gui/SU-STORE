import {
  Order,
  OrderCustomer,
  OrderItem,
  OrderProductSnapshot,
  OrderStatus,
  PaymentStatus
} from "@/types/order";

type LegacyCustomer = Partial<OrderCustomer> & {
  firstName?: string;
  lastName?: string;
  nickname?: string;
};

type RawOrder = Partial<Order> &
  Record<string, unknown> & {
    customer?: LegacyCustomer | null;
    slip?: Order["slip"] | null;
    items?: Partial<OrderItem>[];
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

function normalizeProductSnapshot(product: Partial<OrderProductSnapshot>): OrderProductSnapshot {
  return {
    slug: readString(product.slug),
    name: readString(product.name),
    shortName: readString(product.shortName),
    tagline: readString(product.tagline),
    price: typeof product.price === "number" ? product.price : 0,
    image: readString(product.image),
    category:
      product.category === "bundle" ||
      product.category === "jacket" ||
      product.category === "headband"
        ? product.category
        : "single"
  };
}

export function normalizeOrder(rawOrder: RawOrder) {
  const customer = (rawOrder.customer ?? {}) as LegacyCustomer;
  const rawProduct = (rawOrder.product ?? {}) as Partial<Order["product"]>;
  const product = normalizeProductSnapshot(rawProduct);
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
  const normalizedItems = Array.isArray(rawOrder.items)
    ? rawOrder.items
        .map((item, index) => {
          const productSnapshot = normalizeProductSnapshot(item.product ?? product);
          const itemQuantity =
            typeof item.quantity === "number" && item.quantity > 0 ? item.quantity : 1;
          const unitPrice =
            typeof item.unitPrice === "number" ? item.unitPrice : productSnapshot.price;

          return {
            id: readString(item.id) || `${productSnapshot.slug || "item"}-${index + 1}`,
            product: productSnapshot,
            size: readString(item.size),
            quantity: itemQuantity,
            unitPrice,
            totalAmount:
              typeof item.totalAmount === "number" && item.totalAmount >= 0
                ? item.totalAmount
                : unitPrice * itemQuantity
          } satisfies OrderItem;
        })
        .filter((item) => item.product.slug || item.product.name)
    : [];
  const items =
    normalizedItems.length > 0
      ? normalizedItems
      : [
          {
            id: product.slug || "item-1",
            product,
            size: readString(rawOrder.size),
            quantity,
            unitPrice: product.price,
            totalAmount: product.price * quantity
          }
        ];

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
    product,
    items,
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
