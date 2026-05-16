import { Product } from "@/types/product";

export const products: Product[] = [
  {
    slug: "single-shirt",
    name: "FRESHER POLO SHIRT",
    shortName: "เสื้อเดี่ยว",
    tagline: "Classic fresher polo for everyday campus wear.",
    description: "เสื้อเดี่ยวทรงเรียบ ใส่ง่าย และเป็นฐานหลักของคอลเลกชัน Fresher 28th.",
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
    requiresSchool: true
  },
  {
    slug: "fresh-jacket",
    name: "FRESHER JACKET",
    shortName: "แจ็กเก็ต",
    tagline: "Layer up with a clean campus-ready jacket.",
    description: "แจ็กเก็ตสำหรับวันกิจกรรมหรือวันที่อยากได้เลเยอร์เพิ่ม โดยใช้ flow เลือกไซซ์ จำนวน และสำนักวิชาเหมือนสินค้ากลุ่มเสื้อ.",
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
    requiresSchool: true
  },
  {
    slug: "fresh-headband",
    name: "FRESHER HEADBAND",
    shortName: "เฮดแบนด์",
    tagline: "A lightweight accessory for sports day and activity looks.",
    description: "เฮดแบนด์ที่ใช้ขนาดแบบ one size โดยเลือกจำนวนและสำนักวิชาได้ก่อนเพิ่มลง cart หรือไปชำระเงินต่อ.",
    price: 35,
    images: ["/images/Pr1.png", "/images/Pr1.png"],
    imageSize: { width: 1920, height: 1080 },
    category: "headband",
    requiresSize: false,
    requiresSchool: true
  }
];

export function getProductBySlug(slug: string) {
  return products.find((product) => product.slug === slug);
}
