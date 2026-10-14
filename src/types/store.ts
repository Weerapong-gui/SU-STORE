// Shapes returned by the order-api `/v2` routes (server/store/db.py).

export type StoreCategory = {
  id: number;
  slug: string;
  name: string;
  nameEn: string;
  tagline: string;
  taglineEn: string;
  coverImage: string;
  visible: boolean;
  sortOrder: number;
  productCount: number;
};

export type StoreVariant = {
  designCode: string;
  designName: string;
  designNameEn: string;
  image: string;
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
  nameEn: string;
  categoryId: number | null;
  optionKind: "options" | "designs";
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
  productNameEn: string | null;
  variantLabel: string;
  variantLabelEn: string | null;
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
  receiptWarning?: boolean; // list endpoint only
  slipCheck?: { status: string; amount: number | null; raw_reason: string | null; duplicate_of: string | null } | null;
};

export type StoreMeta = {
  buyerFields: { key: string; label: string; alwaysRequired: boolean }[];
  orderStatuses: { key: OrderStatus; label: string }[];
  productStatuses: { key: ProductStatus; label: string }[];
  payment?: PaymentAccount;
  announcement?: string;
  accent?: string;
  radius?: number;
  font?: string;
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

// radius: this block's corners (0-100); absent = follow the store-wide setting.
type BlockBase = { id: string; hidden: boolean; radius?: number };
export type HomeBlock =
  | (BlockBase & { type: "categories"; title: string; categoryIds: number[]; categories?: StoreCategory[] })
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

export type HomeLayout = { accent: string; radius: number; font: string; blocks: HomeBlock[] };

// What the storefront renders: hidden/empty blocks dropped, featured products filled in.
export type ResolvedHome = HomeLayout & { products: StoreProduct[] };

export type HomeAdminState = {
  draft: HomeLayout;
  published: HomeLayout;
  dirty: boolean;
  publishedAt: string | null;
};

export type ReceiptField = { x: number; y: number; size: number; anchor: "start" | "middle" | "end" };
export type ReceiptColumn = { x: number; width: number; anchor: "start" | "middle" | "end" };
export type ReceiptLayout = {
  rightCopyOffset: number;
  fields: Record<"date" | "receiptNo" | "customer" | "studentId" | "school" | "subtotal" | "total" | "words" | "payeeName" | "pageNo", ReceiptField>;
  signature: { x: number; y: number; width: number };
  table: {
    firstY: number;
    rowSpacing: number;
    size: number;
    bottomY: number;
    cols: Record<"no" | "name" | "qty" | "price" | "amount", ReceiptColumn>;
  };
};
export type ReceiptSnapshot = {
  receiptNo: string;
  issuedAt: string;
  customer: { name: string; studentCode: string; school: string };
  lines: { no: number; name: string; quantity: number; unitPrice: number; amount: number }[];
  total: number;
  totalText: string;
  payeeName: string;
  signatureUrl: string;
};
export type StoreReceipt = {
  id: number;
  receiptNo: string;
  orderCode: string;
  issuedAt: string;
  issuedBy: string;
  snapshot: ReceiptSnapshot;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
};
export type ReceiptSettings = {
  payeeName: string;
  signatureUrl: string;
  prefix: string;
  layout: ReceiptLayout;
  nextReceiptNo?: string;
};
export type ReceiptPage = {
  rows: { line: ReceiptSnapshot["lines"][number]; nameLines: string[] }[];
  pageNo: number;
  pageCount: number;
  isLast: boolean;
};
