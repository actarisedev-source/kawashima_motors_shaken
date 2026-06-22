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

        <section className="grid gap-3 rounded-[5px] border border-slate-200 bg-white px-4 py-3 shadow-sm sm:grid-cols-[140px_1fr] lg:col-span-2 lg:grid-cols-[150px_300px_minmax(0,1fr)] lg:items-center">
          <div className="border-b border-slate-100 pb-3 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-4">
            <p className="text-xs font-semibold text-slate-500">総顧客数</p>
            <p className="mt-1 text-2xl font-bold text-slate-950">
              {summary.total}
              <span className="ml-1 text-sm font-semibold text-slate-500">人</span>
            </p>
          </div>

          <div className="sm:pl-1 lg:border-r lg:border-slate-100 lg:pr-4">
            <p className="text-xs font-semibold text-slate-500">性別顧客数</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
              {genderLabels.map((label) => (
                <p
                  key={label}
                  className="text-xs font-semibold text-slate-700"
                >
                  {label}：{summary.gender[label]}
                </p>
              ))}
            </div>
          </div>

          <div className="sm:col-span-2 lg:col-span-1 lg:pl-1">
            <p className="text-xs font-semibold text-slate-500">年代別顧客数</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
              {ageGroupLabels.map((label) => (
                <p
                  key={label}
                  className="text-xs font-semibold text-slate-700"
                >
                  {label}：{summary.ageGroup[label]}
                </p>
              ))}
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
