"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { isValidHiragana, kanaErrorMessage } from "@/lib/customers/kana";
import { isValidNormalizedPhone, normalizePhone } from "@/lib/customers/phone";
import { adminLoanerRequestOptions } from "@/lib/reservations/admin-loaner-request";
import {
  getJstDateKey,
  reservationTimeSlots,
} from "@/lib/reservations/slots";
import type { ReservationCreateRequest } from "@/lib/reservations/create-reservation";
import {
  LoanerAssignmentPicker,
  type SelectedLoaner,
} from "./loaners/loaner-assignment-picker";
import { AdminInlineDatePicker } from "./shared/admin-inline-date-picker";

type ReservationStatus = "受付中" | "確定" | "完了" | "キャンセル";

export type AdminReservationItem = {
  id: string;
  customerId: string;
  reservedAt: string;
  customerName: string;
  phone: string;
  vehicleModel: string;
  licensePlate: string;
  loanerCarRequested: boolean | null;
  loanerAssignment: {
    id: string;
    status: "scheduled" | "checked_out";
    scheduledStartAt: string;
    scheduledEndAt: string;
    vehicle: Pick<
      SelectedLoaner,
      "id" | "vehicleName" | "displayName" | "plateNumber" | "category"
    >;
  } | null;
  status: ReservationStatus;
  createdAt: string;
};

export type AdminReservationCustomerContext = {
  id: string;
  name: string;
  nameKana: string;
  phone: string;
  gender: "男性" | "女性" | "未設定";
  birthDate: string | null;
  lineStatus: string;
  lineDisplayName: string | null;
  vehicles: {
    id: string;
    modelName: string;
    plateNumber: string;
    shakenExpiryDate: string | null;
  }[];
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

type CreateAssignmentResponse = {
  ok: boolean;
  message?: string;
  item?: {
    id: string;
    status: "scheduled" | "checked_out";
    scheduledStartAt: string;
    scheduledEndAt: string;
  };
};

type FieldErrors = {
  reservedDate: string;
  reservedTime: string;
  vehicleId: string;
  customerName: string;
  phone: string;
  customerKana: string;
  birthDate: string;
  loanerCarRequested: string;
};

const emptyFieldErrors: FieldErrors = {
  reservedDate: "",
  reservedTime: "",
  vehicleId: "",
  customerName: "",
  phone: "",
  customerKana: "",
  birthDate: "",
  loanerCarRequested: "",
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
  customerContext,
  completionMessage = "登録が完了しました",
  onClose,
  onCreated,
}: {
  initialDate: string;
  customerContext?: AdminReservationCustomerContext;
  completionMessage?: string;
  onClose: () => void;
  onCreated: (item: AdminReservationItem) => void;
}) {
  const [reservedDate, setReservedDate] = useState(() => {
    const today = getNowJstDateKey();
    return initialDate < today ? today : initialDate;
  });
  const [reservedTime, setReservedTime] = useState("");
  const [selectedVehicleId, setSelectedVehicleId] = useState(() =>
    customerContext?.vehicles.length === 1
      ? customerContext.vehicles[0].id
      : "",
  );
  const initialSelectedVehicle = customerContext?.vehicles.find(
    (vehicle) => vehicle.id === selectedVehicleId,
  );
  const [birthDate, setBirthDate] = useState(
    customerContext?.birthDate ?? "",
  );
  const [inspectionExpiresOn, setInspectionExpiresOn] = useState(
    initialSelectedVehicle?.shakenExpiryDate ?? "",
  );
  const [loanerCarRequested, setLoanerCarRequested] = useState(false);
  const [loanerStartDate, setLoanerStartDate] = useState(reservedDate);
  const [loanerEndDate, setLoanerEndDate] = useState("");
  const [selectedLoaner, setSelectedLoaner] =
    useState<SelectedLoaner | null>(null);
  const [availability, setAvailability] = useState<Record<string, DayAvailability>>(
    {},
  );
  const [isReservationCalendarOpen, setIsReservationCalendarOpen] =
    useState(false);
  const [reservationCalendarMonth, setReservationCalendarMonth] = useState(() =>
    formatMonth(reservedDate),
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
  const [completionWarning, setCompletionWarning] = useState("");

  const selectedDay = availability[reservedDate];
  const selectedHoliday = selectedDay?.holiday ?? null;
  const selectedVehicle = customerContext?.vehicles.find(
    (vehicle) => vehicle.id === selectedVehicleId,
  );
  const todayKey = getNowJstDateKey();

  const selectedMonth = useMemo(() => formatMonth(reservedDate), [reservedDate]);
  const availabilityMonth = isReservationCalendarOpen
    ? reservationCalendarMonth
    : selectedMonth;

  useEffect(() => {
    const controller = new AbortController();

    setIsLoadingAvailability(true);
    setAvailabilityError("");

    void fetch(`/api/reservations/availability?month=${availabilityMonth}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = (await response.json()) as AvailabilityResponse;

        if (!response.ok || !result.ok || !result.days) {
          throw new Error(result.message ?? "空き状況の取得に失敗しました。");
        }

        setAvailability((current) => ({ ...current, ...result.days }));
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
  }, [availabilityMonth]);

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
    const customerName =
      customerContext?.name.trim() ??
      String(formData.get("customerName") ?? "").trim();
    const customerKana =
      customerContext?.nameKana.trim() ??
      String(formData.get("customerKana") ?? "").trim();
    const phone = normalizePhone(
      customerContext?.phone ?? String(formData.get("phone") ?? ""),
    );
    const submittedBirthDate =
      customerContext?.birthDate ??
      String(formData.get("birthDate") ?? "").trim();
    const vehicleModel =
      selectedVehicle?.modelName ??
      String(formData.get("vehicleModel") ?? "").trim();
    const licensePlate =
      selectedVehicle?.plateNumber ??
      String(formData.get("licensePlate") ?? "").trim();
    const submittedInspectionExpiresOn = selectedVehicle
      ? selectedVehicle.shakenExpiryDate ?? ""
      : String(formData.get("inspectionExpiresOn") ?? "").trim();
    const loanerCarRequestedValue = String(
      formData.get("loanerCarRequested") ?? "",
    );
    const slot = selectedDay?.slots?.[reservedTime];
    const nextFieldErrors: FieldErrors = {
      reservedDate:
        !reservedDate || reservedDate < todayKey
          ? "予約日は本日以降を選択してください。"
          : "",
      reservedTime: reservedTime ? "" : "予約時間を選択してください。",
      vehicleId:
        customerContext?.vehicles.length && !selectedVehicle
          ? "予約する車両を選択してください。"
          : "",
      customerName: customerName ? "" : "氏名を入力してください。",
      phone: !phone
        ? "電話番号を入力してください。"
        : isValidNormalizedPhone(phone)
          ? ""
          : "電話番号の形式が正しくありません。",
      customerKana:
        customerKana && !isValidHiragana(customerKana) ? kanaErrorMessage : "",
      birthDate:
        submittedBirthDate && submittedBirthDate > todayKey
          ? "生年月日は今日以前の日付を選択してください。"
          : "",
      loanerCarRequested: loanerCarRequestedValue
        ? ""
        : "代車希望を選択してください。",
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
      customerId: customerContext?.id,
      vehicleId: selectedVehicle?.id,
      customerName,
      customerKana,
      phone,
      gender:
        customerContext?.gender === "未設定"
          ? undefined
          : (customerContext?.gender ??
            (String(formData.get("gender") ?? "") || undefined)),
      birthDate: submittedBirthDate || undefined,
      vehicleModel: vehicleModel || undefined,
      licensePlate,
      inspectionExpiresOn: submittedInspectionExpiresOn,
      loanerCarRequested: loanerCarRequestedValue === "true",
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

      let completedItem = result.item;
      let warning = "";

      if (
        pendingReservation.loanerCarRequested === true &&
        selectedLoaner &&
        loanerStartDate &&
        loanerEndDate
      ) {
        try {
          const assignmentResponse = await fetch("/api/admin/loaner-assignments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              reservationId: result.item.id,
              loanerVehicleId: selectedLoaner.id,
              startDate: loanerStartDate,
              endDate: loanerEndDate,
            }),
          });
          const assignmentResult =
            (await assignmentResponse.json()) as CreateAssignmentResponse;

          if (
            !assignmentResponse.ok ||
            !assignmentResult.ok ||
            !assignmentResult.item
          ) {
            warning =
              "予約は登録されましたが、代車の割り当てに失敗しました。予約詳細から再度割り当ててください。";
          } else {
            completedItem = {
              ...result.item,
              loanerAssignment: {
                id: assignmentResult.item.id,
                status: assignmentResult.item.status,
                scheduledStartAt: assignmentResult.item.scheduledStartAt,
                scheduledEndAt: assignmentResult.item.scheduledEndAt,
                vehicle: {
                  id: selectedLoaner.id,
                  vehicleName: selectedLoaner.vehicleName,
                  displayName: selectedLoaner.displayName,
                  plateNumber: selectedLoaner.plateNumber,
                  category: selectedLoaner.category,
                },
              },
            };
          }
        } catch {
          warning =
            "予約は登録されましたが、代車の割り当てに失敗しました。予約詳細から再度割り当ててください。";
        }
      }

      setPendingReservation(null);
      setCompletionWarning(warning);
      setCompletedReservation(completedItem);
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
              予約登録
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
            <AdminInlineDatePicker
              label="予約日"
              selectedDate={reservedDate}
              minDate={todayKey}
              error={fieldErrors.reservedDate}
              errorMessage={availabilityError}
              isLoading={isLoadingAvailability}
              isDateHoliday={(dateKey) => Boolean(availability[dateKey]?.holiday)}
              isDateDisabled={(dateKey) => Boolean(availability[dateKey]?.holiday)}
              onOpenChange={setIsReservationCalendarOpen}
              onVisibleMonthChange={setReservationCalendarMonth}
              onSelectDate={(dateKey) => {
                setReservedDate(dateKey);
                setLoanerStartDate(dateKey);
                setLoanerEndDate("");
                setSelectedLoaner(null);
                setFieldErrors((current) => ({
                  ...current,
                  reservedDate: "",
                  reservedTime: "",
                }));
              }}
            />

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

          {customerContext ? (
            <>
              <section className="rounded-md border border-blue-100 bg-blue-50/60 p-4">
                <p className="text-xs font-semibold text-blue-700">予約対象</p>
                <p className="mt-1 text-lg font-bold text-slate-950">
                  {customerContext.name} 様
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-medium text-slate-600">
                  <span>{customerContext.phone}</span>
                  <span>
                    LINE：
                    {customerContext.lineStatus}
                    {customerContext.lineDisplayName
                      ? `（${customerContext.lineDisplayName}）`
                      : ""}
                  </span>
                </div>
              </section>

              <section className="grid gap-4 rounded-md border border-slate-200 bg-slate-50 p-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-800">予約車両</h3>
                  <p className="mt-1 text-xs font-medium text-slate-500">
                    顧客情報に登録されている車両を使用します。
                  </p>
                </div>

                {customerContext.vehicles.length > 1 ? (
                  <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                    車両を選択
                    <select
                      value={selectedVehicleId}
                      onChange={(event) => {
                        const nextVehicleId = event.target.value;
                        const nextVehicle = customerContext.vehicles.find(
                          (vehicle) => vehicle.id === nextVehicleId,
                        );
                        setSelectedVehicleId(nextVehicleId);
                        setInspectionExpiresOn(
                          nextVehicle?.shakenExpiryDate ?? "",
                        );
                        setFieldErrors((current) => ({
                          ...current,
                          vehicleId: "",
                        }));
                      }}
                      className={[
                        "h-11 rounded-md border bg-white px-3 text-sm outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100",
                        fieldErrors.vehicleId
                          ? "border-red-400"
                          : "border-slate-300",
                      ].join(" ")}
                    >
                      <option value="">車両を選択してください</option>
                      {customerContext.vehicles.map((vehicle) => (
                        <option key={vehicle.id} value={vehicle.id}>
                          {vehicle.modelName || "車種未登録"}（
                          {vehicle.plateNumber || "ナンバー未登録"}）
                        </option>
                      ))}
                    </select>
                    {fieldErrors.vehicleId ? (
                      <span className="text-xs font-semibold leading-4 text-red-600">
                        {fieldErrors.vehicleId}
                      </span>
                    ) : null}
                  </label>
                ) : null}

                {selectedVehicle ? (
                  <dl className="grid gap-3 rounded-md border border-slate-200 bg-white p-4 sm:grid-cols-3">
                    <div>
                      <dt className="text-xs font-semibold text-slate-500">
                        車種
                      </dt>
                      <dd className="mt-1 text-sm font-bold text-slate-900">
                        {selectedVehicle.modelName || "－"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold text-slate-500">
                        ナンバー
                      </dt>
                      <dd className="mt-1 text-sm font-bold text-slate-900">
                        {selectedVehicle.plateNumber || "－"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold text-slate-500">
                        車検満了日
                      </dt>
                      <dd className="mt-1 text-sm font-bold text-slate-900">
                        {selectedVehicle.shakenExpiryDate || "－"}
                      </dd>
                    </div>
                  </dl>
                ) : customerContext.vehicles.length === 0 ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                      車種
                      <input
                        name="vehicleModel"
                        className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                      />
                    </label>
                    <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                      ナンバー
                      <input
                        name="licensePlate"
                        className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                      />
                    </label>
                    <div>
                      <AdminInlineDatePicker
                        dropdownClassName="right-0 w-[min(86vw,600px)]"
                        label="車検満了日"
                        minDate={null}
                        selectedDate={inspectionExpiresOn}
                        showCalendarIcon
                        showMonthYearSelectors
                        yearSelectionFutureYears={20}
                        onSelectDate={setInspectionExpiresOn}
                      />
                      <input
                        type="hidden"
                        name="inspectionExpiresOn"
                        value={inspectionExpiresOn}
                      />
                    </div>
                  </div>
                ) : null}
              </section>
            </>
          ) : null}

          {!customerContext ? (
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
            <div>
              <AdminInlineDatePicker
                label="生年月日"
                maxDate={todayKey}
                minDate={null}
                selectedDate={birthDate}
                showCalendarIcon
                showMonthYearSelectors
                error={fieldErrors.birthDate}
                onSelectDate={(dateKey) => {
                  setBirthDate(dateKey);
                  setFieldErrors((current) => ({
                    ...current,
                    birthDate: "",
                  }));
                }}
              />
              <input type="hidden" name="birthDate" value={birthDate} />
            </div>
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
            <div>
              <AdminInlineDatePicker
                dropdownClassName="right-0 w-[min(86vw,600px)]"
                label="車検満了日"
                minDate={null}
                selectedDate={inspectionExpiresOn}
                showCalendarIcon
                showMonthYearSelectors
                yearSelectionFutureYears={20}
                onSelectDate={setInspectionExpiresOn}
              />
              <input
                type="hidden"
                name="inspectionExpiresOn"
                value={inspectionExpiresOn}
              />
            </div>
          </div>
          ) : null}

          <fieldset className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
            <legend className="px-1 text-sm font-bold text-slate-800">
              代車
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {adminLoanerRequestOptions.map((option) => (
                <label
                  key={option.value}
                  className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50/50"
                >
                  <input
                    type="radio"
                    name="loanerCarRequested"
                    value={option.value}
                    checked={loanerCarRequested === (option.value === "true")}
                    onChange={() => {
                      const requested = option.value === "true";
                      setLoanerCarRequested(requested);
                      if (!requested) {
                        setSelectedLoaner(null);
                      }
                      setFieldErrors((current) => ({
                        ...current,
                        loanerCarRequested: "",
                      }));
                    }}
                    className="h-4 w-4 border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  {option.label}
                </label>
              ))}
            </div>
            {fieldErrors.loanerCarRequested ? (
              <span className="text-xs font-semibold leading-4 text-red-600">
                {fieldErrors.loanerCarRequested}
              </span>
            ) : null}
            {loanerCarRequested ? (
              <LoanerAssignmentPicker
                startDate={loanerStartDate}
                endDate={loanerEndDate}
                selectedLoaner={selectedLoaner}
                onStartDateChange={(date) => {
                  setLoanerStartDate(date);
                  setSelectedLoaner(null);
                }}
                onEndDateChange={(date) => {
                  setLoanerEndDate(date);
                  setSelectedLoaner(null);
                }}
                onSelectLoaner={setSelectedLoaner}
              />
            ) : null}
          </fieldset>

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
              {completionMessage}
            </h3>
            {completionWarning ? (
              <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold leading-relaxed text-amber-800">
                {completionWarning}
              </p>
            ) : null}
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
