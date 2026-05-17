import { ONE_SIZE_OPTION, SIZE_OPTIONS } from "@/lib/checkoutOptions";
import { Product, ProductCategory } from "@/types/product";

export type StandardSizeOption = (typeof SIZE_OPTIONS)[number];
export type ProductSizeOption = StandardSizeOption | typeof ONE_SIZE_OPTION;

const DEFAULT_SIZE_OPTION: StandardSizeOption = "M";

export function isStandardSizeOption(value?: string): value is StandardSizeOption {
  return SIZE_OPTIONS.includes(value as StandardSizeOption);
}

export function normalizeStandardProductSize(
  product: Product,
  size?: string
): ProductSizeOption {
  if (!product.requiresSize) {
    return ONE_SIZE_OPTION;
  }

  return isStandardSizeOption(size) ? size : DEFAULT_SIZE_OPTION;
}

export function getStoredProductSize(product: Product, size?: string) {
  if (!product.requiresSize) {
    return ONE_SIZE_OPTION;
  }

  if (size?.includes(" / ")) {
    const [sizeOnly, color] = size.split(" / ");
    const normalizedSize = normalizeStandardProductSize(product, sizeOnly?.trim());
    return color?.trim() ? `${normalizedSize} / ${color.trim()}` : normalizedSize;
  }

  return normalizeStandardProductSize(product, size);
}

export function getSizeSurcharge(product: Product, size?: string): number {
  if (!product.sizeSurcharge || !size) return 0;
  const baseSize = size.split(" / ")[0].trim();
  return product.sizeSurcharge.sizes.includes(baseSize) ? product.sizeSurcharge.amount : 0;
}

export function formatStoredProductSize(category: ProductCategory, size?: string) {
  if (category === "headband") {
    return ONE_SIZE_OPTION;
  }

  if (size?.includes(" / ")) {
    const [sizeOnly, color] = size.split(" / ");
    const normalizedSize = isStandardSizeOption(sizeOnly?.trim()) ? sizeOnly!.trim() : DEFAULT_SIZE_OPTION;
    return color?.trim() ? `${normalizedSize} / ${color.trim()}` : normalizedSize;
  }

  return isStandardSizeOption(size) ? size : DEFAULT_SIZE_OPTION;
}
