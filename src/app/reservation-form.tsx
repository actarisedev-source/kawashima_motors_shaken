"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { reservationTimeSlots } from "@/lib/reservations/slots";

type SubmitState =
  | { status: "idle"; message: "" }
  | { status: "submitting"; message: "送信中です。" }
  | { status: "success"; message: string; confirmationUrl: string }
  | { status: "error"; message: string };

type SlotAvailability = {
  reservedCount: number;
  capacity: number;
  available: boolean;
};

type DayAvailability = {
  totalReserved: number;
  totalCapacity: number;
  holiday: {
    id: string;
    type: "single" | "weekly";
    label: string | null;
  } | null;
  slots: Record<string, SlotAvailability>;
};

type AvailabilityResponse = {
  ok: boolean;
  message?: string;
  days?: Record<string, DayAvailability>;
};

const weekdayLabels = ["日", "月", "火", "水", "木", "金", "土"];

const formatMonth = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

const formatDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;

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

export function ReservationForm() {
  const [submitState, setSubmitState] = useState<SubmitState>({
    status: "idle",
    message: "",
  });
  const [monthDate, setMonthDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedTime, setSelectedTime] = useState("");
  const [availability, setAvailability] = useState<Record<string, DayAvailability>>(
    {},
  );
  const [availabilityMessage, setAvailabilityMessage] = useState("読み込み中です。");

  const month = formatMonth(monthDate);
  const calendarDates = useMemo(() => getCalendarDates(monthDate), [monthDate]);
  const selectedDay = selectedDate ? availability[selectedDate] : undefined;

  useEffect(() => {
    let cancelled = false;

    async function loadAvailability() {
      setAvailabilityMessage("読み込み中です。");

      const response = await fetch(`/api/reservations/availability?month=${month}`, {
        cache: "no-store",
      });
      const result = (await response.json()) as AvailabilityResponse;

      if (cancelled) {
        return;
      }

      if (!response.ok || !result.ok || !result.days) {
        setAvailability({});
        setAvailabilityMessage(result.message ?? "空き状況の取得に失敗しました。");
        return;
      }

      setAvailability(result.days);
      setAvailabilityMessage("");
    }

    void loadAvailability();

    return () => {
      cancelled = true;
    };
  }, [month]);

  function moveMonth(amount: number) {
    setMonthDate(
      (current) => new Date(current.getFullYear(), current.getMonth() + amount, 1),
    );
    setSelectedDate("");
    setSelectedTime("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedDate || !selectedTime) {
      setSubmitState({
        status: "error",
        message: "カレンダーから予約日と時間を選択してください。",
      });
      return;
    }

    const selectedSlot = availability[selectedDate]?.slots[selectedTime];

    if (!selectedSlot?.available) {
      setSubmitState({
        status: "error",
        message: "選択した時間枠は予約済みです。別の時間を選択してください。",
      });
      return;
    }

    setSubmitState({ status: "submitting", message: "送信中です。" });

    const formData = new FormData(event.currentTarget);
    const response = await fetch("/api/reservations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        customerName: formData.get("customerName"),
        customerKana: formData.get("customerKana"),
        phone: formData.get("phone"),
        vehicleModel: formData.get("vehicleModel"),
        licensePlate: formData.get("licensePlate"),
        inspectionExpiresOn: formData.get("inspectionExpiresOn"),
        reservedAt: `${selectedDate}T${selectedTime}:00+09:00`,
        note: formData.get("note"),
      }),
    });

    const result = (await response.json()) as {
      ok: boolean;
      message?: string;
      reservationId?: string;
      confirmationUrl?: string;
    };

    if (!response.ok || !result.ok) {
      setSubmitState({
        status: "error",
        message: result.message ?? "予約の送信に失敗しました。",
      });
      return;
    }

    if (!result.reservationId || !result.confirmationUrl) {
      setSubmitState({
        status: "error",
        message: "予約確認URLの発行に失敗しました。",
      });
      return;
    }

    event.currentTarget.reset();
    setSelectedDate("");
    setSelectedTime("");
    setSubmitState({
      status: "success",
      message: `予約を受け付けました。受付番号: ${result.reservationId}`,
      confirmationUrl: result.confirmationUrl,
    });

    const refreshed = await fetch(`/api/reservations/availability?month=${month}`, {
      cache: "no-store",
    });
    const refreshedResult = (await refreshed.json()) as AvailabilityResponse;
    if (refreshed.ok && refreshedResult.ok && refreshedResult.days) {
      setAvailability(refreshedResult.days);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="grid gap-5 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 text-sm font-medium text-zinc-800">
          お名前
          <input
            required
            name="customerName"
            className="h-11 rounded-md border border-zinc-300 px-3 text-base font-normal outline-none focus:border-emerald-600"
          />
        </label>
        <label className="grid gap-2 text-sm font-medium text-zinc-800">
          フリガナ
          <input
            name="customerKana"
            className="h-11 rounded-md border border-zinc-300 px-3 text-base font-normal outline-none focus:border-emerald-600"
          />
        </label>
        <label className="grid gap-2 text-sm font-medium text-zinc-800">
          電話番号
          <input
            required
            name="phone"
            type="tel"
            className="h-11 rounded-md border border-zinc-300 px-3 text-base font-normal outline-none focus:border-emerald-600"
          />
        </label>
        <label className="grid gap-2 text-sm font-medium text-zinc-800">
          車種
          <input
            required
            name="vehicleModel"
            className="h-11 rounded-md border border-zinc-300 px-3 text-base font-normal outline-none focus:border-emerald-600"
          />
        </label>
        <label className="grid gap-2 text-sm font-medium text-zinc-800">
          ナンバー
          <input
            name="licensePlate"
            className="h-11 rounded-md border border-zinc-300 px-3 text-base font-normal outline-none focus:border-emerald-600"
          />
        </label>
        <label className="grid gap-2 text-sm font-medium text-zinc-800">
          車検満了日
          <input
            name="inspectionExpiresOn"
            type="date"
            className="h-11 rounded-md border border-zinc-300 px-3 text-base font-normal outline-none focus:border-emerald-600"
          />
        </label>
      </div>

      <section className="grid gap-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => moveMonth(-1)}
            className="h-9 rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-700"
          >
            前月
          </button>
          <h2 className="text-base font-bold text-zinc-950">
            {monthDate.getFullYear()}年 {monthDate.getMonth() + 1}月
          </h2>
          <button
            type="button"
            onClick={() => moveMonth(1)}
            className="h-9 rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-700"
          >
            次月
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-zinc-500">
          {weekdayLabels.map((label) => (
            <div key={label} className="py-1">
              {label}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {calendarDates.map((date) => {
            const dateKey = formatDate(date);
            const day = availability[dateKey];
            const isCurrentMonth = date.getMonth() === monthDate.getMonth();
            const isSelected = dateKey === selectedDate;
            const isFull =
              day && day.totalReserved >= day.totalCapacity && day.totalCapacity > 0;
            const isHoliday = Boolean(day?.holiday);

            return (
              <button
                key={dateKey}
                type="button"
                disabled={!isCurrentMonth || isHoliday}
                onClick={() => {
                  setSelectedDate(dateKey);
                  setSelectedTime("");
                }}
                className={[
                  "aspect-square rounded-md border p-1 text-left text-sm transition",
                  isSelected
                    ? "border-emerald-600 bg-emerald-50 text-emerald-800"
                    : "border-zinc-200 bg-white text-zinc-800",
                  !isCurrentMonth || isHoliday ? "cursor-not-allowed opacity-35" : "",
                  (isFull || isHoliday) && isCurrentMonth
                    ? "bg-zinc-100 text-zinc-400"
                    : "",
                ].join(" ")}
              >
                <span className="font-semibold">{date.getDate()}</span>
                {isCurrentMonth && isHoliday ? (
                  <span className="mt-1 block text-[11px]">休業</span>
                ) : null}
                {isCurrentMonth && day && !isHoliday ? (
                  <span className="mt-1 block text-[11px]">
                    {day.totalReserved}/{day.totalCapacity}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        {availabilityMessage ? (
          <p className="text-sm font-medium text-zinc-600">{availabilityMessage}</p>
        ) : null}
      </section>

      {selectedDate ? (
        <section className="grid gap-3">
          <h3 className="text-sm font-bold text-zinc-950">
            {selectedDate} の時間枠
          </h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {reservationTimeSlots.map((time) => {
              const slot = selectedDay?.slots[time];
              const available = Boolean(slot?.available);
              const selected = selectedTime === time;

              return (
                <button
                  key={time}
                  type="button"
                  disabled={!available}
                  onClick={() => setSelectedTime(time)}
                  className={[
                    "h-11 rounded-md border text-sm font-semibold transition",
                    selected
                      ? "border-emerald-600 bg-emerald-700 text-white"
                      : "border-zinc-300 bg-white text-zinc-800",
                    !available
                      ? "cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-400"
                      : "hover:border-emerald-600",
                  ].join(" ")}
                >
                  {time}
                  {!available ? " 満" : ""}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      <label className="grid gap-2 text-sm font-medium text-zinc-800">
        ご要望
        <textarea
          name="note"
          rows={4}
          className="rounded-md border border-zinc-300 px-3 py-2 text-base font-normal outline-none focus:border-emerald-600"
        />
      </label>
      <button
        type="submit"
        disabled={submitState.status === "submitting"}
        className="h-11 rounded-md bg-emerald-700 px-5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
      >
        予約を送信
      </button>
      {submitState.message ? (
        <div
          className={
            submitState.status === "error"
              ? "rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
              : "rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700"
          }
        >
          <p>{submitState.message}</p>
          {submitState.status === "success" ? (
            <a
              href={submitState.confirmationUrl}
              className="mt-2 block break-all font-semibold underline underline-offset-4"
            >
              予約確認・キャンセルページを開く
            </a>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
