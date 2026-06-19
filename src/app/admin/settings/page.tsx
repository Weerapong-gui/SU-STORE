"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminNav } from "@/components/admin/AdminNav";

type SiteSettings = {
  siteClosed: boolean;
  scheduleEnabled: boolean;
  scheduleWarningMessage: string;
  announcementText: string;
  announcementEnabled: boolean;
};

export default function AdminSettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/site-settings")
      .then(async (res) => {
        if (res.status === 401) { router.push("/admin/login"); return; }
        setSettings(await res.json() as SiteSettings);
      });
  }, [router]);

  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/site-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } else {
        const data = await res.json() as { message?: string };
        setError(data.message ?? "Save failed");
      }
    } finally {
      setSaving(false);
    }
  }

  function update(patch: Partial<SiteSettings>) {
    setSettings((prev) => prev ? { ...prev, ...patch } : prev);
  }

  return (
    <div className="min-h-screen">
      <AdminNav />
      <div className="mx-auto max-w-2xl px-4 py-6">
        <h1 className="mb-6 text-xl font-bold text-zinc-900">Settings</h1>

        {!settings ? (
          <p className="text-zinc-400">Loading...</p>
        ) : (
          <div className="space-y-4">
            <div className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Store Status</p>

              <label className="flex items-center justify-between">
                <span className="text-sm font-medium text-zinc-900">Close store (force closed)</span>
                <button
                  onClick={() => update({ siteClosed: !settings.siteClosed })}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${settings.siteClosed ? "bg-red-500" : "bg-zinc-200"}`}
                >
                  <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition ${settings.siteClosed ? "translate-x-6" : "translate-x-1"}`} />
                </button>
              </label>

              <label className="flex items-center justify-between">
                <span className="text-sm font-medium text-zinc-900">Enable schedule (6:00–23:00)</span>
                <button
                  onClick={() => update({ scheduleEnabled: !settings.scheduleEnabled })}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${settings.scheduleEnabled ? "bg-zinc-900" : "bg-zinc-200"}`}
                >
                  <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition ${settings.scheduleEnabled ? "translate-x-6" : "translate-x-1"}`} />
                </button>
              </label>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Warning Message</p>
              <textarea
                value={settings.scheduleWarningMessage}
                onChange={(e) => update({ scheduleWarningMessage: e.target.value })}
                rows={2}
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-zinc-400"
              />
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Announcement</p>
              <label className="flex items-center justify-between">
                <span className="text-sm font-medium text-zinc-900">Show announcement banner</span>
                <button
                  onClick={() => update({ announcementEnabled: !settings.announcementEnabled })}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${settings.announcementEnabled ? "bg-zinc-900" : "bg-zinc-200"}`}
                >
                  <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition ${settings.announcementEnabled ? "translate-x-6" : "translate-x-1"}`} />
                </button>
              </label>
              <textarea
                value={settings.announcementText}
                onChange={(e) => update({ announcementText: e.target.value })}
                rows={3}
                placeholder="Announcement text..."
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-zinc-400"
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full rounded-xl bg-zinc-900 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {saved ? "Saved!" : saving ? "Saving..." : "Save Settings"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
