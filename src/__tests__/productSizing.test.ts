import { describe, it, expect } from "vitest";
import {
  getSizeSurcharge,
  formatStoredProductSize,
  isStandardSizeOption,
  getStoredProductSize,
} from "@/lib/productSizing";
import type { Product } from "@/types/product";

const mockShirt: Product = {
  slug: "single",
  shortName: "Shirt",
  name: "Fresher Shirt",
  tagline: "Test shirt",
  description: "FRESHER PACKAGE 28TH",
  category: "single",
  price: 158,
  images: [],
  colors: [],
  requiresSize: true,
  requiresSchool: false,
  available: true,
  sizeSurcharge: { amount: 30, sizes: ["2XL", "3XL", "4XL", "5XL", "6XL", "7XL"] },
};

const mockHeadband: Product = {
  slug: "headband",
  shortName: "Headband",
  name: "Fresher Headband",
  tagline: "Test headband",
  description: "FRESHER PACKAGE 28TH",
  category: "headband",
  price: 20,
  images: [],
  colors: [],
  requiresSize: false,
  requiresSchool: true,
  available: true,
};

describe("isStandardSizeOption", () => {
  it("returns true for valid sizes", () => {
    expect(isStandardSizeOption("S")).toBe(true);
    expect(isStandardSizeOption("XL")).toBe(true);
    expect(isStandardSizeOption("2XL")).toBe(true);
  });

  it("returns false for invalid sizes", () => {
    expect(isStandardSizeOption("XXL")).toBe(false);
    expect(isStandardSizeOption("")).toBe(false);
    expect(isStandardSizeOption(undefined)).toBe(false);
  });
});

describe("getSizeSurcharge", () => {
  it("returns 0 for no-surcharge sizes", () => {
    expect(getSizeSurcharge(mockShirt, "S")).toBe(0);
    expect(getSizeSurcharge(mockShirt, "XL")).toBe(0);
  });

  it("returns surcharge amount for large sizes", () => {
    expect(getSizeSurcharge(mockShirt, "2XL")).toBe(30);
    expect(getSizeSurcharge(mockShirt, "3XL")).toBe(30);
  });

  it("returns 0 for product without surcharge", () => {
    expect(getSizeSurcharge(mockHeadband, "2XL")).toBe(0);
  });

  it("handles size with color suffix", () => {
    expect(getSizeSurcharge(mockShirt, "2XL / Blue")).toBe(30);
    expect(getSizeSurcharge(mockShirt, "M / Red")).toBe(0);
  });
});

describe("getStoredProductSize", () => {
  it("returns ONE_SIZE for products that don't require size", () => {
    const result = getStoredProductSize(mockHeadband, "M");
    expect(result).toBe("ONE SIZE");
  });

  it("normalizes size for shirt", () => {
    expect(getStoredProductSize(mockShirt, "M")).toBe("M");
    expect(getStoredProductSize(mockShirt, "XL")).toBe("XL");
  });

  it("preserves color suffix", () => {
    const result = getStoredProductSize(mockShirt, "M / Blue");
    expect(result).toBe("M / Blue");
  });
});

describe("formatStoredProductSize", () => {
  it("always returns One Size for headband", () => {
    expect(formatStoredProductSize("headband", "M")).toBe("ONE SIZE");
    expect(formatStoredProductSize("headband", undefined)).toBe("ONE SIZE");
  });

  it("returns size for shirt", () => {
    expect(formatStoredProductSize("single", "M")).toBe("M");
    expect(formatStoredProductSize("single", "2XL")).toBe("2XL");
  });

  it("formats size with color suffix", () => {
    expect(formatStoredProductSize("jacket", "M / Blue")).toBe("M / Blue");
  });
});
