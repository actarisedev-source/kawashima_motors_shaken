"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getJstDateKey,
  getJstTimeKey,
  reservationTimeSlots,
} from "@/lib/reservations/slots";
import { AdminHeader } from "./admin-header";
import {
  AdminNewReservationModal,
  type AdminReservationItem,
} from "./admin-new-reservation-modal";
import {
  ReservationCustomerDetail,
  ReservationCustomerSummary,
} from "./reservation-customer-summary";
import {
  AdminDateCalendarModal,
  formatAdminCalendarMonth as formatMonth,
  formatAdminCalendarSelectedDate as formatSelectedDate,
  type AdminCalendarDayAvailability,
  type AdminCalendarReservationCounts,
} from "./shared/admin-date-calendar-modal";

const reservationStatuses = ["受付中", "確定", "完了", "キャンセル"] as const;

type ReservationStatus = (typeof reservationStatuses)[number];

type ReservationItem = AdminReservationItem;

type SlotAvailability = {
  time: string;
  reservedCount: number;
  capacity: number;
  available: boolean;
};

type DayAvailability = AdminCalendarDayAvailability & {
  totalReserved: number;
  totalCapacity: number;
  slots: Record<string, SlotAvailability>;
};

type AvailabilityResponse = {
  ok: boolean;
  message?: string;
  days?: Record<string, DayAvailability>;
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
  const [availability, setAvailability] = useState<
    Record<string, DayAvailability>
  >({});
  const [loadState, setLoadState] = useState<LoadState>({
    status: "loading",
    message: "読み込み中です。",
  });
  const [monthDate, setMonthDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState(() =>
    getJstDateKey(new Date()),
  );
  const [selectedReservation, setSelectedReservation] =
    useState<ReservationItem | null>(null);
  const [selectedCustomer, setSelectedCustomer] =
    useState<ReservationCustomerDetail | null>(null);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [customerError, setCustomerError] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isNewReservationOpen, setIsNewReservationOpen] = useState(false);
  const [printedAt, setPrintedAt] = useState(() => new Date());

  const month = formatMonth(monthDate);
  const selectedCustomerId = selectedReservation?.customerId ?? null;

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
    setSelectedReservation((current) =>
      current
        ? (result.items?.find((item) => item.id === current.id) ?? null)
        : current,
    );
    setLoadState({ status: "ready", message: "" });
  }

  async function loadAvailability() {
    const response = await fetch(`/api/reservations/availability?month=${month}`, {
      cache: "no-store",
    });
    const result = (await response.json()) as AvailabilityResponse;

    if (!response.ok || !result.ok || !result.days) {
      setAvailability({});
      setLoadState({
        status: "error",
        message: result.message ?? "休業日情報の取得に失敗しました。",
      });
      return;
    }

    setAvailability(result.days);
  }

  async function refreshAll() {
    await Promise.all([loadReservations(), loadAvailability()]);
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
    setSelectedReservation((current) =>
      current?.id === id ? { ...current, status } : current,
    );
    setLoadState({ status: "ready", message: "" });
    setUpdatingId(null);
  }

  function moveMonth(amount: number) {
    const nextMonth = new Date(
      monthDate.getFullYear(),
      monthDate.getMonth() + amount,
      1,
    );
    setMonthDate(nextMonth);
  }

  function selectDate(dateKey: string, closeCalendar = false) {
    const [year, monthNumber] = dateKey.split("-").map(Number);

    setSelectedDate(dateKey);
    setSelectedReservation(null);

    if (
      year !== monthDate.getFullYear() ||
      monthNumber !== monthDate.getMonth() + 1
    ) {
      setMonthDate(new Date(year, monthNumber - 1, 1));
    }

    if (closeCalendar) {
      setIsCalendarOpen(false);
    }
  }

  function selectRelativeDate(dayOffset: number) {
    const date = new Date();
    date.setDate(date.getDate() + dayOffset);
    selectDate(getJstDateKey(date));
  }

  function printSelectedReservations() {
    setPrintedAt(new Date());
    window.setTimeout(() => window.print(), 0);
  }

  function handleReservationCreated(item: ReservationItem) {
    const dateKey = getJstDateKey(item.reservedAt);

    setIsNewReservationOpen(false);
    setItems((currentItems) => [
      item,
      ...currentItems.filter((currentItem) => currentItem.id !== item.id),
    ]);
    selectDate(dateKey);
    setSelectedReservation(item);
    setLoadState({ status: "ready", message: "" });
    void refreshAll();
  }

  useEffect(() => {
    void refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  useEffect(() => {
    if (!selectedCustomerId) {
      setSelectedCustomer(null);
      setCustomerLoading(false);
      setCustomerError("");
      return;
    }

    const controller = new AbortController();
    setSelectedCustomer(null);
    setCustomerLoading(true);
    setCustomerError("");

    void fetch(`/api/admin/customers/${selectedCustomerId}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => ({
        response,
        result: (await response.json()) as {
          ok: boolean;
          customer?: ReservationCustomerDetail;
          message?: string;
        },
      }))
      .then(({ response, result }) => {
        if (!response.ok || !result.ok || !result.customer) {
          setCustomerError(
            result.message ?? "顧客情報の取得に失敗しました。",
          );
          return;
        }

        setSelectedCustomer(result.customer);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setCustomerError("顧客情報の取得に失敗しました。");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setCustomerLoading(false);
        }
      });

    return () => controller.abort();
  }, [selectedCustomerId]);

  const itemsByDate = useMemo(() => {
    const map = new Map<string, ReservationItem[]>();

    for (const item of items) {
      const dateKey = getJstDateKey(item.reservedAt);
      map.set(dateKey, [...(map.get(dateKey) ?? []), item]);
    }

    for (const [dateKey, dateItems] of map.entries()) {
      map.set(
        dateKey,
        [...dateItems].sort(
          (a, b) =>
            new Date(a.reservedAt).getTime() - new Date(b.reservedAt).getTime(),
        ),
      );
    }

    return map;
  }, [items]);

  const selectedDateItems = useMemo(
    () => itemsByDate.get(selectedDate) ?? [],
    [itemsByDate, selectedDate],
  );
  const reservationCountsByDate = useMemo(() => {
    const counts: Record<string, AdminCalendarReservationCounts> = {};

    for (const [dateKey, dateItems] of itemsByDate.entries()) {
      counts[dateKey] = {
        accepting: dateItems.filter((item) => item.status === "受付中").length,
        confirmed: dateItems.filter((item) => item.status === "確定").length,
      };
    }

    return counts;
  }, [itemsByDate]);
  const selectedAvailability = availability[selectedDate];
  const selectedHoliday = availability[selectedDate]?.holiday ?? null;
  const selectedDateIsPast = selectedDate < getJstDateKey(new Date());

  const selectedItemsByTime = useMemo(() => {
    const map = new Map<string, ReservationItem[]>();

    for (const item of selectedDateItems) {
      const time = getJstTimeKey(item.reservedAt);
      map.set(time, [...(map.get(time) ?? []), item]);
    }

    return map;
  }, [selectedDateItems]);

  return (
    <>
    <div className="admin-reservation-screen min-h-screen bg-slate-50 text-slate-950">
      <AdminHeader title="予約管理" onRefresh={refreshAll} />

      <main className="mx-auto grid max-w-7xl gap-6 px-5 py-6 sm:px-6 lg:px-8">
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

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-end gap-2 sm:gap-3">
            <div className="grid gap-1.5 text-sm font-semibold text-slate-700">
              日付選択
              <button
                type="button"
                onClick={() => setIsCalendarOpen(true)}
                className="flex h-11 min-w-[190px] cursor-pointer items-center justify-between gap-3 rounded-md border border-slate-300 bg-white px-3 text-left text-sm font-semibold text-slate-950 outline-none transition hover:border-blue-300 hover:bg-blue-50 focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                aria-haspopup="dialog"
                aria-expanded={isCalendarOpen}
              >
                <span>{formatSelectedDate(selectedDate)}</span>
                <span className="text-blue-600" aria-hidden="true">
                  ▼
                </span>
              </button>
            </div>
            <div className="flex flex-wrap gap-2 sm:gap-3">
              <button
                type="button"
                onClick={() => selectRelativeDate(0)}
                className="h-11 cursor-pointer rounded-md border border-blue-200 bg-white px-4 text-sm font-semibold text-blue-700 shadow-sm transition hover:bg-blue-50"
              >
                今日
              </button>
              <button
                type="button"
                onClick={() => setIsNewReservationOpen(true)}
                className="h-11 cursor-pointer rounded-md bg-blue-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
              >
                ＋ 新規予約
              </button>
            </div>
          </div>
        </section>

        <section className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-2 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div>
                <h2 className="text-base font-semibold">
                  {formatSelectedDate(selectedDate)} の予約
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {selectedHoliday
                    ? `休業日${selectedHoliday.label ? `: ${selectedHoliday.label}` : ""}`
                    : `${selectedDateItems.length}件の予約があります。`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {selectedDateItems.length ? (
                  <span className="w-fit rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700 ring-1 ring-blue-100">
                    {selectedDateItems.length}件
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={printSelectedReservations}
                  className="h-9 cursor-pointer rounded-md border border-blue-200 bg-white px-3 text-sm font-semibold text-blue-700 shadow-sm transition hover:bg-blue-50"
                >
                  印刷
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] border-collapse text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500">
                  <tr>
                    <th className="px-4 py-3">時間</th>
                    <th className="px-4 py-3">予約状況</th>
                    <th className="px-4 py-3">予約内容</th>
                    <th className="px-4 py-3">ステータス</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reservationTimeSlots.map((time) => {
                    const timeItems = selectedItemsByTime.get(time) ?? [];
                    const slot = selectedAvailability?.slots?.[time];
                    const reservedCount = slot?.reservedCount ?? timeItems.length;
                    const capacity = selectedHoliday ? 0 : (slot?.capacity ?? 1);
                    const isStopped = capacity === 0;
                    const isFull = capacity > 0 && reservedCount >= capacity;

                    return (
                      <tr key={time} className="transition hover:bg-slate-50/80">
                        <td className="whitespace-nowrap px-4 py-4 text-base font-bold text-slate-950">
                          {time}
                        </td>
                        <td className="px-4 py-4">
                          <span
                            className={[
                              "inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ring-1",
                              isStopped
                                ? "bg-slate-100 text-slate-500 ring-slate-200"
                                : isFull
                                  ? "bg-red-50 text-red-700 ring-red-200"
                                  : "bg-blue-50 text-blue-700 ring-blue-200",
                            ].join(" ")}
                          >
                            {reservedCount} / {capacity}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          {timeItems.length ? (
                            <div className="grid gap-1.5">
                              {timeItems.map((item) => (
                                <button
                                  key={item.id}
                                  type="button"
                                  onClick={() => setSelectedReservation(item)}
                                  className={[
                                    "w-fit rounded-md px-2 py-1 text-left text-sm font-semibold transition",
                                    selectedReservation?.id === item.id
                                      ? "bg-blue-50 text-blue-700 ring-1 ring-blue-200"
                                      : "text-blue-700 hover:bg-blue-50",
                                  ].join(" ")}
                                >
                                  {item.customerName} 様
                                </button>
                              ))}
                            </div>
                          ) : (
                            <span className="text-sm font-medium text-slate-500">
                              予約なし
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          {timeItems.length ? (
                            <div className="flex flex-wrap gap-1.5">
                              {timeItems.map((item) => (
                                <button
                                  key={item.id}
                                  type="button"
                                  onClick={() => setSelectedReservation(item)}
                                  className={`w-fit rounded-full px-2.5 py-1 text-xs font-semibold ring-1 transition hover:brightness-95 ${statusClassName(
                                    item.status,
                                  )}`}
                                >
                                  {item.status}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <span className="text-sm font-semibold text-slate-400">
                              -
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <aside className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-4 sm:px-5">
              <h2 className="text-base font-semibold">予約詳細</h2>
            </div>
            {selectedReservation ? (
              <div className="grid gap-5 p-4 sm:p-5">
                <dl className="grid gap-4 text-sm">
                  <div>
                    <dt className="text-slate-500">予約日時</dt>
                    <dd className="mt-1 text-lg font-bold text-slate-950">
                      {formatDateTime(selectedReservation.reservedAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">受付番号</dt>
                    <dd className="mt-1 break-all font-semibold text-slate-950">
                      {selectedReservation.id}
                    </dd>
                  </div>
                </dl>
                <div className="text-sm">
                  <label className="font-semibold text-slate-700">
                    ステータス
                    <select
                      value={selectedReservation.status}
                      disabled={
                        selectedDateIsPast ||
                        updatingId === selectedReservation.id
                      }
                      onChange={(event) =>
                        void updateStatus(
                          selectedReservation.id,
                          event.target.value as ReservationStatus,
                        )
                      }
                      className="mt-2 h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-600"
                    >
                      {reservationStatuses.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                    {selectedDateIsPast ? (
                      <span className="mt-2 block text-xs font-medium text-slate-500">
                        過去の予約は閲覧のみです。
                      </span>
                    ) : null}
                  </label>
                </div>
                <ReservationCustomerSummary
                  customer={selectedCustomer}
                  loading={customerLoading}
                  error={customerError}
                />
              </div>
            ) : (
              <div className="px-5 py-12 text-center text-sm text-slate-500">
                予約カードを選択すると詳細を表示します。
              </div>
            )}
          </aside>
        </section>
      </main>

      {isCalendarOpen ? (
        <AdminDateCalendarModal
          availability={availability}
          description="月全体の受付状況を確認できます。"
          monthDate={monthDate}
          onClose={() => setIsCalendarOpen(false)}
          onMoveMonth={moveMonth}
          onSelectDate={(dateKey) => selectDate(dateKey, true)}
          reservationCountsByDate={reservationCountsByDate}
          selectedDate={selectedDate}
          showReservationCounts
          title="予約カレンダー"
        />
      ) : null}
      {isNewReservationOpen ? (
        <AdminNewReservationModal
          initialDate={selectedDate}
          onClose={() => setIsNewReservationOpen(false)}
          onCreated={handleReservationCreated}
        />
      ) : null}
    </div>
    <section className="reservation-print-sheet" aria-label="選択日の予約印刷一覧">
      <header className="mb-7 border-b-2 border-slate-900 pb-4">
        <h1 className="text-2xl font-bold">川島モータース 車検予約一覧</h1>
        <div className="mt-3 flex justify-between gap-6 text-sm">
          <p>
            <span className="font-semibold">日付：</span>
            {formatSelectedDate(selectedDate)}
          </p>
          <p>
            <span className="font-semibold">印刷日時：</span>
            {formatDateTime(printedAt.toISOString())}
          </p>
        </div>
      </header>

      {selectedDateItems.length ? (
        <table className="w-full table-fixed border-collapse text-sm">
          <thead>
            <tr className="bg-slate-100 text-left">
              <th className="w-[16%] border border-slate-400 px-3 py-2">時間</th>
              <th className="w-[30%] border border-slate-400 px-3 py-2">お名前</th>
              <th className="w-[27%] border border-slate-400 px-3 py-2">車種</th>
              <th className="w-[27%] border border-slate-400 px-3 py-2">ナンバー</th>
            </tr>
          </thead>
          <tbody>
            {selectedDateItems.map((item) => (
              <tr key={item.id}>
                <td className="border border-slate-400 px-3 py-3 font-semibold">
                  {getJstTimeKey(item.reservedAt)}
                </td>
                <td className="border border-slate-400 px-3 py-3">
                  {item.customerName} 様
                </td>
                <td className="border border-slate-400 px-3 py-3">
                  {item.vehicleModel}
                </td>
                <td className="border border-slate-400 px-3 py-3">
                  {item.licensePlate || "未登録"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="border border-slate-300 px-5 py-8 text-center text-base font-semibold">
          この日の予約はありません
        </p>
      )}
    </section>
    </>
  );
}
