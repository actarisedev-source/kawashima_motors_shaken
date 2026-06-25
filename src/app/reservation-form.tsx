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

type SlotMark = "○" | "△" | "×";

const weekdayLabels = ["日", "月", "火", "水", "木", "金", "土"];
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

const formatDisplayMonth = (date: Date) =>
  `${date.getFullYear()}年${date.getMonth() + 1}月`;

const getDateFromKey = (dateKey: string) => {
  const [year, month, date] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, date);
};

const getMonthStart = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), 1);

const getMonthDates = (monthDate: Date, todayDate: Date) => {
  const monthStart = getMonthStart(monthDate);
  const todayMonthStart = getMonthStart(todayDate);
  const startDate =
    monthStart.getTime() === todayMonthStart.getTime() ? todayDate : monthStart;
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
  const dateCount = monthEnd.getDate() - startDate.getDate() + 1;

  return Array.from({ length: dateCount }, (_, index) => {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + index);
    return date;
  });
};

const fetchAvailabilityForMonths = async (months: string[]) => {
  const responses = await Promise.all(
    months.map(async (targetMonth) => {
      const response = await fetch(
        `/api/reservations/availability?month=${targetMonth}`,
        { cache: "no-store" },
      );
      const result = (await response.json()) as AvailabilityResponse;

      if (!response.ok || !result.ok || !result.days) {
        throw new Error(result.message ?? "空き状況の取得に失敗しました。");
      }

      return result.days;
    }),
  );

  return responses.reduce<Record<string, DayAvailability>>(
    (merged, days) => ({ ...merged, ...days }),
    {},
  );
};

const getSlotMark = (
  slot?: SlotAvailability,
): { mark: SlotMark; label: string; selectable: boolean; tone: string } => {
  const remaining = slot ? Math.max(slot.capacity - slot.reservedCount, 0) : 0;

  if (remaining >= 2) {
    return { mark: "○", label: "予約可能", selectable: true, tone: "available" };
  }

  if (remaining === 1) {
    return { mark: "△", label: "残りわずか", selectable: true, tone: "limited" };
  }

  return { mark: "×", label: "予約不可", selectable: false, tone: "unavailable" };
};

function SlotSymbol({ mark }: { mark: SlotMark }) {
  if (mark === "○") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[22px] w-[22px] sm:h-6 sm:w-6">
        <circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
      </svg>
    );
  }

  if (mark === "△") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[22px] w-[22px] sm:h-6 sm:w-6">
        <path
          d="M12 4.6 20 18.5H4L12 4.6Z"
          fill="none"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="2.2"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[22px] w-[22px] sm:h-6 sm:w-6">
      <path
        d="M7 7 17 17M17 7 7 17"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="3"
      />
    </svg>
  );
}

export function ReservationForm({
  reservationLiffId = "",
}: ReservationFormProps) {
  const [submitState, setSubmitState] = useState<SubmitState>({
    status: "idle",
    message: "",
  });
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedTime, setSelectedTime] = useState("");
  const [customerKana, setCustomerKana] = useState("");
  const [customerKanaError, setCustomerKanaError] = useState("");
  const [phone, setPhone] = useState("");
  const [fieldErrors, setFieldErrors] =
    useState<FieldErrors>(emptyFieldErrors);
  const [lineIdToken, setLineIdToken] = useState("");
  const [calendarViewDate, setCalendarViewDate] = useState(() =>
    getMonthStart(getDateFromKey(getJstDateKey(new Date()))),
  );
  const [availability, setAvailability] = useState<Record<string, DayAvailability>>(
    {},
  );
  const [availabilityMessage, setAvailabilityMessage] =
    useState("最新情報を取得中です");
  const scheduleScrollRef = useRef<HTMLDivElement | null>(null);
  const submissionInFlightRef = useRef(false);

  const currentTodayKey = getJstDateKey(new Date());
  const todayDate = useMemo(() => getDateFromKey(currentTodayKey), [currentTodayKey]);
  const visibleDates = useMemo(
    () => getMonthDates(calendarViewDate, todayDate),
    [calendarViewDate, todayDate],
  );
  const availabilityMonths = useMemo(() => [formatMonth(calendarViewDate)], [calendarViewDate]);
  const availabilityMonthsKey = availabilityMonths.join(",");
  const canMoveToPreviousMonth =
    getMonthStart(calendarViewDate).getTime() > getMonthStart(todayDate).getTime();

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

      try {
        const days = await fetchAvailabilityForMonths(availabilityMonths);

        if (cancelled) {
          return;
        }

        setAvailability(days);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setAvailability({});
        setAvailabilityMessage(
          error instanceof Error
            ? error.message
            : "空き状況の取得に失敗しました。",
        );
        return;
      }
      setAvailabilityMessage("");
    }

    void loadAvailability();

    return () => {
      cancelled = true;
    };
  }, [availabilityMonths, availabilityMonthsKey]);

  useEffect(() => {
    if (scheduleScrollRef.current) {
      scheduleScrollRef.current.scrollLeft = 0;
    }
  }, [calendarViewDate]);

  function moveCalendarMonth(amount: number) {
    setCalendarViewDate((current) => {
      const next = new Date(current);
      next.setMonth(current.getMonth() + amount, 1);
      const todayMonthStart = getMonthStart(todayDate);

      return next.getTime() < todayMonthStart.getTime() ? todayMonthStart : next;
    });
    setSelectedDate("");
    setSelectedTime("");
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

      void fetchAvailabilityForMonths(availabilityMonths)
        .then((days) => setAvailability(days))
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
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2.5 shadow-sm sm:px-8 sm:py-4">
          <button
            type="button"
            onClick={() => moveCalendarMonth(-1)}
            disabled={!canMoveToPreviousMonth}
            className="grid h-9 w-9 place-items-center rounded-md border border-blue-100 bg-white text-2xl font-black leading-none text-blue-600 shadow-sm transition hover:bg-blue-50 active:scale-95 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:text-zinc-300 sm:h-12 sm:w-12 sm:text-3xl"
            aria-label="前月を表示"
          >
            ‹
          </button>
          <div className="flex items-center justify-center gap-2 text-blue-600 sm:gap-4">
            <svg viewBox="0 0 48 48" aria-hidden="true" className="h-7 w-7 sm:h-9 sm:w-9">
              <rect x="8" y="10" width="32" height="30" rx="3" fill="none" stroke="currentColor" strokeWidth="3" />
              <path d="M8 18h32M17 7v7M31 7v7" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="3" />
              <path d="M17 27h4M27 27h4M17 34h4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="3" />
            </svg>
            <span className="text-[22px] font-black tracking-tight sm:text-3xl">
              {formatDisplayMonth(calendarViewDate)}
            </span>
          </div>
          <button
            type="button"
            onClick={() => moveCalendarMonth(1)}
            className="grid h-9 w-9 place-items-center rounded-md border border-blue-100 bg-white text-2xl font-black leading-none text-blue-600 shadow-sm transition hover:bg-blue-50 active:scale-95 sm:h-12 sm:w-12 sm:text-3xl"
            aria-label="翌月を表示"
          >
            ›
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-0.5 text-sm font-bold text-zinc-800 sm:gap-x-8 sm:px-1 sm:text-lg">
          <span className="inline-flex items-center gap-1 sm:gap-2">
            <span className="inline-flex w-6 justify-center text-blue-600">
              <SlotSymbol mark="○" />
            </span>
            予約可能
          </span>
          <span className="inline-flex items-center gap-1 sm:gap-2">
            <span className="inline-flex w-6 justify-center text-blue-600">
              <SlotSymbol mark="△" />
            </span>
            残りわずか
          </span>
          <span className="inline-flex items-center gap-1 sm:gap-2">
            <span className="inline-flex w-6 justify-center text-gray-400">
              <SlotSymbol mark="×" />
            </span>
            予約不可
          </span>
        </div>

        <div
          className={`relative overflow-hidden rounded-md border bg-white shadow-[0_10px_30px_rgba(15,23,42,0.06)] ${
            fieldErrors.reservationDateTime
              ? "border-red-400"
              : "border-zinc-200"
          }`}
        >
          <div
            ref={scheduleScrollRef}
            className="overflow-x-auto"
          >
            <table className="min-w-max border-collapse text-center">
              <thead>
                <tr>
                  <th className="sticky left-0 z-20 w-11 min-w-11 border-b border-r border-zinc-200 bg-white px-1 py-3 text-sm font-black text-zinc-950 sm:w-20 sm:min-w-20 sm:px-3 sm:py-5 sm:text-lg">
                    時間
                  </th>
                  {visibleDates.map((date) => {
                    const weekday = date.getDay();
                    const dateKey = formatDate(date);
                    const isPast = dateKey < currentTodayKey;
                    const isToday = dateKey === currentTodayKey;
                    const holiday = availability[dateKey]?.holiday;
                    const dateTextClass = holiday
                      ? "text-zinc-950"
                      : weekday === 0
                        ? "text-red-600"
                        : weekday === 6
                          ? "text-blue-600"
                          : "text-zinc-950";

                    return (
                      <th
                        key={dateKey}
                        className={`w-[48px] min-w-[48px] border-b border-r border-zinc-200 px-1 py-2.5 text-[13px] font-black leading-tight sm:w-24 sm:min-w-24 sm:px-3 sm:py-4 sm:text-lg sm:leading-normal ${
                          isPast
                            ? "bg-gray-100"
                            : "bg-white"
                        } ${isToday ? "ring-2 ring-inset ring-blue-500" : ""} ${dateTextClass}`}
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
                    <th className="sticky left-0 z-10 w-11 min-w-11 border-b border-r border-zinc-200 bg-white px-1 py-2 text-sm font-black text-zinc-950 sm:w-20 sm:min-w-20 sm:px-3 sm:py-4 sm:text-lg">
                      {time.replace(/^0/, "")}
                    </th>
                    {visibleDates.map((date) => {
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
                        status.tone === "unavailable"
                          ? "text-gray-500"
                          : "text-blue-600";

                      return (
                        <td
                          key={`${dateKey}-${time}`}
                          className={`border-b border-r border-zinc-200 p-0.5 sm:p-1.5 ${
                            isPast
                              ? "bg-gray-100"
                              : holiday
                                ? "bg-gray-50"
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
                              "grid h-10 w-full place-items-center rounded-md border transition sm:h-14",
                              selected
                                ? "border-blue-600 bg-blue-600 text-white shadow-md ring-2 ring-blue-200"
                                : symbolClass,
                              !isPast && status.selectable && !selected
                                ? "border-[#dbeafe] bg-[#f8fbff] hover:bg-blue-50 active:scale-95"
                                : "",
                              !isPast && isLoadingAvailability
                                ? "cursor-wait border-transparent bg-white text-transparent"
                                : "",
                              isPast
                                ? "cursor-not-allowed border-[#e5e7eb] bg-[#f9fafb] text-gray-400"
                                : "",
                              !isPast && holiday
                                ? "cursor-not-allowed border-[#e5e7eb] bg-[#f9fafb] text-gray-400"
                                : "",
                              !isPast &&
                              !isLoadingAvailability &&
                              !status.selectable
                                ? "cursor-not-allowed border-[#e5e7eb] bg-[#f9fafb] text-gray-500"
                                : "",
                            ].join(" ")}
                          >
                            {isLoadingAvailability ? (
                              ""
                            ) : isPast ? (
                              <SlotSymbol mark="×" />
                            ) : (
                              <SlotSymbol mark={status.mark} />
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {availabilityMessage ? (
            <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center bg-white/70 px-4 text-center backdrop-blur-[1px]">
              <p className="rounded-md border border-blue-100 bg-white px-4 py-2 text-sm font-bold text-blue-600 shadow-sm">
                {availabilityMessage}
              </p>
            </div>
          ) : null}
        </div>
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
