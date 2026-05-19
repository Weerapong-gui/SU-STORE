import { Product } from "@/types/product";

export const products: Product[] = [
  {
    slug: "single-shirt",
    name: "FRESHER POLO SHIRT",
    shortName: "เสื้อเดี่ยว",
    tagline: "FRESHER PACKAGE 28TH",
    description: "FRESHER PACKAGE 28TH",
    price: 399,
    images: [
      "/images/POLP_post/Artboard 4.png",
      "/images/POLP_post/Artboard 1.png",
      "/images/POLP_post/Artboard 2.png",
      "/images/POLP_post/Artboard 3.png",
    ],
    imageSize: { width: 1015, height: 1350 },
    sizeSurcharge: { sizes: ["2XL", "3XL", "4XL", "5XL", "6XL", "7XL"], amount: 20 },
    category: "single",
    requiresSize: true,
    requiresSchool: true,
    fabricNote: "ใช้เนื้อผ้า Micro Fresh Star หรือผ้าดาวกระจาย"
  },
  {
    slug: "fresh-jacket",
    name: "FRESHER JACKET",
    shortName: "แจ็คเก็ต",
    tagline: "FRESHER PACKAGE 28TH",
    description: "FRESHER PACKAGE 28TH",
    price: 739,
    images: ["/Jacket/B.png"],
    imageSize: { width: 1000, height: 1000 },
    colors: [
      { name: "Blue",  hex: "#0d0f40", image: "/Jacket/B.png" },
      { name: "Red",   hex: "#9d1c1f", image: "/Jacket/R.png" },
      { name: "White", hex: "#f7f9fc", image: "/Jacket/w.png" },
    ],
    sizeSurcharge: { sizes: ["2XL", "3XL", "4XL", "5XL", "6XL", "7XL"], amount: 20 },
    category: "jacket",
    requiresSize: true,
    requiresSchool: true,
    fabricNote: "ใช้ผ้าทัสลาน เบา กันลม กันละอองน้ำ"
  },
  {
    slug: "fresh-headband",
    name: "FRESHER HEADBAND",
    shortName: "ผ้าคาดสำนักวิชา",
    tagline: "FRESHER PACKAGE 28TH",
    description: "FRESHER PACKAGE 28TH",
    price: 35,
    images: ["/images/handband.png"],
    imageSize: { width: 1920, height: 1080 },
    category: "headband",
    requiresSize: false,
    requiresSchool: true
  }
];

export function getProductBySlug(slug: string) {
  return products.find((product) => product.slug === slug);
}
