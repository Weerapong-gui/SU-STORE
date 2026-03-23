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
  const textAlignmentClass = align === "center" ? "text-center" : "text-left";
  const titleColorClass = light ? "text-white" : "text-ink";
  const subtitleColorClass = light ? "text-zinc-300" : "text-ink-soft";

  return (
    <div className={textAlignmentClass}>
      <h2 className={`text-4xl font-semibold tracking-tight md:text-6xl ${titleColorClass}`}>
        {title}
      </h2>
      {subtitle ? (
        <p className={`mt-4 text-lg md:text-2xl ${subtitleColorClass}`}>{subtitle}</p>
      ) : null}
    </div>
  );
}
