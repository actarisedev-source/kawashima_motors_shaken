import { NextResponse } from "next/server";
import { fetchHolidays, findHolidayForDate } from "@/lib/holidays/holidays";
import {
  getSlotEnd,
  isReservationTimeSlot,
  reservationSlotCapacity,
} from "@/lib/reservations/slots";
import { supabaseServer } from "@/lib/supabase/server";

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
  const vehicleModel = normalizeOptional(body.vehicleModel);
  const reservedAt = normalizeOptional(body.reservedAt);

  if (!customerName || !phone || !vehicleModel || !reservedAt) {
    return NextResponse.json(
      {
        ok: false,
        message: "お名前、電話番号、車種、予約日時を入力してください。",
      },
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

  const { data: existingReservations, error: availabilityError } =
    await supabaseServer
      .from("reservations")
      .select("id")
      .neq("status", "キャンセル")
      .gte("reserved_at", reservedDate.toISOString())
      .lt("reserved_at", getSlotEnd(reservedDate).toISOString())
      .limit(reservationSlotCapacity);

  if (availabilityError) {
    return NextResponse.json(
      { ok: false, message: availabilityError.message },
      { status: 500 },
    );
  }

  if ((existingReservations?.length ?? 0) >= reservationSlotCapacity) {
    return NextResponse.json(
      {
        ok: false,
        message: "選択した時間枠はすでに予約済みです。別の時間を選択してください。",
      },
      { status: 409 },
    );
  }

  const { data: customer, error: customerError } = await supabaseServer
    .from("customers")
    .insert({
      name: customerName,
      phone,
    })
    .select("id")
    .single();

  if (customerError) {
    return NextResponse.json(
      { ok: false, message: customerError.message },
      { status: 500 },
    );
  }

  const { data: vehicle, error: vehicleError } = await supabaseServer
    .from("vehicles")
    .insert({
      customer_id: customer.id,
      model_name: vehicleModel,
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
      status: "受付中",
    })
    .select("id,status")
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
  });
}
