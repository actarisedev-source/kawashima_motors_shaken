import {
  loanerCategoryLabels,
  type LoanerCategory,
} from "@/lib/loaners/loaner-vehicle";

const categoryStyles: Record<LoanerCategory, string> = {
  rental: "bg-red-500",
  owned: "bg-amber-400",
  sales: "bg-blue-500",
};

export function LoanerCategoryDot({
  category,
  className = "h-2.5 w-2.5",
}: {
  category: LoanerCategory;
  className?: string;
}) {
  return (
    <span
      className={`${className} shrink-0 rounded-full ${categoryStyles[category]}`}
      aria-hidden="true"
    />
  );
}

export function LoanerCategoryBadge({
  category,
}: {
  category: LoanerCategory;
}) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap text-sm font-semibold text-slate-700">
      <LoanerCategoryDot category={category} />
      {loanerCategoryLabels[category]}
    </span>
  );
}
