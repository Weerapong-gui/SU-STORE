import { ProductCategory } from "@/types/product";

export type OrderStatus = "pending_payment" | "payment_submitted";

export type PaymentStatus = "awaiting_payment" | "slip_uploaded";

export type OrderCustomer = {
  firstName: string;
  lastName: string;
  nickname: string;
  email: string;
  phone: string;
  school: string;
};

export type OrderProductSnapshot = {
  slug: string;
  name: string;
  shortName: string;
  tagline: string;
  price: number;
  image: string;
  category: ProductCategory;
};

export type OrderSlip = {
  originalName: string;
  storedName: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
};

export type Order = {
  id: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  createdAt: string;
  updatedAt: string;
  size: string;
  quantity: number;
  totalAmount: number;
  product: OrderProductSnapshot;
  customer: OrderCustomer;
  slip: OrderSlip | null;
};
