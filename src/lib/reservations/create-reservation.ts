import { normalizeBirthDateInput } from "@/lib/customers/birth-date";
import { isValidHiragana, kanaErrorMessage } from "@/lib/customers/kana";
import { isValidNormalizedPhone, normalizePhone } from "@/lib/customers/phone";
import {
  LineLoginConfigurationError,
  verifyLineIdToken,
  type LineIdTokenProfile,
} from "@/lib/line/id-token";
import { sendReservationCompletionNotification } from "@/lib/line/reservation-completion";
import {
  getJstDateKey,
  isReservationTimeSlot,
} from "@/lib/reservations/slots";
import { supabaseServer } from "@/lib/supabase/server";
import { normalizeDateInput } from "@/lib/vehicles/shaken-expiry";

export type ReservationCreateRequest = {
  customerId?: string;
  vehicleId?: string;
  customerName?: string;
  customerKana?: string;
  phone?: string;
  gender?: string;
  birthDate?: string;
  vehicleModel?: string;
  licensePlate?: string;
  inspectionExpiresOn?: string;
  reservedAt?: string;
  loanerCarRequested?: boolean;
  note?: string;
  lineIdToken?: string;
};

export type ReservationCreateMode = "public" | "admin";

type ReservationCreateResult =
  | {
      ok: true;
      statusCode: 200;
      reservationId: string;
      reservationStatus: string;
      confirmationToken: string;
      confirmationUrl: string;
      customerId: string;
      vehicleId: string;
      customerName: string;
      phone: string;
      vehicleModel: string;
      licensePlate: string | null;
      reservedAt: string;
      loanerCarRequested: boolean;
      lineLinkWarning: string | null;
      lineLinked: boolean;
    }
  | {
      ok: false;
      statusCode: 400 | 409 | 500;
      message: string;
    };

const normalizeOptional = (value: unknown) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeGender = (
  value: string | null,
): "男性" | "女性" | null =>
  value === "男性" || value === "女性" ? value : null;

const getJstTime = (date: Date) =>
  new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
  }).format(date);

const getDatePolicyError = (reservedDate: Date, mode: ReservationCreateMode) => {
  const reservedDateKey = getJstDateKey(reservedDate);
  const todayKey = getJstDateKey(new Date());

  if (mode === "public" && reservedDateKey <= todayKey) {
    return "予約は翌日以降の日付を選択してください。";
  }

  if (mode === "admin" && reservedDateKey < todayKey) {
    return "過去の日付には予約を登録できません。";
  }

  if (mode === "admin" && reservedDateKey === todayKey && reservedDate <= new Date()) {
    return "当日の過去時間枠には予約を登録できません。";
  }

  return null;
};

export async function createReservation({
  body,
  mode,
  requestUrl,
}: {
  body: ReservationCreateRequest;
  mode: ReservationCreateMode;
  requestUrl: string;
}): Promise<ReservationCreateResult> {
  const requestedCustomerId = normalizeOptional(body.customerId);
  const requestedVehicleId = normalizeOptional(body.vehicleId);
  let customerName = normalizeOptional(body.customerName);
  let customerKana = normalizeOptional(body.customerKana);
  let phone = normalizeOptional(body.phone);
  let normalizedPhone = phone ? normalizePhone(phone) : "";
  let gender = normalizeOptional(body.gender);
  let normalizedGender = normalizeGender(gender);
  let birthDate = normalizeBirthDateInput(normalizeOptional(body.birthDate));
  let vehicleModel = normalizeOptional(body.vehicleModel);
  let licensePlate = normalizeOptional(body.licensePlate);
  let shakenExpiryDate = normalizeDateInput(
    normalizeOptional(body.inspectionExpiresOn),
  );
  const reservedAt = normalizeOptional(body.reservedAt);
  const loanerCarRequested = body.loanerCarRequested;
  const note = normalizeOptional(body.note);
  const lineIdToken = normalizeOptional(body.lineIdToken);

  if (
    (requestedCustomerId || requestedVehicleId) &&
    mode !== "admin"
  ) {
    return {
      ok: false,
      statusCode: 400,
      message: "顧客指定の予約は管理画面から登録してください。",
    };
  }

  if (requestedVehicleId && !requestedCustomerId) {
    return {
      ok: false,
      statusCode: 400,
      message: "車両を指定する場合は顧客情報が必要です。",
    };
  }

  if (requestedCustomerId) {
    const { data: existingCustomer, error: customerError } = await supabaseServer
      .from("customers")
      .select("id,name,name_kana,phone,gender,birth_date")
      .eq("id", requestedCustomerId)
      .maybeSingle();

    if (customerError) {
      return {
        ok: false,
        statusCode: 500,
        message: customerError.message,
      };
    }

    if (!existingCustomer) {
      return {
        ok: false,
        statusCode: 400,
        message: "指定された顧客が見つかりません。",
      };
    }

    customerName = normalizeOptional(existingCustomer.name);
    customerKana = normalizeOptional(existingCustomer.name_kana);
    phone = normalizeOptional(existingCustomer.phone);
    normalizedPhone = phone ? normalizePhone(phone) : "";
    gender = normalizeOptional(existingCustomer.gender);
    normalizedGender = normalizeGender(gender);
    birthDate = normalizeBirthDateInput(existingCustomer.birth_date);

    if (requestedVehicleId) {
      const { data: existingVehicle, error: vehicleError } = await supabaseServer
        .from("vehicles")
        .select("id,customer_id,model_name,plate_number,shaken_expiry_date")
        .eq("id", requestedVehicleId)
        .eq("customer_id", requestedCustomerId)
        .maybeSingle();

      if (vehicleError) {
        return {
          ok: false,
          statusCode: 500,
          message: vehicleError.message,
        };
      }

      if (!existingVehicle) {
        return {
          ok: false,
          statusCode: 400,
          message: "指定された車両が顧客情報に登録されていません。",
        };
      }

      vehicleModel = normalizeOptional(existingVehicle.model_name);
      licensePlate = normalizeOptional(existingVehicle.plate_number);
      shakenExpiryDate = normalizeDateInput(existingVehicle.shaken_expiry_date);
    }
  }

  if (
    !customerName ||
    !phone ||
    !isValidNormalizedPhone(normalizedPhone) ||
    !reservedAt
  ) {
    return {
      ok: false,
      statusCode: 400,
      message: "お名前、電話番号、予約日時を入力してください。",
    };
  }

  if (customerKana && !isValidHiragana(customerKana)) {
    return { ok: false, statusCode: 400, message: kanaErrorMessage };
  }

  if (body.birthDate && !birthDate) {
    return {
      ok: false,
      statusCode: 400,
      message: "生年月日は今日以前の日付を入力してください。",
    };
  }

  if (body.inspectionExpiresOn && !shakenExpiryDate) {
    return {
      ok: false,
      statusCode: 400,
      message: "車検満了日の形式が正しくありません。",
    };
  }

  if (typeof loanerCarRequested !== "boolean") {
    return {
      ok: false,
      statusCode: 400,
      message: "代車希望を選択してください。",
    };
  }

  const reservedDate = new Date(reservedAt);

  if (Number.isNaN(reservedDate.getTime())) {
    return {
      ok: false,
      statusCode: 400,
      message: "予約日時の形式が正しくありません。",
    };
  }

  const datePolicyError = getDatePolicyError(reservedDate, mode);
  if (datePolicyError) {
    return { ok: false, statusCode: 400, message: datePolicyError };
  }

  const time = getJstTime(reservedDate);
  if (!isReservationTimeSlot(time)) {
    return { ok: false, statusCode: 400, message: "選択できない予約時間です。" };
  }

  let lineProfile: LineIdTokenProfile | null = null;
  let lineLinkWarning: string | null = null;

  if (lineIdToken) {
    try {
      lineProfile = await verifyLineIdToken(lineIdToken);

      if (!lineProfile) {
        lineLinkWarning =
          "LINEログイン情報を確認できなかったため、予約のみ受け付けました。";
        console.warn("Reservation LINE ID token verification failed");
      }
    } catch (error) {
      lineLinkWarning =
        "LINE連携を確認できなかったため、予約のみ受け付けました。";
      console.warn(
        error instanceof LineLoginConfigurationError
          ? "Reservation LINE login is not configured"
          : "Reservation LINE ID token verification failed",
        error,
      );
    }
  }

  const { data: reservation, error: reservationError } = await supabaseServer
    .rpc("create_reservation_atomic", {
      p_customer_name: customerName,
      p_customer_kana: customerKana,
      p_phone: phone,
      p_normalized_phone: normalizedPhone,
      p_gender: normalizedGender,
      p_birth_date: birthDate,
      p_vehicle_model: vehicleModel,
      p_license_plate: licensePlate,
      p_shaken_expiry_date: requestedVehicleId ? null : shakenExpiryDate,
      p_reserved_at: reservedDate.toISOString(),
      p_note: note,
      p_line_user_id: lineProfile?.sub ?? null,
      p_line_display_name: lineProfile?.name ?? null,
      p_line_picture_url: lineProfile?.picture ?? null,
      p_loaner_car_requested: loanerCarRequested,
      p_slot_type: "shaken",
    })
    .single();

  if (reservationError || !reservation) {
    const conflictMessages: Record<string, string> = {
      reservation_holiday:
        "選択した日は休業日のため予約できません。別の日を選択してください。",
      reservation_slot_stopped:
        "選択した時間枠は受付停止中です。別の時間を選択してください。",
      reservation_slot_full:
        "選択した時間枠はすでに予約済みです。別の時間を選択してください。",
    };
    const badRequestMessages: Record<string, string> = {
      reservation_invalid_input:
        "お名前、電話番号、予約日時を入力してください。",
      reservation_invalid_time: "選択できない予約時間です。",
      reservation_invalid_gender: "性別の選択内容が正しくありません。",
      reservation_invalid_birth_date:
        "生年月日は今日以前の日付を入力してください。",
      reservation_invalid_loaner_car_requested:
        "代車希望を選択してください。",
    };
    const errorKey = reservationError?.message ?? "";

    if (conflictMessages[errorKey]) {
      return { ok: false, statusCode: 409, message: conflictMessages[errorKey] };
    }

    if (badRequestMessages[errorKey]) {
      return { ok: false, statusCode: 400, message: badRequestMessages[errorKey] };
    }

    return {
      ok: false,
      statusCode: 500,
      message: reservationError?.message ?? "予約登録に失敗しました。",
    };
  }

  if (
    requestedCustomerId &&
    reservation.customer_id !== requestedCustomerId
  ) {
    await supabaseServer
      .from("reservations")
      .delete()
      .eq("id", reservation.reservation_id);

    return {
      ok: false,
      statusCode: 500,
      message: "予約と顧客情報の紐付けに失敗しました。",
    };
  }

  let linkedVehicleId = reservation.vehicle_id;

  if (requestedVehicleId && reservation.vehicle_id !== requestedVehicleId) {
    const { error: vehicleLinkError } = await supabaseServer
      .from("reservations")
      .update({ vehicle_id: requestedVehicleId })
      .eq("id", reservation.reservation_id);

    if (vehicleLinkError) {
      await supabaseServer
        .from("reservations")
        .delete()
        .eq("id", reservation.reservation_id);

      return {
        ok: false,
        statusCode: 500,
        message: "予約と車両情報の紐付けに失敗しました。",
      };
    }

    linkedVehicleId = requestedVehicleId;
  }

  await sendReservationCompletionNotification({
    customerId: reservation.customer_id,
    vehicleId: linkedVehicleId,
    reservationId: reservation.reservation_id,
  });

  return {
    ok: true,
    statusCode: 200,
    reservationId: reservation.reservation_id,
    reservationStatus: reservation.reservation_status,
    confirmationToken: reservation.confirmation_token,
    confirmationUrl: new URL(
      `/reservations/confirm/${reservation.confirmation_token}`,
      requestUrl,
    ).toString(),
    customerId: reservation.customer_id,
    vehicleId: linkedVehicleId,
    customerName,
    phone,
    vehicleModel: vehicleModel ?? "未登録",
    licensePlate,
    reservedAt: reservedDate.toISOString(),
    loanerCarRequested,
    lineLinkWarning: reservation.line_link_warning ?? lineLinkWarning,
    lineLinked: reservation.line_linked,
  };
}
