"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  getJstDateKey,
  getJstTimeKey,
  reservationTimeSlots,
} from "@/lib/reservations/slots";

const reservationStatuses = ["受付中", "確定", "完了", "キャンセル"] as const;
const weekdayLabels = ["日", "月", "火", "水", "木", "金", "土"];

type ReservationStatus = (typeof reservationStatuses)[number];

type ReservationItem = {
  id: string;
  customerId: string;
  reservedAt: string;
  customerName: string;
  phone: string;
  vehicleModel: string;
  status: ReservationStatus;
  createdAt: string;
};

type DayAvailability = {
  totalReserved: number;
  totalCapacity: number;
  holiday: {
    id: string;
    type: "single" | "weekly";
    label: string | null;
  } | null;
};

type AvailabilityResponse = {
  ok: boolean;
  message?: string;
  days?: Record<string, DayAvailability>;
};

type DashboardVehicleItem = {
  id: string;
  customerId: string;
  customerName: string;
  phone: string;
  modelName: string;
  shakenExpiryDate: string | null;
  shakenExpiryStatus: "expired" | "soon" | "active" | "unknown";
  shakenExpiryLabel: string;
};

type DashboardSummary = {
  kpis: {
    totalCustomers: number;
    totalVehicles: number;
    currentMonthReservations: number;
    expiringSoonVehicles: number;
    expiredVehicles: number;
  };
  expiringSoonVehicles: DashboardVehicleItem[];
  expiredVehicles: DashboardVehicleItem[];
};

type DashboardResponse = {
  ok: boolean;
  message?: string;
  kpis?: DashboardSummary["kpis"];
  expiringSoonVehicles?: DashboardVehicleItem[];
  expiredVehicles?: DashboardVehicleItem[];
};

type LoadState =
  | { status: "loading"; message: "読み込み中です。" }
  | { status: "ready"; message: "" }
  | { status: "error"; message: string };

const formatMonth = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

const formatDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;

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
  }).format(new Date(`${value}T00:00:00+09:00`));

const formatSelectedDate = (dateKey: string) =>
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

const statusCalendarClassName = (status: ReservationStatus) => {
  switch (status) {
    case "確定":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "完了":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "キャンセル":
      return "border-zinc-200 bg-zinc-100 text-zinc-500";
    default:
      return "border-amber-200 bg-amber-50 text-amber-700";
  }
};

function VehicleExpiryList({
  title,
  description,
  emptyMessage,
  items,
  tone,
}: {
  title: string;
  description: string;
  emptyMessage: string;
  items: DashboardVehicleItem[];
  tone: "soon" | "expired";
}) {
  const badgeClassName =
    tone === "expired"
      ? "bg-red-50 text-red-700 ring-red-200"
      : "bg-amber-50 text-amber-700 ring-amber-200";

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-2 border-b border-slate-200 px-4 py-4 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-slate-500">{description}</p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-sm font-semibold ring-1 ${badgeClassName}`}
          >
            {items.length}件
          </span>
        </div>
      </div>
      {items.length ? (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[620px] border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-5 py-3">顧客名</th>
                  <th className="px-5 py-3">電話番号</th>
                  <th className="px-5 py-3">車種</th>
                  <th className="px-5 py-3">車検満了日</th>
                  <th className="px-5 py-3">詳細</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="px-5 py-4 font-semibold text-slate-950">
                      {item.customerName}
                    </td>
                    <td className="px-5 py-4 text-slate-600">
                      {item.phone || "未登録"}
                    </td>
                    <td className="px-5 py-4 text-slate-600">
                      {item.modelName}
                    </td>
                    <td className="px-5 py-4">
                      <div className="grid gap-1">
                        <span className="font-semibold text-slate-950">
                          {item.shakenExpiryDate
                            ? formatDate(item.shakenExpiryDate)
                            : "未登録"}
                        </span>
                        <span
                          className={`w-fit rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${badgeClassName}`}
                        >
                          {item.shakenExpiryLabel}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <Link
                        href={`/admin/customers/${item.customerId}`}
                        className="text-sm font-semibold text-blue-700 transition hover:text-blue-900"
                      >
                        顧客詳細
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="divide-y divide-slate-100 md:hidden">
            {items.map((item) => (
              <Link
                key={item.id}
                href={`/admin/customers/${item.customerId}`}
                className="block p-4 transition hover:bg-slate-50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-950">
                      {item.customerName}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      {item.phone || "電話番号未登録"}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${badgeClassName}`}
                  >
                    {item.shakenExpiryLabel}
                  </span>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-slate-500">車種</dt>
                    <dd className="mt-1 font-semibold text-slate-950">
                      {item.modelName}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">車検満了日</dt>
                    <dd className="mt-1 font-semibold text-slate-950">
                      {item.shakenExpiryDate
                        ? formatDate(item.shakenExpiryDate)
                        : "未登録"}
                    </dd>
                  </div>
                </dl>
              </Link>
            ))}
          </div>
        </>
      ) : (
        <p className="px-5 py-10 text-center text-sm text-slate-500">
          {emptyMessage}
        </p>
      )}
    </section>
  );
}

export function AdminDashboard() {
  const [items, setItems] = useState<ReservationItem[]>([]);
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary>({
    kpis: {
      totalCustomers: 0,
      totalVehicles: 0,
      currentMonthReservations: 0,
      expiringSoonVehicles: 0,
      expiredVehicles: 0,
    },
    expiringSoonVehicles: [],
    expiredVehicles: [],
  });
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
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const month = formatMonth(monthDate);
  const calendarDates = useMemo(() => getCalendarDates(monthDate), [monthDate]);

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

  async function loadDashboard() {
    const response = await fetch("/api/admin/dashboard", {
      cache: "no-store",
    });
    const result = (await response.json()) as DashboardResponse;

    if (
      !response.ok ||
      !result.ok ||
      !result.kpis ||
      !result.expiringSoonVehicles ||
      !result.expiredVehicles
    ) {
      setLoadState({
        status: "error",
        message: result.message ?? "ダッシュボード集計の取得に失敗しました。",
      });
      return;
    }

    setDashboardSummary({
      kpis: result.kpis,
      expiringSoonVehicles: result.expiringSoonVehicles,
      expiredVehicles: result.expiredVehicles,
    });
  }

  async function refreshAll() {
    await Promise.all([loadReservations(), loadAvailability(), loadDashboard()]);
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

  async function handleLogout() {
    await fetch("/api/admin/logout", {
      method: "POST",
    });
    window.location.href = "/admin/login";
  }

  function moveMonth(amount: number) {
    const nextMonth = new Date(
      monthDate.getFullYear(),
      monthDate.getMonth() + amount,
      1,
    );
    setMonthDate(nextMonth);
    setSelectedDate(formatDateKey(nextMonth));
    setSelectedReservation(null);
  }

  useEffect(() => {
    void refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const summary = useMemo(
    () =>
      reservationStatuses.map((status) => ({
        status,
        count: items.filter((item) => item.status === status).length,
      })),
    [items],
  );

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
  const selectedHoliday = availability[selectedDate]?.holiday ?? null;

  const selectedItemsByTime = useMemo(() => {
    const map = new Map<string, ReservationItem[]>();

    for (const item of selectedDateItems) {
      const time = getJstTimeKey(item.reservedAt);
      map.set(time, [...(map.get(time) ?? []), item]);
    }

    return map;
  }, [selectedDateItems]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-blue-700">
                Kawashima Motors
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-normal sm:text-3xl">
                予約管理
              </h1>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link
                href="/admin/customers"
                className="flex h-10 items-center justify-center rounded-md border border-blue-200 bg-white px-4 text-sm font-semibold text-blue-700 shadow-sm transition hover:bg-blue-50"
              >
                顧客管理
              </Link>
              <Link
                href="/admin/settings/holidays"
                className="flex h-10 items-center justify-center rounded-md border border-blue-200 bg-white px-4 text-sm font-semibold text-blue-700 shadow-sm transition hover:bg-blue-50"
              >
                定休日管理
              </Link>
              <button
                type="button"
                onClick={() => void refreshAll()}
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
          <div className="grid gap-3 sm:grid-cols-5">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-sm text-slate-500">総顧客数</p>
              <p className="mt-2 text-2xl font-bold text-slate-950">
                {dashboardSummary.kpis.totalCustomers}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-sm text-slate-500">総車両数</p>
              <p className="mt-2 text-2xl font-bold text-slate-950">
                {dashboardSummary.kpis.totalVehicles}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-sm text-slate-500">今月予約数</p>
              <p className="mt-2 text-2xl font-bold text-slate-950">
                {dashboardSummary.kpis.currentMonthReservations}
              </p>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm text-amber-700">車検30日以内</p>
              <p className="mt-2 text-2xl font-bold text-amber-900">
                {dashboardSummary.kpis.expiringSoonVehicles}
              </p>
            </div>
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <p className="text-sm text-red-700">車検期限切れ</p>
              <p className="mt-2 text-2xl font-bold text-red-900">
                {dashboardSummary.kpis.expiredVehicles}
              </p>
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
        </div>
      </header>

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

        <section className="grid gap-6 lg:grid-cols-2">
          <VehicleExpiryList
            title="車検30日以内"
            description="満了日が近い車両です。早めの案内対象として確認できます。"
            emptyMessage="30日以内の車検満了車両はありません。"
            items={dashboardSummary.expiringSoonVehicles}
            tone="soon"
          />
          <VehicleExpiryList
            title="車検期限切れ"
            description="満了日を過ぎている車両です。優先して確認してください。"
            emptyMessage="期限切れの車両はありません。"
            items={dashboardSummary.expiredVehicles}
            tone="expired"
          />
        </section>

        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div>
              <h2 className="text-base font-semibold">予約カレンダー</h2>
              <p className="mt-1 text-sm text-slate-500">
                日付を選択すると時間枠ごとの予約を確認できます。
              </p>
            </div>
            <div className="flex items-center justify-between gap-2 sm:justify-end">
              <button
                type="button"
                onClick={() => moveMonth(-1)}
                className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                前月
              </button>
              <p className="min-w-28 text-center text-base font-bold">
                {monthDate.getFullYear()}年 {monthDate.getMonth() + 1}月
              </p>
              <button
                type="button"
                onClick={() => moveMonth(1)}
                className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                次月
              </button>
            </div>
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
              const dateItems = itemsByDate.get(dateKey) ?? [];
              const isCurrentMonth = date.getMonth() === monthDate.getMonth();
              const isSelected = dateKey === selectedDate;
              const holiday = availability[dateKey]?.holiday;

              return (
                <button
                  key={dateKey}
                  type="button"
                  onClick={() => {
                    setSelectedDate(dateKey);
                    setSelectedReservation(null);
                  }}
                  className={[
                    "min-h-24 border-b border-r border-slate-100 p-2 text-left transition sm:min-h-32",
                    isSelected ? "bg-blue-50 ring-2 ring-inset ring-blue-500" : "",
                    holiday ? "bg-slate-100 text-slate-400" : "bg-white",
                    !isCurrentMonth ? "text-slate-300" : "",
                    !holiday && !isSelected ? "hover:bg-blue-50/60" : "",
                  ].join(" ")}
                >
                  <div className="flex items-start justify-between gap-1">
                    <span className="text-sm font-bold">{date.getDate()}</span>
                    {isCurrentMonth && dateItems.length ? (
                      <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[11px] font-bold text-white">
                        {dateItems.length}件
                      </span>
                    ) : null}
                  </div>
                  {isCurrentMonth && holiday ? (
                    <span className="mt-2 block text-[11px] font-semibold">
                      休業
                    </span>
                  ) : null}
                  <div className="mt-2 hidden gap-1 sm:grid">
                    {dateItems.slice(0, 3).map((item) => (
                      <span
                        key={item.id}
                        className={`truncate rounded border px-1.5 py-0.5 text-[11px] font-semibold ${statusCalendarClassName(
                          item.status,
                        )}`}
                      >
                        {getJstTimeKey(item.reservedAt)} {item.customerName}
                      </span>
                    ))}
                    {dateItems.length > 3 ? (
                      <span className="text-[11px] font-semibold text-slate-500">
                        +{dateItems.length - 3}件
                      </span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1fr_360px]">
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
              {selectedDateItems.length ? (
                <span className="w-fit rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700 ring-1 ring-blue-100">
                  {selectedDateItems.length}件
                </span>
              ) : null}
            </div>
            <div className="grid gap-3 p-4 sm:p-5">
              {reservationTimeSlots.map((time) => {
                const timeItems = selectedItemsByTime.get(time) ?? [];

                return (
                  <div
                    key={time}
                    className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[72px_1fr]"
                  >
                    <div className="text-sm font-bold text-slate-950">{time}</div>
                    <div className="grid gap-2">
                      {timeItems.length ? (
                        timeItems.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setSelectedReservation(item)}
                            className={[
                              "rounded-lg border bg-white p-3 text-left shadow-sm transition hover:border-blue-300 hover:bg-blue-50/40",
                              selectedReservation?.id === item.id
                                ? "border-blue-500 ring-2 ring-blue-100"
                                : "border-slate-200",
                            ].join(" ")}
                          >
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <p className="font-semibold text-slate-950">
                                  {item.customerName}
                                </p>
                                <p className="mt-1 text-sm text-slate-500">
                                  {item.vehicleModel} / {item.phone || "電話番号未登録"}
                                </p>
                              </div>
                              <span
                                className={`w-fit rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${statusClassName(
                                  item.status,
                                )}`}
                              >
                                {item.status}
                              </span>
                            </div>
                          </button>
                        ))
                      ) : (
                        <p className="rounded-md border border-dashed border-slate-200 bg-white px-3 py-2 text-sm text-slate-400">
                          予約なし
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <aside className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-4 sm:px-5">
              <h2 className="text-base font-semibold">予約詳細</h2>
            </div>
            {selectedReservation ? (
              <div className="grid gap-5 p-4 sm:p-5">
                <div>
                  <p className="text-sm text-slate-500">予約日時</p>
                  <p className="mt-1 text-lg font-bold text-slate-950">
                    {formatDateTime(selectedReservation.reservedAt)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-slate-500">顧客名</p>
                  <p className="mt-1 font-semibold text-slate-950">
                    {selectedReservation.customerName}
                  </p>
                  <Link
                    href={`/admin/customers/${selectedReservation.customerId}`}
                    className="mt-2 inline-flex text-sm font-semibold text-blue-700 transition hover:text-blue-900"
                  >
                    顧客詳細を見る
                  </Link>
                </div>
                <dl className="grid gap-4 text-sm">
                  <div>
                    <dt className="text-slate-500">電話番号</dt>
                    <dd className="mt-1 font-semibold text-slate-950">
                      {selectedReservation.phone || "未登録"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">車種</dt>
                    <dd className="mt-1 font-semibold text-slate-950">
                      {selectedReservation.vehicleModel}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">受付番号</dt>
                    <dd className="mt-1 break-all font-semibold text-slate-950">
                      {selectedReservation.id}
                    </dd>
                  </div>
                </dl>
                <div>
                  <label className="text-sm font-semibold text-slate-700">
                    ステータス
                    <select
                      value={selectedReservation.status}
                      disabled={updatingId === selectedReservation.id}
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
                  </label>
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
    </div>
  );
}
