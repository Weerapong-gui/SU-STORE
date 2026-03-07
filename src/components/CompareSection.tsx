import Link from "next/link";
import { products } from "@/data/products";
import { formatPrice } from "@/lib/formatPrice";
import { Container } from "@/components/ui/Container";
import { SectionTitle } from "@/components/ui/SectionTitle";

export function CompareSection() {
  const [single, set] = products;

  return (
    <section className="bg-white py-24 md:py-32">
      <Container>
        <SectionTitle
          align="center"
          title="Compare Your Style"
          subtitle="เลือกแบบที่ใช่จากตารางเปรียบเทียบแบบเรียบง่าย"
        />

        <div className="mt-14 overflow-hidden rounded-3xl border border-zinc-200 shadow-soft">
          <table className="w-full bg-white text-left">
            <thead className="bg-zinc-50 text-sm text-zinc-600">
              <tr>
                <th className="px-6 py-4 font-medium">Feature</th>
                <th className="px-6 py-4 font-medium">{single.name}</th>
                <th className="px-6 py-4 font-medium">{set.name}</th>
              </tr>
            </thead>
            <tbody className="text-sm md:text-base">
              <tr className="border-t border-zinc-100">
                <td className="px-6 py-4 text-zinc-500">Price</td>
                <td className="px-6 py-4">{formatPrice(single.price)}</td>
                <td className="px-6 py-4">{formatPrice(set.price)}</td>
              </tr>
              <tr className="border-t border-zinc-100">
                <td className="px-6 py-4 text-zinc-500">เหมาะกับ</td>
                <td className="px-6 py-4">ลุคเรียบง่ายทุกวัน</td>
                <td className="px-6 py-4">ลุคครบชุดพร้อมออกจากบ้าน</td>
              </tr>
              <tr className="border-t border-zinc-100">
                <td className="px-6 py-4 text-zinc-500">Style Focus</td>
                <td className="px-6 py-4">Minimal Essential</td>
                <td className="px-6 py-4">Complete Statement</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-5">
          <Link
            href={`/products/${single.slug}`}
            className="text-sm font-medium text-zinc-800 underline-offset-4 hover:underline"
          >
            ดูรายละเอียด {single.shortName}
          </Link>
          <Link
            href={`/products/${set.slug}`}
            className="text-sm font-medium text-zinc-800 underline-offset-4 hover:underline"
          >
            ดูรายละเอียด {set.shortName}
          </Link>
        </div>
      </Container>
    </section>
  );
}
