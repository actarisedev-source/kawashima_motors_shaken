"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { isValidHiragana, kanaErrorMessage } from "@/lib/customers/kana";
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
const baseYear = new Date().getFullYear();

const formatMonth = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

const formatDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;

const getMonthDates = (monthDate: Date) => {
  const lastDate = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);

  return Array.from({ length: lastDate.getDate() }, (_, index) => {
    const date = new Date(monthDate.getFullYear(), monthDate.getMonth(), index + 1);
    return date;
  });
};

const getSlotMark = (slot?: SlotAvailability) => {
  const remaining = slot ? Math.max(slot.capacity - slot.reservedCount, 0) : 0;

  if (remaining >= 2) {
    return { mark: "○", label: "予約可能", selectable: true, tone: "available" };
  }

  if (remaining === 1) {
    return { mark: "△", label: "残りわずか", selectable: true, tone: "limited" };
  }

  return { mark: "×", label: "予約不可", selectable: false, tone: "unavailable" };
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
  const [customerKana, setCustomerKana] = useState("");
  const [customerKanaError, setCustomerKanaError] = useState("");
  const [availability, setAvailability] = useState<Record<string, DayAvailability>>(
    {},
  );
  const [availabilityMessage, setAvailabilityMessage] =
    useState("最新情報を取得中です");
  const scheduleScrollRef = useRef<HTMLDivElement | null>(null);

  const month = formatMonth(monthDate);
  const monthDates = useMemo(() => getMonthDates(monthDate), [monthDate]);
  const yearOptions = useMemo(
    () => Array.from({ length: 6 }, (_, index) => baseYear + index),
    [],
  );
  const selectedYear = monthDate.getFullYear();
  const selectedMonth = monthDate.getMonth() + 1;

  useEffect(() => {
    let cancelled = false;

    async function loadAvailability() {
      setAvailabilityMessage("最新情報を取得中です");

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

  function updateMonth(nextYear: number, nextMonth: number) {
    setMonthDate(new Date(nextYear, nextMonth - 1, 1));
    setSelectedDate("");
    setSelectedTime("");
  }

  function scrollSchedule(amount: number) {
    scheduleScrollRef.current?.scrollBy({ left: amount, behavior: "smooth" });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedDate || !selectedTime) {
      setSubmitState({
        status: "error",
        message: "予約表から予約日と時間を選択してください。",
      });
      return;
    }

    if (!isValidHiragana(customerKana)) {
      setCustomerKanaError(kanaErrorMessage);
      setSubmitState({
        status: "error",
        message: kanaErrorMessage,
      });
      return;
    }

    const selectedSlot = availability[selectedDate]?.slots[selectedTime];

    if (!selectedSlot?.available) {
      setSubmitState({
        status: "error",
        message: "選択した時間枠は予約できません。別の時間を選択してください。",
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
    setCustomerKana("");
    setCustomerKanaError("");
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
      <section className="grid gap-5">
        <div className="text-center">
          <h2 className="text-3xl font-black tracking-tight text-zinc-950">
            車検の予約
          </h2>
          <p className="mt-2 text-base font-medium text-zinc-500">
            ご希望の日時を選択してください
          </p>
        </div>

        <div className="grid gap-4 rounded-[16px] border border-zinc-200 bg-white p-5 shadow-sm">
          <h3 className="text-xl font-black text-zinc-950">年月を選択</h3>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-2 text-sm font-bold text-zinc-700">
              年
              <select
                value={selectedYear}
                onChange={(event) =>
                  updateMonth(Number(event.target.value), selectedMonth)
                }
                className="h-14 rounded-[12px] border border-zinc-200 bg-white px-4 text-xl font-black text-zinc-950 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              >
                {yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}年
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm font-bold text-zinc-700">
              月
              <select
                value={selectedMonth}
                onChange={(event) =>
                  updateMonth(selectedYear, Number(event.target.value))
                }
                className="h-14 rounded-[12px] border border-zinc-200 bg-white px-4 text-xl font-black text-zinc-950 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              >
                {Array.from({ length: 12 }, (_, index) => index + 1).map(
                  (monthNumber) => (
                    <option key={monthNumber} value={monthNumber}>
                      {monthNumber}月
                    </option>
                  ),
                )}
              </select>
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-7 gap-y-3 px-1 text-base font-bold text-zinc-800">
          <span className="inline-flex items-center gap-2">
            <span className="text-3xl leading-none text-blue-600">○</span>
            予約可能
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="text-3xl leading-none text-orange-500">△</span>
            残りわずか
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="text-3xl leading-none text-zinc-500">×</span>
            予約不可
          </span>
        </div>

        <div className="overflow-hidden rounded-[16px] border border-zinc-200 bg-white shadow-sm">
          <div ref={scheduleScrollRef} className="overflow-x-auto">
            <table className="min-w-max border-collapse text-center">
              <thead>
                <tr>
                  <th className="sticky left-0 z-20 w-20 min-w-20 border-b border-r border-zinc-200 bg-white px-3 py-5 text-base font-black text-zinc-950">
                    時間
                  </th>
                  {monthDates.map((date) => {
                    const weekday = date.getDay();
                    const weekendClass =
                      weekday === 0
                        ? "text-red-600"
                        : weekday === 6
                          ? "text-blue-600"
                          : "text-zinc-950";

                    return (
                      <th
                        key={formatDate(date)}
                        className={`w-24 min-w-24 border-b border-r border-zinc-200 bg-white px-3 py-4 text-lg font-black ${weekendClass}`}
                      >
                        <span className="block">
                          {date.getMonth() + 1}/{date.getDate()}
                        </span>
                        <span className="mt-1 block">
                          （{weekdayLabels[weekday]}）
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {reservationTimeSlots.map((time) => (
                  <tr key={time}>
                    <th className="sticky left-0 z-10 w-20 min-w-20 border-b border-r border-zinc-200 bg-white px-3 py-5 text-lg font-black text-zinc-950">
                      {time.replace(/^0/, "")}
                    </th>
                    {monthDates.map((date) => {
                      const dateKey = formatDate(date);
                      const slot = availability[dateKey]?.slots[time];
                      const isLoadingAvailability =
                        availabilityMessage === "最新情報を取得中です";
                      const status = getSlotMark(slot);
                      const selected =
                        selectedDate === dateKey && selectedTime === time;
                      const symbolClass =
                        status.tone === "available"
                          ? "text-blue-600"
                          : status.tone === "limited"
                            ? "text-orange-500"
                            : "text-zinc-500";

                      return (
                        <td
                          key={`${dateKey}-${time}`}
                          className="border-b border-r border-zinc-200 bg-white p-2"
                        >
                          <button
                            type="button"
                            disabled={isLoadingAvailability || !status.selectable}
                            onClick={() => {
                              setSelectedDate(dateKey);
                              setSelectedTime(time);
                            }}
                            aria-label={`${date.getMonth() + 1}/${date.getDate()} ${time} ${status.label}`}
                            className={[
                              "grid h-16 w-full place-items-center rounded-[12px] text-4xl font-black leading-none transition",
                              selected
                                ? "bg-blue-600 text-white shadow-md ring-2 ring-blue-200"
                                : symbolClass,
                              status.selectable && !selected
                                ? "hover:bg-blue-50 active:scale-95"
                                : "",
                              isLoadingAvailability
                                ? "cursor-wait bg-white text-transparent"
                                : "",
                              !isLoadingAvailability && !status.selectable
                                ? "cursor-not-allowed bg-zinc-50 text-zinc-400"
                                : "",
                            ].join(" ")}
                          >
                            {isLoadingAvailability ? "" : status.mark}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex items-center gap-3 px-1">
          <button
            type="button"
            onClick={() => scrollSchedule(-280)}
            className="grid h-10 w-10 place-items-center rounded-full bg-white text-2xl font-black text-zinc-950 shadow-sm ring-1 ring-zinc-200"
            aria-label="予約表を左へスクロール"
          >
            ‹
          </button>
          <div className="h-3 flex-1 rounded-full bg-zinc-200">
            <div className="h-3 w-1/3 rounded-full bg-zinc-400" />
          </div>
          <button
            type="button"
            onClick={() => scrollSchedule(280)}
            className="grid h-10 w-10 place-items-center rounded-full bg-white text-2xl font-black text-zinc-950 shadow-sm ring-1 ring-zinc-200"
            aria-label="予約表を右へスクロール"
          >
            ›
          </button>
        </div>

        {availabilityMessage ? (
          <p className="text-sm font-semibold text-zinc-500">
            {availabilityMessage}
          </p>
        ) : null}
      </section>

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
          ふりがな
          <input
            name="customerKana"
            value={customerKana}
            onChange={(event) => {
              const nextValue = event.target.value;
              setCustomerKana(nextValue);
              setCustomerKanaError(
                isValidHiragana(nextValue) ? "" : kanaErrorMessage,
              );
            }}
            aria-invalid={customerKanaError ? "true" : "false"}
            aria-describedby="customer-kana-error"
            className={
              customerKanaError
                ? "h-11 rounded-md border border-red-400 px-3 text-base font-normal outline-none focus:border-red-500"
                : "h-11 rounded-md border border-zinc-300 px-3 text-base font-normal outline-none focus:border-emerald-600"
            }
          />
          {customerKanaError ? (
            <span
              id="customer-kana-error"
              className="text-xs font-semibold text-red-600"
            >
              {customerKanaError}
            </span>
          ) : null}
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
        disabled={
          submitState.status === "submitting" ||
          Boolean(customerKanaError) ||
          !selectedDate ||
          !selectedTime
        }
        className="flex h-14 items-center justify-center rounded-[12px] bg-blue-600 px-5 text-lg font-black text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
      >
        {submitState.status === "submitting" ? "送信中..." : "予約に進む"}
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
