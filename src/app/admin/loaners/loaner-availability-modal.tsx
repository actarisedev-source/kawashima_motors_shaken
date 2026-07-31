"use client";

import { useEffect, useState } from "react";
import type { LoanerAvailabilityItem } from "@/lib/loaners/loaner-availability";
import {
  formatLoanerDate,
  getLoanerReturnDateKey,
} from "@/lib/loaners/loaner-period";
import {
  loanerCategories,
  loanerCategoryLabels,
  type LoanerCategory,
} from "@/lib/loaners/loaner-vehicle";
import { LoanerCategoryBadge } from "./loaner-category-badge";

type AvailabilityResponse = {
  ok: boolean;
  message?: string;
  availableCount?: number;
  items?: LoanerAvailabilityItem[];
};

export function LoanerAvailabilityModal({
  startDate,
  endDate,
  onClose,
  onSelect,
}: {
  startDate: string;
  endDate: string;
  onClose: () => void;
  onSelect: (item: LoanerAvailabilityItem) => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [category, setCategory] = useState<LoanerCategory | "all">("all");
  const [availableOnly, setAvailableOnly] = useState(true);
  const [items, setItems] = useState<LoanerAvailabilityItem[]>([]);
  const [availableCount, setAvailableCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({
        start_date: startDate,
        end_date: endDate,
        keyword,
        category,
        available_only: String(availableOnly),
      });

      setIsLoading(true);
      setError("");
      void fetch(`/api/admin/loaners/availability?${params}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => ({
          response,
          result: (await response.json()) as AvailabilityResponse,
        }))
        .then(({ response, result }) => {
          if (!response.ok || !result.ok || !result.items) {
            throw new Error(
              result.message ?? "代車の空き状況を取得できませんでした。",
            );
          }
          setItems(result.items);
          setAvailableCount(result.availableCount ?? 0);
        })
        .catch((fetchError: unknown) => {
          if (fetchError instanceof DOMException && fetchError.name === "AbortError") {
            return;
          }
          setItems([]);
          setError(
            fetchError instanceof Error
              ? fetchError.message
              : "代車の空き状況を取得できませんでした。",
          );
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsLoading(false);
        });
    }, 200);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [availableOnly, category, endDate, keyword, startDate]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-3 sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="loaner-search-title"
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-4 py-4 sm:px-5">
          <div>
            <h2 id="loaner-search-title" className="text-lg font-bold text-slate-950">
              空いている代車を検索
            </h2>
            <p className="mt-1 text-sm font-medium text-slate-500">
              利用期間 {formatLoanerDate(startDate)} ～ {formatLoanerDate(endDate)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-9 shrink-0 rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            閉じる
          </button>
        </header>

        <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-4 sm:px-5">
          <p className="text-sm font-bold text-slate-800">
            利用可能な代車：{availableCount}台
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_180px]">
            <label className="grid gap-1.5 text-xs font-semibold text-slate-600">
              車名・ナンバーで検索
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="車名・表示名・ナンバー"
                className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-slate-600">
              分類
              <select
                value={category}
                onChange={(event) =>
                  setCategory(event.target.value as LoanerCategory | "all")
                }
                className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              >
                <option value="all">すべて</option>
                {loanerCategories.map((value) => (
                  <option key={value} value={value}>
                    {loanerCategoryLabels[value]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="mt-3 flex min-h-9 cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={availableOnly}
              onChange={(event) => setAvailableOnly(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            空いている代車のみ表示
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {isLoading ? (
            <p className="py-12 text-center text-sm font-semibold text-slate-500">
              空き状況を確認しています。
            </p>
          ) : error ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
              {error}
            </div>
          ) : items.length === 0 ? (
            <div className="py-10 text-center">
              <p className="font-bold text-slate-800">
                指定期間に利用可能な代車はありません。
              </p>
              <p className="mt-2 text-sm font-medium text-slate-500">
                貸出期間を変更するか、全車両表示で予約状況をご確認ください。
              </p>
            </div>
          ) : (
            <div className="grid gap-3">
              {items.map((item) => {
                const conflict = item.conflictingAssignment;
                return (
                  <article
                    key={item.id}
                    className={[
                      "rounded-md border p-4",
                      item.available
                        ? "border-slate-200 bg-white"
                        : "border-slate-200 bg-slate-50 opacity-70",
                    ].join(" ")}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <LoanerCategoryBadge category={item.category} />
                        <p className="mt-2 text-base font-bold text-slate-950">
                          {item.displayName}
                        </p>
                        <p className="mt-1 text-sm font-medium text-slate-600">
                          {item.vehicleName} / {item.plateNumber}
                        </p>
                        {!item.available ? (
                          <div className="mt-2 text-sm font-semibold text-slate-600">
                            <p>{item.unavailableReason}</p>
                            {conflict ? (
                              <p className="mt-1 text-xs font-medium text-slate-500">
                                {formatLoanerDate(
                                  new Date(conflict.scheduledStartAt)
                                    .toLocaleDateString("sv-SE", {
                                      timeZone: "Asia/Tokyo",
                                    }),
                                )}
                                {" ～ "}
                                {formatLoanerDate(
                                  getLoanerReturnDateKey(conflict.scheduledEndAt),
                                )}
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        disabled={!item.available}
                        onClick={() => onSelect(item)}
                        className="h-10 shrink-0 rounded-md bg-blue-600 px-5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
                      >
                        {item.available ? "選択" : "選択不可"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
