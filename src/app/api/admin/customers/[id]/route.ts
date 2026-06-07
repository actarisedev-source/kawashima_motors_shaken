import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  adminSessionCookieName,
  verifyAdminSessionValue,
} from "@/lib/auth/admin-session";
import { supabaseServer } from "@/lib/supabase/server";
import { normalizeDateInput } from "@/lib/vehicles/shaken-expiry";
import type { Database } from "@/types/database";

type VehicleRow = Database["public"]["Tables"]["vehicles"]["Row"];

const unauthorizedResponse = () =>
  NextResponse.json(
    { ok: false, message: "ログインが必要です。" },
    { status: 401 },
  );

const isAuthenticated = (request: NextRequest) =>
  verifyAdminSessionValue(request.cookies.get(adminSessionCookieName)?.value);

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!isAuthenticated(request)) {
    return unauthorizedResponse();
  }

  const { id } = await context.params;

  const { data: customer, error: customerError } = await supabaseServer
    .from("customers")
    .select("*")
    .eq("id", id)
    .single();

  if (customerError) {
    return NextResponse.json(
      { ok: false, message: customerError.message },
      { status: customerError.code === "PGRST116" ? 404 : 500 },
    );
  }

  const [vehiclesResult, reservationsResult] = await Promise.all([
    supabaseServer
      .from("vehicles")
      .select("*")
      .eq("customer_id", id)
      .order("created_at", { ascending: false }),
    supabaseServer
      .from("reservations")
      .select("*")
      .eq("customer_id", id)
      .order("reserved_at", { ascending: false }),
  ]);

  if (vehiclesResult.error) {
    return NextResponse.json(
      { ok: false, message: vehiclesResult.error.message },
      { status: 500 },
    );
  }

  if (reservationsResult.error) {
    return NextResponse.json(
      { ok: false, message: reservationsResult.error.message },
      { status: 500 },
    );
  }

  const vehicles = vehiclesResult.data ?? [];
  const vehiclesById = new Map(
    vehicles.map((vehicle: VehicleRow) => [vehicle.id, vehicle]),
  );
  const reservations = (reservationsResult.data ?? []).map((reservation) => ({
    id: reservation.id,
    reservedAt: reservation.reserved_at,
    status: reservation.status,
    createdAt: reservation.created_at,
    vehicleModel:
      vehiclesById.get(reservation.vehicle_id)?.model_name ?? "未登録",
  }));

  return NextResponse.json({
    ok: true,
    customer: {
      id: customer.id,
      name: customer.name,
      nameKana: customer.name_kana ?? "",
      phone: customer.phone ?? "",
      memo: customer.memo ?? "",
      createdAt: customer.created_at,
      latestReservedAt: reservations[0]?.reservedAt ?? null,
      vehicles: vehicles.map((vehicle) => ({
        id: vehicle.id,
        modelName: vehicle.model_name,
        plateNumber: vehicle.plate_number ?? "",
        shakenExpiryDate: vehicle.shaken_expiry_date,
        memo: vehicle.memo ?? "",
        createdAt: vehicle.created_at,
      })),
      reservations,
    },
  });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!isAuthenticated(request)) {
    return unauthorizedResponse();
  }

  const { id } = await context.params;
  const body = (await request.json()) as {
    vehicleId?: unknown;
    shakenExpiryDate?: unknown;
  };

  if (typeof body.vehicleId !== "string" || !body.vehicleId) {
    return NextResponse.json(
      { ok: false, message: "vehicleId is required." },
      { status: 400 },
    );
  }

  const shakenExpiryDate =
    typeof body.shakenExpiryDate === "string"
      ? normalizeDateInput(body.shakenExpiryDate)
      : null;

  if (body.shakenExpiryDate && !shakenExpiryDate) {
    return NextResponse.json(
      { ok: false, message: "車検満了日の形式が正しくありません。" },
      { status: 400 },
    );
  }

  const { data, error } = await supabaseServer
    .from("vehicles")
    .update({ shaken_expiry_date: shakenExpiryDate })
    .eq("id", body.vehicleId)
    .eq("customer_id", id)
    .select("id,shaken_expiry_date")
    .single();

  if (error) {
    return NextResponse.json(
      { ok: false, message: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    vehicle: {
      id: data.id,
      shakenExpiryDate: data.shaken_expiry_date,
    },
  });
}
