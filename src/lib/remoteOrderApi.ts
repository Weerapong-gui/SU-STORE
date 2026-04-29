import { ValidatedOrderInput } from "@/lib/orderValidation";
import { Order, OrderCustomer, OrderProductSnapshot, OrderSlip } from "@/types/order";

const REMOTE_ORDER_API_BASE_URL = process.env.ORDER_API_BASE_URL?.replace(/\/$/, "") ?? "";
const REMOTE_ORDER_API_TOKEN = process.env.ORDER_API_TOKEN ?? "";

type RemoteOrderPayload = {
  product: OrderProductSnapshot;
  customer: OrderCustomer;
  size: string;
  quantity: number;
  totalAmount: number;
};

function createProductSnapshot(input: ValidatedOrderInput): OrderProductSnapshot {
  return {
    slug: input.product.slug,
    name: input.product.name,
    shortName: input.product.shortName,
    tagline: input.product.tagline,
    price: input.product.price,
    image: input.product.images[0],
    category: input.product.category
  };
}

function createCustomerSnapshot(input: ValidatedOrderInput): OrderCustomer {
  return {
    firstName: input.firstName,
    lastName: input.lastName,
    nickname: input.nickname,
    email: input.email,
    phone: input.phone,
    school: input.school
  };
}

function createRemoteOrderPayload(input: ValidatedOrderInput): RemoteOrderPayload {
  return {
    product: createProductSnapshot(input),
    customer: createCustomerSnapshot(input),
    size: input.size,
    quantity: input.quantity,
    totalAmount: input.product.price * input.quantity
  };
}

async function remoteOrderRequest<T>(pathname: string, init?: RequestInit): Promise<T | null> {
  if (!REMOTE_ORDER_API_BASE_URL) {
    return null;
  }

  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }
  if (REMOTE_ORDER_API_TOKEN) {
    headers.set("Authorization", `Bearer ${REMOTE_ORDER_API_TOKEN}`);
  }

  const response = await fetch(`${REMOTE_ORDER_API_BASE_URL}${pathname}`, {
    ...init,
    headers,
    cache: "no-store"
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Remote order API request failed (${response.status}): ${errorText}`);
  }

  return (await response.json()) as T;
}

export function hasRemoteOrderApi() {
  return Boolean(REMOTE_ORDER_API_BASE_URL);
}

export async function getRemoteOrderById(orderId: string) {
  return remoteOrderRequest<Order>(`/orders/${encodeURIComponent(orderId)}`);
}

export async function createRemoteOrder(input: ValidatedOrderInput) {
  return remoteOrderRequest<Order>("/orders", {
    method: "POST",
    body: JSON.stringify(createRemoteOrderPayload(input))
  });
}

export async function updateRemoteOrder(orderId: string, input: ValidatedOrderInput) {
  return remoteOrderRequest<Order>(`/orders/${encodeURIComponent(orderId)}`, {
    method: "PUT",
    body: JSON.stringify(createRemoteOrderPayload(input))
  });
}

export async function updateRemoteOrderSlip(orderId: string, slip: OrderSlip) {
  return remoteOrderRequest<Order>(`/orders/${encodeURIComponent(orderId)}/slip`, {
    method: "PATCH",
    body: JSON.stringify({ slip })
  });
}
