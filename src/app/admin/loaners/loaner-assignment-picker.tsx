"use client";

import { useState } from "react";
import type { LoanerAvailabilityItem } from "@/lib/loaners/loaner-availability";
import { createLoanerDatePeriod } from "@/lib/loaners/loaner-period";
import { AdminInlineDatePicker } from "../shared/admin-inline-date-picker";
import { LoanerCategoryBadge } from "./loaner-category-badge";
import { LoanerAvailabilityModal } from "./loaner-availability-modal";

export type SelectedLoaner = LoanerAvailabilityItem;

export function LoanerAssignmentPicker({
  startDate,
  endDate,
  selectedLoaner,
  onStartDateChange,
  onEndDateChange,
  onSelectLoaner,
}: {
  startDate: string;
  endDate: string;
  selectedLoaner: SelectedLoaner | null;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
  onSelectLoaner: (loaner: SelectedLoaner) => void;
}) {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const period = createLoanerDatePeriod(startDate, endDate);

  function changeStartDate(date: string) {
    onStartDateChange(date);
  }

  function changeEndDate(date: string) {
    onEndDateChange(date);
  }

  return (
    <div className="grid gap-4 rounded-md border border-slate-200 bg-slate-50 p-3 sm:p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <AdminInlineDatePicker
          label="貸出開始日"
          minDate={null}
          selectedDate={startDate}
          showCalendarIcon
          onSelectDate={changeStartDate}
        />
        <AdminInlineDatePicker
          dropdownClassName="right-0 w-[min(86vw,600px)]"
          label="返却予定日"
          minDate={startDate || null}
          selectedDate={endDate}
          showCalendarIcon
          onSelectDate={changeEndDate}
        />
      </div>

      <div>
        <button
          type="button"
          disabled={!period.ok}
          onClick={() => setIsSearchOpen(true)}
          className="h-11 w-full rounded-md bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-auto"
        >
          空いている代車を検索
        </button>
        <p className="mt-2 text-xs font-medium text-slate-500">
          貸出期間を入力すると、空いている代車を検索できます。
        </p>
        {!period.ok && startDate && endDate ? (
          <p className="mt-1 text-xs font-semibold text-red-600">
            {period.message}
          </p>
        ) : null}
      </div>

      {selectedLoaner ? (
        <div className="rounded-md border border-blue-200 bg-white p-4">
          <p className="text-xs font-semibold text-blue-700">選択中の代車</p>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <LoanerCategoryBadge category={selectedLoaner.category} />
              <p className="mt-2 font-bold text-slate-950">
                {selectedLoaner.displayName}
              </p>
              <p className="mt-1 text-sm font-medium text-slate-600">
                {selectedLoaner.vehicleName} / {selectedLoaner.plateNumber}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsSearchOpen(true)}
              className="h-9 rounded-md border border-blue-200 px-4 text-sm font-semibold text-blue-700 transition hover:bg-blue-50"
            >
              変更
            </button>
          </div>
        </div>
      ) : null}

      {isSearchOpen && period.ok ? (
        <LoanerAvailabilityModal
          startDate={startDate}
          endDate={endDate}
          currentLoanerVehicleId={selectedLoaner?.id}
          onClose={() => setIsSearchOpen(false)}
          onSelect={(item) => {
            onSelectLoaner(item);
            setIsSearchOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
