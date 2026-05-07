import { del, get, put } from "@vercel/blob";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  createRemoteOrder,
  getRemoteOrderById,
  hasRemoteOrderApi,
  updateRemoteOrder,
  updateRemoteOrderSlip
} from "@/lib/remoteOrderApi";
import { ValidatedOrderInput } from "@/lib/orderValidation";
import { Order, OrderSlip } from "@/types/order";

const DATA_ROOT = path.join(process.cwd(), "data");
const ORDERS_DIR = path.join(DATA_ROOT, "orders");
const SLIPS_DIR = path.join(DATA_ROOT, "slips");
const ORDER_ID_PATTERN = /^[A-Z0-9-]+$/;
const ALLOWED_SLIP_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const MAX_SLIP_SIZE_BYTES = 5 * 1024 * 1024;
const ORDER_COOKIE_PREFIX = "su-order-";
const REMOTE_ORDER_TOKEN_COOKIE_PREFIX = "su-order-token-";
const ORDER_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

type OrderStorageMode = "filesystem" | "blob" | "cookie";
type CreateOrderResult = {
  order: Order;
  accessToken?: string;
};

function getOrderFilePath(orderId: string) {
  return path.join(ORDERS_DIR, `${orderId}.json`);
}

function getOrderBlobPath(orderId: string) {
  return `orders/${orderId}.json`;
}

function generateOrderId() {
  const suffix = randomBytes(3).toString("hex").toUpperCase();
  return `SU-${Date.now().toString(36).toUpperCase()}${suffix}`;
}

function isSafeOrderId(orderId: string) {
  return ORDER_ID_PATTERN.test(orderId);
}

function buildOrderFromInput(orderId: string, input: ValidatedOrderInput, existingOrder?: Order): Order {
  const now = new Date().toISOString();

  return {
    id: orderId,
    status: "pending_payment",
    paymentStatus: "awaiting_payment",
    createdAt: existingOrder?.createdAt ?? now,
    updatedAt: now,
    size: input.size,
    quantity: input.quantity,
    totalAmount: input.product.price * input.quantity,
    product: {
      slug: input.product.slug,
      name: input.product.name,
      shortName: input.product.shortName,
      tagline: input.product.tagline,
      price: input.product.price,
      image: input.product.images[0],
      category: input.product.category
    },
    customer: {
      firstName: input.firstName,
      lastName: input.lastName,
      nickname: input.nickname,
      email: input.email,
      phone: input.phone,
      school: input.school
    },
    slip: null
  };
}

function isVercelRuntime() {
  return Boolean(process.env.VERCEL || process.env.VERCEL_URL);
}

function hasBlobStorage() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function getOrderStorageMode(): OrderStorageMode {
  if (hasBlobStorage()) {
    return "blob";
  }

  if (isVercelRuntime()) {
    return "cookie";
  }

  return "filesystem";
}

function getOrderCookieName(orderId: string) {
  return `${ORDER_COOKIE_PREFIX}${orderId}`;
}

function getRemoteOrderTokenCookieName(orderId: string) {
  return `${REMOTE_ORDER_TOKEN_COOKIE_PREFIX}${orderId}`;
}

function encodeOrderCookie(order: Order) {
  return Buffer.from(JSON.stringify(order), "utf8").toString("base64url");
}

function decodeOrderCookie(serializedOrder: string) {
  return JSON.parse(Buffer.from(serializedOrder, "base64url").toString("utf8")) as Order;
}

function getRemoteOrderAccessToken(orderId: string) {
  return cookies().get(getRemoteOrderTokenCookieName(orderId))?.value ?? "";
}

function setRemoteOrderAccessTokenCookie(
  response: NextResponse,
  orderId: string,
  accessToken: string
) {
  response.cookies.set({
    name: getRemoteOrderTokenCookieName(orderId),
    value: accessToken,
    httpOnly: true,
    sameSite: "lax",
    secure: isVercelRuntime(),
    path: "/",
    maxAge: ORDER_COOKIE_MAX_AGE_SECONDS
  });
}

function sanitizeFileName(fileName: string) {
  return fileName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "slip";
}

async function ensureStorage() {
  await fs.mkdir(ORDERS_DIR, { recursive: true });
  await fs.mkdir(SLIPS_DIR, { recursive: true });
}

async function writeOrder(order: Order) {
  const storageMode = getOrderStorageMode();

  if (storageMode === "blob") {
    await put(getOrderBlobPath(order.id), JSON.stringify(order, null, 2), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: 60
    });
    return;
  }

  if (storageMode === "cookie") {
    return;
  }

  await ensureStorage();
  await fs.writeFile(getOrderFilePath(order.id), JSON.stringify(order, null, 2), "utf8");
}

async function getLocalOrderById(orderId: string) {
  const storageMode = getOrderStorageMode();

  if (storageMode === "blob") {
    const blobResult = await get(getOrderBlobPath(orderId), {
      access: "private"
    });

    if (!blobResult || blobResult.statusCode !== 200) {
      return null;
    }

    const rawOrder = await new Response(blobResult.stream).text();
    return JSON.parse(rawOrder) as Order;
  }

  if (storageMode === "cookie") {
    const serializedOrder = cookies().get(getOrderCookieName(orderId))?.value;
    if (!serializedOrder) {
      return null;
    }

    try {
      return decodeOrderCookie(serializedOrder);
    } catch {
      return null;
    }
  }

  try {
    const rawOrder = await fs.readFile(getOrderFilePath(orderId), "utf8");
    return JSON.parse(rawOrder) as Order;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function removeSlipFile(order: Order) {
  if (!order.slip?.storedName) {
    return;
  }

  if (getOrderStorageMode() === "blob") {
    try {
      await del(order.slip.storedName);
    } catch {
      return;
    }
    return;
  }

  try {
    await fs.unlink(path.join(SLIPS_DIR, order.slip.storedName));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

function resolveSlipExtension(fileName: string, mimeType: string) {
  const originalExtension = path.extname(fileName).toLowerCase();
  if (originalExtension) {
    return originalExtension;
  }

  if (mimeType === "image/jpeg") {
    return ".jpg";
  }
  if (mimeType === "image/png") {
    return ".png";
  }
  if (mimeType === "image/webp") {
    return ".webp";
  }
  if (mimeType === "application/pdf") {
    return ".pdf";
  }

  return ".bin";
}

export async function getOrderById(orderId: string) {
  if (!isSafeOrderId(orderId)) {
    return null;
  }

  if (hasRemoteOrderApi()) {
    const remoteOrder = await getRemoteOrderById(orderId, getRemoteOrderAccessToken(orderId));
    if (remoteOrder) {
      return remoteOrder;
    }
  }

  return getLocalOrderById(orderId);
}

export async function createOrder(input: ValidatedOrderInput) {
  if (hasRemoteOrderApi()) {
    try {
      const order = await createRemoteOrder(input);
      if (order) {
        return {
          order,
          accessToken: order.accessToken
        } satisfies CreateOrderResult;
      }

      console.warn("Remote order API returned no order during creation. Falling back to local storage.");
    } catch (error) {
      console.error("Remote order API create failed. Falling back to local storage.", error);
    }
  }

  const order = buildOrderFromInput(generateOrderId(), input);
  await writeOrder(order);
  return { order } satisfies CreateOrderResult;
}

export async function updateOrder(orderId: string, input: ValidatedOrderInput) {
  if (hasRemoteOrderApi()) {
    try {
      const remoteOrder = await updateRemoteOrder(orderId, input, getRemoteOrderAccessToken(orderId));
      if (remoteOrder) {
        return remoteOrder;
      }

      console.warn(`Remote order API returned no order while updating ${orderId}. Falling back to local storage.`);
    } catch (error) {
      console.error(`Remote order API update failed for ${orderId}. Falling back to local storage.`, error);
    }
  }

  const existingOrder = await getLocalOrderById(orderId);
  if (!existingOrder) {
    return null;
  }

  await removeSlipFile(existingOrder);

  const order = buildOrderFromInput(orderId, input, existingOrder);
  await writeOrder(order);
  return order;
}

export function setOrderResponseCookie(
  response: NextResponse,
  order: Order,
  options?: {
    accessToken?: string;
  }
) {
  if (options?.accessToken) {
    setRemoteOrderAccessTokenCookie(response, order.id, options.accessToken);
  }

  if (getOrderStorageMode() !== "cookie") {
    return;
  }

  response.cookies.set({
    name: getOrderCookieName(order.id),
    value: encodeOrderCookie(order),
    httpOnly: true,
    sameSite: "lax",
    secure: isVercelRuntime(),
    path: "/",
    maxAge: ORDER_COOKIE_MAX_AGE_SECONDS
  });
}

export function canUploadPaymentSlip() {
  return getOrderStorageMode() !== "cookie";
}

export function validateSlipUpload(file: File) {
  if (!canUploadPaymentSlip()) {
    return {
      message: "deployment นี้ยังไม่ได้ตั้งค่า Vercel Blob สำหรับเก็บสลิปการชำระเงิน"
    };
  }

  if (!ALLOWED_SLIP_TYPES.has(file.type)) {
    return { message: "รองรับไฟล์ JPG, PNG, WEBP หรือ PDF เท่านั้น" };
  }

  if (file.size < 1 || file.size > MAX_SLIP_SIZE_BYTES) {
    return { message: "ไฟล์สลิปต้องมีขนาดไม่เกิน 5 MB" };
  }

  return { message: null };
}

export async function attachSlipToOrder(orderId: string, file: File) {
  const existingOrder = await getOrderById(orderId);
  if (!existingOrder) {
    return null;
  }

  const storageMode = getOrderStorageMode();
  if (storageMode === "cookie") {
    throw new Error("Payment slip upload requires persistent storage.");
  }

  await removeSlipFile(existingOrder);

  const extension = resolveSlipExtension(file.name, file.type);
  const storedName = `${orderId}-${Date.now()}-${sanitizeFileName(file.name.replace(/\.[^.]+$/, ""))}${extension}`;

  if (storageMode === "blob") {
    await put(`slips/${storedName}`, file, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: file.type,
      cacheControlMaxAge: 60
    });
  } else {
    await ensureStorage();
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(path.join(SLIPS_DIR, storedName), fileBuffer);
  }

  const slip: OrderSlip = {
    originalName: file.name,
    storedName: storageMode === "blob" ? `slips/${storedName}` : storedName,
    mimeType: file.type,
    size: file.size,
    uploadedAt: new Date().toISOString()
  };

  const updatedOrder: Order = {
    ...existingOrder,
    status: "payment_submitted",
    paymentStatus: "slip_uploaded",
    updatedAt: new Date().toISOString(),
    slip
  };

  if (hasRemoteOrderApi()) {
    try {
      const remoteOrder = await updateRemoteOrderSlip(
        orderId,
        slip,
        getRemoteOrderAccessToken(orderId)
      );
      if (remoteOrder) {
        return remoteOrder;
      }

      console.warn(`Remote order API returned no order while updating slip for ${orderId}. Falling back to local storage.`);
    } catch (error) {
      console.error(`Remote order API slip update failed for ${orderId}. Falling back to local storage.`, error);
    }
  }

  await writeOrder(updatedOrder);
  return updatedOrder;
}
