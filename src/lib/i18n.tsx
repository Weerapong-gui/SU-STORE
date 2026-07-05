"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "en" | "th";

export const translations = {
  en: {
    status: {
      pending_payment: { label: "Awaiting Payment",      description: "Please transfer and upload your slip" },
      waiting_confirm: { label: "Awaiting Confirmation", description: "Our team is verifying your transfer" },
      paid:            { label: "Paid",                  description: "Payment confirmed" },
      preparing:       { label: "Preparing",             description: "Your order is being prepared" },
      shipped:         { label: "Ready for Pickup",      description: "Your order is ready. Show this QR at the pickup point." },
      received:        { label: "Received",              description: "You have collected your order. Thank you!" },
      cancelled:       { label: "Cancelled",             description: "This order has been cancelled" },
      rejected:        { label: "Rejected",              description: "Payment not confirmed. Please contact us" },
      refund:          { label: "Refund Pending",        description: "This product is unavailable. Full refund will be processed by the Student Union." },
      refunded:        { label: "Refunded",              description: "Refund has been completed." },
    },
    checkOrder: {
      title: "Track Your Order",
      subtitle: "Enter your Student ID to check your order status",
      orderNumber: "ORDER NUMBER",
      noOrders: "No orders found",
      noOrdersHint: "Please check your Student ID and try again",
      total: "Total",
      uploadSlip: "Upload Payment Slip",
      errorGeneric: "Something went wrong",
      searching: "Searching...",
      search: "Search",
      khantokReceived: "Khantok ticket received",
      khantokClaimed: "Already claimed",
      pickupQrHint: "Show this QR at the pickup point",
    },
    orderAccess: {
      notFound: (id: string) => `Order ${id} was not found`,
      hint: "This link can only be opened from the device and browser where the order was placed, or the order may predate the latest system update.",
    },
    slip: {
      fileHint: "Supports JPG, PNG, WEBP or PDF up to 5 MB",
      errorUpload: "Unable to upload slip at this time",
      errorConnection: "Unable to connect to the upload service",
      uploading: "UPLOADING...",
      replace: "REPLACE SLIP",
      submit: "SUBMIT SLIP FOR REVIEW",
      sent: "Your slip has been submitted. Waiting for admin confirmation.",
    },
    surcharge: {
      message: (amount: number) => `An extra ฿${amount} applies for size 2XL and above`,
    },
    schedule: {
      defaultWarning: "The website is closing soon. Please complete your order before 22:59",
      closingIn: (mins: number, secs: string) => `Closing in ${mins} min ${secs} sec`,
    },
    product: {
      outOfStock: "Out of Stock / Unavailable",

      surchargeNote: (amount: number, size: string) => `+฿${amount} for size ${size}`,
    },
    products: {
      "single-shirt": {
        shortName: "Individual Shirt",
        description: "FRESHER PACKAGE 28TH",
      },
      "fresh-jacket": {
        shortName: "Jacket",
        description: "FRESHER PACKAGE 28TH",
      },
      "fresh-headband": {
        shortName: "Headband",
        description: "FRESHER PACKAGE 28TH",
      },
    } as Record<string, { shortName: string; description: string }>,
    productsPage: {
      closed: "Orders Closed",
      closedThankYou: "Thank you for ordering Fresher Package 28th",
      closedHint: "If you already have an order, you can check its status below",
      checkOrderLink: "Check My Order",
    },
    configurePage: {
      productClosed: "Not Available",
      productClosedMessage: "This product is not currently available for purchase. Please check back later.",
      viewOtherProducts: "View other products",
    },
    paymentPage: {
      storeClosed: "Store Closed",
      storeClosedMessage: "Orders are not currently being accepted. Please contact admin if you have questions about this order.",
    },
    payment: {
      bankName: "Bangkok Bank",
    },
    feedback: {
      title: "Feedback",
      question: "How are you feeling?",
      subtitle: "Your input helps us improve our service.",
      ratingLabels: ["Very Bad", "Bad", "Medium", "Good", "Very Good"] as [string, string, string, string, string],
      commentPlaceholder: "Add a Comment...",
      submit: "Submit Now",
      submitting: "Submitting...",
      thanks: "Thank you!",
      thanksSub: "Your feedback has been recorded.",
      errorGeneric: "Unable to submit feedback. Please try again.",
    },
  },
  th: {
    status: {
      pending_payment: { label: "รอชำระเงิน",      description: "กรุณาชำระเงินและแนบสลิป" },
      waiting_confirm: { label: "รอยืนยันการชำระ", description: "ทีมงานกำลังตรวจสอบสลิปการโอน" },
      paid:            { label: "ชำระเงินแล้ว",    description: "ยืนยันการชำระเงินเรียบร้อย" },
      preparing:       { label: "กำลังเตรียมของ",  description: "กำลังเตรียมสินค้าของคุณ" },
      shipped:         { label: "พร้อมรับสินค้า",  description: "ออเดอร์ของคุณพร้อมแล้ว โปรดแสดง QR นี้ที่จุดรับสินค้า" },
      received:        { label: "รับสินค้าแล้ว",   description: "รับสินค้าเรียบร้อยแล้ว" },
      cancelled:       { label: "ยกเลิก",          description: "ออเดอร์ถูกยกเลิก" },
      rejected:        { label: "ปฏิเสธ",          description: "ไม่ผ่านการยืนยัน กรุณาติดต่อทีมงาน" },
      refund:          { label: "รอคืนเงิน",       description: "สินค้านี้ไม่สามารถจำหน่ายได้ องค์การบริหารองค์การนักศึกษาจะคืนเงินให้เต็มจำนวน" },
      refunded:        { label: "คืนเงินแล้ว",    description: "ดำเนินการคืนเงินเรียบร้อยแล้ว" },
    },
    checkOrder: {
      title: "เช็คสถานะออเดอร์",
      subtitle: "กรอกรหัสนักศึกษาเพื่อดูสถานะออเดอร์",
      orderNumber: "เลขออเดอร์",
      noOrders: "ไม่พบออเดอร์",
      noOrdersHint: "ลองตรวจสอบรหัสนักศึกษาอีกครั้ง",
      total: "รวม",
      uploadSlip: "อัปโหลดสลิปการโอนเงิน",
      errorGeneric: "เกิดข้อผิดพลาด",
      searching: "กำลังค้นหา...",
      search: "ค้นหา",
      khantokReceived: "ได้รับ Khantok ticket",
      khantokClaimed: "รับไปแล้ว",
      pickupQrHint: "แสดง QR นี้ที่จุดรับสินค้า",
    },
    orderAccess: {
      notFound: (id: string) => `ไม่พบข้อมูลคำสั่งซื้อ ${id} ใน browser นี้`,
      hint: "ลิงก์ออเดอร์จะเปิดได้จากอุปกรณ์และ browser ที่สร้างออเดอร์ไว้เท่านั้น หรืออาจเป็นออเดอร์เก่าก่อนอัปเดตระบบล่าสุด",
    },
    slip: {
      fileHint: "รองรับไฟล์ JPG, PNG, WEBP หรือ PDF ขนาดไม่เกิน 5 MB",
      errorUpload: "ไม่สามารถอัปโหลดสลิปได้ในขณะนี้",
      errorConnection: "ไม่สามารถเชื่อมต่อกับระบบอัปโหลดสลิปได้ในขณะนี้",
      uploading: "UPLOADING...",
      replace: "REPLACE SLIP",
      submit: "SUBMIT SLIP FOR REVIEW",
      sent: "สลิปของคุณถูกส่งแล้ว กำลังรอ admin ยืนยัน",
    },
    surcharge: {
      message: (amount: number) => `สำหรับเสื้อไซส์ 2XL ขึ้นไป มีค่าใช้จ่ายเพิ่ม ${amount} บาท`,
    },
    schedule: {
      defaultWarning: "เว็บกำลังจะปิด กรุณาทำรายการให้เสร็จก่อนเวลา 22:59",
      closingIn: (mins: number, secs: string) => `ปิดใน ${mins} นาที ${secs} วินาที`,
    },
    product: {
      outOfStock: "หมดแล้ว / ไม่พร้อมจำหน่าย",

      surchargeNote: (amount: number, size: string) => `+${amount} บาท สำหรับไซซ์ ${size}`,
    },
    products: {
      "single-shirt": {
        shortName: "เสื้อเดี่ยว",
        description: "FRESHER PACKAGE 28TH",
      },
      "fresh-jacket": {
        shortName: "แจ็คเก็ต",
        description: "FRESHER PACKAGE 28TH",
      },
      "fresh-headband": {
        shortName: "ผ้าคาดสำนักวิชา",
        description: "FRESHER PACKAGE 28TH",
      },
    } as Record<string, { shortName: string; description: string }>,
    productsPage: {
      closed: "ปิดรับออเดอร์แล้ว",
      closedThankYou: "ขอบคุณทุกคนที่สั่งซื้อสินค้า Fresher Package 28th",
      closedHint: "หากมีออเดอร์อยู่แล้ว สามารถตรวจสอบสถานะได้ที่",
      checkOrderLink: "ตรวจสอบออเดอร์",
    },
    configurePage: {
      productClosed: "ปิดรับสั่งซื้อ",
      productClosedMessage: "ขณะนี้ยังไม่เปิดรับคำสั่งซื้อสินค้านี้ กรุณากลับมาใหม่ในภายหลัง",
      viewOtherProducts: "ดูสินค้าอื่น",
    },
    paymentPage: {
      storeClosed: "ปิดรับสั่งซื้อ",
      storeClosedMessage: "ขณะนี้ไม่รับคำสั่งซื้อ กรุณาติดต่อแอดมินหากมีคำถามเกี่ยวกับออเดอร์นี้",
    },
    payment: {
      bankName: "ธนาคารกรุงเทพ",
    },
    feedback: {
      title: "Feedback",
      question: "คุณรู้สึกอย่างไร?",
      subtitle: "ความคิดเห็นของคุณช่วยให้เราพัฒนาบริการดีขึ้น",
      ratingLabels: ["แย่มาก", "แย่", "เฉยๆ", "ดี", "ดีมาก"] as [string, string, string, string, string],
      commentPlaceholder: "เพิ่มความคิดเห็น...",
      submit: "ส่งความคิดเห็น",
      submitting: "กำลังส่ง...",
      thanks: "ขอบคุณ!",
      thanksSub: "บันทึกความคิดเห็นของคุณเรียบร้อยแล้ว",
      errorGeneric: "ไม่สามารถส่งความคิดเห็นได้ กรุณาลองใหม่",
    },
  },
} as const;

type Translations = typeof translations;

type LanguageContextType = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: Translations[Lang];
};

const LanguageContext = createContext<LanguageContextType>({
  lang: "en",
  setLang: () => {},
  t: translations.en,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    const stored = localStorage.getItem("su-store-lang") as Lang | null;
    if (stored === "en" || stored === "th") setLangState(stored);
  }, []);

  function setLang(l: Lang) {
    setLangState(l);
    localStorage.setItem("su-store-lang", l);
  }

  return (
    <LanguageContext.Provider value={{ lang, setLang, t: translations[lang] }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLang() {
  return useContext(LanguageContext);
}
