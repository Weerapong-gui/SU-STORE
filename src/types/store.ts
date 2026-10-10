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
export type SaleState = "open" | "upcoming" | "ended";

export type StoreProduct = {
  id: number;
  slug: string;
  name: string;
  description: string;
  images: string[];
  status: ProductStatus;
  buyerFields: string[];
  sortOrder: number;
  saleStartsAt: string | null;
  saleEndsAt: string | null;
  saleState: SaleState;
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
  payment?: PaymentAccount;
  announcement?: string;
  accent?: string;
};

export type PaymentAccount = { bankName: string; accountNumber: string; accountName: string };

export type StoreSettings = { payment: PaymentAccount; announcement: string; siteClosed: boolean };

export type Dashboard = {
  paidAmount: number;
  awaitingAmount: number;
  orderCount: number;
  statusCounts: Record<OrderStatus, number>;
  byDay: { date: string; paidAmount: number; orders: number }[];
  byVariant: { productName: string; variantLabel: string; paidQuantity: number; unpaidQuantity: number; paidAmount: number }[];
};

export type HeroSlide = {
  image: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  buttonText: string;
  buttonHref: string;
};

type BlockBase = { id: string; hidden: boolean };
export type HomeBlock =
  | (BlockBase & { type: "hero"; autoplay: boolean; slides: HeroSlide[] })
  | (BlockBase & { type: "featured"; title: string; productIds: number[]; products?: StoreProduct[] })
  | (BlockBase & { type: "text"; title: string; body: string; align: "left" | "center" })
  | (BlockBase & {
      type: "imageText";
      image: string;
      title: string;
      body: string;
      buttonText: string;
      buttonHref: string;
      imageSide: "left" | "right";
    })
  | (BlockBase & { type: "allProducts"; title: string });

export type HomeBlockType = HomeBlock["type"];

export type HomeLayout = { accent: string; blocks: HomeBlock[] };

// What the storefront renders: hidden/empty blocks dropped, featured products filled in.
export type ResolvedHome = HomeLayout & { products: StoreProduct[] };

export type HomeAdminState = {
  draft: HomeLayout;
  published: HomeLayout;
  dirty: boolean;
  publishedAt: string | null;
};
