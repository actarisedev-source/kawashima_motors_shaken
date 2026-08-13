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
import {
  LoanerCategoryBadge,
  LoanerCategoryDot,
} from "./loaner-category-badge";

type AvailabilityResponse = {
  ok: boolean;
  message?: string;
  availableCount?: number;
  items?: LoanerAvailabilityItem[];
};

export function LoanerAvailabilityModal({
  startDate,
  endDate,
  currentLoanerVehicleId,
  onClose,
  onSelect,
}: {
  startDate: string;
  endDate: string;
  currentLoanerVehicleId?: string;
  onClose: () => void;
  onSelect: (item: LoanerAvailabilityItem) => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [category, setCategory] = useState<LoanerCategory | "all">("all");
  const [availableOnly, setAvailableOnly] = useState(!currentLoanerVehicleId);
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
        className="flex h-[90dvh] max-h-[90dvh] w-[90vw] max-w-[1600px] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-4 py-4 sm:px-5">
          <div>
            <h2 id="loaner-search-title" className="text-lg font-bold text-slate-950">
              代車検索
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
          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={availableOnly}
                onChange={(event) => setAvailableOnly(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              空いている代車のみ表示
            </label>
            <div
              className="flex flex-wrap items-center gap-x-4 gap-y-2"
              aria-label="代車分類の凡例"
            >
              {loanerCategories.map((value) => (
                <LoanerCategoryBadge key={value} category={value} />
              ))}
            </div>
          </div>
        </div>

        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5"
          aria-busy={isLoading}
        >
          {isLoading ? (
            <p className="flex items-center justify-center gap-2 py-12 text-center text-sm font-semibold text-slate-500">
              <span
                className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600"
                aria-hidden="true"
              />
              検索中...
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
            <div className="grid items-stretch gap-2.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {items.map((item) => {
                const conflict = item.conflictingAssignment;
                const isCurrent = item.id === currentLoanerVehicleId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={!item.available || isCurrent}
                    aria-pressed={isCurrent}
                    aria-label={`${item.displayName} ${item.plateNumber} ${loanerCategoryLabels[item.category]}`}
                    onClick={() => onSelect(item)}
                    className={[
                      "h-full min-h-[104px] rounded-md border p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-blue-200 focus:ring-offset-1",
                      isCurrent
                        ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                        : item.available
                          ? "cursor-pointer border-slate-200 bg-white text-slate-900 hover:border-blue-200 hover:bg-blue-50/60"
                          : "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-500 opacity-70",
                    ].join(" ")}
                  >
                    <div className="flex h-full min-w-0 flex-col justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <LoanerCategoryDot
                            category={item.category}
                            className={[
                              "h-3 w-3",
                              isCurrent ? "ring-2 ring-white/90" : "",
                            ].join(" ")}
                          />
                          <p
                            className={[
                              "truncate text-sm font-bold",
                              isCurrent ? "text-white" : "text-slate-950",
                            ].join(" ")}
                          >
                            {item.displayName}
                          </p>
                        </div>
                        <p
                          className={[
                            "mt-0.5 truncate text-xs font-semibold",
                            isCurrent ? "text-blue-50" : "text-slate-600",
                          ].join(" ")}
                        >
                          {item.vehicleName}
                        </p>
                        <p
                          className={[
                            "mt-1 truncate text-xs font-medium",
                            isCurrent ? "text-blue-50" : "text-slate-500",
                          ].join(" ")}
                        >
                          {item.plateNumber}
                        </p>
                      </div>
                      {isCurrent ? (
                        <p className="w-fit rounded-full bg-white/15 px-2 py-0.5 text-xs font-semibold text-white ring-1 ring-white/30">
                          現在選択中
                        </p>
                      ) : null}
                      {!item.available && !isCurrent ? (
                        <div className="text-xs font-semibold text-slate-600">
                          <p className="line-clamp-2">{item.unavailableReason}</p>
                          {conflict ? (
                            <p className="mt-1 font-medium text-slate-500">
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
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
