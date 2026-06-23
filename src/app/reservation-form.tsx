"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { isValidHiragana, kanaErrorMessage } from "@/lib/customers/kana";
import { normalizePhone } from "@/lib/customers/phone";
import {
  getJstDateKey,
  reservationTimeSlots,
} from "@/lib/reservations/slots";
import { reservationCompletionStorageKey } from "@/lib/reservations/completion-storage";
import {
  CompletedReservation,
  ReservationComplete,
} from "./reservation-complete";
import { ReservationLineLinkGuide } from "./reservation-line-link-guide";

type SubmitState =
  | { status: "idle"; message: "" }
  | { status: "submitting"; message: "送信中です。" }
  | {
      status: "success";
      message: string;
      reservation: CompletedReservation;
      showLineLinkGuide: boolean;
    }
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

type ReservationFormProps = {
  reservationLiffId?: string;
};

type FieldErrors = {
  customerName: string;
  phone: string;
  vehicleModel: string;
  reservationDateTime: string;
};

const weekdayLabels = ["日", "月", "火", "水", "木", "金", "土"];
const baseYear = new Date().getFullYear();
const emptyFieldErrors: FieldErrors = {
  customerName: "",
  phone: "",
  vehicleModel: "",
  reservationDateTime: "",
};

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

export function ReservationForm({
  reservationLiffId = "",
}: ReservationFormProps) {
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
  const [phone, setPhone] = useState("");
  const [fieldErrors, setFieldErrors] =
    useState<FieldErrors>(emptyFieldErrors);
  const [lineIdToken, setLineIdToken] = useState("");
  const [availability, setAvailability] = useState<Record<string, DayAvailability>>(
    {},
  );
  const [availabilityMessage, setAvailabilityMessage] =
    useState("最新情報を取得中です");
  const scheduleScrollRef = useRef<HTMLDivElement | null>(null);
  const submissionInFlightRef = useRef(false);

  const month = formatMonth(monthDate);
  const monthDates = useMemo(() => getMonthDates(monthDate), [monthDate]);
  const yearOptions = useMemo(
    () => Array.from({ length: 6 }, (_, index) => baseYear + index),
    [],
  );
  const selectedYear = monthDate.getFullYear();
  const selectedMonth = monthDate.getMonth() + 1;
  const currentTodayKey = getJstDateKey(new Date());

  useEffect(() => {
    if (!reservationLiffId) {
      return;
    }

    let cancelled = false;

    async function initializeReservationLiff() {
      try {
        const { default: liff } = await import("@line/liff");
        await liff.init({ liffId: reservationLiffId });

        if (cancelled || !liff.isInClient() || !liff.isLoggedIn()) {
          return;
        }

        const token = liff.getIDToken();
        if (token) {
          setLineIdToken(token);
        }
      } catch (error) {
        console.warn("Reservation LIFF initialization failed", error);
      }
    }

    void initializeReservationLiff();

    return () => {
      cancelled = true;
    };
  }, [reservationLiffId]);

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

    if (submissionInFlightRef.current) {
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    const customerName = String(formData.get("customerName") ?? "").trim();
    const normalizedPhone = normalizePhone(phone);
    const vehicleModel = String(formData.get("vehicleModel") ?? "").trim();
    const nextFieldErrors: FieldErrors = {
      customerName: customerName ? "" : "お名前を入力してください。",
      phone: normalizedPhone ? "" : "電話番号を入力してください。",
      vehicleModel: vehicleModel ? "" : "車種を入力してください。",
      reservationDateTime:
        selectedDate && selectedTime ? "" : "予約日時を選択してください。",
    };
    const hasFieldError = Object.values(nextFieldErrors).some(Boolean);

    setPhone(normalizedPhone);
    setFieldErrors(nextFieldErrors);

    if (!isValidHiragana(customerKana)) {
      setCustomerKanaError(kanaErrorMessage);
    }

    if (hasFieldError || !isValidHiragana(customerKana)) {
      setSubmitState({ status: "idle", message: "" });
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

    submissionInFlightRef.current = true;
    setSubmitState({ status: "submitting", message: "送信中です。" });

    const completedReservation = {
      reservedDate: selectedDate,
      reservedTime: selectedTime,
      customerName,
      phone: normalizedPhone,
      vehicleModel,
    };

    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 45_000);
      const response = await fetch("/api/reservations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customerName: completedReservation.customerName,
          customerKana: formData.get("customerKana"),
          phone: completedReservation.phone,
          vehicleModel: completedReservation.vehicleModel,
          licensePlate: formData.get("licensePlate"),
          inspectionExpiresOn: formData.get("inspectionExpiresOn"),
          reservedAt: `${selectedDate}T${selectedTime}:00+09:00`,
          note: formData.get("note"),
          lineIdToken: lineIdToken || undefined,
        }),
        signal: controller.signal,
      });
      window.clearTimeout(timeoutId);

      const result = (await response.json()) as {
        ok: boolean;
        message?: string;
        reservationId?: string;
        confirmationUrl?: string;
        lineLinkWarning?: string;
        lineLinked?: boolean;
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

      const successState: SubmitState = {
        status: "success",
        message: result.lineLinkWarning ?? "",
        reservation: {
          ...completedReservation,
          confirmationUrl: result.confirmationUrl,
        },
        showLineLinkGuide: !result.lineLinked,
      };

      try {
        window.sessionStorage.setItem(
          reservationCompletionStorageKey,
          JSON.stringify({
            reservation: successState.reservation,
            notice: successState.message,
            showLineLinkGuide: successState.showLineLinkGuide,
          }),
        );
        window.location.assign("/reservations/complete");
        return;
      } catch {
        // Show the same completion content only when page navigation is unavailable.
        setSubmitState(successState);
      }

      void fetch(`/api/reservations/availability?month=${month}`, {
        cache: "no-store",
      })
        .then(async (refreshed) => ({
          refreshed,
          result: (await refreshed.json()) as AvailabilityResponse,
        }))
        .then(({ refreshed, result: refreshedResult }) => {
          if (refreshed.ok && refreshedResult.ok && refreshedResult.days) {
            setAvailability(refreshedResult.days);
          }
        })
        .catch(() => undefined);
    } catch {
      setSubmitState({
        status: "error",
        message: "通信に失敗しました。時間をおいてもう一度お試しください。",
      });
    } finally {
      submissionInFlightRef.current = false;
    }
  }

  if (submitState.status === "success") {
    return (
      <ReservationComplete
        reservation={submitState.reservation}
        notice={submitState.message}
        additionalContent={
          submitState.showLineLinkGuide ? <ReservationLineLinkGuide /> : null
        }
      />
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm sm:gap-5 sm:p-5"
    >
      <section className="grid gap-3 sm:gap-5">
        <div className="text-center">
          <h2 className="text-xl font-black tracking-tight text-zinc-950 sm:text-3xl">
            車検の予約
          </h2>
          <p className="mt-1 text-xs font-medium text-zinc-500 sm:mt-2 sm:text-base">
            ご希望の日時を選択してください
          </p>
        </div>

        <div className="grid gap-2 rounded-md border border-zinc-200 bg-white p-2.5 shadow-sm sm:gap-4 sm:rounded-[16px] sm:p-5">
          <h3 className="text-base font-black text-zinc-950 sm:text-xl">年月を選択</h3>
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            <label className="grid gap-1.5 text-xs font-bold text-zinc-700 sm:gap-2 sm:text-sm">
              年
              <select
                value={selectedYear}
                onChange={(event) =>
                  updateMonth(Number(event.target.value), selectedMonth)
                }
                className="h-10 rounded-md border border-zinc-200 bg-white px-2.5 text-sm font-black text-zinc-950 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 sm:h-14 sm:rounded-[12px] sm:px-4 sm:text-xl"
              >
                {yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}年
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-xs font-bold text-zinc-700 sm:gap-2 sm:text-sm">
              月
              <select
                value={selectedMonth}
                onChange={(event) =>
                  updateMonth(selectedYear, Number(event.target.value))
                }
                className="h-10 rounded-md border border-zinc-200 bg-white px-2.5 text-sm font-black text-zinc-950 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 sm:h-14 sm:rounded-[12px] sm:px-4 sm:text-xl"
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

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-0.5 text-xs font-bold text-zinc-800 sm:gap-x-7 sm:gap-y-3 sm:px-1 sm:text-base">
          <span className="inline-flex items-center gap-1 sm:gap-2">
            <span className="inline-flex w-5 justify-center text-xl leading-none text-blue-600 sm:w-8 sm:text-3xl">○</span>
            予約可能
          </span>
          <span className="inline-flex items-center gap-1 sm:gap-2">
            <span className="inline-flex w-5 justify-center text-xl leading-none text-blue-600 sm:w-8 sm:text-3xl">△</span>
            残りわずか
          </span>
          <span className="inline-flex items-center gap-1 sm:gap-2">
            <span className="inline-flex w-5 justify-center text-xl leading-none text-blue-600 sm:w-8 sm:text-3xl">×</span>
            予約不可
          </span>
        </div>

        <div
          className={`overflow-hidden rounded-md border bg-white shadow-sm sm:rounded-[16px] ${
            fieldErrors.reservationDateTime
              ? "border-red-400"
              : "border-zinc-200"
          }`}
        >
          <div ref={scheduleScrollRef} className="overflow-x-auto">
            <table className="min-w-max border-collapse text-center">
              <thead>
                <tr>
                  <th className="sticky left-0 z-20 w-10 min-w-10 border-b border-r border-zinc-200 bg-white px-0.5 py-2 text-[11px] font-black text-zinc-950 sm:w-20 sm:min-w-20 sm:px-3 sm:py-5 sm:text-base">
                    時間
                  </th>
                  {monthDates.map((date) => {
                    const weekday = date.getDay();
                    const dateKey = formatDate(date);
                    const isPast = dateKey < currentTodayKey;
                    const isToday = dateKey === currentTodayKey;
                    const holiday = availability[dateKey]?.holiday;
                    const weekendClass =
                      isPast
                        ? "text-gray-400"
                        : holiday
                          ? "text-red-700"
                        : weekday === 0
                        ? "text-red-600"
                        : weekday === 6
                          ? "text-blue-600"
                          : "text-zinc-950";

                    return (
                      <th
                        key={dateKey}
                        className={`w-[38px] min-w-[38px] border-b border-r border-zinc-200 px-0.5 py-1.5 text-[11px] font-black leading-tight sm:w-24 sm:min-w-24 sm:px-3 sm:py-4 sm:text-lg sm:leading-normal ${
                          isPast
                            ? "bg-gray-100"
                            : holiday
                              ? "bg-red-50"
                              : "bg-white"
                        } ${isToday ? "ring-2 ring-inset ring-blue-500" : ""} ${weekendClass}`}
                      >
                        <span className="block">
                          {date.getMonth() + 1}/{date.getDate()}
                        </span>
                        <span className="mt-0.5 block sm:mt-1">
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
                    <th className="sticky left-0 z-10 w-10 min-w-10 border-b border-r border-zinc-200 bg-white px-0.5 py-2 text-[11px] font-black text-zinc-950 sm:w-20 sm:min-w-20 sm:px-3 sm:py-5 sm:text-lg">
                      {time.replace(/^0/, "")}
                    </th>
                    {monthDates.map((date) => {
                      const dateKey = formatDate(date);
                      const isPast = dateKey < currentTodayKey;
                      const holiday = availability[dateKey]?.holiday;
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
                          className={`border-b border-r border-zinc-200 p-0.5 sm:p-2 ${
                            isPast
                              ? "bg-gray-100"
                              : holiday
                                ? "bg-red-50"
                                : "bg-white"
                          }`}
                        >
                          <button
                            type="button"
                            disabled={
                              isPast ||
                              isLoadingAvailability ||
                              !status.selectable
                            }
                            onClick={() => {
                              setSelectedDate(dateKey);
                              setSelectedTime(time);
                              setFieldErrors((current) => ({
                                ...current,
                                reservationDateTime: "",
                              }));
                            }}
                            aria-label={`${date.getMonth() + 1}/${date.getDate()} ${time} ${
                              isPast ? "予約不可" : status.label
                            }`}
                            className={[
                              "grid h-10 w-full place-items-center rounded-md text-xl font-black leading-none transition sm:h-16 sm:rounded-[12px] sm:text-4xl",
                              selected
                                ? "bg-blue-600 text-white shadow-md ring-2 ring-blue-200"
                                : symbolClass,
                              !isPast && status.selectable && !selected
                                ? "hover:bg-blue-50 active:scale-95"
                                : "",
                              !isPast && isLoadingAvailability
                                ? "cursor-wait bg-white text-transparent"
                                : "",
                              isPast
                                ? "cursor-not-allowed bg-gray-100 text-gray-400"
                                : "",
                              !isPast && holiday
                                ? "cursor-not-allowed bg-red-50 text-red-400"
                                : "",
                              !isPast &&
                              !isLoadingAvailability &&
                              !status.selectable
                                ? "cursor-not-allowed bg-zinc-50 text-zinc-400"
                                : "",
                            ].join(" ")}
                          >
                            {isLoadingAvailability ? "" : isPast ? "×" : status.mark}
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

        <div className="flex items-center gap-2 px-0.5 sm:gap-3 sm:px-1">
          <button
            type="button"
            onClick={() => scrollSchedule(-280)}
            className="grid h-8 w-8 place-items-center rounded-full bg-white text-xl font-black text-zinc-950 shadow-sm ring-1 ring-zinc-200 sm:h-10 sm:w-10 sm:text-2xl"
            aria-label="予約表を左へスクロール"
          >
            ‹
          </button>
          <div className="h-2 flex-1 rounded-full bg-zinc-200 sm:h-3">
            <div className="h-2 w-1/3 rounded-full bg-zinc-400 sm:h-3" />
          </div>
          <button
            type="button"
            onClick={() => scrollSchedule(280)}
            className="grid h-8 w-8 place-items-center rounded-full bg-white text-xl font-black text-zinc-950 shadow-sm ring-1 ring-zinc-200 sm:h-10 sm:w-10 sm:text-2xl"
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
        {fieldErrors.reservationDateTime ? (
          <p className="text-xs font-semibold text-red-600" role="alert">
            {fieldErrors.reservationDateTime}
          </p>
        ) : null}
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 text-sm font-medium text-zinc-800">
          お名前
          <input
            name="customerName"
            aria-invalid={fieldErrors.customerName ? "true" : "false"}
            aria-describedby="customer-name-error"
            onChange={() =>
              setFieldErrors((current) => ({
                ...current,
                customerName: "",
              }))
            }
            className={
              fieldErrors.customerName
                ? "h-11 rounded-md border border-red-400 px-3 text-base font-normal outline-none focus:border-red-500"
                : "h-11 rounded-md border border-zinc-300 px-3 text-base font-normal outline-none focus:border-emerald-600"
            }
          />
          <span
            id="customer-name-error"
            className="min-h-4 text-xs font-semibold leading-4 text-red-600"
          >
            {fieldErrors.customerName}
          </span>
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
          <span
            id="customer-kana-error"
            className="min-h-4 text-xs font-semibold leading-4 text-red-600"
          >
            {customerKanaError}
          </span>
        </label>
        <label className="grid gap-2 text-sm font-medium text-zinc-800">
          電話番号
          <input
            name="phone"
            type="tel"
            inputMode="tel"
            value={phone}
            aria-invalid={fieldErrors.phone ? "true" : "false"}
            aria-describedby="phone-error"
            onChange={(event) => {
              setPhone(normalizePhone(event.target.value));
              setFieldErrors((current) => ({ ...current, phone: "" }));
            }}
            className={
              fieldErrors.phone
                ? "h-11 rounded-md border border-red-400 px-3 text-base font-normal outline-none focus:border-red-500"
                : "h-11 rounded-md border border-zinc-300 px-3 text-base font-normal outline-none focus:border-emerald-600"
            }
          />
          <span
            id="phone-error"
            className="min-h-4 text-xs font-semibold leading-4 text-red-600"
          >
            {fieldErrors.phone}
          </span>
        </label>
        <label className="grid gap-2 text-sm font-medium text-zinc-800">
          車種
          <input
            name="vehicleModel"
            aria-invalid={fieldErrors.vehicleModel ? "true" : "false"}
            aria-describedby="vehicle-model-error"
            onChange={() =>
              setFieldErrors((current) => ({
                ...current,
                vehicleModel: "",
              }))
            }
            className={
              fieldErrors.vehicleModel
                ? "h-11 rounded-md border border-red-400 px-3 text-base font-normal outline-none focus:border-red-500"
                : "h-11 rounded-md border border-zinc-300 px-3 text-base font-normal outline-none focus:border-emerald-600"
            }
          />
          <span
            id="vehicle-model-error"
            className="min-h-4 text-xs font-semibold leading-4 text-red-600"
          >
            {fieldErrors.vehicleModel}
          </span>
        </label>
        <label className="grid gap-2 text-sm font-medium text-zinc-800">
          ナンバー
          <input
            name="licensePlate"
            className="h-11 rounded-md border border-zinc-300 px-3 text-base font-normal outline-none focus:border-emerald-600"
          />
          <span aria-hidden="true" className="min-h-4" />
        </label>
        <label className="grid gap-2 text-sm font-medium text-zinc-800">
          車検満了日
          <input
            name="inspectionExpiresOn"
            type="date"
            className="h-11 rounded-md border border-zinc-300 px-3 text-base font-normal outline-none focus:border-emerald-600"
          />
          <span aria-hidden="true" className="min-h-4" />
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
          Boolean(customerKanaError)
        }
        className="flex h-14 items-center justify-center rounded-[12px] bg-blue-600 px-5 text-lg font-black text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
      >
        {submitState.status === "submitting" ? "送信中..." : "予約に進む"}
      </button>
      {submitState.status === "error" ? (
        <div
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
        >
          <p>{submitState.message}</p>
        </div>
      ) : null}
    </form>
  );
}
