import Link from "next/link";

export function LoanerAdminTabs({ active }: { active: "vehicles" | "history" }) {
  return (
    <nav
      aria-label="代車管理メニュー"
      className="flex w-fit rounded-md border border-slate-200 bg-white p-1 shadow-sm"
    >
      <Link
        href="/admin/loaners"
        aria-current={active === "vehicles" ? "page" : undefined}
        className={`rounded px-4 py-2 text-sm font-semibold transition ${
          active === "vehicles"
            ? "bg-blue-600 text-white"
            : "text-slate-600 hover:bg-slate-50 hover:text-blue-700"
        }`}
      >
        代車一覧
      </Link>
      <Link
        href="/admin/loaners/history"
        aria-current={active === "history" ? "page" : undefined}
        className={`rounded px-4 py-2 text-sm font-semibold transition ${
          active === "history"
            ? "bg-blue-600 text-white"
            : "text-slate-600 hover:bg-slate-50 hover:text-blue-700"
        }`}
      >
        貸出履歴
      </Link>
    </nav>
  );
}
