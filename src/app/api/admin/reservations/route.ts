import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  adminSessionCookieName,
  verifyAdminSessionValue,
} from "@/lib/auth/admin-session";
import { supabaseServer } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

const reservationStatuses = ["受付中", "確定", "完了", "キャンセル"] as const;

type ReservationStatus = (typeof reservationStatuses)[number];
type ReservationRow = Database["public"]["Tables"]["reservations"]["Row"];
type CustomerRow = Database["public"]["Tables"]["customers"]["Row"];
type VehicleRow = Database["public"]["Tables"]["vehicles"]["Row"];

const isReservationStatus = (value: unknown): value is ReservationStatus =>
  typeof value === "string" &&
  reservationStatuses.includes(value as ReservationStatus);

const unauthorizedResponse = () =>
  NextResponse.json(
    { ok: false, message: "ログインが必要です。" },
    { status: 401 },
  );

const isAuthenticated = (request: NextRequest) =>
  verifyAdminSessionValue(request.cookies.get(adminSessionCookieName)?.value);

export async function GET(request: NextRequest) {
  if (!isAuthenticated(request)) {
    return unauthorizedResponse();
  }

  const { data: reservations, error: reservationsError } = await supabaseServer
    .from("reservations")
    .select("*")
    .order("created_at", { ascending: false });

  if (reservationsError) {
    return NextResponse.json(
      { ok: false, message: reservationsError.message },
      { status: 500 },
    );
  }

  const customerIds = [
    ...new Set(reservations.map((reservation) => reservation.customer_id)),
  ];
  const vehicleIds = [
    ...new Set(reservations.map((reservation) => reservation.vehicle_id)),
  ];

  const [customersResult, vehiclesResult] = await Promise.all([
    customerIds.length
      ? supabaseServer.from("customers").select("*").in("id", customerIds)
      : Promise.resolve({ data: [] as CustomerRow[], error: null }),
    vehicleIds.length
      ? supabaseServer.from("vehicles").select("*").in("id", vehicleIds)
      : Promise.resolve({ data: [] as VehicleRow[], error: null }),
  ]);

  if (customersResult.error) {
    return NextResponse.json(
      { ok: false, message: customersResult.error.message },
      { status: 500 },
    );
  }

  if (vehiclesResult.error) {
    return NextResponse.json(
      { ok: false, message: vehiclesResult.error.message },
      { status: 500 },
    );
  }

  const customersById = new Map(
    (customersResult.data ?? []).map((customer) => [customer.id, customer]),
  );
  const vehiclesById = new Map(
    (vehiclesResult.data ?? []).map((vehicle) => [vehicle.id, vehicle]),
  );

  const items = reservations.map((reservation: ReservationRow) => {
    const customer = customersById.get(reservation.customer_id);
    const vehicle = vehiclesById.get(reservation.vehicle_id);

    return {
      id: reservation.id,
      customerId: reservation.customer_id,
      reservedAt: reservation.reserved_at,
      status: reservation.status,
      customerName: customer?.name ?? "未登録",
      phone: customer?.phone ?? "",
      vehicleModel: vehicle?.model_name ?? "未登録",
      createdAt: reservation.created_at,
    };
  });

  return NextResponse.json({ ok: true, items });
}

export async function PATCH(request: NextRequest) {
  if (!isAuthenticated(request)) {
    return unauthorizedResponse();
  }

  const body = (await request.json()) as {
    reservationId?: unknown;
    status?: unknown;
  };

  if (typeof body.reservationId !== "string" || !body.reservationId) {
    return NextResponse.json(
      { ok: false, message: "reservationId is required." },
      { status: 400 },
    );
  }

  if (!isReservationStatus(body.status)) {
    return NextResponse.json(
      { ok: false, message: "Invalid reservation status." },
      { status: 400 },
    );
  }

  const { data, error } = await supabaseServer
    .from("reservations")
    .update({ status: body.status })
    .eq("id", body.reservationId)
    .select("id,status")
    .single();

  if (error) {
    return NextResponse.json(
      { ok: false, message: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, reservation: data });
}
