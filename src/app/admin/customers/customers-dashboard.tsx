"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { AdminHeader } from "../admin-header";

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

type LoadState =
  | { status: "loading"; message: "読み込み中です。" }
  | { status: "ready"; message: "" }
  | { status: "error"; message: string };

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(new Date(value));

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(new Date(value));

export function CustomersDashboard() {
  const [items, setItems] = useState<CustomerItem[]>([]);
  const [query, setQuery] = useState("");
  const [loadState, setLoadState] = useState<LoadState>({
    status: "loading",
    message: "読み込み中です。",
  });

  const loadCustomers = useCallback(async (filters?: { query?: string }) => {
    setLoadState({ status: "loading", message: "読み込み中です。" });

    const params = new URLSearchParams();
    const queryFilter = filters?.query?.trim();

    if (queryFilter) {
      params.set("q", queryFilter);
    }

    const response = await fetch(
      `/api/admin/customers${params.size ? `?${params.toString()}` : ""}`,
      { cache: "no-store" },
    );
    const result = (await response.json()) as {
      ok: boolean;
      items?: CustomerItem[];
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
    setLoadState({ status: "ready", message: "" });
  }, []);

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadCustomers({ query });
  }

  function handleReset() {
    setQuery("");
    void loadCustomers();
  }

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <AdminHeader title="顧客管理" onRefresh={() => loadCustomers({ query })}>
          <form
            onSubmit={handleSearch}
            className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-[1fr_auto_auto]"
          >
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">
                名前・電話番号検索
              </span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="例: 川島 / 09012345678"
                className="mt-2 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <button
              type="submit"
              className="h-11 self-end rounded-md bg-blue-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              検索
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="h-11 self-end rounded-md border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              クリア
            </button>
          </form>
      </AdminHeader>
      <main className="mx-auto max-w-7xl px-5 py-6 sm:px-6 lg:px-8">
        {loadState.message ? (
          <div
            className={
              loadState.status === "error"
                ? "mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
                : "mb-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700"
            }
          >
            {loadState.message}
          </div>
        ) : null}
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-1 border-b border-slate-200 px-4 py-4 sm:px-5">
            <h2 className="text-base font-semibold">顧客一覧</h2>
            <p className="text-sm text-slate-500">
              新しい登録順で表示しています。
            </p>
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[860px] border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-5 py-3">登録日</th>
                  <th className="px-5 py-3">顧客名</th>
                  <th className="px-5 py-3">電話番号</th>
                  <th className="px-5 py-3">車両</th>
                  <th className="px-5 py-3">車検満了日</th>
                  <th className="px-5 py-3">予約</th>
                  <th className="px-5 py-3">最新予約日</th>
                  <th className="px-5 py-3">詳細</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="px-5 py-4 text-slate-600">
                      {formatDate(item.createdAt)}
                    </td>
                    <td className="px-5 py-4 font-semibold text-slate-950">
                      {item.name}
                    </td>
                    <td className="px-5 py-4 text-slate-600">
                      {item.phone || "未登録"}
                    </td>
                    <td className="px-5 py-4 text-slate-600">
                      {item.vehicleCount}台
                    </td>
                    <td className="px-5 py-4">
                      <div className="grid gap-1">
                        <span className="text-slate-600">
                          {item.nearestShakenExpiryDate
                            ? formatDate(item.nearestShakenExpiryDate)
                            : "未登録"}
                        </span>
                        <span
                          className={[
                            "w-fit rounded-full px-2 py-0.5 text-xs font-semibold ring-1",
                            item.shakenExpiryStatus === "expired"
                              ? "bg-red-50 text-red-700 ring-red-200"
                              : "",
                            item.shakenExpiryStatus === "soon"
                              ? "bg-amber-50 text-amber-700 ring-amber-200"
                              : "",
                            item.shakenExpiryStatus === "active"
                              ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                              : "",
                            item.shakenExpiryStatus === "unknown"
                              ? "bg-slate-100 text-slate-600 ring-slate-200"
                              : "",
                          ].join(" ")}
                        >
                          {item.shakenExpiryLabel}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-slate-600">
                      {item.reservationCount}件
                    </td>
                    <td className="px-5 py-4 text-slate-600">
                      {item.latestReservedAt
                        ? formatDateTime(item.latestReservedAt)
                        : "なし"}
                    </td>
                    <td className="px-5 py-4">
                      <Link
                        href={`/admin/customers/${item.id}`}
                        className="text-sm font-semibold text-blue-700 transition hover:text-blue-900"
                      >
                        詳細を見る
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="divide-y divide-slate-100 md:hidden">
            {items.map((item) => (
              <Link
                key={item.id}
                href={`/admin/customers/${item.id}`}
                className="block p-4 transition hover:bg-slate-50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-950">{item.name}</p>
                    <p className="mt-1 text-sm text-slate-500">
                      {item.phone || "電話番号未登録"}
                    </p>
                  </div>
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 ring-1 ring-blue-100">
                    詳細
                  </span>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-slate-500">登録日</dt>
                    <dd className="mt-1 font-semibold text-slate-950">
                      {formatDate(item.createdAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">最新予約日</dt>
                    <dd className="mt-1 font-semibold text-slate-950">
                      {item.latestReservedAt
                        ? formatDate(item.latestReservedAt)
                        : "なし"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">車両</dt>
                    <dd className="mt-1 font-semibold text-slate-950">
                      {item.vehicleCount}台
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">予約</dt>
                    <dd className="mt-1 font-semibold text-slate-950">
                      {item.reservationCount}件
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">車検満了日</dt>
                    <dd className="mt-1 font-semibold text-slate-950">
                      {item.nearestShakenExpiryDate
                        ? formatDate(item.nearestShakenExpiryDate)
                        : "未登録"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">車検ステータス</dt>
                    <dd className="mt-1 font-semibold text-slate-950">
                      {item.shakenExpiryLabel}
                    </dd>
                  </div>
                </dl>
              </Link>
            ))}
          </div>
          {!items.length && loadState.status === "ready" ? (
            <div className="px-5 py-12 text-center text-sm text-slate-500">
              条件に一致する顧客はありません。
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
