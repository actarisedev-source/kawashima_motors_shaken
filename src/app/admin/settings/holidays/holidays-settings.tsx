"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { weekdayLabels } from "@/lib/holidays/holidays";
import { getJstDateKey } from "@/lib/reservations/slots";
import { AdminHeader } from "../../admin-header";

type HolidayItem = {
  id: string;
  type: "single" | "weekly";
  date: string | null;
  weekday: number | null;
  label: string | null;
  createdAt: string;
};

type LoadState =
  | { status: "loading"; message: "読み込み中です。" }
  | { status: "ready"; message: "" }
  | { status: "error"; message: string };

type PendingAction =
  | {
      kind: "set-single";
      dateKey: string;
      reservationCount: number;
    }
  | {
      kind: "remove";
      dateKey: string;
      holiday: HolidayItem;
    }
  | {
      kind: "set-monthly-weekday";
      weekday: number;
      dates: string[];
      reservedDayCount: number;
    }
  | {
      kind: "set-range";
      startDate: string;
      endDate: string;
      dates: string[];
      reservationCount: number;
    };

type RangeErrors = {
  startDate: string;
  endDate: string;
};

const todayKey = () => getJstDateKey(new Date());

const formatDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;

const formatDisplayDate = (dateKey: string) =>
  new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    timeZone: "Asia/Tokyo",
  }).format(new Date(`${dateKey}T00:00:00+09:00`));

const formatShortDate = (dateKey: string) => dateKey.replaceAll("-", "/");

const getDateRange = (startDate: string, endDate: string) => {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];

  const dates: string[] = [];
  for (const date = start; date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    dates.push(date.toISOString().slice(0, 10));
  }

  return dates;
};

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

const findHoliday = (dateKey: string, items: HolidayItem[]) => {
  const single = items.find(
    (item) => item.type === "single" && item.date === dateKey,
  );
  if (single) return single;

  const weekday = new Date(`${dateKey}T00:00:00+09:00`).getDay();
  return items.find(
    (item) => item.type === "weekly" && item.weekday === weekday,
  );
};

const getMonthWeekdayDateKeys = (
  monthDate: Date,
  weekday: number,
  minimumDateKey: string,
) => {
  const lastDay = new Date(
    monthDate.getFullYear(),
    monthDate.getMonth() + 1,
    0,
  ).getDate();

  return Array.from({ length: lastDay }, (_, index) => {
    const date = new Date(
      monthDate.getFullYear(),
      monthDate.getMonth(),
      index + 1,
    );
    return date.getDay() === weekday ? formatDateKey(date) : null;
  }).filter(
    (dateKey): dateKey is string =>
      dateKey !== null && dateKey >= minimumDateKey,
  );
};

export function HolidaysSettings() {
  const [items, setItems] = useState<HolidayItem[]>([]);
  const [reservationCounts, setReservationCounts] = useState<
    Record<string, number>
  >({});
  const [loadState, setLoadState] = useState<LoadState>({
    status: "loading",
    message: "読み込み中です。",
  });
  const [monthDate, setMonthDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [rangeStartDate, setRangeStartDate] = useState("");
  const [rangeEndDate, setRangeEndDate] = useState("");
  const [rangeErrors, setRangeErrors] = useState<RangeErrors>({
    startDate: "",
    endDate: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  const calendarDates = useMemo(
    () => getCalendarDates(monthDate),
    [monthDate],
  );
  const currentTodayKey = todayKey();

  async function loadHolidays() {
    setLoadState({ status: "loading", message: "読み込み中です。" });

    const response = await fetch("/api/admin/holidays", { cache: "no-store" });
    const result = (await response.json()) as {
      ok: boolean;
      items?: HolidayItem[];
      reservationCounts?: Record<string, number>;
      message?: string;
    };

    if (!response.ok || !result.ok || !result.items) {
      setLoadState({
        status: "error",
        message: result.message ?? "休業日の取得に失敗しました。",
      });
      return;
    }

    setItems(result.items);
    setReservationCounts(result.reservationCounts ?? {});
    setLoadState({ status: "ready", message: "" });
  }

  function moveMonth(amount: number) {
    setMonthDate(
      (current) =>
        new Date(current.getFullYear(), current.getMonth() + amount, 1),
    );
  }

  function openDateConfirmation(dateKey: string) {
    if (dateKey < currentTodayKey) return;

    const holiday = findHoliday(dateKey, items);
    if (holiday) {
      setPendingAction({ kind: "remove", dateKey, holiday });
      return;
    }

    setPendingAction({
      kind: "set-single",
      dateKey,
      reservationCount: reservationCounts[dateKey] ?? 0,
    });
  }

  function openMonthlyWeekdayConfirmation(weekday: number) {
    const dates = getMonthWeekdayDateKeys(
      monthDate,
      weekday,
      currentTodayKey,
    ).filter((dateKey) => !findHoliday(dateKey, items));
    if (!dates.length) return;

    const reservedDayCount = dates.filter(
      (dateKey) => (reservationCounts[dateKey] ?? 0) > 0,
    ).length;

    setPendingAction({
      kind: "set-monthly-weekday",
      weekday,
      dates,
      reservedDayCount,
    });
  }

  function openRangeConfirmation() {
    const errors: RangeErrors = { startDate: "", endDate: "" };

    if (!rangeStartDate) errors.startDate = "開始日を選択してください。";
    if (!rangeEndDate) errors.endDate = "終了日を選択してください。";

    if (rangeStartDate && rangeStartDate < currentTodayKey) {
      errors.startDate = "過去日は設定できません。";
    }

    if (rangeEndDate && rangeEndDate < currentTodayKey) {
      errors.endDate = "過去日は設定できません。";
    }

    if (rangeStartDate && rangeEndDate && rangeEndDate < rangeStartDate) {
      errors.endDate = "終了日は開始日以降の日付を選択してください。";
    }

    const dates =
      !errors.startDate && !errors.endDate
        ? getDateRange(rangeStartDate, rangeEndDate)
        : [];

    if (dates.length > 31) {
      errors.endDate = "一度に設定できる期間は31日までです。";
    }

    setRangeErrors(errors);
    if (errors.startDate || errors.endDate || !dates.length) return;

    const reservationCount = dates.reduce(
      (total, dateKey) => total + (reservationCounts[dateKey] ?? 0),
      0,
    );

    setPendingAction({
      kind: "set-range",
      startDate: rangeStartDate,
      endDate: rangeEndDate,
      dates,
      reservationCount,
    });
  }

  async function confirmAction() {
    if (!pendingAction || submitting) return;
    setSubmitting(true);

    const response =
      pendingAction.kind === "remove"
        ? await fetch(`/api/admin/holidays?id=${pendingAction.holiday.id}`, {
            method: "DELETE",
          })
        : await fetch("/api/admin/holidays", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              pendingAction.kind === "set-single"
                ? {
                    type: "single",
                    date: pendingAction.dateKey,
                    label: null,
                  }
                : {
                    type: "single-bulk",
                    dates: pendingAction.dates,
                  },
            ),
          });

    const result = (await response.json()) as {
      ok: boolean;
      message?: string;
    };

    if (!response.ok || !result.ok) {
      setLoadState({
        status: "error",
        message: result.message ?? "定休日の更新に失敗しました。",
      });
      setSubmitting(false);
      setPendingAction(null);
      return;
    }

    setPendingAction(null);
    setSubmitting(false);
    if (pendingAction.kind === "set-range") {
      setRangeStartDate("");
      setRangeEndDate("");
      setRangeErrors({ startDate: "", endDate: "" });
    }
    await loadHolidays();
  }

  useEffect(() => {
    void loadHolidays();
  }, []);

  useEffect(() => {
    if (pendingAction) cancelButtonRef.current?.focus();
  }, [pendingAction]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <AdminHeader
        title="定休日管理"
        description="カレンダーから定休日の設定・解除ができます。"
        onRefresh={loadHolidays}
      />

      <main className="mx-auto grid max-w-7xl gap-5 px-4 py-6 sm:px-6 lg:px-8">
        {loadState.message ? (
          <div
            className={
              loadState.status === "error"
                ? "rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
                : "rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700"
            }
          >
            {loadState.message}
          </div>
        ) : null}

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5 lg:min-h-[130px]">
          <div className="flex h-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold">曜日一括設定</h2>
              <p className="mt-1 text-sm text-slate-500">
                表示中の月だけ、選択した曜日を定休日に設定します。
              </p>
            </div>
            <div className="grid grid-cols-7 gap-1.5 sm:flex sm:flex-wrap">
              {[1, 2, 3, 4, 5, 6, 0].map((weekday) => {
                const targetDates = getMonthWeekdayDateKeys(
                  monthDate,
                  weekday,
                  currentTodayKey,
                );
                const active =
                  targetDates.length > 0 &&
                  targetDates.every((dateKey) => findHoliday(dateKey, items));
                return (
                  <button
                    key={weekday}
                    type="button"
                    disabled={
                      active ||
                      !targetDates.length ||
                      loadState.status === "loading"
                    }
                    onClick={() => openMonthlyWeekdayConfirmation(weekday)}
                    aria-pressed={active}
                    className={[
                      "grid h-10 min-w-10 cursor-pointer place-items-center rounded-md border px-2 text-sm font-bold transition",
                      active
                        ? "cursor-default border-red-300 bg-red-100 text-red-700"
                        : "border-slate-300 bg-white text-slate-700 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700",
                    ].join(" ")}
                  >
                    {weekdayLabels[weekday]}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5 lg:min-h-[130px]">
          <div className="flex h-full flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="lg:self-center">
              <h2 className="text-base font-semibold">連休設定</h2>
              <p className="mt-1 text-sm text-slate-500">
                開始日と終了日を選択して、連続した定休日をまとめて設定できます。
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[180px_180px_auto] lg:items-start">
              <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                開始日
                <input
                  type="date"
                  min={currentTodayKey}
                  value={rangeStartDate}
                  aria-invalid={rangeErrors.startDate ? "true" : "false"}
                  onChange={(event) => {
                    setRangeStartDate(event.target.value);
                    setRangeErrors((current) => ({
                      ...current,
                      startDate: "",
                    }));
                  }}
                  className={`h-10 rounded-md border bg-white px-3 text-sm outline-none transition focus:ring-2 focus:ring-blue-100 ${
                    rangeErrors.startDate
                      ? "border-red-400 focus:border-red-500"
                      : "border-slate-300 focus:border-blue-500"
                  }`}
                />
                <span className="min-h-4 text-xs font-semibold leading-4 text-red-600">
                  {rangeErrors.startDate}
                </span>
              </label>
              <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                終了日
                <input
                  type="date"
                  min={rangeStartDate || currentTodayKey}
                  value={rangeEndDate}
                  aria-invalid={rangeErrors.endDate ? "true" : "false"}
                  onChange={(event) => {
                    setRangeEndDate(event.target.value);
                    setRangeErrors((current) => ({
                      ...current,
                      endDate: "",
                    }));
                  }}
                  className={`h-10 rounded-md border bg-white px-3 text-sm outline-none transition focus:ring-2 focus:ring-blue-100 ${
                    rangeErrors.endDate
                      ? "border-red-400 focus:border-red-500"
                      : "border-slate-300 focus:border-blue-500"
                  }`}
                />
                <span className="min-h-4 text-xs font-semibold leading-4 text-red-600">
                  {rangeErrors.endDate}
                </span>
              </label>
              <button
                type="button"
                disabled={loadState.status === "loading"}
                onClick={openRangeConfirmation}
                className="h-10 cursor-pointer rounded-md bg-red-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-2 lg:col-span-1 lg:mt-[26px]"
              >
                定休日に設定
              </button>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-5">
            <button
              type="button"
              onClick={() => moveMonth(-1)}
              className="h-9 cursor-pointer rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              前月
            </button>
            <h2 className="text-base font-bold sm:text-lg">
              {monthDate.getFullYear()}年 {monthDate.getMonth() + 1}月
            </h2>
            <button
              type="button"
              onClick={() => moveMonth(1)}
              className="h-9 cursor-pointer rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              次月
            </button>
          </div>

          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-semibold text-slate-500">
            {weekdayLabels.map((label) => (
              <div key={label} className="px-1 py-2">
                {label}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {calendarDates.map((date) => {
              const dateKey = formatDateKey(date);
              const holiday = findHoliday(dateKey, items);
              const isToday = dateKey === currentTodayKey;
              const isPast = dateKey < currentTodayKey;
              const isCurrentMonth = date.getMonth() === monthDate.getMonth();
              const reservationCount = reservationCounts[dateKey] ?? 0;

              return (
                <button
                  key={dateKey}
                  type="button"
                  disabled={isPast || !isCurrentMonth || loadState.status === "loading"}
                  onClick={() => openDateConfirmation(dateKey)}
                  aria-label={`${formatDisplayDate(dateKey)}${holiday ? " 定休日" : " 営業日"}`}
                  className={[
                    "relative min-h-20 border-b border-r border-slate-200 p-1.5 text-left transition sm:min-h-28 sm:p-2",
                    isPast
                      ? "bg-gray-100 text-gray-400"
                      : holiday
                        ? "bg-red-50 text-red-800"
                        : "bg-white",
                    isToday ? "z-[1] ring-2 ring-inset ring-blue-500" : "",
                    !isCurrentMonth ? "text-slate-300 opacity-50" : "",
                    isPast || !isCurrentMonth
                      ? "cursor-default"
                      : holiday
                        ? "cursor-pointer hover:bg-red-100"
                        : "cursor-pointer hover:bg-blue-50",
                  ].join(" ")}
                >
                  <span className="text-sm font-bold">{date.getDate()}</span>
                  {holiday && isCurrentMonth ? (
                    <span
                      className={`mt-2 block text-[10px] font-bold sm:text-xs ${
                        isPast ? "text-red-500" : ""
                      }`}
                    >
                      定休日
                    </span>
                  ) : null}
                  {reservationCount > 0 && isCurrentMonth ? (
                    <span className="mt-1 block text-[10px] font-semibold text-amber-700 sm:text-xs">
                      予約 {reservationCount}件
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </section>
      </main>

      {pendingAction ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="holiday-confirm-title"
        >
          <div className="w-full max-w-md rounded-md border border-slate-200 bg-white p-6 shadow-xl">
            <h2 id="holiday-confirm-title" className="text-lg font-bold">
              {pendingAction.kind === "set-single"
                ? "定休日に設定しますか？"
                : pendingAction.kind === "remove"
                  ? "営業日に戻しますか？"
                  : pendingAction.kind === "set-range"
                    ? pendingAction.reservationCount > 0
                      ? "予約がある日が含まれています"
                      : "連休を定休日に設定しますか？"
                    : `${monthDate.getFullYear()}年${monthDate.getMonth() + 1}月の${weekdayLabels[pendingAction.weekday]}曜日を定休日に設定しますか？`}
            </h2>

            <div className="mt-4 grid gap-3 text-sm leading-6 text-slate-600">
              {pendingAction.kind === "set-single" ? (
                <>
                  <p className="font-semibold text-slate-900">
                    {formatDisplayDate(pendingAction.dateKey)}
                  </p>
                  {pendingAction.reservationCount > 0 ? (
                    <>
                      <p className="font-semibold text-amber-700">
                        この日には既に予約が{pendingAction.reservationCount}件入っています。
                      </p>
                      <p>
                        定休日に設定すると新規予約は停止されます。
                        <br />
                        既存予約は自動キャンセルされません。
                      </p>
                    </>
                  ) : null}
                </>
              ) : pendingAction.kind === "remove" ? (
                <>
                  <p className="font-semibold text-slate-900">
                    {formatDisplayDate(pendingAction.dateKey)}
                  </p>
                  {pendingAction.holiday.type === "weekly" ? (
                    <p className="font-semibold text-amber-700">
                      毎週{weekdayLabels[pendingAction.holiday.weekday ?? 0]}
                      曜日の定休日設定を解除します。
                    </p>
                  ) : null}
                </>
              ) : pendingAction.kind === "set-monthly-weekday" ? (
                <>
                  <p>
                    対象期間:
                    <br />
                    {monthDate.getFullYear()}年{monthDate.getMonth() + 1}月
                    （当月のみ）
                  </p>
                  {pendingAction.reservedDayCount > 0 ? (
                    <>
                      <p className="font-semibold text-amber-700">
                        対象期間内に既存予約がある日が
                        {pendingAction.reservedDayCount}日あります。
                      </p>
                      <p>
                        定休日に設定すると新規予約は停止されます。
                        <br />
                        既存予約は自動キャンセルされません。
                      </p>
                    </>
                  ) : null}
                </>
              ) : pendingAction.reservationCount > 0 ? (
                <>
                  <p className="font-semibold text-amber-700">
                    対象期間内に既存予約が{pendingAction.reservationCount}件あります。
                  </p>
                  <p>
                    定休日に設定すると新規予約は停止されます。
                    <br />
                    既存予約は自動キャンセルされません。
                  </p>
                  <p className="font-semibold text-slate-900">
                    本当に定休日に設定しますか？
                  </p>
                </>
              ) : (
                <>
                  <p>以下の期間を定休日に設定します。</p>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                    <dt>開始日:</dt>
                    <dd className="font-semibold text-slate-900">
                      {formatShortDate(pendingAction.startDate)}
                    </dd>
                    <dt>終了日:</dt>
                    <dd className="font-semibold text-slate-900">
                      {formatShortDate(pendingAction.endDate)}
                    </dd>
                    <dt>対象日数:</dt>
                    <dd className="font-semibold text-slate-900">
                      {pendingAction.dates.length}日間
                    </dd>
                  </dl>
                </>
              )}
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                ref={cancelButtonRef}
                type="button"
                disabled={submitting}
                onClick={() => setPendingAction(null)}
                className="h-11 cursor-pointer rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void confirmAction()}
                className={[
                  "h-11 cursor-pointer rounded-md px-3 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50",
                  pendingAction.kind === "remove"
                    ? "bg-blue-600 hover:bg-blue-700"
                    : "bg-red-600 hover:bg-red-700",
                ].join(" ")}
              >
                {submitting
                  ? "更新中..."
                  : pendingAction.kind === "set-single"
                    ? "定休日にする"
                    : pendingAction.kind === "remove"
                      ? "営業日に戻す"
                      : "設定する"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
