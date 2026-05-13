import { ONE_SIZE_OPTION, SIZE_OPTIONS } from "@/lib/checkoutOptions";
import { Product, ProductCategory } from "@/types/product";

export type StandardSizeOption = (typeof SIZE_OPTIONS)[number];
export type ProductSizeOption = StandardSizeOption | typeof ONE_SIZE_OPTION;
export type BundleSizeSelection = {
  polo: StandardSizeOption;
  jacket: StandardSizeOption;
};

const DEFAULT_SIZE_OPTION: StandardSizeOption = "M";

export function isStandardSizeOption(value?: string): value is StandardSizeOption {
  return SIZE_OPTIONS.includes(value as StandardSizeOption);
}

export function isBundleCategory(category: ProductCategory) {
  return category === "bundle";
}

export function isBundleProduct(product: Product) {
  return isBundleCategory(product.category);
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

export function parseBundleSizeSelection(size?: string): BundleSizeSelection {
  const fallbackSelection: BundleSizeSelection = {
    polo: DEFAULT_SIZE_OPTION,
    jacket: DEFAULT_SIZE_OPTION
  };

  const normalizedValue = String(size ?? "").trim();
  if (!normalizedValue) {
    return fallbackSelection;
  }

  if (isStandardSizeOption(normalizedValue)) {
    return {
      polo: normalizedValue,
      jacket: normalizedValue
    };
  }

  for (const entry of normalizedValue.split("|")) {
    const [rawKey, rawSize] = entry.split(":");
    const key = String(rawKey ?? "").trim().toUpperCase();
    const value = String(rawSize ?? "").trim().toUpperCase();

    if (!isStandardSizeOption(value)) {
      continue;
    }

    if (key === "POLO") {
      fallbackSelection.polo = value;
    }

    if (key === "JACKET") {
      fallbackSelection.jacket = value;
    }
  }

  return fallbackSelection;
}

export function serializeBundleSizeSelection(selection: BundleSizeSelection) {
  return `POLO:${selection.polo}|JACKET:${selection.jacket}`;
}

export function getStoredProductSize(product: Product, size?: string) {
  if (!product.requiresSize) {
    return ONE_SIZE_OPTION;
  }

  if (isBundleProduct(product)) {
    return serializeBundleSizeSelection(parseBundleSizeSelection(size));
  }

  return normalizeStandardProductSize(product, size);
}

export function getSizeSurcharge(product: Product, size?: string): number {
  if (!product.sizeSurcharge || !size) return 0;
  const baseSize = size.split(" / ")[0].trim();
  if (isBundleCategory(product.category)) {
    const bundleSize = parseBundleSizeSelection(baseSize);
    return product.sizeSurcharge.sizes.includes(bundleSize.polo) ? product.sizeSurcharge.amount : 0;
  }
  return product.sizeSurcharge.sizes.includes(baseSize) ? product.sizeSurcharge.amount : 0;
}

export function formatStoredProductSize(category: ProductCategory, size?: string) {
  if (category === "headband") {
    return ONE_SIZE_OPTION;
  }

  if (isBundleCategory(category)) {
    const bundleSize = parseBundleSizeSelection(size);
    return `Polo ${bundleSize.polo} / Jacket ${bundleSize.jacket}`;
  }

  return isStandardSizeOption(size) ? size : DEFAULT_SIZE_OPTION;
}
