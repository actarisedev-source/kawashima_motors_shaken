"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  loanerAssignmentStatusLabels,
  type LoanerHistoryItem,
  type LoanerHistoryResponse,
} from "@/lib/loaners/loaner-history";
import type { LoanerAssignmentStatus } from "@/lib/loaners/loaner-assignment";
import {
  loanerCategories,
  loanerCategoryLabels,
  type LoanerCategory,
} from "@/lib/loaners/loaner-vehicle";
import {
  formatLoanerDate,
  getLoanerReturnDateKey,
} from "@/lib/loaners/loaner-period";
import { AdminHeader } from "../../admin-header";
import { LoanerAdminTabs } from "../loaner-admin-tabs";
import {
  LoanerCategoryBadge,
  LoanerCategoryDot,
} from "../loaner-category-badge";

const statusStyles: Record<LoanerAssignmentStatus, string> = {
  checked_out: "bg-amber-50 text-amber-800 ring-amber-200",
  returned: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  cancelled: "bg-slate-100 text-slate-600 ring-slate-200",
};

const formatDateTime = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("ja-JP", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Tokyo",
      }).format(new Date(value))
    : "—";

const formatPeriodDate = (value: string) =>
  formatLoanerDate(
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(value)),
  );

function StatusBadge({ status }: { status: LoanerAssignmentStatus }) {
  return (
    <span
      className={`inline-flex min-h-7 items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${statusStyles[status]}`}
    >
      {loanerAssignmentStatusLabels[status]}
    </span>
  );
}

function LoadingSpinner({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm font-semibold text-blue-700">
      <span
        aria-hidden="true"
        className="h-4 w-4 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600"
      />
      {label}
    </span>
  );
}

function PhoneActions({ phone }: { phone: string }) {
  const [copyState, setCopyState] = useState<
    "idle" | "copying" | "success" | "error"
  >("idle");
  const callablePhone = phone.replace(/[^\d+]/g, "");

  async function copyPhone() {
    if (!phone || copyState === "copying") return;
    setCopyState("copying");
    try {
      await navigator.clipboard.writeText(phone);
      setCopyState("success");
      window.setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      setCopyState("error");
    }
  }

  if (!phone) return <span className="text-slate-400">—</span>;

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span>{phone}</span>
      <button
        type="button"
        onClick={copyPhone}
        disabled={copyState === "copying"}
        className="cursor-pointer text-xs font-semibold text-blue-700 underline underline-offset-2 disabled:cursor-wait disabled:opacity-60"
      >
        {copyState === "copying" ? "コピー中..." : "コピー"}
      </button>
      <a
        href={`tel:${callablePhone}`}
        className="text-xs font-semibold text-blue-700 underline underline-offset-2 md:hidden"
      >
        電話する
      </a>
      {copyState === "success" ? (
        <span className="w-full text-xs font-semibold text-emerald-700" role="status">
          電話番号をコピーしました。
        </span>
      ) : null}
      {copyState === "error" ? (
        <span className="w-full text-xs font-semibold text-red-700" role="alert">
          電話番号をコピーできませんでした。
        </span>
      ) : null}
    </span>
  );
}

function DetailModal({
  item,
  onClose,
}: {
  item: LoanerHistoryItem;
  onClose: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const details = [
    ["状態", loanerAssignmentStatusLabels[item.status]],
    ["分類", loanerCategoryLabels[item.vehicle.category]],
    ["車種", item.vehicle.vehicleName || "—"],
    ["ナンバー", item.vehicle.plateNumber || "—"],
    ["貸出開始予定", formatPeriodDate(item.scheduledStartAt)],
    ["返却予定", formatLoanerDate(getLoanerReturnDateKey(item.scheduledEndAt))],
    ["実返却日時", formatDateTime(item.actualReturnedAt)],
    ["予約日時（保存時）", formatDateTime(item.snapshotReservedAt)],
    ["登録日時", formatDateTime(item.createdAt)],
    ["更新日時", formatDateTime(item.updatedAt)],
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-3 sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="loaner-history-detail-title"
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-md bg-white shadow-2xl"
      >
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4">
          <div>
            <h2 id="loaner-history-detail-title" className="text-lg font-bold">
              貸出履歴詳細
            </h2>
            <p className="mt-1 text-xs text-slate-500">貸出当時の保存情報を表示しています。</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-9 cursor-pointer rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            閉じる
          </button>
        </header>

        <div className="grid gap-5 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={item.status} />
            <LoanerCategoryBadge category={item.vehicle.category} />
          </div>

          <section className="rounded-md border border-slate-200 p-4">
            <h3 className="text-sm font-bold text-slate-800">お客様（保存時）</h3>
            <p className="mt-3 text-lg font-bold">{item.snapshotCustomerName || "—"}</p>
            <p className="mt-2 text-sm text-slate-700">
              <PhoneActions phone={item.snapshotPhone} />
            </p>
            <div className="mt-3">
              {item.customerId && item.customerExists ? (
                <Link
                  href={`/admin/customers/${item.customerId}`}
                  className="text-sm font-semibold text-blue-700 underline underline-offset-2"
                >
                  現在の顧客情報を開く
                </Link>
              ) : (
                <p className="text-sm text-slate-500">現在の顧客情報は削除されています。</p>
              )}
            </div>
          </section>

          <dl className="grid gap-x-6 gap-y-4 rounded-md border border-slate-200 p-4 sm:grid-cols-2">
            {details.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs font-semibold text-slate-500">{label}</dt>
                <dd className="mt-1 break-words text-sm font-semibold text-slate-800">{value}</dd>
              </div>
            ))}
            <div className="sm:col-span-2">
              <dt className="text-xs font-semibold text-slate-500">メモ</dt>
              <dd className="mt-1 whitespace-pre-wrap break-words text-sm font-medium text-slate-800">
                {item.memo || "—"}
              </dd>
            </div>
          </dl>

          <section className="rounded-md border border-slate-200 p-4">
            <h3 className="text-sm font-bold text-slate-800">予約</h3>
            <p className="mt-2 text-sm font-semibold text-slate-800">
              {formatDateTime(item.snapshotReservedAt)}
            </p>
            <div className="mt-3">
              {item.reservationId && item.reservationExists ? (
                <Link
                  href={`/admin?reservation=${item.reservationId}`}
                  className="text-sm font-semibold text-blue-700 underline underline-offset-2"
                >
                  予約詳細を開く
                </Link>
              ) : (
                <p className="text-sm text-slate-500">元の予約情報は削除されています。</p>
              )}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

export function LoanerHistoryDashboard() {
  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [status, setStatus] = useState<LoanerAssignmentStatus | "all">("all");
  const [category, setCategory] = useState<LoanerCategory | "all">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<LoanerHistoryResponse>({ ok: true });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedItem, setSelectedItem] = useState<LoanerHistoryItem | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedKeyword(keyword.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [keyword]);

  const loadHistory = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setError("");
    const params = new URLSearchParams({ page: String(page) });
    params.set("page_size", "25");
    if (debouncedKeyword) params.set("keyword", debouncedKeyword);
    if (status !== "all") params.set("status", status);
    if (category !== "all") params.set("category", category);
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);

    try {
      const response = await fetch(
        `/api/admin/loaner-assignments/history?${params.toString()}`,
        { cache: "no-store", signal },
      );
      const nextResult = (await response.json()) as LoanerHistoryResponse;
      if (!response.ok || !nextResult.ok || !nextResult.items) {
        setError(nextResult.message ?? "貸出履歴の取得に失敗しました。");
        return;
      }
      setResult(nextResult);
    } catch (fetchError) {
      if (fetchError instanceof DOMException && fetchError.name === "AbortError") return;
      setError("貸出履歴の取得に失敗しました。時間をおいて再度お試しください。");
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, [category, dateFrom, dateTo, debouncedKeyword, page, status]);

  useEffect(() => {
    const controller = new AbortController();
    void loadHistory(controller.signal);
    return () => controller.abort();
  }, [loadHistory]);

  const hasFilters = Boolean(
    debouncedKeyword || status !== "all" || category !== "all" || dateFrom || dateTo,
  );
  const items = result.items ?? [];
  const total = result.total ?? 0;
  const pageSize = result.page_size ?? 25;
  const totalPages = result.total_pages ?? 1;
  const rangeLabel = useMemo(() => {
    if (!total) return "0件";
    const start = (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, total);
    return `全${total}件中 ${start}〜${end}件`;
  }, [page, pageSize, total]);

  const resetFilters = () => {
    setKeyword("");
    setDebouncedKeyword("");
    setStatus("all");
    setCategory("all");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <AdminHeader
        title="代車管理"
        description="代車の貸出履歴を検索・確認できます。"
        onRefresh={() => loadHistory()}
      />
      <main className="mx-auto grid max-w-7xl gap-5 px-5 py-6 sm:px-6 lg:px-8">
        <LoanerAdminTabs active="history" />

        <div
          className="-mb-2 flex flex-wrap items-center justify-start gap-x-4 gap-y-2 px-1 sm:justify-end"
          aria-label="代車分類の凡例"
        >
          {loanerCategories.map((value) => (
            <LoanerCategoryBadge key={value} category={value} />
          ))}
        </div>
        <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1fr)_160px_160px_150px_150px_auto] lg:items-end">
            <label className="text-sm font-semibold text-slate-700">
              キーワード検索
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="お客様・電話・代車・担当者・メモ"
                className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <label className="text-sm font-semibold text-slate-700">
              状態
              <select
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as LoanerAssignmentStatus | "all");
                  setPage(1);
                }}
                className="mt-1.5 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
              >
                <option value="all">すべて</option>
                {Object.entries(loanerAssignmentStatusLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="text-sm font-semibold text-slate-700">
              分類
              <select
                value={category}
                onChange={(event) => {
                  setCategory(event.target.value as LoanerCategory | "all");
                  setPage(1);
                }}
                className="mt-1.5 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
              >
                <option value="all">すべて</option>
                {loanerCategories.map((value) => (
                  <option key={value} value={value}>{loanerCategoryLabels[value]}</option>
                ))}
              </select>
            </label>
            <label className="text-sm font-semibold text-slate-700">
              開始日
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => { setDateFrom(event.target.value); setPage(1); }}
                className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 text-sm"
              />
            </label>
            <label className="text-sm font-semibold text-slate-700">
              終了日
              <input
                type="date"
                value={dateTo}
                onChange={(event) => { setDateTo(event.target.value); setPage(1); }}
                className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 text-sm"
              />
            </label>
            <button
              type="button"
              onClick={resetFilters}
              className="h-10 cursor-pointer rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              条件をクリア
            </button>
          </div>
        </section>

        {error ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            <p>{error}</p>
            <button type="button" onClick={() => loadHistory()} className="cursor-pointer underline">
              再試行
            </button>
          </div>
        ) : null}

        <section className="relative rounded-md border border-slate-200 bg-white shadow-sm">
          <div className="flex min-h-12 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <p className="text-sm font-semibold text-slate-600">{rangeLabel}</p>
            {isLoading ? <LoadingSpinner label="履歴を読み込み中..." /> : null}
          </div>

          {!isLoading && !items.length ? (
            <div className="px-5 py-16 text-center">
              <p className="font-semibold text-slate-700">
                {hasFilters ? "条件に一致する貸出履歴はありません。" : "貸出履歴がまだありません。"}
              </p>
            </div>
          ) : null}

          {items.length ? (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[960px] table-fixed border-collapse text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
                    <tr>
                      <th className="w-[105px] px-3 py-3">状態</th>
                      <th className="w-[205px] px-3 py-3">代車</th>
                      <th className="w-[195px] px-3 py-3">お客様</th>
                      <th className="w-[205px] px-3 py-3">貸出期間</th>
                      <th className="w-[145px] px-3 py-3">実返却</th>
                      <th className="w-[175px] px-3 py-3">予約日時</th>
                      <th className="w-[80px] px-3 py-3 text-center">詳細</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map((item) => (
                      <tr key={item.id} className="align-top hover:bg-slate-50/70">
                        <td className="px-3 py-4"><StatusBadge status={item.status} /></td>
                        <td className="px-3 py-4">
                          <p className="flex items-center gap-2 font-bold text-slate-900">
                            <LoanerCategoryDot category={item.vehicle.category} />
                            <span className="break-words">{item.vehicle.vehicleName}</span>
                          </p>
                          <p className="mt-0.5 break-words text-xs text-slate-500">{item.vehicle.plateNumber}</p>
                        </td>
                        <td className="px-3 py-4">
                          <p className="break-words font-semibold text-slate-900">{item.snapshotCustomerName || "—"}</p>
                          <p className="mt-1 break-words text-xs text-slate-500">{item.snapshotPhone || "—"}</p>
                        </td>
                        <td className="px-3 py-4 text-xs font-medium leading-6 text-slate-700">
                          <p>{formatPeriodDate(item.scheduledStartAt)}</p>
                          <p>〜 {formatLoanerDate(getLoanerReturnDateKey(item.scheduledEndAt))}</p>
                        </td>
                        <td className="px-3 py-4 text-xs font-medium text-slate-700">{formatDateTime(item.actualReturnedAt)}</td>
                        <td className="px-3 py-4 text-xs font-medium text-slate-700">{formatDateTime(item.snapshotReservedAt)}</td>
                        <td className="px-3 py-4 text-center">
                          <button
                            type="button"
                            onClick={() => setSelectedItem(item)}
                            className="h-9 cursor-pointer rounded-md border border-blue-200 px-3 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                          >
                            詳細
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid gap-3 p-3 md:hidden">
                {items.map((item) => (
                  <article key={item.id} className="rounded-md border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <StatusBadge status={item.status} />
                        <p className="mt-2 flex items-center gap-2 font-bold text-slate-950">
                          <LoanerCategoryDot category={item.vehicle.category} />
                          <span className="break-words">{item.vehicle.vehicleName}</span>
                        </p>
                        <p className="mt-1 text-xs text-slate-500">{item.vehicle.plateNumber}</p>
                      </div>
                    </div>
                    <dl className="mt-4 grid gap-3 text-sm">
                      <div><dt className="text-xs font-semibold text-slate-500">お客様</dt><dd className="mt-1 font-semibold">{item.snapshotCustomerName || "—"}</dd></div>
                      <div><dt className="text-xs font-semibold text-slate-500">電話番号</dt><dd className="mt-1"><PhoneActions phone={item.snapshotPhone} /></dd></div>
                      <div><dt className="text-xs font-semibold text-slate-500">貸出期間</dt><dd className="mt-1 font-semibold">{formatPeriodDate(item.scheduledStartAt)} 〜 {formatLoanerDate(getLoanerReturnDateKey(item.scheduledEndAt))}</dd></div>
                      <div><dt className="text-xs font-semibold text-slate-500">予約日時</dt><dd className="mt-1 font-semibold">{formatDateTime(item.snapshotReservedAt)}</dd></div>
                    </dl>
                    <button
                      type="button"
                      onClick={() => setSelectedItem(item)}
                      className="mt-4 h-11 w-full cursor-pointer rounded-md border border-blue-200 text-sm font-semibold text-blue-700 hover:bg-blue-50"
                    >
                      詳細を見る
                    </button>
                  </article>
                ))}
              </div>
            </>
          ) : null}

          <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
            <button
              type="button"
              disabled={page <= 1 || isLoading}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              className="h-9 cursor-pointer rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              前へ
            </button>
            <span className="text-sm font-semibold text-slate-600">{page} / {totalPages}</span>
            <button
              type="button"
              disabled={page >= totalPages || isLoading}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              className="h-9 cursor-pointer rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              次へ
            </button>
          </div>
        </section>
      </main>

      {selectedItem ? (
        <DetailModal item={selectedItem} onClose={() => setSelectedItem(null)} />
      ) : null}
    </div>
  );
}
