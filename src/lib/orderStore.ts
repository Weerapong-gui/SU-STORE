import { del, get, put } from "@vercel/blob";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { DEFAULT_ORDER_ROUND, ORDER_PREFIX } from "@/lib/formatOrderNumber";
import {
  createRemoteOrder,
  getRemoteOrderById,
  hasRemoteOrderApi,
  uploadRemoteOrderSlip,
  updateRemoteOrder,
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
const LOCAL_ORDER_SEQUENCE_COOKIE_NAME = "su-order-sequence";
const ORDER_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const LOCAL_ORDER_SEQUENCE_BLOB_PATH = "orders/_sequence.json";
const LOCAL_ORDER_SEQUENCE_FILE_PATH = path.join(DATA_ROOT, "order-sequence.json");

type OrderStorageMode = "filesystem" | "blob" | "cookie";
type CreateOrderResult = {
  order: Order;
  accessToken?: string;
};
type LocalOrderNumber = {
  roundNumber: number;
  sequenceNumber: number;
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

function getLocalOrderRound() {
  const parsedRound = Number.parseInt(process.env.ORDER_ROUND ?? "", 10);
  return Number.isInteger(parsedRound) && parsedRound > 0 ? parsedRound : DEFAULT_ORDER_ROUND;
}

function isSafeOrderId(orderId: string) {
  return ORDER_ID_PATTERN.test(orderId);
}

function buildOrderFromInput(
  orderId: string,
  input: ValidatedOrderInput,
  existingOrder?: Order,
  localOrderNumber?: LocalOrderNumber
): Order {
  const now = new Date().toISOString();

  return {
    id: orderId,
    sequenceNumber: existingOrder?.sequenceNumber ?? localOrderNumber?.sequenceNumber,
    roundNumber: existingOrder?.roundNumber ?? localOrderNumber?.roundNumber,
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

function getStoredLocalSequenceNumberFromCookie() {
  const rawValue = cookies().get(LOCAL_ORDER_SEQUENCE_COOKIE_NAME)?.value ?? "";
  const parsedValue = Number.parseInt(rawValue, 10);
  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : 0;
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

function setLocalOrderSequenceCookie(response: NextResponse, sequenceNumber: number) {
  response.cookies.set({
    name: LOCAL_ORDER_SEQUENCE_COOKIE_NAME,
    value: String(sequenceNumber),
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

async function readStoredLocalSequenceNumber() {
  const storageMode = getOrderStorageMode();

  if (storageMode === "blob") {
    const blobResult = await get(LOCAL_ORDER_SEQUENCE_BLOB_PATH, {
      access: "private"
    });

    if (!blobResult || blobResult.statusCode !== 200) {
      return 0;
    }

    try {
      const rawState = await new Response(blobResult.stream).text();
      const state = JSON.parse(rawState) as { lastSequenceNumber?: number };
      return typeof state.lastSequenceNumber === "number" && state.lastSequenceNumber > 0
        ? state.lastSequenceNumber
        : 0;
    } catch {
      return 0;
    }
  }

  if (storageMode === "cookie") {
    return getStoredLocalSequenceNumberFromCookie();
  }

  try {
    const rawState = await fs.readFile(LOCAL_ORDER_SEQUENCE_FILE_PATH, "utf8");
    const state = JSON.parse(rawState) as { lastSequenceNumber?: number };
    return typeof state.lastSequenceNumber === "number" && state.lastSequenceNumber > 0
      ? state.lastSequenceNumber
      : 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return 0;
    }
    throw error;
  }
}

async function writeStoredLocalSequenceNumber(sequenceNumber: number) {
  const storageMode = getOrderStorageMode();
  const serializedState = JSON.stringify({ lastSequenceNumber: sequenceNumber }, null, 2);

  if (storageMode === "blob") {
    await put(LOCAL_ORDER_SEQUENCE_BLOB_PATH, serializedState, {
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
  await fs.writeFile(LOCAL_ORDER_SEQUENCE_FILE_PATH, serializedState, "utf8");
}

async function allocateLocalOrderNumber() {
  const sequenceNumber = (await readStoredLocalSequenceNumber()) + 1;

  if (getOrderStorageMode() !== "cookie") {
    await writeStoredLocalSequenceNumber(sequenceNumber);
  }

  return {
    sequenceNumber,
    roundNumber: getLocalOrderRound()
  } satisfies LocalOrderNumber;
}

async function ensureLocalOrderNumber(order: Order) {
  if (
    typeof order.sequenceNumber === "number" ||
    order.id.startsWith(ORDER_PREFIX) ||
    getOrderStorageMode() === "cookie"
  ) {
    return order;
  }

  const localOrderNumber = await allocateLocalOrderNumber();
  const normalizedOrder: Order = {
    ...order,
    sequenceNumber: localOrderNumber.sequenceNumber,
    roundNumber: localOrderNumber.roundNumber
  };

  await writeOrder(normalizedOrder);
  return normalizedOrder;
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
    return ensureLocalOrderNumber(JSON.parse(rawOrder) as Order);
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
    return ensureLocalOrderNumber(JSON.parse(rawOrder) as Order);
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

  const order = buildOrderFromInput(generateOrderId(), input, undefined, await allocateLocalOrderNumber());
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

  if (typeof order.sequenceNumber === "number") {
    setLocalOrderSequenceCookie(response, order.sequenceNumber);
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
  return hasRemoteOrderApi() || getOrderStorageMode() !== "cookie";
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

  if (hasRemoteOrderApi()) {
    try {
      const remoteOrder = await uploadRemoteOrderSlip(
        orderId,
        file,
        getRemoteOrderAccessToken(orderId)
      );
      if (remoteOrder) {
        return remoteOrder;
      }

      console.warn(`Remote order API returned no order while uploading slip for ${orderId}. Falling back to local storage.`);
    } catch (error) {
      console.error(`Remote order API slip upload failed for ${orderId}. Falling back to local storage.`, error);
    }
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
    console.warn(`Local slip storage was used for ${orderId} because remote upload was unavailable.`);
  }

  await writeOrder(updatedOrder);
  return updatedOrder;
}
