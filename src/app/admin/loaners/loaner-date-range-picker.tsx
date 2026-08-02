"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addLoanerRangeMonths,
  formatLoanerRangeMonthLabel,
  getLoanerRangeCalendarDates,
  getLoanerRangeMonthKey,
  isLoanerDateWithinRange,
  selectLoanerDateRange,
} from "@/lib/loaners/loaner-date-range";
import { formatLoanerDate } from "@/lib/loaners/loaner-period";
import { getJstDateKey } from "@/lib/reservations/slots";

const weekdayLabels = ["日", "月", "火", "水", "木", "金", "土"];

type AvailabilityResponse = {
  ok: boolean;
  days?: Record<string, { holiday: unknown | null }>;
};

function RangeCalendarMonth({
  monthKey,
  startDate,
  endDate,
  holidayDates,
  today,
  onSelectDate,
}: {
  monthKey: string;
  startDate: string;
  endDate: string;
  holidayDates: Set<string>;
  today: string;
  onSelectDate: (dateKey: string) => void;
}) {
  const calendarDates = getLoanerRangeCalendarDates(monthKey);

  return (
    <section aria-label={`${formatLoanerRangeMonthLabel(monthKey)}のカレンダー`}>
      <h3 className="mb-3 text-center text-base font-bold text-slate-900 sm:text-lg">
        {formatLoanerRangeMonthLabel(monthKey)}
      </h3>
      <div className="grid grid-cols-7 text-center text-xs font-bold sm:text-sm">
        {weekdayLabels.map((label, index) => (
          <div
            key={label}
            className={`py-2 ${
              index === 0
                ? "text-red-600"
                : index === 6
                  ? "text-blue-600"
                  : "text-slate-600"
            }`}
          >
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 overflow-hidden rounded-md border border-slate-200 bg-slate-100">
        {calendarDates.map(({ dateKey, day, weekday, isCurrentMonth }) => {
          if (!isCurrentMonth) {
            return <div key={dateKey} className="aspect-square min-h-10 bg-slate-50" />;
          }

          const isStart = dateKey === startDate;
          const isEnd = dateKey === endDate;
          const isInRange = isLoanerDateWithinRange(dateKey, startDate, endDate);
          const isToday = dateKey === today;
          const isHoliday = holidayDates.has(dateKey);
          const endpointLabel =
            isStart && isEnd ? "開始・返却" : isStart ? "開始" : isEnd ? "返却" : "";

          return (
            <button
              key={dateKey}
              type="button"
              aria-label={`${dateKey}${isHoliday ? " 休業" : ""}${endpointLabel ? ` ${endpointLabel}` : ""}`}
              aria-pressed={isStart || isEnd || isInRange}
              onClick={() => onSelectDate(dateKey)}
              className={`relative aspect-square min-h-10 cursor-pointer border-b border-r border-white/80 p-1 text-center transition focus:z-10 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:p-1.5 ${
                isStart || isEnd
                  ? "z-[1] bg-blue-600 text-white"
                  : isInRange
                    ? "bg-blue-100 text-blue-950 hover:bg-blue-200"
                    : "bg-white hover:bg-blue-50"
              } ${isToday && !isStart && !isEnd ? "ring-1 ring-inset ring-blue-400" : ""}`}
            >
              <span
                className={`block text-sm font-bold sm:text-base ${
                  isStart || isEnd
                    ? "text-white"
                    : isHoliday || weekday === 0
                      ? "text-red-600"
                      : weekday === 6
                        ? "text-blue-600"
                        : "text-slate-900"
                }`}
              >
                {day}
              </span>
              {endpointLabel ? (
                <span className="mt-0.5 block text-[9px] font-bold leading-none sm:text-[10px]">
                  {endpointLabel}
                </span>
              ) : isHoliday ? (
                <span className="mt-0.5 block text-[9px] font-bold leading-none text-red-600 sm:text-[10px]">
                  休業
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function LoanerDateRangePicker({
  startDate,
  endDate,
  error,
  isSaving,
  onChange,
  onClose,
  onConfirm,
}: {
  startDate: string;
  endDate: string;
  error?: string;
  isSaving: boolean;
  onChange: (startDate: string, endDate: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const today = getJstDateKey(new Date());
  const [visibleMonth, setVisibleMonth] = useState(
    () => getLoanerRangeMonthKey(startDate) || getLoanerRangeMonthKey(today),
  );
  const [holidayDatesByMonth, setHolidayDatesByMonth] = useState<
    Record<string, string[]>
  >({});
  const [holidayLoadFailed, setHolidayLoadFailed] = useState(false);
  const nextMonth = addLoanerRangeMonths(visibleMonth, 1);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isSaving) onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isSaving, onClose]);

  useEffect(() => {
    const monthsToLoad = [visibleMonth, nextMonth].filter(
      (month) => month && !(month in holidayDatesByMonth),
    );
    if (!monthsToLoad.length) return;

    const controller = new AbortController();
    void Promise.all(
      monthsToLoad.map(async (month) => {
        const response = await fetch(
          `/api/reservations/availability?month=${month}`,
          { cache: "no-store", signal: controller.signal },
        );
        const result = (await response.json()) as AvailabilityResponse;
        if (!response.ok || !result.ok) throw new Error("holiday lookup failed");
        return {
          month,
          dates: Object.entries(result.days ?? {})
            .filter(([, day]) => Boolean(day.holiday))
            .map(([dateKey]) => dateKey),
        };
      }),
    )
      .then((items) => {
        if (controller.signal.aborted) return;
        setHolidayDatesByMonth((current) => ({
          ...current,
          ...Object.fromEntries(items.map((item) => [item.month, item.dates])),
        }));
        setHolidayLoadFailed(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setHolidayLoadFailed(true);
      });

    return () => controller.abort();
  }, [holidayDatesByMonth, nextMonth, visibleMonth]);

  const holidayDates = useMemo(
    () =>
      new Set([
        ...(holidayDatesByMonth[visibleMonth] ?? []),
        ...(holidayDatesByMonth[nextMonth] ?? []),
      ]),
    [holidayDatesByMonth, nextMonth, visibleMonth],
  );
  const hasValidRange = Boolean(startDate && endDate && startDate <= endDate);

  function selectDate(dateKey: string) {
    const next = selectLoanerDateRange({ startDate, endDate }, dateKey);
    onChange(next.startDate, next.endDate);
  }

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/45 p-2 sm:p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSaving) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="loaner-date-range-title"
        className="flex h-[calc(100dvh-1rem)] max-h-[900px] w-[calc(100vw-1rem)] max-w-[1200px] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl sm:h-[90dvh] sm:w-[90vw]"
      >
        <header className="shrink-0 border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="loaner-date-range-title" className="text-lg font-bold text-slate-950 sm:text-xl">
                貸出期間を変更
              </h2>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2 sm:gap-5">
                <div>
                  <dt className="font-semibold text-slate-500">貸出開始日</dt>
                  <dd className="mt-0.5 font-bold text-slate-900">
                    {formatLoanerDate(startDate)}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-500">返却予定日</dt>
                  <dd className="mt-0.5 font-bold text-slate-900">
                    {formatLoanerDate(endDate)}
                  </dd>
                </div>
              </dl>
            </div>
            <button
              type="button"
              disabled={isSaving}
              onClick={onClose}
              className="h-10 shrink-0 cursor-pointer rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
            >
              閉じる
            </button>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setVisibleMonth(addLoanerRangeMonths(visibleMonth, -1))}
              className="h-10 cursor-pointer rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              前月
            </button>
            <p className="text-center text-xs font-semibold text-slate-500">
              1回目で開始日、2回目で返却予定日を選択
            </p>
            <button
              type="button"
              onClick={() => setVisibleMonth(addLoanerRangeMonths(visibleMonth, 1))}
              className="h-10 cursor-pointer rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              次月
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-5">
          {holidayLoadFailed ? (
            <p className="mb-3 text-center text-xs font-semibold text-slate-500">
              休業日情報を取得できませんでした。日付は選択できます。
            </p>
          ) : null}
          <div className="grid gap-5 md:grid-cols-2">
            <RangeCalendarMonth
              monthKey={visibleMonth}
              startDate={startDate}
              endDate={endDate}
              holidayDates={holidayDates}
              today={today}
              onSelectDate={selectDate}
            />
            <div className="hidden md:block">
              <RangeCalendarMonth
                monthKey={nextMonth}
                startDate={startDate}
                endDate={endDate}
                holidayDates={holidayDates}
                today={today}
                onSelectDate={selectDate}
              />
            </div>
          </div>
        </div>

        <footer className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 sm:px-6 sm:py-4">
          {error ? (
            <p className="mb-3 text-sm font-semibold text-red-600" role="alert">
              {error}
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-3 sm:ml-auto sm:max-w-md">
            <button
              type="button"
              disabled={isSaving}
              onClick={onClose}
              className="h-11 cursor-pointer rounded-md border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
            >
              キャンセル
            </button>
            <button
              type="button"
              disabled={!hasValidRange || isSaving}
              onClick={onConfirm}
              className="h-11 cursor-pointer rounded-md bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {isSaving ? (
                <span className="inline-flex items-center gap-2">
                  <span
                    className="h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-white"
                    aria-hidden="true"
                  />
                  変更中...
                </span>
              ) : (
                "この期間に変更"
              )}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
