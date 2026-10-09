"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, inputClass } from "@/components/admin/ui";

export default function AdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        router.push("/admin/dashboard");
        router.refresh();
      } else {
        const data = (await res.json()) as { message?: string };
        setError(data.message ?? "เข้าสู่ระบบไม่สำเร็จ");
      }
    } catch {
      setError("เชื่อมต่อไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">SU STORE</p>
        <h1 className="mt-2 text-2xl font-bold text-zinc-900">เข้าสู่ระบบหลังร้าน</h1>
        <p className="mt-1 text-sm text-zinc-500">ใช้ชื่อผู้ใช้และรหัสผ่านเดียวกับจุดรับของ (claim station)</p>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <Field label="ชื่อผู้ใช้">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              required
              className={inputClass}
            />
          </Field>
          <Field label="รหัสผ่าน">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className={inputClass}
            />
          </Field>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
          </Button>
        </form>
        <p className="mt-6 text-xs text-zinc-400">ยังไม่มีบัญชี? ให้ผู้ดูแลระบบสร้างให้ที่หน้า admin เดิม (เมนู Users)</p>
      </div>
    </div>
  );
}
