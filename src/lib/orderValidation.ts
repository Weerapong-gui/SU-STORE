import { products } from "@/data/products";
import { ONE_SIZE_OPTION, SCHOOL_OPTIONS, SIZE_OPTIONS } from "@/lib/checkoutOptions";
import { getStoredProductSize, isBundleProduct, parseBundleSizeSelection } from "@/lib/productSizing";
import { Product } from "@/types/product";

export type ValidatedOrderInput = {
  product: Product;
  size: string;
  quantity: number;
  studentCode: string;
  email: string;
  fullName: string;
  phone: string;
  school: (typeof SCHOOL_OPTIONS)[number];
  parentPhone: string;
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
  const studentCode = readString(payload.studentCode);
  const email = readString(payload.email);
  const fullName = readString(payload.fullName);
  const phone = readString(payload.phone);
  const school = readString(payload.school);
  const parentPhone = readString(payload.parentPhone);

  const parsedQuantity =
    typeof payload.quantity === "number"
      ? payload.quantity
      : Number.parseInt(readString(payload.quantity), 10);

  const product = products.find((item) => item.slug === productSlug);
  if (!product) {
    return { message: "Selected product was not found." };
  }

  if (product.requiresSize && isBundleProduct(product)) {
    const bundleSize = parseBundleSizeSelection(size);

    if (
      !SIZE_OPTIONS.includes(bundleSize.polo as (typeof SIZE_OPTIONS)[number]) ||
      !SIZE_OPTIONS.includes(bundleSize.jacket as (typeof SIZE_OPTIONS)[number])
    ) {
      return { message: "Please select both polo size and jacket size." };
    }
  } else if (product.requiresSize && !SIZE_OPTIONS.includes(size as (typeof SIZE_OPTIONS)[number])) {
    return { message: "Please select a valid size." };
  }

  if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1 || parsedQuantity > 99) {
    return { message: "Please enter a valid quantity." };
  }

  if (!studentCode) {
    return { message: "Please enter your student code." };
  }

  if (!fullName) {
    return { message: "Please enter your full name." };
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { message: "Please enter a valid email address." };
  }

  const phoneDigits = phone.replace(/\D/g, "");
  if (!phone || phoneDigits.length < 9) {
    return { message: "Please enter a valid phone number." };
  }

  const parentPhoneDigits = parentPhone.replace(/\D/g, "");
  if (!parentPhone || parentPhoneDigits.length < 9) {
    return { message: "Please enter a valid parent phone number." };
  }

  if (!SCHOOL_OPTIONS.includes(school as (typeof SCHOOL_OPTIONS)[number])) {
    return { message: "Please choose a school." };
  }

  return {
    data: {
      product,
      size: product.requiresSize ? getStoredProductSize(product, size) : ONE_SIZE_OPTION,
      quantity: parsedQuantity,
      studentCode,
      email,
      fullName,
      phone,
      school: school as (typeof SCHOOL_OPTIONS)[number],
      parentPhone
    }
  };
}
