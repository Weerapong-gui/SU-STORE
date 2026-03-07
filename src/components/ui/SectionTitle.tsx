type SectionTitleProps = {
  title: string;
  subtitle?: string;
  align?: "left" | "center";
  light?: boolean;
};

export function SectionTitle({
  title,
  subtitle,
  align = "left",
  light = false
}: SectionTitleProps) {
  const alignment = align === "center" ? "text-center" : "text-left";
  const titleColor = light ? "text-white" : "text-ink";
  const subtitleColor = light ? "text-zinc-300" : "text-ink-soft";

  return (
    <div className={alignment}>
      <h2 className={`text-4xl font-semibold tracking-tight md:text-6xl ${titleColor}`}>
        {title}
      </h2>
      {subtitle ? (
        <p className={`mt-4 text-lg md:text-2xl ${subtitleColor}`}>{subtitle}</p>
      ) : null}
    </div>
  );
}
