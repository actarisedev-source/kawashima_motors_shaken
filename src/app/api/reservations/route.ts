import { NextResponse } from "next/server";
import { fetchHolidays, findHolidayForDate } from "@/lib/holidays/holidays";
import { isValidNormalizedPhone, normalizePhone } from "@/lib/customers/phone";
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
  const phone = normalizeOptional(body.phone);
  const normalizedPhone = phone ? normalizePhone(phone) : "";
  const vehicleModel = normalizeOptional(body.vehicleModel);
  const licensePlate = normalizeOptional(body.licensePlate);
  const shakenExpiryDate = normalizeDateInput(
    normalizeOptional(body.inspectionExpiresOn),
  );
  const reservedAt = normalizeOptional(body.reservedAt);

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

  const { data: existingCustomer, error: existingCustomerError } =
    await supabaseServer
      .from("customers")
      .select("id")
      .eq("normalized_phone", normalizedPhone)
      .maybeSingle();

  if (existingCustomerError) {
    return NextResponse.json(
      { ok: false, message: existingCustomerError.message },
      { status: 500 },
    );
  }

  let customer = existingCustomer;

  if (!customer) {
    const { data: createdCustomer, error: customerError } = await supabaseServer
      .from("customers")
      .insert({
        name: customerName,
        phone,
        normalized_phone: normalizedPhone,
      })
      .select("id")
      .single();

    if (customerError) {
      return NextResponse.json(
        { ok: false, message: customerError.message },
        { status: 500 },
      );
    }

    customer = createdCustomer;
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
  });
}
