"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { isValidHiragana, kanaErrorMessage } from "@/lib/customers/kana";
import { isValidNormalizedPhone, normalizePhone } from "@/lib/customers/phone";
import {
  getJstDateKey,
  reservationTimeSlots,
} from "@/lib/reservations/slots";
import type { ReservationCreateRequest } from "@/lib/reservations/create-reservation";

type ReservationStatus = "受付中" | "確定" | "完了" | "キャンセル";

export type AdminReservationItem = {
  id: string;
  customerId: string;
  reservedAt: string;
  customerName: string;
  phone: string;
  vehicleModel: string;
  licensePlate: string;
  status: ReservationStatus;
  createdAt: string;
};

type SlotAvailability = {
  time: string;
  reservedCount: number;
  capacity: number;
  available: boolean;
};

type DayAvailability = {
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

type CreateReservationResponse = {
  ok: boolean;
  message?: string;
  item?: AdminReservationItem;
};

type FieldErrors = {
  reservedDate: string;
  reservedTime: string;
  customerName: string;
  phone: string;
  customerKana: string;
  birthDate: string;
};

const emptyFieldErrors: FieldErrors = {
  reservedDate: "",
  reservedTime: "",
  customerName: "",
  phone: "",
  customerKana: "",
  birthDate: "",
};

const formatMonth = (dateKey: string) => dateKey.slice(0, 7);

const getNowJstDateKey = () => getJstDateKey(new Date());

const getJstDateTime = (date: string, time: string) =>
  new Date(`${date}T${time}:00+09:00`);

const isPastAdminSlot = (date: string, time: string) => {
  const today = getNowJstDateKey();

  if (date < today) return true;
  if (date > today) return false;

  return getJstDateTime(date, time) <= new Date();
};

export function AdminNewReservationModal({
  initialDate,
  onClose,
  onCreated,
}: {
  initialDate: string;
  onClose: () => void;
  onCreated: (item: AdminReservationItem) => void;
}) {
  const [reservedDate, setReservedDate] = useState(() => {
    const today = getNowJstDateKey();
    return initialDate < today ? today : initialDate;
  });
  const [reservedTime, setReservedTime] = useState("");
  const [availability, setAvailability] = useState<Record<string, DayAvailability>>(
    {},
  );
  const [availabilityError, setAvailabilityError] = useState("");
  const [isLoadingAvailability, setIsLoadingAvailability] = useState(false);
  const [fieldErrors, setFieldErrors] =
    useState<FieldErrors>(emptyFieldErrors);
  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingReservation, setPendingReservation] =
    useState<ReservationCreateRequest | null>(null);
  const [completedReservation, setCompletedReservation] =
    useState<AdminReservationItem | null>(null);

  const selectedDay = availability[reservedDate];
  const selectedHoliday = selectedDay?.holiday ?? null;
  const todayKey = getNowJstDateKey();

  const selectedMonth = useMemo(() => formatMonth(reservedDate), [reservedDate]);

  useEffect(() => {
    const controller = new AbortController();

    setIsLoadingAvailability(true);
    setAvailabilityError("");

    void fetch(`/api/reservations/availability?month=${selectedMonth}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = (await response.json()) as AvailabilityResponse;

        if (!response.ok || !result.ok || !result.days) {
          throw new Error(result.message ?? "空き状況の取得に失敗しました。");
        }

        setAvailability(result.days);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setAvailabilityError(
          error instanceof Error
            ? error.message
            : "空き状況の取得に失敗しました。",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoadingAvailability(false);
        }
      });

    return () => controller.abort();
  }, [selectedMonth]);

  useEffect(() => {
    if (!reservedTime) return;

    const slot = selectedDay?.slots?.[reservedTime];
    if (!slot?.available || selectedHoliday || isPastAdminSlot(reservedDate, reservedTime)) {
      setReservedTime("");
    }
  }, [reservedDate, reservedTime, selectedDay, selectedHoliday]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }

  function handleRegisterRequest(form: HTMLFormElement | null) {
    if (!form || isSubmitting) {
      return;
    }

    const formData = new FormData(form);
    const customerName = String(formData.get("customerName") ?? "").trim();
    const customerKana = String(formData.get("customerKana") ?? "").trim();
    const phone = normalizePhone(String(formData.get("phone") ?? ""));
    const birthDate = String(formData.get("birthDate") ?? "").trim();
    const slot = selectedDay?.slots?.[reservedTime];
    const nextFieldErrors: FieldErrors = {
      reservedDate:
        !reservedDate || reservedDate < todayKey
          ? "予約日は本日以降を選択してください。"
          : "",
      reservedTime: reservedTime ? "" : "予約時間を選択してください。",
      customerName: customerName ? "" : "氏名を入力してください。",
      phone: !phone
        ? "電話番号を入力してください。"
        : isValidNormalizedPhone(phone)
          ? ""
          : "電話番号の形式が正しくありません。",
      customerKana:
        customerKana && !isValidHiragana(customerKana) ? kanaErrorMessage : "",
      birthDate:
        birthDate && birthDate > todayKey
          ? "生年月日は今日以前の日付を選択してください。"
          : "",
    };

    if (reservedTime && isPastAdminSlot(reservedDate, reservedTime)) {
      nextFieldErrors.reservedTime =
        "当日の過去時間枠には予約を登録できません。";
    } else if (selectedHoliday) {
      nextFieldErrors.reservedTime = "休業日には予約を登録できません。";
    } else if (reservedTime && !slot?.available) {
      nextFieldErrors.reservedTime =
        "選択した時間枠は予約できません。別の時間を選択してください。";
    }

    setFieldErrors(nextFieldErrors);
    setSubmitError("");

    if (Object.values(nextFieldErrors).some(Boolean)) {
      return;
    }

    setPendingReservation({
      customerName,
      customerKana,
      phone,
      gender: String(formData.get("gender") ?? "") || undefined,
      birthDate: birthDate || undefined,
      vehicleModel: String(formData.get("vehicleModel") ?? "").trim() || undefined,
      licensePlate: String(formData.get("licensePlate") ?? "").trim(),
      inspectionExpiresOn: String(formData.get("inspectionExpiresOn") ?? "").trim(),
      reservedAt: `${reservedDate}T${reservedTime}:00+09:00`,
      note: String(formData.get("note") ?? "").trim(),
    });
  }

  async function handleConfirmRegistration() {
    if (!pendingReservation || isSubmitting) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/admin/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pendingReservation),
      });
      const result = (await response.json()) as CreateReservationResponse;

      if (!response.ok || !result.ok || !result.item) {
        setPendingReservation(null);
        setSubmitError(result.message ?? "予約登録に失敗しました。");
        return;
      }

      setPendingReservation(null);
      setCompletedReservation(result.item);
    } catch {
      setPendingReservation(null);
      setSubmitError("通信に失敗しました。時間をおいてもう一度お試しください。");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-3 sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (
          event.target === event.currentTarget &&
          !isSubmitting &&
          !pendingReservation &&
          !completedReservation
        ) {
          onClose();
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-reservation-title"
        className="max-h-[92vh] w-full max-w-3xl overflow-auto rounded-lg border border-slate-200 bg-white shadow-xl"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-4 sm:px-5">
          <div>
            <h2 id="new-reservation-title" className="text-lg font-bold">
              新規予約
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              電話受付や店頭受付の予約を登録します。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={
              isSubmitting ||
              Boolean(pendingReservation) ||
              Boolean(completedReservation)
            }
            className="h-9 cursor-pointer rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            閉じる
          </button>
        </div>

        <form onSubmit={handleSubmit} className="grid gap-5 p-4 sm:p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
              予約日
              <input
                type="date"
                value={reservedDate}
                min={todayKey}
                onChange={(event) => {
                  setReservedDate(event.target.value);
                  setFieldErrors((current) => ({ ...current, reservedDate: "" }));
                }}
                className={[
                  "h-11 rounded-md border bg-white px-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100",
                  fieldErrors.reservedDate ? "border-red-400" : "border-slate-300",
                ].join(" ")}
              />
              <span className="min-h-4 text-xs font-semibold leading-4 text-red-600">
                {fieldErrors.reservedDate}
              </span>
            </label>

            <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
              ステータス
              <input
                value="受付中"
                readOnly
                className="h-11 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-500 outline-none"
              />
              <span className="min-h-4 text-xs leading-4 text-slate-400">
                登録時は受付中で作成されます。
              </span>
            </label>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-bold text-slate-800">予約時間</p>
                <p className="mt-1 text-xs font-medium text-slate-500">
                  空きがある時間枠のみ選択できます。
                </p>
              </div>
              {isLoadingAvailability ? (
                <p className="text-xs font-semibold text-blue-700">
                  最新情報を取得中です
                </p>
              ) : null}
            </div>
            {availabilityError ? (
              <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                {availabilityError}
              </p>
            ) : null}
            {selectedHoliday ? (
              <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                この日は休業日のため予約登録できません。
              </p>
            ) : null}
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {reservationTimeSlots.map((time) => {
                const slot = selectedDay?.slots?.[time];
                const isPast = isPastAdminSlot(reservedDate, time);
                const disabled =
                  isLoadingAvailability ||
                  Boolean(selectedHoliday) ||
                  isPast ||
                  !slot?.available;
                const capacity = slot?.capacity ?? 0;
                const reservedCount = slot?.reservedCount ?? 0;

                return (
                  <button
                    key={time}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      setReservedTime(time);
                      setFieldErrors((current) => ({ ...current, reservedTime: "" }));
                    }}
                    className={[
                      "min-h-16 rounded-md border px-3 py-2 text-left transition",
                      reservedTime === time
                        ? "border-blue-600 bg-blue-50 ring-2 ring-blue-100"
                        : "border-slate-200 bg-white",
                      disabled
                        ? "cursor-not-allowed bg-slate-100 text-slate-400"
                        : "cursor-pointer hover:border-blue-300 hover:bg-blue-50/60",
                    ].join(" ")}
                  >
                    <span className="block text-sm font-bold">{time}</span>
                    <span className="mt-1 block text-xs font-semibold">
                      {isPast
                        ? "受付終了"
                        : capacity <= 0
                          ? "受付停止"
                          : slot?.available
                            ? `${reservedCount} / ${capacity}`
                            : "満席"}
                    </span>
                  </button>
                );
              })}
            </div>
            <span className="mt-2 block min-h-4 text-xs font-semibold leading-4 text-red-600">
              {fieldErrors.reservedTime}
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
              氏名
              <input
                name="customerName"
                className={[
                  "h-11 rounded-md border px-3 text-sm outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100",
                  fieldErrors.customerName ? "border-red-400" : "border-slate-300",
                ].join(" ")}
              />
              <span className="min-h-4 text-xs font-semibold leading-4 text-red-600">
                {fieldErrors.customerName}
              </span>
            </label>
            <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
              ふりがな
              <input
                name="customerKana"
                className={[
                  "h-11 rounded-md border px-3 text-sm outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100",
                  fieldErrors.customerKana ? "border-red-400" : "border-slate-300",
                ].join(" ")}
              />
              <span className="min-h-4 text-xs font-semibold leading-4 text-red-600">
                {fieldErrors.customerKana}
              </span>
            </label>
            <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
              電話番号
              <input
                name="phone"
                inputMode="tel"
                className={[
                  "h-11 rounded-md border px-3 text-sm outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100",
                  fieldErrors.phone ? "border-red-400" : "border-slate-300",
                ].join(" ")}
              />
              <span className="min-h-4 text-xs font-semibold leading-4 text-red-600">
                {fieldErrors.phone}
              </span>
            </label>
            <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
              性別
              <select
                name="gender"
                className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              >
                <option value="">未選択</option>
                <option value="男性">男性</option>
                <option value="女性">女性</option>
              </select>
              <span aria-hidden="true" className="min-h-4" />
            </label>
            <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
              生年月日
              <input
                name="birthDate"
                type="date"
                max={todayKey}
                className={[
                  "h-11 rounded-md border px-3 text-sm outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100",
                  fieldErrors.birthDate ? "border-red-400" : "border-slate-300",
                ].join(" ")}
              />
              <span className="min-h-4 text-xs font-semibold leading-4 text-red-600">
                {fieldErrors.birthDate}
              </span>
            </label>
            <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
              車種
              <input
                name="vehicleModel"
                className="h-11 rounded-md border border-slate-300 px-3 text-sm outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              />
              <span aria-hidden="true" className="min-h-4" />
            </label>
            <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
              ナンバー
              <input
                name="licensePlate"
                className="h-11 rounded-md border border-slate-300 px-3 text-sm outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              />
              <span aria-hidden="true" className="min-h-4" />
            </label>
            <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
              車検満了日
              <input
                name="inspectionExpiresOn"
                type="date"
                className="h-11 rounded-md border border-slate-300 px-3 text-sm outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              />
              <span aria-hidden="true" className="min-h-4" />
            </label>
          </div>

          <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
            ご要望
            <textarea
              name="note"
              rows={3}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
            />
          </label>

          {submitError ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
              {submitError}
            </p>
          ) : null}

          <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={
                isSubmitting ||
                Boolean(pendingReservation) ||
                Boolean(completedReservation)
              }
              className="h-11 cursor-pointer rounded-md border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              キャンセル
            </button>
            <button
              type="button"
              disabled={isSubmitting || Boolean(completedReservation)}
              onClick={(event) => handleRegisterRequest(event.currentTarget.form)}
              className="h-11 cursor-pointer rounded-md bg-blue-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {isSubmitting ? "登録中..." : "予約を登録"}
            </button>
          </div>
        </form>
      </section>
      {pendingReservation ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/40 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isSubmitting) {
              setPendingReservation(null);
            }
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-reservation-confirm-title"
            className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl"
          >
            <h3
              id="new-reservation-confirm-title"
              className="text-lg font-bold text-slate-950"
            >
              予約を登録しますか？
            </h3>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => setPendingReservation(null)}
                className="h-11 cursor-pointer rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                キャンセル
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => void handleConfirmRegistration()}
                className="h-11 cursor-pointer rounded-md bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {isSubmitting ? "登録中..." : "登録する"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {completedReservation ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/40 p-4"
          role="presentation"
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-reservation-complete-title"
            className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl"
          >
            <h3
              id="new-reservation-complete-title"
              className="text-lg font-bold text-slate-950"
            >
              登録が完了しました
            </h3>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => onCreated(completedReservation)}
                className="h-11 min-w-28 cursor-pointer rounded-md bg-blue-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
              >
                OK
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
