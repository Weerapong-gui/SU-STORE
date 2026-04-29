import { products } from "@/data/products";
import { SCHOOL_OPTIONS, SIZE_OPTIONS } from "@/lib/checkoutOptions";
import { Product } from "@/types/product";

export type ValidatedOrderInput = {
  product: Product;
  size: (typeof SIZE_OPTIONS)[number];
  quantity: number;
  firstName: string;
  lastName: string;
  nickname: string;
  email: string;
  phone: string;
  school: (typeof SCHOOL_OPTIONS)[number];
};

type ValidationResult =
  | {
      data: ValidatedOrderInput;
      message?: never;
    }
  | {
      data?: never;
      message: string;
    };

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function validateOrderInput(payload: Record<string, unknown>): ValidationResult {
  const productSlug = readString(payload.product);
  const size = readString(payload.size);
  const firstName = readString(payload.firstName);
  const lastName = readString(payload.lastName);
  const nickname = readString(payload.nickname);
  const email = readString(payload.email);
  const phone = readString(payload.phone);
  const school = readString(payload.school);

  const parsedQuantity =
    typeof payload.quantity === "number"
      ? payload.quantity
      : Number.parseInt(readString(payload.quantity), 10);

  const product = products.find((item) => item.slug === productSlug);
  if (!product) {
    return { message: "ไม่พบสินค้าที่เลือก" };
  }

  if (!SIZE_OPTIONS.includes(size as (typeof SIZE_OPTIONS)[number])) {
    return { message: "กรุณาเลือกไซซ์เสื้อที่ถูกต้อง" };
  }

  if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1 || parsedQuantity > 99) {
    return { message: "กรุณาระบุจำนวนสินค้าที่ถูกต้อง" };
  }

  if (!firstName || !lastName || !nickname) {
    return { message: "กรุณากรอกชื่อ นามสกุล และชื่อเล่นให้ครบ" };
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { message: "กรุณากรอกอีเมลให้ถูกต้อง" };
  }

  const phoneDigits = phone.replace(/\D/g, "");
  if (!phone || phoneDigits.length < 9) {
    return { message: "กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง" };
  }

  if (!SCHOOL_OPTIONS.includes(school as (typeof SCHOOL_OPTIONS)[number])) {
    return { message: "กรุณาเลือกสำนักวิชา" };
  }

  return {
    data: {
      product,
      size: size as (typeof SIZE_OPTIONS)[number],
      quantity: parsedQuantity,
      firstName,
      lastName,
      nickname,
      email,
      phone,
      school: school as (typeof SCHOOL_OPTIONS)[number]
    }
  };
}
