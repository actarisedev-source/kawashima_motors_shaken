"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addLoanerCalendarDays,
  formatLoanerCalendarDate,
  getLoanerCalendarDayDisplay,
  getLoanerCalendarAssignmentSegment,
  getLoanerCalendarJstDateKey,
  getLoanerCalendarWeekStart,
  isLoanerAssignmentOnDate,
  type LoanerCalendarAssignmentStatus,
  type LoanerCalendarResponse,
  type LoanerCalendarVehicle,
  type LoanerCalendarVehicleStatus,
} from "@/lib/loaners/loaner-calendar";
import type { LoanerHistoryItem } from "@/lib/loaners/loaner-history";
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
import { AdminInlineDatePicker } from "../../shared/admin-inline-date-picker";
import { LoanerAdminTabs } from "../loaner-admin-tabs";
import {
  LoanerCategoryBadge,
  LoanerCategoryDot,
} from "../loaner-category-badge";

const calendarStatusLabels: Record<LoanerCalendarAssignmentStatus, string> = {
  checked_out: "貸出中",
};

const calendarStatusStyles: Record<
  LoanerCalendarAssignmentStatus,
  string
> = {
  checked_out: "border-amber-500 bg-amber-500 text-slate-950",
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

function StatusLegend() {
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-semibold text-slate-600"
      aria-label="代車割当状態の凡例"
    >
      <span className="inline-flex items-center gap-2">
        <span className="h-2.5 w-7 rounded-sm bg-amber-500" aria-hidden="true" />
        貸出中
      </span>
    </div>
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

function AssignmentDetailModal({
  assignment,
  onClose,
}: {
  assignment: LoanerHistoryItem;
  onClose: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

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
        aria-labelledby="loaner-calendar-detail-title"
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-md bg-white shadow-2xl"
      >
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4">
          <div>
            <h2 id="loaner-calendar-detail-title" className="text-lg font-bold">
              代車貸出詳細
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              貸出時に保存した情報を表示しています。
            </p>
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
            <span
              className="inline-flex min-h-7 items-center rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200"
            >
              {calendarStatusLabels[assignment.status as LoanerCalendarAssignmentStatus]}
            </span>
            <LoanerCategoryBadge category={assignment.vehicle.category} />
          </div>

          <section className="rounded-md border border-slate-200 p-4">
            <p className="font-bold text-slate-950">
              {assignment.vehicle.displayName}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              {assignment.vehicle.plateNumber || "—"}
            </p>
          </section>

          <section className="rounded-md border border-slate-200 p-4">
            <h3 className="text-sm font-bold text-slate-800">お客様（保存時）</h3>
            <p className="mt-3 text-lg font-bold">
              {assignment.snapshotCustomerName || "—"}
            </p>
            <p className="mt-2 text-sm text-slate-700">
              <PhoneActions phone={assignment.snapshotPhone} />
            </p>
          </section>

          <dl className="grid gap-x-6 gap-y-4 rounded-md border border-slate-200 p-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold text-slate-500">貸出開始日</dt>
              <dd className="mt-1 text-sm font-semibold">
                {formatLoanerDate(
                  getLoanerCalendarJstDateKey(assignment.scheduledStartAt),
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-slate-500">返却予定日</dt>
              <dd className="mt-1 text-sm font-semibold">
                {formatLoanerDate(
                  getLoanerReturnDateKey(assignment.scheduledEndAt),
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-slate-500">実返却日時</dt>
              <dd className="mt-1 text-sm font-semibold">
                {formatDateTime(assignment.actualReturnedAt)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-slate-500">
                予約日時（保存時）
              </dt>
              <dd className="mt-1 text-sm font-semibold">
                {formatDateTime(assignment.snapshotReservedAt)}
              </dd>
            </div>
          </dl>

          <section className="rounded-md border border-slate-200 p-4">
            <h3 className="text-xs font-semibold text-slate-500">メモ</h3>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
              {assignment.memo || "—"}
            </p>
          </section>

          <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4">
            {assignment.reservationId && assignment.reservationExists ? (
              <Link
                href={`/admin?reservation=${assignment.reservationId}`}
                className="inline-flex h-10 items-center rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
              >
                予約詳細を開く
              </Link>
            ) : null}
            {assignment.customerId && assignment.customerExists ? (
              <Link
                href={`/admin/customers/${assignment.customerId}`}
                className="inline-flex h-10 items-center rounded-md border border-blue-200 px-4 text-sm font-semibold text-blue-700 hover:bg-blue-50"
              >
                顧客詳細を開く
              </Link>
            ) : null}
            <Link
              href="/admin/loaners/history"
              className="inline-flex h-10 items-center rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              貸出履歴を開く
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

function VehicleCell({ vehicle }: { vehicle: LoanerCalendarVehicle }) {
  return (
    <div
      className={`sticky left-0 z-10 flex min-h-[76px] items-center border-r border-slate-200 px-3 py-2 ${
        vehicle.isActive ? "bg-white" : "bg-slate-100"
      }`}
    >
      <div className="min-w-0">
        <p className="flex items-center gap-2 font-bold text-slate-950">
          <LoanerCategoryDot category={vehicle.category} />
          <span className="truncate">{vehicle.displayName}</span>
        </p>
        <p className="mt-1 truncate text-xs text-slate-500">
          {vehicle.plateNumber || "—"}
        </p>
        {!vehicle.isActive ? (
          <span className="mt-1 inline-flex rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
            使用停止
          </span>
        ) : null}
      </div>
    </div>
  );
}

function DesktopCalendar({
  dateKeys,
  holidays,
  vehicles,
  today,
  onSelectAssignment,
}: {
  dateKeys: string[];
  holidays: Set<string>;
  vehicles: LoanerCalendarVehicle[];
  today: string;
  onSelectAssignment: (assignment: LoanerHistoryItem) => void;
}) {
  const gridTemplateColumns = "220px repeat(7, minmax(145px, 1fr))";

  return (
    <div className="hidden max-h-[65vh] overflow-auto md:block">
      <div className="min-w-[1235px]">
        <div
          className="sticky top-0 z-30 grid border-b border-slate-200 bg-slate-50"
          style={{ gridTemplateColumns }}
        >
          <div className="sticky left-0 z-40 flex min-h-16 items-center border-r border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-600">
            代車
          </div>
          {dateKeys.map((dateKey) => {
            const day = getLoanerCalendarDayDisplay(dateKey);
            const isToday = dateKey === today;
            const isHoliday = holidays.has(dateKey);
            return (
              <div
                key={dateKey}
                className={`grid min-h-16 place-items-center border-r border-slate-200 px-2 py-2 text-center ${
                  isToday ? "bg-blue-50" : "bg-slate-50"
                }`}
              >
                <p
                  className={`text-sm font-bold ${
                    day.weekdayIndex === 0
                      ? "text-red-600"
                      : day.weekdayIndex === 6
                        ? "text-blue-600"
                        : "text-slate-800"
                  }`}
                >
                  {day.monthDay}({day.weekday})
                </p>
                {isHoliday ? (
                  <span className="flex items-center justify-center gap-2 text-[11px] font-semibold">
                    <span className="text-red-600">休業</span>
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>

        {vehicles.map((vehicle) => (
          <div
            key={vehicle.id}
            className="grid border-b border-slate-100"
            style={{ gridTemplateColumns }}
          >
            <VehicleCell vehicle={vehicle} />
            {dateKeys.map((dateKey, index) => (
              <div
                key={dateKey}
                className={`min-h-[76px] border-r border-slate-100 ${
                  dateKey === today ? "bg-blue-50/60" : "bg-white"
                } ${!vehicle.isActive ? "bg-slate-50" : ""}`}
                style={{ gridColumn: index + 2, gridRow: 1 }}
              />
            ))}
            {vehicle.assignments.map((assignment) => {
              const segment = getLoanerCalendarAssignmentSegment(
                assignment,
                dateKeys[0],
                dateKeys.length,
              );
              if (!segment) return null;
              const status = assignment.status as LoanerCalendarAssignmentStatus;
              return (
                <button
                  key={assignment.id}
                  type="button"
                  onClick={() => onSelectAssignment(assignment)}
                  title={`${calendarStatusLabels[status]} ${assignment.snapshotCustomerName || ""}`.trim()}
                  className={`relative z-20 mx-1 my-3 min-w-0 cursor-pointer overflow-hidden border px-2 text-left text-xs font-semibold shadow-sm transition hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-blue-300 ${calendarStatusStyles[status]} ${
                    segment.continuesBefore ? "rounded-l-none" : "rounded-l-md"
                  } ${segment.continuesAfter ? "rounded-r-none" : "rounded-r-md"}`}
                  style={{
                    gridColumn: `${segment.startIndex + 2} / span ${segment.span}`,
                    gridRow: 1,
                  }}
                >
                  <span className="block truncate">
                    {segment.continuesBefore ? "‹ " : ""}
                    {calendarStatusLabels[status]}
                    {segment.continuesAfter ? " ›" : ""}
                  </span>
                  {segment.span > 1 && assignment.snapshotCustomerName ? (
                    <span className="mt-0.5 block truncate text-[11px] opacity-90">
                      {assignment.snapshotCustomerName} 様
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function MobileCalendar({
  selectedDate,
  vehicles,
  onSelectAssignment,
}: {
  selectedDate: string;
  vehicles: LoanerCalendarVehicle[];
  onSelectAssignment: (assignment: LoanerHistoryItem) => void;
}) {
  return (
    <div className="grid gap-3 p-3 md:hidden">
      {vehicles.map((vehicle) => {
        const assignment = vehicle.assignments.find((item) =>
          isLoanerAssignmentOnDate(item, selectedDate),
        );
        const status = assignment?.status as
          | LoanerCalendarAssignmentStatus
          | undefined;

        return (
          <article
            key={vehicle.id}
            className={`rounded-md border p-4 ${
              vehicle.isActive
                ? "border-slate-200 bg-white"
                : "border-slate-200 bg-slate-100 text-slate-500"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-bold text-slate-950">
                  <LoanerCategoryDot category={vehicle.category} />
                  <span className="truncate">{vehicle.displayName}</span>
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {vehicle.plateNumber || "—"}
                </p>
              </div>
              {!vehicle.isActive ? (
                <span className="shrink-0 rounded-full bg-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600">
                  使用停止
                </span>
              ) : null}
            </div>

            {assignment && status ? (
              <button
                type="button"
                onClick={() => onSelectAssignment(assignment)}
                className="mt-4 w-full cursor-pointer rounded-md border border-amber-200 bg-amber-50 p-3 text-left text-amber-950 shadow-sm"
              >
                <span className="block text-sm font-bold">
                  {calendarStatusLabels[status]}
                </span>
                {assignment.snapshotCustomerName ? (
                  <span className="mt-1 block text-sm font-semibold">
                    {assignment.snapshotCustomerName} 様
                  </span>
                ) : null}
                <span className="mt-1 block text-xs">
                  {formatLoanerDate(
                    getLoanerCalendarJstDateKey(assignment.scheduledStartAt),
                  )}
                  {" 〜 "}
                  {formatLoanerDate(
                    getLoanerReturnDateKey(assignment.scheduledEndAt),
                  )}
                </span>
              </button>
            ) : (
              <p className="mt-4 rounded-md bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-500">
                {vehicle.isActive ? "空き" : "使用停止中"}
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}

export function LoanerCalendarDashboard({
  initialToday,
}: {
  initialToday: string;
}) {
  const today = initialToday;
  const [selectedDate, setSelectedDate] = useState(today);
  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [category, setCategory] = useState<LoanerCategory | "all">("all");
  const [assignmentStatus, setAssignmentStatus] = useState<
    LoanerCalendarAssignmentStatus | "all"
  >("all");
  const [vehicleStatus, setVehicleStatus] = useState<
    LoanerCalendarVehicleStatus | "all"
  >("all");
  const [result, setResult] = useState<LoanerCalendarResponse>({ ok: true });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedAssignment, setSelectedAssignment] =
    useState<LoanerHistoryItem | null>(null);
  const weekStart = getLoanerCalendarWeekStart(selectedDate);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedKeyword(keyword.trim());
    }, 350);
    return () => window.clearTimeout(timeoutId);
  }, [keyword]);

  const loadCalendar = useCallback(
    async (signal?: AbortSignal) => {
      setIsLoading(true);
      setError("");
      const params = new URLSearchParams({
        date: weekStart,
        days: "7",
        keyword: debouncedKeyword,
        category,
        assignment_status: assignmentStatus,
        vehicle_status: vehicleStatus,
      });

      try {
        const response = await fetch(
          `/api/admin/loaner-assignments/calendar?${params.toString()}`,
          { cache: "no-store", signal },
        );
        const nextResult = (await response.json()) as LoanerCalendarResponse;
        if (!response.ok || !nextResult.ok) {
          if (!signal?.aborted) {
            setError(
              nextResult.message ??
                "代車カレンダーの取得に失敗しました。時間をおいて再度お試しください。",
            );
          }
          return;
        }
        if (!signal?.aborted) setResult(nextResult);
      } catch {
        if (!signal?.aborted) {
          setError(
            "代車カレンダーの取得に失敗しました。時間をおいて再度お試しください。",
          );
        }
      } finally {
        if (!signal?.aborted) setIsLoading(false);
      }
    },
    [assignmentStatus, category, debouncedKeyword, vehicleStatus, weekStart],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadCalendar(controller.signal);
    return () => controller.abort();
  }, [loadCalendar]);

  const dateKeys = Array.from({ length: 7 }, (_, index) =>
    addLoanerCalendarDays(weekStart, index),
  );
  const vehicles = result.vehicles ?? [];
  const holidays = useMemo(
    () => new Set(result.holidays ?? []),
    [result.holidays],
  );
  const hasFilters = Boolean(
    debouncedKeyword ||
      category !== "all" ||
      assignmentStatus !== "all" ||
      vehicleStatus !== "all",
  );

  const resetFilters = () => {
    setKeyword("");
    setDebouncedKeyword("");
    setCategory("all");
    setAssignmentStatus("all");
    setVehicleStatus("all");
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <AdminHeader
        title="代車管理"
        description="代車の貸出状況と空き状況を週間で確認できます。"
        onRefresh={() => loadCalendar()}
      />
      <main className="mx-auto grid max-w-[1600px] gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <LoanerAdminTabs active="calendar" />

        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="hidden items-center gap-2 md:flex">
              <button
                type="button"
                disabled={isLoading}
                onClick={() => setSelectedDate(addLoanerCalendarDays(selectedDate, -7))}
                className="h-10 cursor-pointer rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
              >
                前週
              </button>
              <button
                type="button"
                disabled={isLoading}
                onClick={() => setSelectedDate(today)}
                className="h-10 cursor-pointer rounded-md border border-blue-300 bg-white px-4 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-wait disabled:opacity-60"
              >
                今日
              </button>
              <button
                type="button"
                disabled={isLoading}
                onClick={() => setSelectedDate(addLoanerCalendarDays(selectedDate, 7))}
                className="h-10 cursor-pointer rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
              >
                次週
              </button>
            </div>
            <div className="flex items-center gap-2 md:hidden">
              <button
                type="button"
                disabled={isLoading}
                onClick={() => setSelectedDate(addLoanerCalendarDays(selectedDate, -1))}
                className="h-10 flex-1 cursor-pointer rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 disabled:cursor-wait disabled:opacity-60"
              >
                前日
              </button>
              <button
                type="button"
                disabled={isLoading}
                onClick={() => setSelectedDate(today)}
                className="h-10 flex-1 cursor-pointer rounded-md border border-blue-300 bg-white px-3 text-sm font-semibold text-blue-700 disabled:cursor-wait disabled:opacity-60"
              >
                今日
              </button>
              <button
                type="button"
                disabled={isLoading}
                onClick={() => setSelectedDate(addLoanerCalendarDays(selectedDate, 1))}
                className="h-10 flex-1 cursor-pointer rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 disabled:cursor-wait disabled:opacity-60"
              >
                翌日
              </button>
            </div>
            <p className="text-sm font-bold text-slate-700 md:min-w-64 md:text-center">
              <span className="hidden md:inline">
                {formatLoanerCalendarDate(dateKeys[0])} ～ {formatLoanerCalendarDate(dateKeys[6])}
              </span>
              <span className="md:hidden">
                {formatLoanerCalendarDate(selectedDate)}
              </span>
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:items-end">
            <div
              className="flex flex-wrap items-center gap-x-4 gap-y-2"
              aria-label="代車分類の凡例"
            >
              {loanerCategories.map((value) => (
                <LoanerCategoryBadge key={value} category={value} />
              ))}
            </div>
            <StatusLegend />
          </div>
        </div>

        <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(240px,1fr)_170px_170px_170px_220px_auto] xl:items-end">
            <label className="text-sm font-semibold text-slate-700">
              キーワード検索
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="車名・表示名・ナンバー"
                className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <label className="text-sm font-semibold text-slate-700">
              分類
              <select
                value={category}
                onChange={(event) =>
                  setCategory(event.target.value as LoanerCategory | "all")
                }
                className="mt-1.5 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
              >
                <option value="all">すべて</option>
                {loanerCategories.map((value) => (
                  <option key={value} value={value}>
                    {loanerCategoryLabels[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-semibold text-slate-700">
              状態
              <select
                value={assignmentStatus}
                onChange={(event) =>
                  setAssignmentStatus(
                    event.target.value as LoanerCalendarAssignmentStatus | "all",
                  )
                }
                className="mt-1.5 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
              >
                <option value="all">すべて</option>
                <option value="checked_out">貸出中</option>
              </select>
            </label>
            <label className="text-sm font-semibold text-slate-700">
              使用可能状態
              <select
                value={vehicleStatus}
                onChange={(event) =>
                  setVehicleStatus(
                    event.target.value as LoanerCalendarVehicleStatus | "all",
                  )
                }
                className="mt-1.5 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
              >
                <option value="all">すべて</option>
                <option value="active">使用可能</option>
                <option value="inactive">使用停止</option>
              </select>
            </label>
            <AdminInlineDatePicker
              label="日付選択"
              selectedDate={selectedDate}
              minDate={null}
              onSelectDate={setSelectedDate}
              showCalendarIcon
              className="gap-1.5 font-semibold text-slate-700 [&>button]:h-10 [&>span:last-child]:hidden"
              dropdownClassName="right-0 w-[min(88vw,600px)]"
            />
            <button
              type="button"
              onClick={resetFilters}
              className="mb-4 h-10 cursor-pointer rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 xl:mb-0"
            >
              条件をクリア
            </button>
          </div>
        </section>

        {error ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            <p>{error}</p>
            <button
              type="button"
              onClick={() => loadCalendar()}
              className="cursor-pointer underline"
            >
              再試行
            </button>
          </div>
        ) : null}

        <section className="relative overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
          <div className="flex min-h-12 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <p className="text-sm font-semibold text-slate-600">
              {vehicles.length}台
            </p>
            {isLoading ? <LoadingSpinner label="カレンダーを読み込み中..." /> : null}
          </div>

          {!isLoading && !vehicles.length ? (
            <div className="px-5 py-16 text-center">
              <p className="font-semibold text-slate-700">
                {hasFilters
                  ? "条件に一致する代車がありません。"
                  : "代車がまだ登録されていません。"}
              </p>
            </div>
          ) : null}

          {vehicles.length ? (
            <>
              <DesktopCalendar
                dateKeys={dateKeys}
                holidays={holidays}
                vehicles={vehicles}
                today={today}
                onSelectAssignment={setSelectedAssignment}
              />
              <MobileCalendar
                selectedDate={selectedDate}
                vehicles={vehicles}
                onSelectAssignment={setSelectedAssignment}
              />
            </>
          ) : null}
        </section>
      </main>

      {selectedAssignment ? (
        <AssignmentDetailModal
          assignment={selectedAssignment}
          onClose={() => setSelectedAssignment(null)}
        />
      ) : null}
    </div>
  );
}
