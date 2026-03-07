import { Container } from "@/components/ui/Container";
import { SectionTitle } from "@/components/ui/SectionTitle";

const features = [
  {
    title: "เนื้อผ้านุ่ม",
    description: "Premium cotton ที่สัมผัสสบายตั้งแต่ครั้งแรกที่ใส่"
  },
  {
    title: "ทรงสวย",
    description: "ออกแบบทรงให้ดูสะอาด คม และแมตช์ง่าย"
  },
  {
    title: "ใส่สบาย",
    description: "เบา ระบายอากาศดี ใส่ได้ทั้งวันแบบไม่อึดอัด"
  },
  {
    title: "แมตช์ง่าย",
    description: "เข้ากับลุคประจำวันได้ทันที ทั้งเดี่ยวและชุดเซต"
  }
];

export function FeatureSection() {
  return (
    <section className="bg-mist py-24 md:py-32">
      <Container>
        <SectionTitle
          align="center"
          title="Designed for Daily Confidence"
          subtitle="โฟกัสสิ่งสำคัญที่คุณสัมผัสได้ทุกครั้งที่สวมใส่"
        />

        <div className="mt-14 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {features.map((feature) => (
            <article
              key={feature.title}
              className="rounded-3xl border border-zinc-200 bg-white p-7 shadow-soft"
            >
              <h3 className="text-2xl font-semibold tracking-tight text-ink">{feature.title}</h3>
              <p className="mt-3 text-zinc-600">{feature.description}</p>
            </article>
          ))}
        </div>
      </Container>
    </section>
  );
}
