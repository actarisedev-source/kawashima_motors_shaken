"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  getJstDateKey,
  getJstTimeKey,
  reservationTimeSlots,
} from "@/lib/reservations/slots";
import {
  getUpcomingJstMonthRanges,
  summarizeReservationsByJstMonth,
} from "@/lib/reservations/monthly-counts";
import {
  canAssignLoanerToReservation,
  getAdminLoanerRequestLabel,
} from "@/lib/reservations/admin-loaner-request";
import {
  filterActiveAdminReservations,
  getAdminReservationSlotLabel,
  groupAdminReservationsByTime,
  isActiveAdminReservation,
} from "@/lib/reservations/admin-reservation-list";
import {
  formatLoanerDate,
  getLoanerReturnDateKey,
} from "@/lib/loaners/loaner-period";
import { loanerCategoryLabels } from "@/lib/loaners/loaner-vehicle";
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
import { AdminStatusDropdown } from "./shared/admin-status-dropdown";
import { MonthlyReservationSummaryCard } from "./monthly-reservation-summary-card";
import {
  LoanerAssignmentPicker,
  type SelectedLoaner,
} from "./loaners/loaner-assignment-picker";
import {
  LoanerCategoryBadge,
  LoanerCategoryDot,
} from "./loaners/loaner-category-badge";
import {
  LoanerAssignmentActions,
  LoanerRequestControl,
} from "./loaners/loaner-assignment-actions";

const reservationStatuses = ["受付中", "確定", "完了", "キャンセル"] as const;

type ReservationStatus = (typeof reservationStatuses)[number];

type ReservationItem = AdminReservationItem;

type PendingStatusChange = {
  reservationId: string;
  status: ReservationStatus;
};

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

function EmptyTableCellMark() {
  return (
    <>
      <span className="sr-only">該当なし</span>
      <span
        aria-hidden="true"
        className="inline-block h-px w-3 rounded-full bg-slate-400 align-middle"
      />
    </>
  );
}

function ReservationLoanerCell({ item }: { item: ReservationItem }) {
  const category = item.loanerAssignment?.vehicle.category;

  if (category) {
    const label = loanerCategoryLabels[category];
    return (
      <span
        aria-label={label}
        title={label}
        className="inline-flex h-6 w-6 items-center justify-center"
      >
        <LoanerCategoryDot category={category} className="h-4 w-4" />
      </span>
    );
  }

  if (item.loanerCarRequested === true) {
    return (
      <span className="inline-flex items-center whitespace-nowrap rounded-md bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700">
        あり
      </span>
    );
  }

  return <EmptyTableCellMark />;
}

export function AdminDashboard({
  initialReservationId = null,
}: {
  initialReservationId?: string | null;
}) {
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
  const [pendingStatusChange, setPendingStatusChange] =
    useState<PendingStatusChange | null>(null);
  const [isLoanerAssignmentOpen, setIsLoanerAssignmentOpen] = useState(false);
  const [loanerStartDate, setLoanerStartDate] = useState("");
  const [loanerEndDate, setLoanerEndDate] = useState("");
  const [selectedLoaner, setSelectedLoaner] =
    useState<SelectedLoaner | null>(null);
  const [loanerAssignmentError, setLoanerAssignmentError] = useState("");
  const [loanerAssignmentNotice, setLoanerAssignmentNotice] = useState("");
  const [isAssigningLoaner, setIsAssigningLoaner] = useState(false);
  const [printedAt, setPrintedAt] = useState(() => new Date());
  const initialReservationHandledRef = useRef(false);
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
    if (!initialReservationHandledRef.current && initialReservationId) {
      initialReservationHandledRef.current = true;
      const target = result.items.find(
        (item) =>
          item.id === initialReservationId && isActiveAdminReservation(item),
      );
      if (target) {
        const targetDate = getJstDateKey(target.reservedAt);
        const [year, monthNumber] = targetDate.split("-").map(Number);
        setSelectedDate(targetDate);
        setMonthDate(new Date(year, monthNumber - 1, 1));
        setSelectedReservation(target);
        setLoadState({ status: "ready", message: "" });
        return;
      }
    }
    setSelectedReservation((current) =>
      current
        ? (result.items?.find(
            (item) => item.id === current.id && isActiveAdminReservation(item),
          ) ?? null)
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
    void loadReservations();
  }

  function handleStatusChange(status: ReservationStatus) {
    if (!selectedReservation) {
      return;
    }

    const isPastReservation =
      getJstDateKey(selectedReservation.reservedAt) < getJstDateKey(new Date());

    if (status === "キャンセル" || (isPastReservation && status === "完了")) {
      setPendingStatusChange({
        reservationId: selectedReservation.id,
        status,
      });
      return;
    }

    void updateStatus(selectedReservation.id, status);
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

  function openLoanerAssignment() {
    if (!selectedReservation) return;
    setLoanerStartDate(getJstDateKey(selectedReservation.reservedAt));
    setLoanerEndDate("");
    setSelectedLoaner(null);
    setLoanerAssignmentError("");
    setLoanerAssignmentNotice("");
    setIsLoanerAssignmentOpen(true);
  }

  async function assignSelectedLoaner() {
    if (
      !selectedReservation ||
      !selectedLoaner ||
      !loanerStartDate ||
      !loanerEndDate ||
      isAssigningLoaner
    ) {
      return;
    }

    setIsAssigningLoaner(true);
    setLoanerAssignmentError("");
    setLoanerAssignmentNotice("");

    try {
      const response = await fetch("/api/admin/loaner-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reservationId: selectedReservation.id,
          loanerVehicleId: selectedLoaner.id,
          startDate: loanerStartDate,
          endDate: loanerEndDate,
        }),
      });
      const result = (await response.json()) as {
        ok: boolean;
        message?: string;
      };

      if (!response.ok || !result.ok) {
        setLoanerAssignmentError(
          result.message ?? "代車の割り当てに失敗しました。",
        );
        return;
      }

      await loadReservations();
      setLoanerAssignmentNotice("代車を割り当てました。");
      setIsLoanerAssignmentOpen(false);
      setSelectedLoaner(null);
    } catch {
      setLoanerAssignmentError(
        "通信に失敗しました。時間をおいてもう一度お試しください。",
      );
    } finally {
      setIsAssigningLoaner(false);
    }
  }

  async function handleLoanerWorkflowUpdated(message: string) {
    await loadReservations();
    setLoanerAssignmentError("");
    setLoanerAssignmentNotice(message);
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

  useEffect(() => {
    setIsLoanerAssignmentOpen(false);
    setLoanerStartDate("");
    setLoanerEndDate("");
    setSelectedLoaner(null);
    setLoanerAssignmentError("");
    setLoanerAssignmentNotice("");
  }, [selectedReservation?.id]);

  const activeItems = useMemo(
    () => filterActiveAdminReservations(items),
    [items],
  );
  const itemsByDate = useMemo(() => {
    const map = new Map<string, ReservationItem[]>();

    for (const item of activeItems) {
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
  }, [activeItems]);
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
  const upcomingMonthlyReservationCounts = useMemo(
    () =>
      summarizeReservationsByJstMonth(
        items,
        getUpcomingJstMonthRanges(),
      ),
    [items],
  );
  const selectedAvailability = availability[selectedDate];
  const selectedHoliday = availability[selectedDate]?.holiday ?? null;
  const selectedReservationDateIsPast = selectedReservation
    ? getJstDateKey(selectedReservation.reservedAt) < getJstDateKey(new Date())
    : false;
  const selectedReservationCanAssignLoaner = selectedReservation
    ? canAssignLoanerToReservation({
        requested: selectedReservation.loanerCarRequested,
        status: selectedReservation.status,
        reservedAt: selectedReservation.reservedAt,
      })
    : false;
  const selectedReservationStatusOptions = selectedReservation
    ? selectedReservationDateIsPast
      ? Array.from(new Set([selectedReservation.status, "完了"] as const))
      : reservationStatuses
    : reservationStatuses;
  const selectedReservationStatusDisabled =
    !selectedReservation ||
    updatingId === selectedReservation.id ||
    (selectedReservationDateIsPast && selectedReservation.status === "完了");

  const selectedItemsByTime = useMemo(() => {
    return groupAdminReservationsByTime(selectedDateItems);
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
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
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
                  ＋ 予約登録
                </button>
              </div>
            </div>

            <div
              className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4 xl:w-auto xl:min-w-[440px]"
              aria-label="今後4か月の予約件数"
            >
              {upcomingMonthlyReservationCounts.map((summary) => (
                <MonthlyReservationSummaryCard
                  key={summary.key}
                  summary={summary}
                />
              ))}
            </div>
          </div>
        </section>

        <section className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-2 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div>
                <h2 className="text-lg font-semibold">
                  {formatSelectedDate(selectedDate)} の予約
                </h2>
                {selectedHoliday ? (
                  <p className="mt-1 text-sm text-slate-500">
                    休業日{selectedHoliday.label ? `: ${selectedHoliday.label}` : ""}
                  </p>
                ) : null}
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
                    <th className="whitespace-nowrap px-3 py-3 text-center">
                      代車
                    </th>
                    <th className="px-4 py-3 text-center">ステータス</th>
                    <th className="w-10 px-4 py-3" aria-label="予約詳細" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reservationTimeSlots.map((time) => {
                    const timeItems = selectedItemsByTime.get(time) ?? [];
                    const slot = selectedAvailability?.slots?.[time];
                    const capacity = selectedHoliday ? 0 : (slot?.capacity ?? 1);
                    const isStopped = capacity === 0;

                    if (!timeItems.length) {
                      return (
                        <tr key={time} className="transition">
                          <td className="whitespace-nowrap px-4 py-4 text-base font-bold text-slate-950">
                            {time}
                          </td>
                          <td className="px-4 py-4">
                            <span
                              className={[
                                "inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ring-1",
                                isStopped
                                  ? "bg-slate-100 text-slate-500 ring-slate-200"
                                  : "bg-blue-50 text-blue-700 ring-blue-200",
                              ].join(" ")}
                            >
                              0 / {capacity}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            <span className="text-sm font-medium text-slate-500">
                              予約なし
                            </span>
                          </td>
                          <td className="px-3 py-4 text-center">
                            <EmptyTableCellMark />
                          </td>
                          <td className="px-4 py-4 text-center">
                            <EmptyTableCellMark />
                          </td>
                          <td className="px-4 py-4 text-right text-xl font-semibold text-slate-300">
                            <span aria-hidden="true">›</span>
                          </td>
                        </tr>
                      );
                    }

                    return timeItems.map((item, index) => {
                      const reservationNumber = index + 1;
                      const isFull =
                        capacity > 0 && reservationNumber >= capacity;
                      const isSelectedRow = item.id === selectedReservation?.id;
                      const selectReservation = () => {
                        setSelectedReservation(item);
                      };

                      return (
                        <tr
                          key={item.id}
                          tabIndex={0}
                          role="button"
                          onClick={selectReservation}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              selectReservation();
                            }
                          }}
                          className={[
                            "cursor-pointer transition hover:bg-slate-50/80 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-200",
                            isSelectedRow ? "bg-blue-50/40" : "",
                          ].join(" ")}
                        >
                          {index === 0 ? (
                            <td
                              rowSpan={timeItems.length}
                              className="whitespace-nowrap px-4 py-4 align-top text-base font-bold text-slate-950"
                            >
                              {time}
                            </td>
                          ) : null}
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
                              {getAdminReservationSlotLabel(index, capacity)}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            <span className="text-sm font-semibold text-blue-700">
                              {item.customerName} 様
                            </span>
                          </td>
                          <td className="px-3 py-4 text-center">
                            <ReservationLoanerCell item={item} />
                          </td>
                          <td className="px-4 py-4 text-center">
                            <span
                              className={`inline-flex w-20 items-center justify-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${statusClassName(
                                item.status,
                              )}`}
                            >
                              {item.status}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-right text-xl font-semibold text-slate-700">
                            <span aria-hidden="true">›</span>
                          </td>
                        </tr>
                      );
                    });
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
              <div>
                <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-4 sm:p-5">
                  <div className="min-w-0">
                    <p className="text-lg font-bold text-slate-950">
                      {formatDateTime(selectedReservation.reservedAt)}
                    </p>
                    <p className="mt-2 text-2xl font-bold text-slate-950">
                      {selectedReservation.customerName} 様
                    </p>
                    <div className="mt-3 text-sm">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="font-semibold text-slate-500">
                          代車
                        </span>
                        <span className="font-bold text-slate-950">
                          {getAdminLoanerRequestLabel(
                            selectedReservation.loanerCarRequested,
                          )}
                        </span>
                        <LoanerRequestControl
                          reservationId={selectedReservation.id}
                          requested={selectedReservation.loanerCarRequested}
                          assignment={selectedReservation.loanerAssignment}
                          onUpdated={handleLoanerWorkflowUpdated}
                        />
                      </div>
                      {selectedReservationCanAssignLoaner &&
                      !selectedReservation.loanerAssignment ? (
                        <p className="mt-2 w-fit rounded-md bg-amber-50 px-2.5 py-2 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
                          代車はまだ割り当てられていません
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="w-40 shrink-0 text-sm">
                    <AdminStatusDropdown
                      value={selectedReservation.status}
                      options={selectedReservationStatusOptions}
                      disabled={selectedReservationStatusDisabled}
                      label="ステータス"
                      onChange={(status) =>
                        handleStatusChange(status as ReservationStatus)
                      }
                      buttonClassName={`h-8 min-h-8 w-28 rounded-full border px-3 text-center text-sm font-semibold ring-1 transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 ${statusClassName(
                        selectedReservation.status,
                      )}`}
                    />
                    {selectedReservationDateIsPast ? (
                      <span className="mt-2 block w-40 whitespace-normal text-left text-xs font-medium leading-relaxed text-slate-500">
                        {selectedReservation.status === "完了"
                          ? "完了済みの過去予約です。"
                          : (
                              <>
                                過去の予約は、「完了」
                                <br />
                                への変更のみ可能です。
                              </>
                            )}
                      </span>
                    ) : null}
                  </div>
                </div>
                {selectedReservation.loanerAssignment ? (
                  <section className="border-b border-slate-200 bg-slate-50/70 px-4 py-4 sm:px-5">
                    <h3 className="text-sm font-bold text-slate-800">割り当て済み代車</h3>
                    <div className="mt-3 rounded-md border border-blue-100 bg-white p-4">
                      <LoanerCategoryBadge
                        category={selectedReservation.loanerAssignment.vehicle.category}
                      />
                      <p className="mt-2 font-bold text-slate-950">
                        {selectedReservation.loanerAssignment.vehicle.displayName}
                      </p>
                      <p className="mt-1 text-sm font-medium text-slate-600">
                        {selectedReservation.loanerAssignment.vehicle.vehicleName} / {selectedReservation.loanerAssignment.vehicle.plateNumber}
                      </p>
                      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                        <div>
                          <dt className="font-semibold text-slate-500">貸出開始日</dt>
                          <dd className="mt-1 font-bold text-slate-800">
                            {formatLoanerDate(
                              getJstDateKey(
                                selectedReservation.loanerAssignment.scheduledStartAt,
                              ),
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt className="font-semibold text-slate-500">返却予定日</dt>
                          <dd className="mt-1 font-bold text-slate-800">
                            {formatLoanerDate(
                              getLoanerReturnDateKey(
                                selectedReservation.loanerAssignment.scheduledEndAt,
                              ),
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt className="font-semibold text-slate-500">状態</dt>
                          <dd className="mt-1 font-bold text-slate-800">
                            貸出中
                          </dd>
                        </div>
                      </dl>
                      <LoanerAssignmentActions
                        assignment={selectedReservation.loanerAssignment}
                        onUpdated={handleLoanerWorkflowUpdated}
                      />
                    </div>
                  </section>
                ) : selectedReservationCanAssignLoaner ? (
                  <section className="border-b border-slate-200 px-4 py-4 sm:px-5">
                    {!isLoanerAssignmentOpen ? (
                      <button
                        type="button"
                        onClick={openLoanerAssignment}
                        className="h-11 w-full rounded-md bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 sm:w-auto"
                      >
                        空いている代車を検索
                      </button>
                    ) : (
                      <div className="grid gap-4">
                        <LoanerAssignmentPicker
                          startDate={loanerStartDate}
                          endDate={loanerEndDate}
                          selectedLoaner={selectedLoaner}
                          onStartDateChange={(date) => {
                            setLoanerStartDate(date);
                            setSelectedLoaner(null);
                            setLoanerAssignmentError("");
                          }}
                          onEndDateChange={(date) => {
                            setLoanerEndDate(date);
                            setSelectedLoaner(null);
                            setLoanerAssignmentError("");
                          }}
                          onSelectLoaner={(loaner) => {
                            setSelectedLoaner(loaner);
                            setLoanerAssignmentError("");
                          }}
                        />
                        {loanerAssignmentError ? (
                          <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                            {loanerAssignmentError}
                          </p>
                        ) : null}
                        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                          <button
                            type="button"
                            disabled={isAssigningLoaner}
                            onClick={() => setIsLoanerAssignmentOpen(false)}
                            className="h-10 rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                          >
                            キャンセル
                          </button>
                          <button
                            type="button"
                            disabled={!selectedLoaner || isAssigningLoaner}
                            onClick={() => void assignSelectedLoaner()}
                            className="h-10 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                          >
                            {isAssigningLoaner ? (
                              <span className="inline-flex items-center gap-2">
                                <span
                                  className="h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-white"
                                  aria-hidden="true"
                                />
                                割り当て中...
                              </span>
                            ) : (
                              "代車を割り当てる"
                            )}
                          </button>
                        </div>
                      </div>
                    )}
                  </section>
                ) : null}
                {loanerAssignmentNotice ? (
                  <p className="border-b border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 sm:px-5">
                    {loanerAssignmentNotice}
                  </p>
                ) : null}
                <ReservationCustomerSummary
                  customer={selectedCustomer}
                  loading={customerLoading}
                  error={customerError}
                />
                <div className="border-t border-slate-200 px-4 py-4 text-sm sm:px-5">
                  <p className="font-semibold text-slate-500">受付番号</p>
                  <p className="mt-1 break-all font-semibold text-slate-700">
                    {selectedReservation.id}
                  </p>
                </div>
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
      {pendingStatusChange ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-5"
          role="dialog"
          aria-modal="true"
          aria-labelledby="status-confirm-title"
        >
          <div className="w-full max-w-md rounded-md bg-white p-6 shadow-xl">
            <h2 id="status-confirm-title" className="text-lg font-bold">
              {pendingStatusChange.status === "キャンセル"
                ? "予約キャンセル確認"
                : "ステータス変更確認"}
            </h2>
            <p className="mt-4 text-sm font-medium text-slate-700">
              {pendingStatusChange.status === "キャンセル"
                ? "この予約をキャンセルしますか？"
                : "この予約を完了に変更しますか？"}
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setPendingStatusChange(null)}
                className="h-11 rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => {
                  const nextStatusChange = pendingStatusChange;
                  setPendingStatusChange(null);
                  void updateStatus(
                    nextStatusChange.reservationId,
                    nextStatusChange.status,
                  );
                }}
                className="h-11 rounded-md bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700"
              >
                {pendingStatusChange.status === "キャンセル"
                  ? "予約をキャンセル"
                  : "変更する"}
              </button>
            </div>
          </div>
        </div>
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
              <th className="w-[11%] border border-slate-400 px-3 py-2">時間</th>
              <th className="w-[20%] border border-slate-400 px-3 py-2">お名前</th>
              <th className="w-[18%] border border-slate-400 px-3 py-2">車種</th>
              <th className="w-[18%] border border-slate-400 px-3 py-2">ナンバー</th>
              <th className="w-[33%] border border-slate-400 px-3 py-2">代車情報</th>
            </tr>
          </thead>
          <tbody>
            {selectedDateItems.map((item) => (
              <tr key={item.id}>
                <td className="border border-slate-400 px-3 py-2 font-semibold">
                  {getJstTimeKey(item.reservedAt)}
                </td>
                <td className="border border-slate-400 px-3 py-2">
                  {item.customerName} 様
                </td>
                <td className="border border-slate-400 px-3 py-2">
                  {item.vehicleModel}
                </td>
                <td className="border border-slate-400 px-3 py-2">
                  {item.licensePlate || "未登録"}
                </td>
                <td className="border border-slate-400 px-3 py-2 align-middle">
                  {item.loanerCarRequested === true ? (
                    item.loanerAssignment ? (
                      <div className="grid gap-0.5 text-xs leading-tight">
                        <p>
                          <span className="font-semibold">代車：</span>
                          {item.loanerAssignment.vehicle.displayName}
                          <span>
                            （{item.loanerAssignment.vehicle.plateNumber}）
                          </span>
                        </p>
                        <p className="whitespace-nowrap">
                          <span className="font-semibold">貸出期間：</span>
                          {formatLoanerDate(
                            getJstDateKey(
                              item.loanerAssignment.scheduledStartAt,
                            ),
                          )}
                          <span> ～ </span>
                          {formatLoanerDate(
                            getLoanerReturnDateKey(
                              item.loanerAssignment.scheduledEndAt,
                            ),
                          )}
                        </p>
                      </div>
                    ) : (
                      <p className="text-xs font-semibold leading-tight">未割当</p>
                    )
                  ) : item.loanerCarRequested === false ? (
                    <p className="text-xs font-semibold leading-tight">代車希望なし</p>
                  ) : (
                    <p className="text-xs leading-tight">代車希望 —</p>
                  )}
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
