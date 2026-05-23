"use client";

import { useEffect, useMemo, useState } from "react";

const reservationStatuses = ["受付中", "確定", "完了", "キャンセル"] as const;

type ReservationStatus = (typeof reservationStatuses)[number];

type ReservationItem = {
  id: string;
  reservedAt: string;
  customerName: string;
  phone: string;
  vehicleModel: string;
  status: ReservationStatus;
  createdAt: string;
};

type LoadState =
  | { status: "loading"; message: "読み込み中です。" }
  | { status: "ready"; message: "" }
  | { status: "error"; message: string };

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(new Date(value));

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(new Date(value));

const statusClassName = (status: ReservationStatus) => {
  switch (status) {
    case "確定":
      return "bg-blue-50 text-blue-700 ring-blue-200";
    case "完了":
      return "bg-emerald-50 text-emerald-700 ring-emerald-200";
    case "キャンセル":
      return "bg-zinc-100 text-zinc-600 ring-zinc-200";
    default:
      return "bg-amber-50 text-amber-700 ring-amber-200";
  }
};

export function AdminDashboard() {
  const [items, setItems] = useState<ReservationItem[]>([]);
  const [loadState, setLoadState] = useState<LoadState>({
    status: "loading",
    message: "読み込み中です。",
  });
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  async function loadReservations() {
    setLoadState({ status: "loading", message: "読み込み中です。" });

    const response = await fetch("/api/admin/reservations", {
      cache: "no-store",
    });
    const result = (await response.json()) as {
      ok: boolean;
      items?: ReservationItem[];
      message?: string;
    };

    if (!response.ok || !result.ok || !result.items) {
      setLoadState({
        status: "error",
        message: result.message ?? "予約一覧の取得に失敗しました。",
      });
      return;
    }

    setItems(result.items);
    setLoadState({ status: "ready", message: "" });
  }

  async function updateStatus(id: string, status: ReservationStatus) {
    setUpdatingId(id);

    const response = await fetch("/api/admin/reservations", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        reservationId: id,
        status,
      }),
    });
    const result = (await response.json()) as {
      ok: boolean;
      message?: string;
    };

    if (!response.ok || !result.ok) {
      setLoadState({
        status: "error",
        message: result.message ?? "ステータス更新に失敗しました。",
      });
      setUpdatingId(null);
      return;
    }

    setItems((currentItems) =>
      currentItems.map((item) => (item.id === id ? { ...item, status } : item)),
    );
    setLoadState({ status: "ready", message: "" });
    setUpdatingId(null);
  }

  async function handleLogout() {
    await fetch("/api/admin/logout", {
      method: "POST",
    });
    window.location.href = "/admin/login";
  }

  useEffect(() => {
    void loadReservations();
  }, []);

  const summary = useMemo(
    () =>
      reservationStatuses.map((status) => ({
        status,
        count: items.filter((item) => item.status === status).length,
      })),
    [items],
  );

  const dateSummary = useMemo(() => {
    const counts = new Map<string, number>();

    for (const item of items) {
      const date = formatDate(item.reservedAt);
      counts.set(date, (counts.get(date) ?? 0) + 1);
    }

    return Array.from(counts.entries())
      .map(([date, count]) => ({ date, count }))
      .slice(0, 8);
  }, [items]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-blue-700">
                Kawashima Motors
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-normal sm:text-3xl">
                予約管理
              </h1>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => void loadReservations()}
                className="h-10 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
              >
                最新に更新
              </button>
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                ログアウト
              </button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            {summary.map((item) => (
              <div
                key={item.status}
                className="rounded-lg border border-slate-200 bg-white p-4"
              >
                <p className="text-sm text-slate-500">{item.status}</p>
                <p className="mt-2 text-2xl font-bold text-slate-950">
                  {item.count}
                </p>
              </div>
            ))}
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-950">
                  日付別の予約件数
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  予約日時ベースで集計しています。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {dateSummary.length ? (
                  dateSummary.map((item) => (
                    <span
                      key={item.date}
                      className="rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700 ring-1 ring-blue-100"
                    >
                      {item.date} {item.count}件
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-slate-500">
                    表示できる予約はありません。
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>
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
          <div className="border-b border-slate-200 px-4 py-4 sm:px-5">
            <h2 className="text-base font-semibold">予約一覧</h2>
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[880px] border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-5 py-3">予約日時</th>
                  <th className="px-5 py-3">顧客名</th>
                  <th className="px-5 py-3">電話番号</th>
                  <th className="px-5 py-3">車種</th>
                  <th className="px-5 py-3">ステータス</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => (
                  <tr key={item.id} className="align-middle">
                    <td className="px-5 py-4 font-medium text-slate-950">
                      {formatDateTime(item.reservedAt)}
                    </td>
                    <td className="px-5 py-4">{item.customerName}</td>
                    <td className="px-5 py-4 text-slate-600">{item.phone}</td>
                    <td className="px-5 py-4">{item.vehicleModel}</td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${statusClassName(item.status)}`}
                        >
                          {item.status}
                        </span>
                        <select
                          value={item.status}
                          disabled={updatingId === item.id}
                          onChange={(event) =>
                            void updateStatus(
                              item.id,
                              event.target.value as ReservationStatus,
                            )
                          }
                          className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm outline-none focus:border-blue-600"
                        >
                          {reservationStatuses.map((status) => (
                            <option key={status} value={status}>
                              {status}
                            </option>
                          ))}
                        </select>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 p-4 md:hidden">
            {items.map((item) => (
              <article
                key={item.id}
                className="rounded-lg border border-slate-200 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-950">
                      {formatDateTime(item.reservedAt)}
                    </p>
                    <p className="mt-2 text-base font-semibold">
                      {item.customerName}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${statusClassName(item.status)}`}
                  >
                    {item.status}
                  </span>
                </div>
                <dl className="mt-4 grid gap-2 text-sm text-slate-600">
                  <div className="flex justify-between gap-4">
                    <dt>電話番号</dt>
                    <dd className="font-medium text-slate-900">{item.phone}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt>車種</dt>
                    <dd className="font-medium text-slate-900">
                      {item.vehicleModel}
                    </dd>
                  </div>
                </dl>
                <select
                  value={item.status}
                  disabled={updatingId === item.id}
                  onChange={(event) =>
                    void updateStatus(
                      item.id,
                      event.target.value as ReservationStatus,
                    )
                  }
                  className="mt-4 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-600"
                >
                  {reservationStatuses.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </article>
            ))}
          </div>
          {loadState.status === "ready" && items.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500">
              予約はまだありません。
            </p>
          ) : null}
        </section>
      </main>
    </div>
  );
}
