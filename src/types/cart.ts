import { ProductCategory } from "@/types/product";

export type CartItem = {
  id: string;
  productSlug: string;
  productName: string;
  productShortName: string;
  productImage: string;
  productCategory: ProductCategory;
  unitPrice: number;
  quantity: number;
  size: string;
  school: string;
  addedAt: string;
};
