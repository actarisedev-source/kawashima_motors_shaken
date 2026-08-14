"use client";

import { useEffect, useState } from "react";
import { getJstDateKey } from "@/lib/reservations/slots";
import {
  createLoanerDatePeriod,
  getLoanerReturnDateKey,
} from "@/lib/loaners/loaner-period";
import type { LoanerAvailabilityItem } from "@/lib/loaners/loaner-availability";
import { LoanerAvailabilityModal } from "./loaner-availability-modal";
import { LoanerDateRangePicker } from "./loaner-date-range-picker";

export type ActiveLoanerAssignment = {
  id: string;
  status: "checked_out";
  scheduledStartAt: string;
  scheduledEndAt: string;
  vehicle: {
    id: string;
    vehicleName: string;
    displayName: string;
    plateNumber: string;
    category: "rental" | "owned" | "sales";
  };
};

type Confirmation =
  | { type: "return" }
  | { type: "change"; vehicle: LoanerAvailabilityItem };

const formatJstDateTimeInput = (date: Date) => {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}`;
};

const toIsoFromJstInput = (value: string) =>
  new Date(`${value}:00+09:00`).toISOString();

function ModalFrame({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/45 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="loaner-action-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-slate-200 bg-white p-5 shadow-xl sm:p-6"
      >
        <h2 id="loaner-action-title" className="text-lg font-bold text-slate-950">
          {title}
        </h2>
        {children}
      </section>
    </div>
  );
}

export function LoanerAssignmentActions({
  assignment,
  onUpdated,
}: {
  assignment: ActiveLoanerAssignment;
  onUpdated: (message: string) => Promise<void>;
}) {
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [isVehicleSearchOpen, setIsVehicleSearchOpen] = useState(false);
  const [isPeriodOpen, setIsPeriodOpen] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [actualReturnedAt, setActualReturnedAt] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const currentStartDate = getJstDateKey(assignment.scheduledStartAt);
  const currentEndDate = getLoanerReturnDateKey(assignment.scheduledEndAt);

  function openPeriodEditor() {
    setStartDate(currentStartDate);
    setEndDate(currentEndDate);
    setError("");
    setIsPeriodOpen(true);
  }

  function openVehicleSearch() {
    setStartDate(currentStartDate);
    setEndDate(currentEndDate);
    setError("");
    setIsVehicleSearchOpen(true);
  }

  async function patchAssignment(
    body: Record<string, unknown>,
    successMessage: string,
  ) {
    if (isSaving) return false;
    setIsSaving(true);
    setError("");

    try {
      const response = await fetch(
        `/api/admin/loaner-assignments/${assignment.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const result = (await response.json()) as { ok: boolean; message?: string };

      if (!response.ok || !result.ok) {
        setError(result.message ?? "代車の操作に失敗しました。");
        return false;
      }

      await onUpdated(successMessage);
      return true;
    } catch {
      setError("通信に失敗しました。時間をおいてもう一度お試しください。");
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  async function savePeriod() {
    const period = createLoanerDatePeriod(startDate, endDate);
    if (!period.ok) {
      setError(period.message);
      return;
    }

    const succeeded = await patchAssignment(
      {
        action: "change",
        loanerVehicleId: assignment.vehicle.id,
        scheduledStartAt: period.value.scheduledStartAt,
        scheduledEndAt: period.value.scheduledEndAt,
      },
      "貸出期間を変更しました。",
    );
    if (succeeded) setIsPeriodOpen(false);
  }

  async function confirmAction() {
    if (!confirmation) return;

    if (confirmation.type === "return") {
      if (
        !actualReturnedAt ||
        Number.isNaN(new Date(`${actualReturnedAt}:00+09:00`).getTime())
      ) {
        setError("返却日時が正しくありません。");
        return;
      }
      const succeeded = await patchAssignment(
        {
          action: "release",
          actualReturnedAt: toIsoFromJstInput(actualReturnedAt),
        },
        "代車の返却を登録しました。",
      );
      if (succeeded) setConfirmation(null);
      return;
    }

    const period = createLoanerDatePeriod(startDate, endDate);
    if (!period.ok) {
      setError(period.message);
      return;
    }
    const succeeded = await patchAssignment(
      {
        action: "change",
        loanerVehicleId: confirmation.vehicle.id,
        scheduledStartAt: period.value.scheduledStartAt,
        scheduledEndAt: period.value.scheduledEndAt,
      },
      "代車を変更しました。",
    );
    if (succeeded) setConfirmation(null);
  }

  return (
    <>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={openVehicleSearch}
          className="h-10 rounded-md border border-blue-200 bg-white px-3 text-sm font-semibold text-blue-700 transition hover:bg-blue-50"
        >
          代車を変更
        </button>
        <button
          type="button"
          onClick={openPeriodEditor}
          className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          貸出期間を変更
        </button>
        <button
          type="button"
          onClick={() => {
            setActualReturnedAt(formatJstDateTimeInput(new Date()));
            setError("");
            setConfirmation({ type: "return" });
          }}
          className="h-10 rounded-md bg-blue-600 px-3 text-sm font-semibold text-white transition hover:bg-blue-700 sm:col-span-2"
        >
          返却
        </button>
      </div>

      {error && !confirmation && !isPeriodOpen ? (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
          {error}
        </p>
      ) : null}

      {isVehicleSearchOpen ? (
        <LoanerAvailabilityModal
          startDate={startDate}
          endDate={endDate}
          currentLoanerVehicleId={assignment.vehicle.id}
          onClose={() => setIsVehicleSearchOpen(false)}
          onSelect={(vehicle) => {
            setIsVehicleSearchOpen(false);
            setConfirmation({ type: "change", vehicle });
          }}
        />
      ) : null}

      {isPeriodOpen ? (
        <LoanerDateRangePicker
          startDate={startDate}
          endDate={endDate}
          error={error}
          isSaving={isSaving}
          onChange={(nextStartDate, nextEndDate) => {
            setStartDate(nextStartDate);
            setEndDate(nextEndDate);
            setError("");
          }}
          onClose={() => setIsPeriodOpen(false)}
          onConfirm={() => void savePeriod()}
        />
      ) : null}

      {confirmation ? (
        <ModalFrame
          title={
            confirmation.type === "return"
              ? "代車を返却済みにしますか？"
              : "代車を変更しますか？"
          }
          onClose={() => setConfirmation(null)}
        >
          <div className="mt-5 rounded-md bg-slate-50 p-4 text-sm text-slate-700">
            {confirmation.type === "change" ? (
              <dl className="grid gap-3">
                <div><dt className="font-semibold text-slate-500">現在</dt><dd className="mt-1 font-bold">{assignment.vehicle.vehicleName}（{assignment.vehicle.plateNumber}）</dd></div>
                <div><dt className="font-semibold text-slate-500">変更後</dt><dd className="mt-1 font-bold">{confirmation.vehicle.vehicleName}（{confirmation.vehicle.plateNumber}）</dd></div>
              </dl>
            ) : (
              <>
                <p className="font-bold text-slate-950">{assignment.vehicle.vehicleName}</p>
                <p className="mt-1 text-sm font-semibold text-slate-600">{assignment.vehicle.plateNumber}</p>
                <label className="mt-3 grid gap-1.5 font-semibold text-slate-700">
                  返却日時
                  <input
                    type="datetime-local"
                    value={actualReturnedAt}
                    onChange={(event) => setActualReturnedAt(event.target.value)}
                    className="h-11 rounded-md border border-slate-300 bg-white px-3 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                  />
                </label>
              </>
            )}
          </div>
          {error ? <p className="mt-4 text-sm font-semibold text-red-600">{error}</p> : null}
          <div className="mt-6 grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={isSaving}
              onClick={() => setConfirmation(null)}
              className="h-11 rounded-md border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              戻る
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={() => void confirmAction()}
              className="h-11 rounded-md bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {isSaving ? (
                <span className="inline-flex items-center gap-2">
                  <span
                    className="h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-white"
                    aria-hidden="true"
                  />
                  処理中...
                </span>
              ) : confirmation.type === "return" ? (
                "返却済みにする"
              ) : (
                "変更する"
              )}
            </button>
          </div>
        </ModalFrame>
      ) : null}
    </>
  );
}

export function LoanerRequestControl({
  reservationId,
  requested,
  assignment,
  onUpdated,
}: {
  reservationId: string;
  requested: boolean | null;
  assignment: ActiveLoanerAssignment | null;
  onUpdated: (message: string) => Promise<void>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [nextRequested, setNextRequested] = useState(requested === true);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function save() {
    if (isSaving || nextRequested === (requested === true)) {
      setIsOpen(false);
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/reservations/${reservationId}/loaner-request`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requested: nextRequested }),
        },
      );
      const result = (await response.json()) as { ok: boolean; message?: string };
      if (!response.ok || !result.ok) {
        setError(result.message ?? "代車希望の変更に失敗しました。");
        return;
      }
      setIsOpen(false);
      await onUpdated("代車希望を変更しました。");
    } catch {
      setError("通信に失敗しました。時間をおいてもう一度お試しください。");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setNextRequested(requested === true);
          setError("");
          setIsOpen(true);
        }}
        className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
      >
        変更
      </button>
      {isOpen ? (
        <ModalFrame
          title={
            requested === true && !nextRequested
              ? "代車を不要に変更しますか？"
              : "代車希望を変更"
          }
          onClose={() => setIsOpen(false)}
        >
          <div className="mt-5 grid gap-3">
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-slate-200 px-4 text-sm font-semibold text-slate-800">
              <input
                type="radio"
                name="reservationLoanerRequest"
                checked={!nextRequested}
                onChange={() => setNextRequested(false)}
                className="h-4 w-4"
              />
              代車なし
            </label>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-slate-200 px-4 text-sm font-semibold text-slate-800">
              <input
                type="radio"
                name="reservationLoanerRequest"
                checked={nextRequested}
                onChange={() => setNextRequested(true)}
                className="h-4 w-4"
              />
              代車希望あり
            </label>
          </div>
          {!nextRequested && assignment ? (
            <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 ring-1 ring-amber-200">
              {assignment.vehicle.vehicleName}（{assignment.vehicle.plateNumber}）の割り当ても解除されます。
            </p>
          ) : null}
          {error ? <p className="mt-4 text-sm font-semibold text-red-600">{error}</p> : null}
          <div className="mt-6 grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={isSaving}
              onClick={() => setIsOpen(false)}
              className="h-11 rounded-md border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              戻る
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={() => void save()}
              className="h-11 rounded-md bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {isSaving ? "変更中..." : nextRequested ? "代車希望ありにする" : "代車を不要にする"}
            </button>
          </div>
        </ModalFrame>
      ) : null}
    </>
  );
}
