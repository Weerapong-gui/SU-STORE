"use client";

import { useEffect, useState } from "react";
import { adminFetch } from "@/lib/adminApi";
import { Button, Card, Field, inputClass, useToast } from "@/components/admin/ui";
import type { StoreSettings } from "@/types/store";

export default function SettingsPage() {
  const toast = useToast();
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [form, setForm] = useState<StoreSettings | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    adminFetch<StoreSettings>("settings")
      .then((s) => {
        setSettings(s);
        setForm(s);
      })
      .catch((e: Error) => toast(e.message, "error"));
  }, [toast]);

  async function save(body: Partial<StoreSettings>, done: string) {
    setBusy(true);
    try {
      const saved = await adminFetch<StoreSettings>("settings", { method: "PUT", json: body });
      setSettings(saved);
      setForm((f) => (f ? { ...f, siteClosed: saved.siteClosed } : saved));
      toast(done);
      return saved;
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  if (!settings || !form) return <p className="text-sm text-zinc-500">กำลังโหลด...</p>;

  function toggleSite() {
    const closing = !settings!.siteClosed;
    const question = closing
      ? "ปิดหน้าร้าน? ลูกค้าจะเห็นหน้า \"ร้านปิดอยู่ตอนนี้\" ทุกหน้า (หลังร้านยังใช้ได้ตามปกติ)"
      : "เปิดหน้าร้านให้ลูกค้าเข้าได้?";
    if (window.confirm(question)) save({ siteClosed: closing }, closing ? "ปิดหน้าร้านแล้ว" : "เปิดหน้าร้านแล้ว");
  }

  const paymentDirty = JSON.stringify(form.payment) !== JSON.stringify(settings.payment);
  const setPayment = (patch: Partial<StoreSettings["payment"]>) => setForm({ ...form, payment: { ...form.payment, ...patch } });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">ตั้งค่าร้าน</h1>
        <p className="text-sm text-zinc-500">การเปลี่ยนแปลงมีผลกับหน้าร้านภายในไม่เกิน 15 วินาที ไม่ต้อง deploy</p>
      </div>

      <Card title="สถานะหน้าร้าน">
        <div className="flex flex-wrap items-center gap-4">
          <span
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold ${
              settings.siteClosed ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
            }`}
          >
            <span className={`h-2.5 w-2.5 rounded-full ${settings.siteClosed ? "bg-red-600" : "bg-emerald-600"}`} />
            {settings.siteClosed ? "ปิดอยู่ — ลูกค้าเห็นหน้าร้านปิด" : "เปิดอยู่ — ลูกค้าเข้าซื้อได้"}
          </span>
          <Button variant={settings.siteClosed ? "primary" : "danger"} disabled={busy} onClick={toggleSite}>
            {settings.siteClosed ? "เปิดหน้าร้าน" : "ปิดหน้าร้าน"}
          </Button>
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          ใช้ปิดทั้งเว็บชั่วคราว ถ้าต้องการหยุดขายแค่บางสินค้า ให้ตั้ง &quot;เวลาปิดขาย&quot; หรือเปลี่ยนสถานะในหน้าสินค้าแทน
        </p>
      </Card>

      <Card title="บัญชีรับเงิน" hint="แสดงในหน้าชำระเงินของลูกค้าทุกออเดอร์ ตรวจให้ถูกต้องก่อนบันทึก">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="ธนาคาร">
            <input className={inputClass} value={form.payment.bankName} onChange={(e) => setPayment({ bankName: e.target.value })} />
          </Field>
          <Field label="เลขบัญชี" hint="ใส่ขีดได้ ลูกค้ากดคัดลอกจะได้เฉพาะตัวเลข">
            <input className={inputClass} inputMode="numeric" value={form.payment.accountNumber} onChange={(e) => setPayment({ accountNumber: e.target.value })} />
          </Field>
          <Field label="ชื่อบัญชี">
            <input className={inputClass} value={form.payment.accountName} onChange={(e) => setPayment({ accountName: e.target.value })} placeholder="เช่น องค์การนักศึกษา มฟล." />
          </Field>
        </div>
        <Button
          className="mt-4"
          disabled={busy || !paymentDirty}
          onClick={() => window.confirm(`ยืนยันบัญชีรับเงิน\n${form.payment.bankName} ${form.payment.accountNumber}\n${form.payment.accountName}`) && save({ payment: form.payment }, "บันทึกบัญชีรับเงินแล้ว")}
        >
          บันทึกบัญชีรับเงิน
        </Button>
      </Card>

      <Card title="ข้อความประกาศ" hint="แถบข้อความบนสุดของหน้าร้าน เช่น วัน-เวลารับสินค้า · เว้นว่าง = ไม่แสดง">
        <textarea
          className={`${inputClass} min-h-20`}
          maxLength={300}
          value={form.announcement}
          onChange={(e) => setForm({ ...form, announcement: e.target.value })}
          placeholder="เช่น รับสินค้าได้ 20–22 ต.ค. เวลา 10:00–16:00 ที่ห้ององค์การนักศึกษา"
        />
        <Button
          className="mt-3"
          variant="secondary"
          disabled={busy || form.announcement === settings.announcement}
          onClick={() => save({ announcement: form.announcement }, form.announcement.trim() ? "บันทึกประกาศแล้ว" : "ซ่อนประกาศแล้ว")}
        >
          บันทึกประกาศ
        </Button>
      </Card>
    </div>
  );
}
