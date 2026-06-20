import { NextResponse } from "next/server";
import { isValidHiragana, kanaErrorMessage } from "@/lib/customers/kana";
import { isValidNormalizedPhone, normalizePhone } from "@/lib/customers/phone";
import {
  LineLoginConfigurationError,
  verifyLineIdToken,
  type LineIdTokenProfile,
} from "@/lib/line/id-token";
import { isReservationTimeSlot } from "@/lib/reservations/slots";
import { supabaseServer } from "@/lib/supabase/server";
import { normalizeDateInput } from "@/lib/vehicles/shaken-expiry";

type ReservationRequest = {
  customerName?: string;
  customerKana?: string;
  phone?: string;
  vehicleModel?: string;
  licensePlate?: string;
  inspectionExpiresOn?: string;
  reservedAt?: string;
  note?: string;
  lineIdToken?: string;
};

const normalizeOptional = (value: unknown) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export async function POST(request: Request) {
  const body = (await request.json()) as ReservationRequest;

  const customerName = normalizeOptional(body.customerName);
  const customerKana = normalizeOptional(body.customerKana);
  const phone = normalizeOptional(body.phone);
  const normalizedPhone = phone ? normalizePhone(phone) : "";
  const vehicleModel = normalizeOptional(body.vehicleModel);
  const licensePlate = normalizeOptional(body.licensePlate);
  const shakenExpiryDate = normalizeDateInput(
    normalizeOptional(body.inspectionExpiresOn),
  );
  const reservedAt = normalizeOptional(body.reservedAt);
  const note = normalizeOptional(body.note);
  const lineIdToken = normalizeOptional(body.lineIdToken);

  if (
    !customerName ||
    !phone ||
    !isValidNormalizedPhone(normalizedPhone) ||
    !vehicleModel ||
    !reservedAt
  ) {
    return NextResponse.json(
      {
        ok: false,
        message: "お名前、電話番号、車種、予約日時を入力してください。",
      },
      { status: 400 },
    );
  }

  if (customerKana && !isValidHiragana(customerKana)) {
    return NextResponse.json(
      { ok: false, message: kanaErrorMessage },
      { status: 400 },
    );
  }

  if (body.inspectionExpiresOn && !shakenExpiryDate) {
    return NextResponse.json(
      { ok: false, message: "車検満了日の形式が正しくありません。" },
      { status: 400 },
    );
  }

  const reservedDate = new Date(reservedAt);

  if (Number.isNaN(reservedDate.getTime())) {
    return NextResponse.json(
      { ok: false, message: "予約日時の形式が正しくありません。" },
      { status: 400 },
    );
  }

  const time = new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
  }).format(reservedDate);

  if (!isReservationTimeSlot(time)) {
    return NextResponse.json(
      { ok: false, message: "選択できない予約時間です。" },
      { status: 400 },
    );
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
      p_vehicle_model: vehicleModel,
      p_license_plate: licensePlate,
      p_shaken_expiry_date: shakenExpiryDate,
      p_reserved_at: reservedDate.toISOString(),
      p_note: note,
      p_line_user_id: lineProfile?.sub ?? null,
      p_line_display_name: lineProfile?.name ?? null,
      p_line_picture_url: lineProfile?.picture ?? null,
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
        "お名前、電話番号、車種、予約日時を入力してください。",
      reservation_invalid_time: "選択できない予約時間です。",
    };
    const errorKey = reservationError?.message ?? "";

    if (conflictMessages[errorKey]) {
      return NextResponse.json(
        { ok: false, message: conflictMessages[errorKey] },
        { status: 409 },
      );
    }

    if (badRequestMessages[errorKey]) {
      return NextResponse.json(
        { ok: false, message: badRequestMessages[errorKey] },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        message: reservationError?.message ?? "予約登録に失敗しました。",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    reservationId: reservation.reservation_id,
    status: reservation.reservation_status,
    confirmationUrl: new URL(
      `/reservations/confirm/${reservation.confirmation_token}`,
      request.url,
    ).toString(),
    lineLinkWarning: reservation.line_link_warning ?? lineLinkWarning,
    lineLinked: reservation.line_linked,
  });
}
