import { NextResponse } from "next/server";
import { fetchHolidays, findHolidayForDate } from "@/lib/holidays/holidays";
import { isValidHiragana, kanaErrorMessage } from "@/lib/customers/kana";
import { isValidNormalizedPhone, normalizePhone } from "@/lib/customers/phone";
import {
  LineLoginConfigurationError,
  verifyLineIdToken,
  type LineIdTokenProfile,
} from "@/lib/line/id-token";
import { createReservationConfirmationToken } from "@/lib/reservations/confirmation-token";
import {
  getSlotEnd,
  isReservationTimeSlot,
} from "@/lib/reservations/slots";
import {
  buildSpecialCapacityMap,
  buildWeeklyCapacityMap,
  fetchSlotSettings,
  getSlotCapacity,
} from "@/lib/reservations/slot-settings";
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

  const { data: holidays, error: holidaysError } = await fetchHolidays();
  const holidaysUnavailable = holidaysError?.code === "PGRST205";

  if (holidaysError && !holidaysUnavailable) {
    return NextResponse.json(
      { ok: false, message: holidaysError.message },
      { status: 500 },
    );
  }

  if (!holidaysUnavailable && findHolidayForDate(reservedDate, holidays)) {
    return NextResponse.json(
      {
        ok: false,
        message: "選択した日は休業日のため予約できません。別の日を選択してください。",
      },
      { status: 409 },
    );
  }

  const {
    weekly,
    special,
    error: slotSettingsError,
  } = await fetchSlotSettings();
  const slotSettingsUnavailable = slotSettingsError?.code === "PGRST205";

  if (slotSettingsError && !slotSettingsUnavailable) {
    return NextResponse.json(
      { ok: false, message: slotSettingsError.message },
      { status: 500 },
    );
  }

  const slotCapacity = getSlotCapacity({
    date: reservedDate,
    time,
    weekly: buildWeeklyCapacityMap(slotSettingsUnavailable ? [] : weekly),
    special: buildSpecialCapacityMap(slotSettingsUnavailable ? [] : special),
  });

  if (slotCapacity <= 0) {
    return NextResponse.json(
      {
        ok: false,
        message: "選択した時間枠は受付停止中です。別の時間を選択してください。",
      },
      { status: 409 },
    );
  }

  const { data: existingReservations, error: availabilityError } =
    await supabaseServer
      .from("reservations")
      .select("id")
      .neq("status", "キャンセル")
      .gte("reserved_at", reservedDate.toISOString())
      .lt("reserved_at", getSlotEnd(reservedDate).toISOString())
      .limit(slotCapacity);

  if (availabilityError) {
    return NextResponse.json(
      { ok: false, message: availabilityError.message },
      { status: 500 },
    );
  }

  if ((existingReservations?.length ?? 0) >= slotCapacity) {
    return NextResponse.json(
      {
        ok: false,
        message: "選択した時間枠はすでに予約済みです。別の時間を選択してください。",
      },
      { status: 409 },
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

  const { data: existingCustomer, error: existingCustomerError } =
    await supabaseServer
      .from("customers")
      .select("id,line_user_id")
      .eq("normalized_phone", normalizedPhone)
      .maybeSingle();

  if (existingCustomerError) {
    return NextResponse.json(
      { ok: false, message: existingCustomerError.message },
      { status: 500 },
    );
  }

  let customerLineLinked = Boolean(existingCustomer?.line_user_id);

  if (lineProfile) {
    const { data: customerLinkedToLine, error: lineCustomerError } =
      await supabaseServer
        .from("customers")
        .select("id")
        .eq("line_user_id", lineProfile.sub)
        .maybeSingle();

    if (lineCustomerError) {
      lineLinkWarning =
        "LINE連携を保存できなかったため、予約のみ受け付けました。";
      console.warn("Reservation LINE customer lookup failed", lineCustomerError);
      lineProfile = null;
    } else if (
      customerLinkedToLine &&
      customerLinkedToLine.id !== existingCustomer?.id
    ) {
      lineLinkWarning =
        "このLINEアカウントは別の顧客情報と連携済みのため、予約のみ受け付けました。";
      console.warn("Reservation LINE user is already linked to another customer");
      lineProfile = null;
    }
  }

  let customer = existingCustomer;

  if (!customer) {
    const lineLinkedAt = new Date().toISOString();
    let customerResult = await supabaseServer
      .from("customers")
      .insert({
        name: customerName,
        name_kana: customerKana,
        phone,
        normalized_phone: normalizedPhone,
        ...(lineProfile
          ? {
              line_user_id: lineProfile.sub,
              line_display_name: lineProfile.name,
              line_picture_url: lineProfile.picture,
              line_linked_at: lineLinkedAt,
              line_status: "連携済み",
            }
          : {}),
      })
      .select("id,line_user_id")
      .single();

    if (customerResult.error?.code === "23505" && lineProfile) {
      lineLinkWarning =
        "LINE連携を保存できなかったため、予約のみ受け付けました。";
      console.warn("Reservation LINE customer link conflicted during insert");
      lineProfile = null;
      customerResult = await supabaseServer
        .from("customers")
        .insert({
          name: customerName,
          name_kana: customerKana,
          phone,
          normalized_phone: normalizedPhone,
        })
        .select("id,line_user_id")
        .single();
    }

    const { data: createdCustomer, error: customerError } = customerResult;

    if (customerError) {
      return NextResponse.json(
        { ok: false, message: customerError.message },
        { status: 500 },
      );
    }

    customer = createdCustomer;
    customerLineLinked = Boolean(createdCustomer.line_user_id);
  } else {
    if (customerKana) {
      const { error: customerKanaError } = await supabaseServer
        .from("customers")
        .update({ name_kana: customerKana })
        .eq("id", customer.id);

      if (customerKanaError) {
        return NextResponse.json(
          { ok: false, message: customerKanaError.message },
          { status: 500 },
        );
      }
    }

    if (lineProfile && !customer.line_user_id) {
      const { data: linkedCustomer, error: lineLinkError } =
        await supabaseServer
          .from("customers")
          .update({
            line_user_id: lineProfile.sub,
            line_display_name: lineProfile.name,
            line_picture_url: lineProfile.picture,
            line_linked_at: new Date().toISOString(),
            line_status: "連携済み",
          })
          .eq("id", customer.id)
          .is("line_user_id", null)
          .select("id")
          .maybeSingle();

      if (lineLinkError || !linkedCustomer) {
        lineLinkWarning =
          "LINE連携を保存できなかったため、予約のみ受け付けました。";
        console.warn(
          "Reservation customer LINE link was not saved",
          lineLinkError,
        );
      } else {
        customerLineLinked = true;
      }
    } else if (
      lineProfile &&
      customer.line_user_id !== lineProfile.sub
    ) {
      lineLinkWarning =
        "この顧客情報は別のLINEアカウントと連携済みのため、予約のみ受け付けました。";
      console.warn("Reservation customer is linked to another LINE user");
    }
  }

  let vehicleQuery = supabaseServer
    .from("vehicles")
    .select("id")
    .eq("customer_id", customer.id)
    .eq("model_name", vehicleModel);

  vehicleQuery = licensePlate
    ? vehicleQuery.eq("plate_number", licensePlate)
    : vehicleQuery.is("plate_number", null);

  const { data: existingVehicle, error: existingVehicleError } =
    await vehicleQuery.maybeSingle();

  if (existingVehicleError) {
    return NextResponse.json(
      { ok: false, message: existingVehicleError.message },
      { status: 500 },
    );
  }

  const { data: vehicle, error: vehicleError } = existingVehicle
    ? shakenExpiryDate
      ? await supabaseServer
          .from("vehicles")
          .update({ shaken_expiry_date: shakenExpiryDate })
          .eq("id", existingVehicle.id)
          .select("id")
          .single()
      : { data: existingVehicle, error: null }
    : await supabaseServer
    .from("vehicles")
    .insert({
      customer_id: customer.id,
      model_name: vehicleModel,
      plate_number: licensePlate,
      shaken_expiry_date: shakenExpiryDate,
    })
    .select("id")
    .single();

  if (vehicleError) {
    return NextResponse.json(
      { ok: false, message: vehicleError.message },
      { status: 500 },
    );
  }

  const { data: reservation, error: reservationError } = await supabaseServer
    .from("reservations")
    .insert({
      customer_id: customer.id,
      vehicle_id: vehicle.id,
      reserved_at: reservedDate.toISOString(),
      confirmation_token: createReservationConfirmationToken(),
      status: "受付中",
    })
    .select("id,status,confirmation_token")
    .single();

  if (reservationError) {
    return NextResponse.json(
      { ok: false, message: reservationError.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    reservationId: reservation.id,
    status: reservation.status,
    confirmationUrl: new URL(
      `/reservations/confirm/${reservation.confirmation_token}`,
      request.url,
    ).toString(),
    lineLinkWarning,
    lineLinked: customerLineLinked,
  });
}
