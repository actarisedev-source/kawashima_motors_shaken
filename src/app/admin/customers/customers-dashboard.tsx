"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AdminHeader } from "../admin-header";
import { CustomerDetail } from "./[id]/customer-detail";

type CustomerItem = {
  id: string;
  name: string;
  phone: string;
  createdAt: string;
  vehicleCount: number;
  reservationCount: number;
  latestReservedAt: string | null;
  nearestShakenExpiryDate: string | null;
  shakenExpiryStatus: "expired" | "soon" | "active" | "unknown";
  shakenExpiryLabel: string;
};

type CustomerSummary = {
  total: number;
  gender: Record<"男性" | "女性" | "未設定", number>;
  ageGroup: Record<
    "10代" | "20代" | "30代" | "40代" | "50代" | "60代以上" | "未設定",
    number
  >;
};

type LoadState =
  | { status: "loading"; message: "読み込み中です。" }
  | { status: "ready"; message: "" }
  | { status: "error"; message: string };

const pageSize = 8;
const genderLabels = ["男性", "女性", "未設定"] as const;
const ageGroupLabels = [
  "10代",
  "20代",
  "30代",
  "40代",
  "50代",
  "60代以上",
  "未設定",
] as const;
const emptySummary: CustomerSummary = {
  total: 0,
  gender: { 男性: 0, 女性: 0, 未設定: 0 },
  ageGroup: {
    "10代": 0,
    "20代": 0,
    "30代": 0,
    "40代": 0,
    "50代": 0,
    "60代以上": 0,
    未設定: 0,
  },
};

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(new Date(value));

export function CustomersDashboard({
  initialCustomerId,
}: {
  initialCustomerId?: string;
}) {
  const [items, setItems] = useState<CustomerItem[]>([]);
  const [summary, setSummary] = useState<CustomerSummary>(emptySummary);
  const [selectedCustomerId, setSelectedCustomerId] = useState(
    initialCustomerId ?? "",
  );
  const [query, setQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [loadState, setLoadState] = useState<LoadState>({
    status: "loading",
    message: "読み込み中です。",
  });

  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const pagedItems = useMemo(
    () => items.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [currentPage, items],
  );

  const loadCustomers = useCallback(async (nextQuery?: string) => {
    setLoadState({ status: "loading", message: "読み込み中です。" });

    const trimmedQuery = nextQuery?.trim();
    const params = new URLSearchParams();

    if (trimmedQuery) {
      params.set("q", trimmedQuery);
    }

    const response = await fetch(
      `/api/admin/customers${params.size ? `?${params.toString()}` : ""}`,
      { cache: "no-store" },
    );
    const result = (await response.json()) as {
      ok: boolean;
      items?: CustomerItem[];
      summary?: CustomerSummary;
      message?: string;
    };

    if (!response.ok || !result.ok || !result.items) {
      setLoadState({
        status: "error",
        message: result.message ?? "顧客一覧の取得に失敗しました。",
      });
      return;
    }

    setItems(result.items);
    setSummary(result.summary ?? emptySummary);
    setCurrentPage(1);
    setSelectedCustomerId((current) => {
      if (current && result.items?.some((item) => item.id === current)) {
        return current;
      }

      return result.items?.[0]?.id ?? "";
    });
    setLoadState({ status: "ready", message: "" });
  }, []);

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadCustomers(query);
  }

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, pageCount));
  }, [pageCount]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <AdminHeader title="顧客管理" onRefresh={() => loadCustomers(query)} />
      <main className="relative mx-auto grid max-w-[1600px] gap-5 px-5 py-6 sm:px-6 lg:grid-cols-[390px_minmax(0,1fr)] lg:px-8">
        {loadState.status === "loading" ? (
          <div className="pointer-events-none absolute right-5 top-2 z-10 rounded-[5px] border border-blue-100 bg-white/95 px-3 py-1.5 text-xs font-semibold text-blue-700 shadow-sm sm:right-6 lg:right-8">
            読み込み中です。
          </div>
        ) : null}
        {loadState.status === "error" ? (
          <div
            className="rounded-[5px] border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 lg:col-span-2"
          >
            {loadState.message}
          </div>
        ) : null}

        <section className="w-full overflow-x-auto rounded-[5px] border border-blue-100 bg-white shadow-sm lg:col-span-2 lg:w-fit">
          <div className="grid min-w-[1060px] grid-cols-[190px_310px_560px]">
            <div className="flex flex-col bg-blue-50/60 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-[5px] border border-blue-100 bg-white text-blue-600">
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
                    <path d="M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8-1a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 20c0-4 2.5-6 6-6s6 2 6 6M14 14c4 0 7 1.5 7 5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
                  </svg>
                </span>
                <p className="text-[13px] font-semibold text-slate-700">
                  総顧客数
                </p>
              </div>
              <p className="mt-1 flex items-baseline self-center text-3xl font-bold leading-none text-blue-600">
                {summary.total}
                <span className="ml-1 text-[13px] font-semibold text-slate-600">
                  人
                </span>
              </p>
            </div>

            <div className="border-l border-blue-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-[5px] bg-blue-50 text-blue-600">
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
                    <circle cx="12" cy="7" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
                    <path d="M5 21c0-5 2.8-8 7-8s7 3 7 8" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
                  </svg>
                </span>
                <p className="text-[13px] font-semibold text-slate-700">
                  性別顧客数
                </p>
              </div>
              <div className="mt-1.5 grid grid-cols-3 divide-x divide-blue-100">
                {genderLabels.map((label) => (
                  <div key={label} className="px-2.5 first:pl-0 last:pr-0">
                    <p className="text-[13px] font-semibold text-slate-700">
                      {label}
                    </p>
                    <p className="mt-0.5 text-xl font-bold leading-none text-blue-600">
                      {summary.gender[label]}
                      <span className="ml-1 text-[13px] font-semibold text-slate-600">
                        人
                      </span>
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-l border-blue-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-[5px] bg-blue-50 text-blue-600">
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
                    <path d="M5 20v-6M12 20V9M19 20V4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4" />
                  </svg>
                </span>
                <p className="text-[13px] font-semibold text-slate-700">
                  年代別顧客数
                </p>
              </div>
              <div className="mt-1.5 grid grid-cols-7 divide-x divide-blue-100">
                {ageGroupLabels.map((label) => (
                  <div key={label} className="px-2 first:pl-0 last:pr-0">
                    <p className="whitespace-nowrap text-[13px] font-semibold text-slate-700">
                      {label}
                    </p>
                    <p className="mt-0.5 text-xl font-bold leading-none text-blue-600">
                      {summary.ageGroup[label]}
                      <span className="ml-1 text-[13px] font-semibold text-slate-600">
                        人
                      </span>
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <aside className="flex min-h-[calc(100vh-150px)] self-start flex-col overflow-hidden rounded-[5px] border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">顧客一覧</h2>
                <p className="mt-1 text-xs font-semibold text-slate-500">
                  全{items.length}件
                </p>
              </div>
              <Link
                href="/admin/customers/new"
                className="inline-flex h-10 items-center rounded-[5px] bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
              >
                ＋ 新規登録
              </Link>
            </div>
            <form onSubmit={handleSearch} className="mt-4 grid gap-3">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="顧客名・電話番号で検索"
                className="h-11 rounded-[5px] border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
              <button
                type="submit"
                className="h-11 rounded-[5px] bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
              >
                検索
              </button>
            </form>
          </div>

          <div className="flex-1 divide-y divide-slate-100 overflow-y-auto">
            {pagedItems.map((item) => {
              const selected = item.id === selectedCustomerId;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedCustomerId(item.id)}
                  className={[
                    "w-full px-5 py-4 text-left transition",
                    selected
                      ? "bg-blue-600 text-white"
                      : "bg-white text-slate-950 hover:bg-slate-50",
                  ].join(" ")}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">{item.name}</p>
                      <p
                        className={[
                          "mt-1 text-xs font-semibold",
                          selected ? "text-blue-100" : "text-slate-500",
                        ].join(" ")}
                      >
                        {item.phone || "電話番号未登録"}
                      </p>
                    </div>
                    <span
                      className={[
                        "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ring-1",
                        selected
                          ? "bg-white/15 text-white ring-white/20"
                          : "bg-slate-50 text-slate-600 ring-slate-200",
                      ].join(" ")}
                    >
                      {item.vehicleCount}台
                    </span>
                  </div>
                  <p
                    className={[
                      "mt-3 text-xs font-medium",
                      selected ? "text-blue-100" : "text-slate-500",
                    ].join(" ")}
                  >
                    登録日：{formatDate(item.createdAt)}
                  </p>
                </button>
              );
            })}

            {!pagedItems.length && loadState.status === "ready" ? (
              <div className="px-5 py-12 text-center text-sm text-slate-500">
                条件に一致する顧客はありません。
              </div>
            ) : null}
          </div>

          <div className="grid gap-3 border-t border-slate-200 p-5">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                disabled={currentPage <= 1}
                className="h-9 rounded-[5px] border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                前へ
              </button>
              <span className="text-sm font-semibold text-slate-500">
                {currentPage} / {pageCount}
              </span>
              <button
                type="button"
                onClick={() =>
                  setCurrentPage((page) => Math.min(pageCount, page + 1))
                }
                disabled={currentPage >= pageCount}
                className="h-9 rounded-[5px] border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                次へ
              </button>
            </div>
          </div>
        </aside>

        <section className="min-w-0">
          {selectedCustomerId ? (
            <CustomerDetail
              key={selectedCustomerId}
              customerId={selectedCustomerId}
              embedded
              onCustomerUpdated={() => loadCustomers(query)}
            />
          ) : (
            <div className="grid min-h-[520px] place-items-center rounded-[12px] border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
              <div>
                <h2 className="text-lg font-bold text-slate-950">
                  顧客を選択してください
                </h2>
                <p className="mt-2 text-sm text-slate-500">
                  左の一覧から顧客を選ぶと詳細を確認できます。
                </p>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
