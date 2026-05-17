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
      shipped:         { label: "Ready for Pickup",      description: "Your order is ready" },
      cancelled:       { label: "Cancelled",             description: "This order has been cancelled" },
      rejected:        { label: "Rejected",              description: "Payment not confirmed. Please contact us" },
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
      selectSchool: "Select school...",
      surchargeNote: (amount: number, size: string) => `+฿${amount} for size ${size}`,
    },
  },
  th: {
    status: {
      pending_payment: { label: "รอชำระเงิน",      description: "กรุณาชำระเงินและแนบสลิป" },
      waiting_confirm: { label: "รอยืนยันการชำระ", description: "ทีมงานกำลังตรวจสอบสลิปการโอน" },
      paid:            { label: "ชำระเงินแล้ว",    description: "ยืนยันการชำระเงินเรียบร้อย" },
      preparing:       { label: "กำลังเตรียมของ",  description: "กำลังเตรียมสินค้าของคุณ" },
      shipped:         { label: "พร้อมรับสินค้า",  description: "สินค้าพร้อมแล้ว" },
      cancelled:       { label: "ยกเลิก",          description: "ออเดอร์ถูกยกเลิก" },
      rejected:        { label: "ปฏิเสธ",          description: "ไม่ผ่านการยืนยัน กรุณาติดต่อทีมงาน" },
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
      selectSchool: "เลือกสำนักวิชา...",
      surchargeNote: (amount: number, size: string) => `+${amount} บาท สำหรับไซซ์ ${size}`,
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
