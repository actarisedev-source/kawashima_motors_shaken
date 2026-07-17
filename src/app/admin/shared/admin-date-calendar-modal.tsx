"use client";

import { getJstDateKey } from "@/lib/reservations/slots";

const weekdayLabels = ["日", "月", "火", "水", "木", "金", "土"];

export type AdminCalendarDayAvailability = {
  holiday: {
    id: string;
    type: "single" | "weekly";
    label: string | null;
  } | null;
};

export type AdminCalendarReservationCounts = {
  accepting: number;
  confirmed: number;
};

export const formatAdminCalendarMonth = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

export const formatAdminCalendarDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;

export const formatAdminCalendarSelectedDate = (dateKey: string) =>
  new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    timeZone: "Asia/Tokyo",
  }).format(new Date(`${dateKey}T00:00:00+09:00`));

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

type AdminDateCalendarModalProps = {
  availability: Record<string, AdminCalendarDayAvailability | undefined>;
  description: string;
  disableHolidaySelection?: boolean;
  holidayLabelTone?: "inherit" | "red";
  holidayTone?: "red" | "gray";
  monthDate: Date;
  onClose: () => void;
  onMoveMonth: (amount: number) => void;
  onSelectDate: (dateKey: string) => void;
  reservationCountsByDate?: Record<string, AdminCalendarReservationCounts>;
  selectedDate: string;
  showReservationCounts?: boolean;
  title: string;
};

export function AdminDateCalendarModal({
  availability,
  description,
  disableHolidaySelection = false,
  holidayLabelTone = "inherit",
  holidayTone = "red",
  monthDate,
  onClose,
  onMoveMonth,
  onSelectDate,
  reservationCountsByDate = {},
  selectedDate,
  showReservationCounts = false,
  title,
}: AdminDateCalendarModalProps) {
  const calendarDates = getCalendarDates(monthDate);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-3 sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-date-calendar-title"
        className="max-h-[92vh] w-full max-w-5xl overflow-auto rounded-lg border border-slate-200 bg-white shadow-xl"
      >
        <div className="sticky top-0 z-10 flex flex-col gap-3 border-b border-slate-200 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <h2 id="admin-date-calendar-title" className="text-base font-semibold">
              {title}
            </h2>
            <p className="mt-1 text-sm text-slate-500">{description}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onMoveMonth(-1)}
              className="h-9 cursor-pointer rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              前月
            </button>
            <p className="min-w-28 text-center text-base font-bold">
              {monthDate.getFullYear()}年 {monthDate.getMonth() + 1}月
            </p>
            <button
              type="button"
              onClick={() => onMoveMonth(1)}
              className="h-9 cursor-pointer rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              次月
            </button>
            <button
              type="button"
              onClick={onClose}
              className="ml-auto h-9 cursor-pointer rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              閉じる
            </button>
          </div>
        </div>
        <div className="min-w-[700px]">
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-semibold text-slate-500">
            {weekdayLabels.map((label) => (
              <div key={label} className="px-1 py-2">
                {label}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {calendarDates.map((date) => {
              const dateKey = formatAdminCalendarDateKey(date);
              const counts = reservationCountsByDate[dateKey] ?? {
                accepting: 0,
                confirmed: 0,
              };
              const isCurrentMonth = date.getMonth() === monthDate.getMonth();
              const isSelected = dateKey === selectedDate;
              const isToday = dateKey === getJstDateKey(new Date());
              const isPast = dateKey < getJstDateKey(new Date());
              const holiday = availability[dateKey]?.holiday;
              const isHolidayDisabled = Boolean(holiday && disableHolidaySelection);
              const holidayLabelRedClassName = "text-red-500";
              const holidayLabelClassName =
                holidayLabelTone === "red" ||
                (isPast && holidayTone !== "gray")
                  ? holidayLabelRedClassName
                  : "";

              return (
                <button
                  key={dateKey}
                  type="button"
                  disabled={isHolidayDisabled}
                  onClick={() => {
                    if (!isHolidayDisabled) {
                      onSelectDate(dateKey);
                    }
                  }}
                  className={[
                    "min-h-28 border-b border-r border-slate-100 p-2 text-left transition",
                    isHolidayDisabled ? "cursor-not-allowed" : "cursor-pointer",
                    isToday ? "ring-2 ring-inset ring-blue-500" : "",
                    isSelected && !isToday && !isPast
                      ? "bg-blue-50 ring-2 ring-inset ring-blue-500"
                      : "",
                    isPast
                      ? "bg-gray-100 text-gray-400"
                      : holiday
                        ? holidayTone === "gray"
                          ? "bg-gray-100 text-gray-500"
                          : "bg-red-50 text-red-800"
                        : "bg-white",
                    !isCurrentMonth ? "text-slate-300" : "",
                    !isPast && !holiday && !isSelected ? "hover:bg-blue-50/60" : "",
                  ].join(" ")}
                >
                  <div className="flex items-start justify-between gap-1">
                    <span className="text-sm font-bold">{date.getDate()}</span>
                    {isCurrentMonth && holiday ? (
                      <span
                        className={`text-[11px] font-semibold ${holidayLabelClassName}`}
                      >
                        休業
                      </span>
                    ) : null}
                  </div>
                  {isCurrentMonth && showReservationCounts ? (
                    <div className="mt-3 flex flex-wrap gap-1.5 text-xs font-semibold">
                      <span className="inline-flex items-center gap-1.5 px-2 py-1 text-slate-600">
                        <span
                          className="h-2 w-2 rounded-full bg-amber-400"
                          aria-hidden="true"
                        />
                        受付中 {counts.accepting}件
                      </span>
                      <span className="inline-flex items-center gap-1.5 px-2 py-1 text-slate-600">
                        <span
                          className="h-2 w-2 rounded-full bg-emerald-400"
                          aria-hidden="true"
                        />
                        確認済 {counts.confirmed}件
                      </span>
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
