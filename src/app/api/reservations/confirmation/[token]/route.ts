import { NextResponse } from "next/server";
import { isReservationConfirmationToken } from "@/lib/reservations/confirmation-token";
import { supabaseServer } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type ReservationStatus = Database["public"]["Enums"]["reservation_status"];

const statusLabels: ReservationStatus[] = [
  "受付中",
  "確定",
  "完了",
  "キャンセル",
];

const isKnownStatus = (value: unknown): value is ReservationStatus =>
  typeof value === "string" &&
  statusLabels.includes(value as ReservationStatus);

const notFoundResponse = () =>
  NextResponse.json(
    { ok: false, message: "予約が見つかりません。" },
    { status: 404 },
  );

async function getReservationByToken(token: string) {
  if (!isReservationConfirmationToken(token)) {
    return { reservation: null, error: null };
  }

  const { data: reservation, error } = await supabaseServer
    .from("reservations")
    .select("*")
    .eq("confirmation_token", token)
    .single();

  return { reservation, error };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const { reservation, error } = await getReservationByToken(token);

  if (error?.code === "PGRST116" || !reservation) {
    return notFoundResponse();
  }

  if (error) {
    return NextResponse.json(
      { ok: false, message: error.message },
      { status: 500 },
    );
  }

  const [customerResult, vehicleResult] = await Promise.all([
    supabaseServer
      .from("customers")
      .select("id,name,phone")
      .eq("id", reservation.customer_id)
      .single(),
    supabaseServer
      .from("vehicles")
      .select("id,model_name")
      .eq("id", reservation.vehicle_id)
      .single(),
  ]);

  if (customerResult.error) {
    return NextResponse.json(
      { ok: false, message: customerResult.error.message },
      { status: 500 },
    );
  }

  if (vehicleResult.error) {
    return NextResponse.json(
      { ok: false, message: vehicleResult.error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    reservation: {
      id: reservation.id,
      reservedAt: reservation.reserved_at,
      status: reservation.status,
      customerName: customerResult.data.name,
      phone: customerResult.data.phone ?? "",
      vehicleModel: vehicleResult.data.model_name,
    },
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    action?: unknown;
  };

  if (body.action !== "cancel") {
    return NextResponse.json(
      { ok: false, message: "Invalid action." },
      { status: 400 },
    );
  }

  const { reservation, error } = await getReservationByToken(token);

  if (error?.code === "PGRST116" || !reservation) {
    return notFoundResponse();
  }

  if (error) {
    return NextResponse.json(
      { ok: false, message: error.message },
      { status: 500 },
    );
  }

  if (!isKnownStatus(reservation.status)) {
    return NextResponse.json(
      { ok: false, message: "予約ステータスが不正です。" },
      { status: 500 },
    );
  }

  if (reservation.status === "完了") {
    return NextResponse.json(
      { ok: false, message: "完了済みの予約はキャンセルできません。" },
      { status: 409 },
    );
  }

  if (reservation.status === "キャンセル") {
    return NextResponse.json({
      ok: true,
      reservation: {
        id: reservation.id,
        status: reservation.status,
      },
    });
  }

  const { data: updatedReservation, error: updateError } = await supabaseServer
    .from("reservations")
    .update({ status: "キャンセル" })
    .eq("id", reservation.id)
    .select("id,status")
    .single();

  if (updateError) {
    return NextResponse.json(
      { ok: false, message: updateError.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    reservation: updatedReservation,
  });
}
