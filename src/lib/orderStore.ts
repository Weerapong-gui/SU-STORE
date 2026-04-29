import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ValidatedOrderInput } from "@/lib/orderValidation";
import { Order, OrderSlip } from "@/types/order";

const DATA_ROOT = path.join(process.cwd(), "data");
const ORDERS_DIR = path.join(DATA_ROOT, "orders");
const SLIPS_DIR = path.join(DATA_ROOT, "slips");
const ORDER_ID_PATTERN = /^SU-[A-Z0-9]+$/;
const ALLOWED_SLIP_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const MAX_SLIP_SIZE_BYTES = 5 * 1024 * 1024;

function getOrderFilePath(orderId: string) {
  return path.join(ORDERS_DIR, `${orderId}.json`);
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

async function ensureStorage() {
  await fs.mkdir(ORDERS_DIR, { recursive: true });
  await fs.mkdir(SLIPS_DIR, { recursive: true });
}

async function writeOrder(order: Order) {
  await ensureStorage();
  await fs.writeFile(getOrderFilePath(order.id), JSON.stringify(order, null, 2), "utf8");
}

async function removeSlipFile(order: Order) {
  if (!order.slip?.storedName) {
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

export async function createOrder(input: ValidatedOrderInput) {
  const order = buildOrderFromInput(generateOrderId(), input);
  await writeOrder(order);
  return order;
}

export async function updateOrder(orderId: string, input: ValidatedOrderInput) {
  const existingOrder = await getOrderById(orderId);
  if (!existingOrder) {
    return null;
  }

  await removeSlipFile(existingOrder);

  const order = buildOrderFromInput(orderId, input, existingOrder);
  await writeOrder(order);
  return order;
}

export function validateSlipUpload(file: File) {
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

  await ensureStorage();
  await removeSlipFile(existingOrder);

  const extension = resolveSlipExtension(file.name, file.type);
  const storedName = `${orderId}-${Date.now()}${extension}`;
  const fileBuffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(SLIPS_DIR, storedName), fileBuffer);

  const slip: OrderSlip = {
    originalName: file.name,
    storedName,
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

  await writeOrder(updatedOrder);
  return updatedOrder;
}
