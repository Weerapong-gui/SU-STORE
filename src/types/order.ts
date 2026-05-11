import { ProductCategory } from "@/types/product";

export type OrderStatus =
  | "pending_payment"
  | "waiting_confirm"
  | "paid"
  | "preparing"
  | "shipped"
  | "cancelled"
  | "rejected";

export type PaymentStatus = "awaiting_payment" | "waiting_confirm" | "paid" | "rejected";

export type OrderCustomer = {
  studentCode: string;
  email: string;
  fullName: string;
  phone: string;
  school: string;
  parentPhone: string;
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
  storedPath?: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
};

export type Order = {
  id: string;
  sequenceNumber?: number;
  roundNumber?: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  luckyTicket: boolean;
  luckyTicketClaimedAt: string | null;
  createdAt: string;
  updatedAt: string;
  size: string;
  quantity: number;
  totalAmount: number;
  product: OrderProductSnapshot;
  customer: OrderCustomer;
  slip: OrderSlip | null;
};
