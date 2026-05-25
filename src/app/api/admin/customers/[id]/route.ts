import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  adminSessionCookieName,
  verifyAdminSessionValue,
} from "@/lib/auth/admin-session";
import { supabaseServer } from "@/lib/supabase/server";
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
      phone: customer.phone ?? "",
      createdAt: customer.created_at,
      latestReservedAt: reservations[0]?.reservedAt ?? null,
      vehicles: vehicles.map((vehicle) => ({
        id: vehicle.id,
        modelName: vehicle.model_name,
        createdAt: vehicle.created_at,
      })),
      reservations,
    },
  });
}
