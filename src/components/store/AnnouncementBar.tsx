// Staff-written notice from /admin/settings, shown above every storefront page.
export function AnnouncementBar({ text }: { text?: string }) {
  if (!text?.trim()) return null;
  return (
    <div className="bg-apple-blue px-4 py-2.5 text-center text-sm font-medium text-white" role="status">
      {text.trim()}
    </div>
  );
}
