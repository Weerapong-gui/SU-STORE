import { del, get, put } from "@vercel/blob";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ORDER_PREFIX, getCurrentPhase } from "@/lib/formatOrderNumber";
import { normalizeOrder } from "@/lib/orderStatus";
import {
  createRemoteOrder,
  getRemoteOrderById,
  hasRemoteOrderApi,
  isRemoteOrderApiReachable,
  uploadRemoteOrderSlip,
  updateRemoteOrder,
} from "@/lib/remoteOrderApi";
import { ValidatedOrderInput } from "@/lib/orderValidation";
import { productToSnapshot } from "@/lib/orderPayload";
import { Order, OrderItem, OrderSlip } from "@/types/order";

const COOKIE_SECRET = process.env.COOKIE_SECRET ?? "";
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
const LOCAL_KHANTOK_TICKET_STATE_BLOB_PATH = "orders/_khantok-ticket-claims.json";
const LOCAL_KHANTOK_TICKET_STATE_FILE_PATH = path.join(DATA_ROOT, "khantok-ticket-claims.json");
const LEGACY_LOCAL_LUCKY_TICKET_STATE_BLOB_PATH = "orders/_lucky-ticket-claims.json";
const LEGACY_LOCAL_LUCKY_TICKET_STATE_FILE_PATH = path.join(DATA_ROOT, "lucky-ticket-claims.json");
const MAX_KHANTOK_TICKET_CLAIMS = 2000;

type OrderStorageMode = "filesystem" | "blob" | "cookie";
type CreateOrderResult = {
  order: Order;
  accessToken?: string;
};
type SlipUploadAvailability = {
  enabled: boolean;
  message: string | null;
};
type LocalOrderNumber = {
  roundNumber: number;
  sequenceNumber: number;
};
const HEADBAND_ONLY_SLUG = "fresh-headband";

type LocalKhantokTicketState = {
  claims: Record<string, string>;
  studentCodes: Record<string, string>;
};
type KhantokTicketAllocation = {
  khantokTicket: boolean;
  khantokTicketClaimedAt: string | null;
  khantokTicketAlreadyClaimed: boolean;
};

const BLOB_STORAGE_DISABLED_MESSAGE =
  "deployment นี้ยังไม่ได้เชื่อม Blob storage สำหรับเก็บสลิป กรุณาเพิ่ม BLOB_READ_WRITE_TOKEN แล้ว redeploy ก่อนเปิดใช้งานขั้นตอนนี้";
const REMOTE_SLIP_UPLOAD_UNAVAILABLE_MESSAGE =
  "ระบบรับสลิปบนเซิร์ฟเวอร์ยังไม่พร้อมใช้งานในขณะนี้ กรุณาอัปเดต ORDER_API_BASE_URL หรือ restart order API ปลายทางก่อน";

export class SlipUploadError extends Error {
  status: number;

  constructor(message: string, status = 503) {
    super(message);
    this.name = "SlipUploadError";
    this.status = status;
  }
}

function getOrderFilePath(orderId: string) {
  return path.join(ORDERS_DIR, `${orderId}.json`);
}

function getOrderBlobPath(orderId: string) {
  return `orders/${orderId}.json`;
}

function nowThaiISO() {
  const d = new Date();
  const thai = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return thai.toISOString().replace("Z", "+07:00");
}

function generateOrderId() {
  const suffix = randomBytes(3).toString("hex").toUpperCase();
  return `SU-${Date.now().toString(36).toUpperCase()}${suffix}`;
}

function getLocalOrderRound() {
  return getCurrentPhase();
}

function isSafeOrderId(orderId: string) {
  return ORDER_ID_PATTERN.test(orderId);
}

function createOrderItems(input: ValidatedOrderInput): OrderItem[] {
  return input.items.map((item, index) => {
    const product = productToSnapshot(item.product);

    return {
      id: `${product.slug}-${index + 1}`,
      product,
      size: item.size,
      quantity: item.quantity,
      unitPrice: item.product.price,
      totalAmount: item.product.price * item.quantity
    };
  });
}

function buildOrderFromInput(
  orderId: string,
  input: ValidatedOrderInput,
  existingOrder?: Order,
  localOrderNumber?: LocalOrderNumber,
  khantokTicketAllocation?: KhantokTicketAllocation
): Order {
  const now = nowThaiISO();
  const items = createOrderItems(input);
  const primaryItem = items[0];
  const totalAmount = items.reduce((sum, item) => sum + item.totalAmount, 0);

  return {
    id: orderId,
    sequenceNumber: existingOrder?.sequenceNumber ?? localOrderNumber?.sequenceNumber,
    roundNumber: existingOrder?.roundNumber ?? localOrderNumber?.roundNumber,
    status: "pending_payment",
    paymentStatus: "awaiting_payment",
    khantokTicket:
      existingOrder?.khantokTicket ?? khantokTicketAllocation?.khantokTicket ?? false,
    khantokTicketClaimedAt:
      existingOrder?.khantokTicketClaimedAt ??
      khantokTicketAllocation?.khantokTicketClaimedAt ??
      null,
    khantokTicketAlreadyClaimed:
      existingOrder?.khantokTicketAlreadyClaimed ??
      khantokTicketAllocation?.khantokTicketAlreadyClaimed ??
      false,
    createdAt: existingOrder?.createdAt ?? now,
    updatedAt: now,
    size: primaryItem.size,
    quantity: primaryItem.quantity,
    totalAmount,
    product: primaryItem.product,
    items,
    customer: {
      studentCode: input.studentCode,
      email: input.email,
      fullName: input.fullName,
      phone: input.phone,
      school: input.school,
      parentPhone: input.parentPhone
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
  const payload = Buffer.from(JSON.stringify(order), "utf8").toString("base64url");
  if (!COOKIE_SECRET) return payload;
  const sig = createHmac("sha256", COOKIE_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function decodeOrderCookie(serializedOrder: string) {
  if (COOKIE_SECRET) {
    const dotIdx = serializedOrder.lastIndexOf(".");
    if (dotIdx === -1) throw new Error("Cookie missing signature");
    const payload = serializedOrder.slice(0, dotIdx);
    const sig = Buffer.from(serializedOrder.slice(dotIdx + 1), "base64url");
    const expected = Buffer.from(
      createHmac("sha256", COOKIE_SECRET).update(payload).digest("base64url"),
      "base64url"
    );
    if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) {
      throw new Error("Cookie signature invalid");
    }
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Order;
  }
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

async function readLocalKhantokTicketState(): Promise<LocalKhantokTicketState> {
  const storageMode = getOrderStorageMode();

  if (storageMode === "blob") {
    const blobResult =
      (await get(LOCAL_KHANTOK_TICKET_STATE_BLOB_PATH, {
        access: "private"
      })) ??
      (await get(LEGACY_LOCAL_LUCKY_TICKET_STATE_BLOB_PATH, {
        access: "private"
      }));

    if (!blobResult || blobResult.statusCode !== 200) {
      return { claims: {}, studentCodes: {} } satisfies LocalKhantokTicketState;
    }

    try {
      const rawState = await new Response(blobResult.stream).text();
      const state = JSON.parse(rawState) as LocalKhantokTicketState;
      return typeof state === "object" && state && typeof state.claims === "object"
        ? { claims: state.claims ?? {}, studentCodes: state.studentCodes ?? {} }
        : { claims: {}, studentCodes: {} };
    } catch {
      return { claims: {}, studentCodes: {} } satisfies LocalKhantokTicketState;
    }
  }

  if (storageMode === "cookie") {
    return { claims: {}, studentCodes: {} } satisfies LocalKhantokTicketState;
  }

  try {
    const rawState = await fs.readFile(LOCAL_KHANTOK_TICKET_STATE_FILE_PATH, "utf8");
    const state = JSON.parse(rawState) as LocalKhantokTicketState;
    return typeof state === "object" && state && typeof state.claims === "object"
      ? { claims: state.claims ?? {}, studentCodes: state.studentCodes ?? {} }
      : { claims: {}, studentCodes: {} };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      try {
        const rawLegacyState = await fs.readFile(LEGACY_LOCAL_LUCKY_TICKET_STATE_FILE_PATH, "utf8");
        const legacyState = JSON.parse(rawLegacyState) as LocalKhantokTicketState;
        return typeof legacyState === "object" &&
          legacyState &&
          typeof legacyState.claims === "object"
          ? { claims: legacyState.claims ?? {}, studentCodes: legacyState.studentCodes ?? {} }
          : { claims: {}, studentCodes: {} };
      } catch {
        return { claims: {}, studentCodes: {} } satisfies LocalKhantokTicketState;
      }
    }

    throw error;
  }
}

async function writeLocalKhantokTicketState(state: LocalKhantokTicketState) {
  const storageMode = getOrderStorageMode();
  const serializedState = JSON.stringify(state, null, 2);

  if (storageMode === "blob") {
    await put(LOCAL_KHANTOK_TICKET_STATE_BLOB_PATH, serializedState, {
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
  await fs.writeFile(LOCAL_KHANTOK_TICKET_STATE_FILE_PATH, serializedState, "utf8");
}

async function allocateLocalKhantokTicket(
  orderId: string,
  studentCode: string,
  items: { product: { slug: string } }[]
): Promise<KhantokTicketAllocation> {
  if (getOrderStorageMode() === "cookie") {
    return { khantokTicket: false, khantokTicketClaimedAt: null, khantokTicketAlreadyClaimed: false };
  }

  const isHeadbandOnly = items.length > 0 && items.every((i) => i.product.slug === HEADBAND_ONLY_SLUG);
  if (isHeadbandOnly) {
    return { khantokTicket: false, khantokTicketClaimedAt: null, khantokTicketAlreadyClaimed: false };
  }

  const state = await readLocalKhantokTicketState();

  const existingClaimByOrder = state.claims[orderId];
  if (existingClaimByOrder) {
    return { khantokTicket: true, khantokTicketClaimedAt: existingClaimByOrder, khantokTicketAlreadyClaimed: false };
  }

  const normalizedCode = studentCode.trim().toLowerCase();
  if (normalizedCode && state.studentCodes[normalizedCode]) {
    return { khantokTicket: false, khantokTicketClaimedAt: null, khantokTicketAlreadyClaimed: true };
  }

  const currentClaims = Object.keys(state.claims).length;
  if (currentClaims >= MAX_KHANTOK_TICKET_CLAIMS) {
    return { khantokTicket: false, khantokTicketClaimedAt: null, khantokTicketAlreadyClaimed: false };
  }

  const claimedAt = nowThaiISO();
  state.claims[orderId] = claimedAt;
  if (normalizedCode) {
    state.studentCodes[normalizedCode] = orderId;
  }
  await writeLocalKhantokTicketState(state);

  return { khantokTicket: true, khantokTicketClaimedAt: claimedAt, khantokTicketAlreadyClaimed: false };
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
    return ensureLocalOrderNumber(normalizeOrder(JSON.parse(rawOrder) as Order));
  }

  if (storageMode === "cookie") {
    const serializedOrder = cookies().get(getOrderCookieName(orderId))?.value;
    if (!serializedOrder) {
      return null;
    }

    try {
      return normalizeOrder(decodeOrderCookie(serializedOrder));
    } catch {
      return null;
    }
  }

  try {
    const rawOrder = await fs.readFile(getOrderFilePath(orderId), "utf8");
    return ensureLocalOrderNumber(normalizeOrder(JSON.parse(rawOrder) as Order));
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
      return normalizeOrder(remoteOrder);
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
          order: normalizeOrder(order),
          accessToken: order.accessToken
        } satisfies CreateOrderResult;
      }

      console.warn("Remote order API returned no order during creation. Falling back to local storage.");
    } catch (error) {
      console.error("Remote order API create failed. Falling back to local storage.", error);
    }
  }

  const orderId = generateOrderId();
  const order = buildOrderFromInput(
    orderId,
    input,
    undefined,
    await allocateLocalOrderNumber(),
    await allocateLocalKhantokTicket(orderId, input.studentCode, input.items)
  );
  await writeOrder(order);
  return { order } satisfies CreateOrderResult;
}

export async function updateOrder(orderId: string, input: ValidatedOrderInput) {
  if (hasRemoteOrderApi()) {
    try {
      const remoteOrder = await updateRemoteOrder(orderId, input, getRemoteOrderAccessToken(orderId));
      if (remoteOrder) {
        return normalizeOrder(remoteOrder);
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

export async function getPaymentSlipUploadAvailability(): Promise<SlipUploadAvailability> {
  if (getOrderStorageMode() !== "cookie") {
    return { enabled: true, message: null };
  }

  if (!hasRemoteOrderApi()) {
    return {
      enabled: false,
      message: BLOB_STORAGE_DISABLED_MESSAGE
    };
  }

  const remoteReachable = await isRemoteOrderApiReachable();
  if (!remoteReachable) {
    return {
      enabled: false,
      message: REMOTE_SLIP_UPLOAD_UNAVAILABLE_MESSAGE
    };
  }

  return { enabled: true, message: null };
}

export function validateSlipUpload(file: File) {
  if (!canUploadPaymentSlip()) {
    return {
      message: BLOB_STORAGE_DISABLED_MESSAGE
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

  let remoteUploadUnavailableMessage: string | null = null;

  if (hasRemoteOrderApi()) {
    try {
      const remoteOrder = await uploadRemoteOrderSlip(
        orderId,
        file,
        getRemoteOrderAccessToken(orderId)
      );
      if (remoteOrder) {
        return normalizeOrder(remoteOrder);
      }

      console.warn(`Remote order API returned no order while uploading slip for ${orderId}. Falling back to local storage.`);
      remoteUploadUnavailableMessage =
        "ไม่พบคำสั่งซื้อบนเซิร์ฟเวอร์รับสลิป หรือสิทธิ์เข้าถึงคำสั่งซื้อนี้หมดอายุแล้ว";
    } catch (error) {
      console.error(`Remote order API slip upload failed for ${orderId}. Falling back to local storage.`, error);
      remoteUploadUnavailableMessage = REMOTE_SLIP_UPLOAD_UNAVAILABLE_MESSAGE;
    }
  }

  const storageMode = getOrderStorageMode();
  if (storageMode === "cookie") {
    throw new SlipUploadError(
      remoteUploadUnavailableMessage ?? BLOB_STORAGE_DISABLED_MESSAGE
    );
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
    uploadedAt: nowThaiISO()
  };

  const updatedOrder: Order = {
    ...existingOrder,
    status: "waiting_confirm",
    paymentStatus: "waiting_confirm",
    updatedAt: nowThaiISO(),
    slip
  };

  if (hasRemoteOrderApi()) {
    console.warn(`Local slip storage was used for ${orderId} because remote upload was unavailable.`);
  }

  await writeOrder(updatedOrder);
  return updatedOrder;
}
