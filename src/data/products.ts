import { Product } from "@/types/product";

export const products: Product[] = [
  {
    slug: "single-shirt",
    name: "FRESHER POLO SHIRT",
    shortName: "เสื้อเดี่ยว",
    tagline: "Classic fresher polo for everyday campus wear.",
    description: "เสื้อเดี่ยวทรงเรียบ ใส่ง่าย และเป็นฐานหลักของคอลเลกชัน Fresher 28th.",
    price: 399,
    images: ["/images/polo.png", "/images/polo.png"],
    category: "single",
    requiresSize: true,
    requiresSchool: true
  },
  {
    slug: "set-shirt",
    name: "FRESHER BUNDLE",
    shortName: "ชุดเซต",
    tagline: "A fuller set for students who want the complete look.",
    description: "ชุดเซตสำหรับคนที่อยากได้ลุคครบในคำสั่งซื้อเดียว พร้อมเลือกไซซ์และสำนักวิชาได้เหมือนกลุ่มเสื้อ.",
    price: 799,
    images: ["/images/FRESHER BUNDLE.png", "/images/FRESHER BUNDLE.png"],
    category: "bundle",
    requiresSize: true,
    requiresSchool: true
  },
  {
    slug: "fresh-jacket",
    name: "FRESHER JACKET",
    shortName: "แจ็กเก็ต",
    tagline: "Layer up with a clean campus-ready jacket.",
    description: "แจ็กเก็ตสำหรับวันกิจกรรมหรือวันที่อยากได้เลเยอร์เพิ่ม โดยใช้ flow เลือกไซซ์ จำนวน และสำนักวิชาเหมือนสินค้ากลุ่มเสื้อ.",
    price: 899,
    images: ["/images/Pr1.png", "/images/Pr1.png"],
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
    category: "headband",
    requiresSize: false,
    requiresSchool: true
  }
];

export function getProductBySlug(slug: string) {
  return products.find((product) => product.slug === slug);
}
