export type ProductCategory = "single" | "set";

export type Product = {
  slug: string;
  name: string;
  shortName: string;
  tagline: string;
  description: string;
  price: number;
  images: string[];
  category: ProductCategory;
  features: string[];
};
