export type ProductCategory = "single" | "jacket" | "headband";

export type ColorVariant = { name: string; hex: string; image: string };

export type Product = {
  slug: string;
  name: string;
  shortName: string;
  tagline: string;
  description: string;
  price: number;
  images: string[];
  colors?: ColorVariant[];
  sizeSurcharge?: { sizes: string[]; amount: number };
  category: ProductCategory;
  requiresSize: boolean;
  requiresSchool: boolean;
  available?: boolean;
};
