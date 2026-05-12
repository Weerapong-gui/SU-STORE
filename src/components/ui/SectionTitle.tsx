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
      {subtitle ? (
        <p className={`mb-3 text-xs font-semibold tracking-[0.16em] ${subtitleColorClass}`}>
          {subtitle.toUpperCase()}
        </p>
      ) : null}
      <h2 className={`text-5xl font-bold tracking-tight md:text-6xl ${titleColorClass}`}>
        {title}
      </h2>
    </div>
  );
}
