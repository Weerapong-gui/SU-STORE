import { Product } from "@/types/product";

export const products: Product[] = [
  {
    slug: "single-shirt",
    name: "FRESHER POLO SHIRT",
    shortName: "เสื้อเดี่ยว",
    tagline: "เรียบง่าย แต่โดดเด่น",
    description: "เสื้อเดี่ยวทรงสวย ใส่สบาย เนื้อผ้านุ่มพรีเมียม ใส่ได้ทุกวัน",
    price: 390,
    images: ["/images/polo.png", "/images/polo.png"],
    category: "single",
    features: ["Premium cotton", "Soft touch", "Minimal fit"]
  },
  {
    slug: "set-shirt",
    name: "FRESHER BUNDLE",
    shortName: "ชุดเซต",
    tagline: "ครบลุคในชุดเดียว",
    description: "ชุดเซตที่ออกแบบให้เข้ากันอย่างลงตัว พร้อมใส่ พร้อมออกจากบ้านทันที",
    price: 790,
    images: ["/images/FRESHER BUNDLE.png", "/images/FRESHER BUNDLE.png"],
    category: "bundle",
    features: ["Complete look", "Premium fabric", "Easy matching"]
  }
];

export function getProductBySlug(slug: string) {
  return products.find((product) => product.slug === slug);
}
