export type ProductCategory = "single" | "bundle" | "jacket" | "headband";

export type Product = {
  slug: string;
  name: string;
  shortName: string;
  tagline: string;
  description: string;
  price: number;
  images: string[];
  category: ProductCategory;
  requiresSize: boolean;
  requiresSchool: boolean;
};
