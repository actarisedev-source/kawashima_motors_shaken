"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getJstDateKey } from "@/lib/reservations/slots";
import {
  formatAdminCalendarDateKey,
  formatAdminCalendarMonth,
  formatAdminCalendarSelectedDate,
} from "./admin-date-calendar-modal";

const weekdayLabels = ["日", "月", "火", "水", "木", "金", "土"];

const getDateFromDateKey = (dateKey: string) =>
  new Date(`${dateKey}T00:00:00+09:00`);

const getCalendarDates = (monthDate: Date) => {
  const firstDate = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const startDate = new Date(firstDate);
  startDate.setDate(firstDate.getDate() - firstDate.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + index);
    return date;
  });
};

const formatCalendarMonthLabel = (date: Date) => {
  const year = date.getFullYear();
  return `${year}年（令和${year - 2018}年）${date.getMonth() + 1}月`;
};

const formatCalendarYearOption = (year: number) => {
  const era =
    year >= 2019
      ? { name: "令和", firstYear: 2019 }
      : year >= 1989
        ? { name: "平成", firstYear: 1989 }
        : year >= 1926
          ? { name: "昭和", firstYear: 1926 }
          : year >= 1912
            ? { name: "大正", firstYear: 1912 }
            : year >= 1868
              ? { name: "明治", firstYear: 1868 }
              : null;

  if (!era) return `${year}年`;

  const eraYear = year - era.firstYear + 1;
  return `${year}年（${era.name}${eraYear === 1 ? "元" : eraYear}年）`;
};

type AdminInlineDatePickerProps = {
  dropdownClassName?: string;
  error?: string;
  errorMessage?: string;
  isDateDisabled?: (dateKey: string) => boolean;
  isDateHoliday?: (dateKey: string) => boolean;
  isLoading?: boolean;
  label: string;
  loadingMessage?: string;
  maxDate?: string | null;
  minDate?: string | null;
  onOpenChange?: (open: boolean) => void;
  onSelectDate: (dateKey: string) => void;
  onVisibleMonthChange?: (month: string) => void;
  selectedDate: string;
  showCalendarIcon?: boolean;
  showMonthYearSelectors?: boolean;
};

export function AdminInlineDatePicker({
  dropdownClassName = "left-0 w-[min(86vw,600px)]",
  error,
  errorMessage,
  isDateDisabled,
  isDateHoliday,
  isLoading = false,
  label,
  loadingMessage = "休業日情報を読み込み中です",
  maxDate,
  minDate,
  onOpenChange,
  onSelectDate,
  onVisibleMonthChange,
  selectedDate,
  showCalendarIcon = false,
  showMonthYearSelectors = false,
}: AdminInlineDatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [monthDate, setMonthDate] = useState(() =>
    getDateFromDateKey(selectedDate || getJstDateKey(new Date())),
  );
  const todayKey = getJstDateKey(new Date());
  const minimumDate = minDate === undefined ? todayKey : minDate;
  const maximumDate = maxDate ?? null;
  const calendarDates = useMemo(() => getCalendarDates(monthDate), [monthDate]);
  const selectableYears = useMemo(() => {
    const currentYear = Number(todayKey.slice(0, 4));
    const maximumYear = maximumDate
      ? Number(maximumDate.slice(0, 4))
      : currentYear;
    const firstYear = Math.min(1900, monthDate.getFullYear());
    const lastYear = Math.max(currentYear, maximumYear, monthDate.getFullYear());

    return Array.from(
      { length: lastYear - firstYear + 1 },
      (_, index) => lastYear - index,
    );
  }, [maximumDate, monthDate, todayKey]);

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (
        pickerRef.current &&
        !pickerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        onOpenChange?.(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen, onOpenChange]);

  function setOpen(open: boolean) {
    setIsOpen(open);
    onOpenChange?.(open);
    if (open) {
      const nextMonthDate = getDateFromDateKey(
        selectedDate || minimumDate || maximumDate || todayKey,
      );
      setMonthDate(nextMonthDate);
      onVisibleMonthChange?.(formatAdminCalendarMonth(nextMonthDate));
    }
  }

  function moveMonth(amount: number) {
    const nextMonthDate = new Date(
      monthDate.getFullYear(),
      monthDate.getMonth() + amount,
      1,
    );
    setMonthDate(nextMonthDate);
    onVisibleMonthChange?.(formatAdminCalendarMonth(nextMonthDate));
  }

  function setVisibleMonth(year: number, month: number) {
    const nextMonthDate = new Date(year, month, 1);
    setMonthDate(nextMonthDate);
    onVisibleMonthChange?.(formatAdminCalendarMonth(nextMonthDate));
  }

  function selectDate(dateKey: string) {
    onSelectDate(dateKey);
    setOpen(false);
  }

  return (
    <div
      ref={pickerRef}
      className="relative grid gap-1.5 text-sm font-semibold text-slate-700"
    >
      {label}
      <button
        type="button"
        onClick={() => setOpen(!isOpen)}
        className={[
          "flex h-11 items-center justify-between rounded-md border bg-white px-3 text-left text-sm font-semibold text-slate-950 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100",
          error ? "border-red-400" : "border-slate-300",
        ].join(" ")}
      >
        <span>
          {selectedDate ? formatAdminCalendarSelectedDate(selectedDate) : "未選択"}
        </span>
        {showCalendarIcon ? (
          <svg
            aria-hidden="true"
            className="h-5 w-5 shrink-0 text-slate-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M7 3v3m10-3v3M4.5 9h15m-14 11h13a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-13a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1Z"
            />
          </svg>
        ) : (
          <span className="text-base text-slate-500" aria-hidden="true">
            ▾
          </span>
        )}
      </button>
      {isOpen ? (
        <div
          className={[
            "absolute top-[calc(100%-1rem)] z-30 rounded-md border border-slate-300 bg-white shadow-xl",
            dropdownClassName,
          ].join(" ")}
        >
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            {showMonthYearSelectors ? (
              <div className="flex min-w-0 items-center gap-2">
                <select
                  aria-label="年を選択"
                  value={monthDate.getFullYear()}
                  onChange={(event) =>
                    setVisibleMonth(Number(event.target.value), monthDate.getMonth())
                  }
                  className="h-10 min-w-28 rounded-md border border-slate-300 bg-white px-2 text-sm font-bold text-slate-950 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                >
                  {selectableYears.map((year) => (
                    <option key={year} value={year}>
                      {formatCalendarYearOption(year)}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="月を選択"
                  value={monthDate.getMonth()}
                  onChange={(event) =>
                    setVisibleMonth(monthDate.getFullYear(), Number(event.target.value))
                  }
                  className="h-10 min-w-20 rounded-md border border-slate-300 bg-white px-2 text-sm font-bold text-slate-950 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                >
                  {Array.from({ length: 12 }, (_, index) => (
                    <option key={index} value={index}>
                      {index + 1}月
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="text-xl font-bold text-slate-950">
                {formatCalendarMonthLabel(monthDate)}
              </p>
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => moveMonth(-1)}
                className="grid h-9 w-9 place-items-center rounded-md text-2xl font-bold text-slate-500 transition hover:bg-slate-100"
                aria-label="前月"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => moveMonth(1)}
                className="grid h-9 w-9 place-items-center rounded-md text-2xl font-bold text-slate-500 transition hover:bg-slate-100"
                aria-label="次月"
              >
                ›
              </button>
            </div>
          </div>
          <div className="grid grid-cols-7 px-5 pt-4 text-center text-sm font-bold">
            {weekdayLabels.map((weekday, index) => (
              <div
                key={weekday}
                className={[
                  "py-2",
                  index === 0
                    ? "text-red-500"
                    : index === 6
                      ? "text-blue-600"
                      : "text-slate-700",
                ].join(" ")}
              >
                {weekday}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1 px-5 pb-4 text-center">
            {calendarDates.map((date) => {
              const dateKey = formatAdminCalendarDateKey(date);
              const isCurrentMonth = date.getMonth() === monthDate.getMonth();
              const isSelected = dateKey === selectedDate;
              const isToday = dateKey === todayKey;
              const isBeforeMinDate = Boolean(
                minimumDate && dateKey < minimumDate,
              );
              const isAfterMaxDate = Boolean(
                maximumDate && dateKey > maximumDate,
              );
              const isHoliday = Boolean(isDateHoliday?.(dateKey));
              const disabled =
                isLoading ||
                !isCurrentMonth ||
                isBeforeMinDate ||
                isAfterMaxDate ||
                Boolean(isDateDisabled?.(dateKey));

              return (
                <button
                  key={dateKey}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    if (!disabled) {
                      selectDate(dateKey);
                    }
                  }}
                  className={[
                    "grid h-12 place-items-center rounded-md text-base font-bold transition",
                    isSelected
                      ? "bg-blue-600 text-white shadow-sm"
                      : isToday
                        ? "border border-slate-400 bg-white text-slate-950"
                        : "border border-transparent",
                    disabled
                      ? "cursor-not-allowed text-slate-300"
                      : "cursor-pointer text-slate-950 hover:bg-blue-50",
                    isHoliday ? "bg-slate-100 text-red-500" : "",
                  ].join(" ")}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3">
            <button
              type="button"
              disabled={
                Boolean(minimumDate && todayKey < minimumDate) ||
                Boolean(maximumDate && todayKey > maximumDate) ||
                Boolean(isDateDisabled?.(todayKey))
              }
              onClick={() => {
                if (
                  (!minimumDate || todayKey >= minimumDate) &&
                  (!maximumDate || todayKey <= maximumDate) &&
                  !isDateDisabled?.(todayKey)
                ) {
                  selectDate(todayKey);
                }
              }}
              className="text-sm font-bold text-blue-600 transition hover:text-blue-700 disabled:cursor-not-allowed disabled:text-slate-300"
            >
              今日
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-sm font-bold text-slate-500 transition hover:text-slate-700"
            >
              閉じる
            </button>
          </div>
          {isLoading ? (
            <div className="absolute inset-0 grid place-items-center bg-white/70 backdrop-blur-[1px]">
              <p className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 shadow-sm">
                {loadingMessage}
              </p>
            </div>
          ) : null}
          {errorMessage ? (
            <div className="border-t border-red-100 bg-red-50 px-5 py-3 text-sm font-semibold text-red-700">
              {errorMessage}
            </div>
          ) : null}
        </div>
      ) : null}
      <span className="min-h-4 text-xs font-semibold leading-4 text-red-600">
        {error}
      </span>
    </div>
  );
}
