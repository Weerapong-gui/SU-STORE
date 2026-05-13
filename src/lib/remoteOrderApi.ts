import { ValidatedOrderInput } from "@/lib/orderValidation";
import { productToSnapshot } from "@/lib/orderPayload";
import { getSizeSurcharge } from "@/lib/productSizing";
import { Order, OrderCustomer, OrderItem, OrderProductSnapshot } from "@/types/order";

const REMOTE_ORDER_API_BASE_URL = process.env.ORDER_API_BASE_URL?.replace(/\/$/, "") ?? "";
const REMOTE_ORDER_API_TOKEN = process.env.ORDER_API_TOKEN ?? "";

export type RemoteOrder = Order & {
  accessToken?: string;
  success?: boolean;
  khantokTicket?: boolean;
  message?: string;
};

type RemoteOrderPayload = {
  product: OrderProductSnapshot;
  customer: OrderCustomer;
  size: string;
  quantity: number;
  totalAmount: number;
  items: OrderItem[];
};

type RemoteOrderRequestOptions = RequestInit & {
  orderAccessToken?: string;
};

function createCustomerSnapshot(input: ValidatedOrderInput): OrderCustomer {
  return {
    studentCode: input.studentCode,
    email: input.email,
    fullName: input.fullName,
    phone: input.phone,
    school: input.school,
    parentPhone: input.parentPhone
  };
}

function createRemoteOrderPayload(input: ValidatedOrderInput): RemoteOrderPayload {
  const items = input.items.map((item, index) => {
    const product = productToSnapshot(item.product);

    return {
      id: `${product.slug}-${index + 1}`,
      product,
      size: item.size,
      quantity: item.quantity,
      unitPrice: item.product.price + getSizeSurcharge(item.product, item.size),
      totalAmount: (item.product.price + getSizeSurcharge(item.product, item.size)) * item.quantity
    };
  });
  const totalAmount = items.reduce((sum, item) => sum + item.totalAmount, 0);
  // totalAmount already includes size surcharges from each item

  return {
    product: items[0].product,
    customer: createCustomerSnapshot(input),
    size: items[0].size,
    quantity: items[0].quantity,
    totalAmount,
    items
  };
}

async function remoteOrderRequest<T>(
  pathname: string,
  init?: RemoteOrderRequestOptions
): Promise<T | null> {
  if (!REMOTE_ORDER_API_BASE_URL) {
    return null;
  }

  const headers = new Headers(init?.headers);
  const isFormDataBody = typeof FormData !== "undefined" && init?.body instanceof FormData;
  if (!headers.has("Content-Type") && init?.body && !isFormDataBody) {
    headers.set("Content-Type", "application/json");
  }
  if (REMOTE_ORDER_API_TOKEN) {
    headers.set("Authorization", `Bearer ${REMOTE_ORDER_API_TOKEN}`);
  } else if (init?.orderAccessToken) {
    headers.set("X-Order-Token", init.orderAccessToken);
  }

  const response = await fetch(`${REMOTE_ORDER_API_BASE_URL}${pathname}`, {
    ...init,
    headers,
    cache: "no-store"
  });

  if (response.status === 401 || response.status === 404) {
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

export async function isRemoteOrderApiReachable() {
  if (!REMOTE_ORDER_API_BASE_URL) {
    return false;
  }

  try {
    const response = await fetch(`${REMOTE_ORDER_API_BASE_URL}/health`, {
      cache: "no-store"
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function getRemoteOrderById(orderId: string, orderAccessToken?: string) {
  try {
    return await remoteOrderRequest<Order>(`/orders/${encodeURIComponent(orderId)}`, {
      orderAccessToken
    });
  } catch {
    return null;
  }
}

export async function createRemoteOrder(input: ValidatedOrderInput) {
  return remoteOrderRequest<RemoteOrder>("/orders", {
    method: "POST",
    body: JSON.stringify(createRemoteOrderPayload(input))
  });
}

export async function updateRemoteOrder(
  orderId: string,
  input: ValidatedOrderInput,
  orderAccessToken?: string
) {
  return remoteOrderRequest<Order>(`/orders/${encodeURIComponent(orderId)}`, {
    method: "PUT",
    orderAccessToken,
    body: JSON.stringify(createRemoteOrderPayload(input))
  });
}

export async function uploadRemoteOrderSlip(
  orderId: string,
  file: File,
  orderAccessToken?: string
) {
  const formData = new FormData();
  formData.append("slip", file);
  formData.append("uploadedAt", new Date().toISOString());

  return remoteOrderRequest<Order>(`/orders/${encodeURIComponent(orderId)}/slip`, {
    method: "PATCH",
    orderAccessToken,
    body: formData
  });
}
