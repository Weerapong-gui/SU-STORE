// Shapes returned by the order-api `/v2` routes (server/store/db.py).

export type StoreVariant = {
  id: number;
  size: string;
  color: string;
  label: string;
  price: number;
  stock: number | null;
  sku: string;
  active: boolean;
  soldOut: boolean;
};

export type ProductStatus = "draft" | "active" | "archived";

export type StoreProduct = {
  id: number;
  slug: string;
  name: string;
  description: string;
  images: string[];
  status: ProductStatus;
  buyerFields: string[];
  sortOrder: number;
  minPrice: number | null;
  maxPrice: number | null;
  soldOut: boolean;
  variants: StoreVariant[];
  createdAt: string;
  updatedAt: string;
};

export type OrderStatus = "pending_payment" | "waiting_confirm" | "paid" | "ready" | "completed" | "cancelled";

export type StoreOrderItem = {
  variantId: number;
  productId: number;
  productName: string;
  variantLabel: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
};

export type StoreOrder = {
  orderCode: string;
  status: OrderStatus;
  statusLabel: string;
  customer: Record<string, string>;
  totalAmount: number;
  items: StoreOrderItem[];
  hasSlip: boolean;
  slipUploadedAt: string | null;
  adminNote: string;
  createdAt: string;
  updatedAt: string;
  accessToken?: string;
  slipCheck?: { status: string; amount: number | null; raw_reason: string | null; duplicate_of: string | null } | null;
};

export type StoreMeta = {
  buyerFields: { key: string; label: string; alwaysRequired: boolean }[];
  orderStatuses: { key: OrderStatus; label: string }[];
  productStatuses: { key: ProductStatus; label: string }[];
};
