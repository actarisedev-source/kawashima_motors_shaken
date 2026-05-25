import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  adminSessionCookieName,
  verifyAdminSessionValue,
} from "@/lib/auth/admin-session";
import { supabaseServer } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type CustomerRow = Database["public"]["Tables"]["customers"]["Row"];
type ReservationRow = Database["public"]["Tables"]["reservations"]["Row"];
type VehicleRow = Database["public"]["Tables"]["vehicles"]["Row"];

const unauthorizedResponse = () =>
  NextResponse.json(
    { ok: false, message: "ログインが必要です。" },
    { status: 401 },
  );

const isAuthenticated = (request: NextRequest) =>
  verifyAdminSessionValue(request.cookies.get(adminSessionCookieName)?.value);

const getLatestReservedAt = (reservations: ReservationRow[]) =>
  reservations.reduce<string | null>((latest, reservation) => {
    if (!latest) {
      return reservation.reserved_at;
    }

    return new Date(reservation.reserved_at).getTime() >
      new Date(latest).getTime()
      ? reservation.reserved_at
      : latest;
  }, null);

export async function GET(request: NextRequest) {
  if (!isAuthenticated(request)) {
    return unauthorizedResponse();
  }

  const searchParams = request.nextUrl.searchParams;
  const name = searchParams.get("name")?.trim();
  const phone = searchParams.get("phone")?.trim();

  let customersQuery = supabaseServer
    .from("customers")
    .select("*")
    .order("created_at", { ascending: false });

  if (name) {
    customersQuery = customersQuery.ilike("name", `%${name}%`);
  }

  if (phone) {
    customersQuery = customersQuery.ilike("phone", `%${phone}%`);
  }

  const { data: customers, error: customersError } = await customersQuery;

  if (customersError) {
    return NextResponse.json(
      { ok: false, message: customersError.message },
      { status: 500 },
    );
  }

  const customerIds = customers.map((customer) => customer.id);

  const [vehiclesResult, reservationsResult] = await Promise.all([
    customerIds.length
      ? supabaseServer
          .from("vehicles")
          .select("*")
          .in("customer_id", customerIds)
      : Promise.resolve({ data: [] as VehicleRow[], error: null }),
    customerIds.length
      ? supabaseServer
          .from("reservations")
          .select("*")
          .in("customer_id", customerIds)
      : Promise.resolve({ data: [] as ReservationRow[], error: null }),
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

  const vehiclesByCustomerId = new Map<string, VehicleRow[]>();
  const reservationsByCustomerId = new Map<string, ReservationRow[]>();

  for (const vehicle of vehiclesResult.data ?? []) {
    const current = vehiclesByCustomerId.get(vehicle.customer_id) ?? [];
    vehiclesByCustomerId.set(vehicle.customer_id, [...current, vehicle]);
  }

  for (const reservation of reservationsResult.data ?? []) {
    const current =
      reservationsByCustomerId.get(reservation.customer_id) ?? [];
    reservationsByCustomerId.set(reservation.customer_id, [
      ...current,
      reservation,
    ]);
  }

  const items = customers.map((customer: CustomerRow) => {
    const vehicles = vehiclesByCustomerId.get(customer.id) ?? [];
    const reservations = reservationsByCustomerId.get(customer.id) ?? [];

    return {
      id: customer.id,
      name: customer.name,
      phone: customer.phone ?? "",
      createdAt: customer.created_at,
      vehicleCount: vehicles.length,
      reservationCount: reservations.length,
      latestReservedAt: getLatestReservedAt(reservations),
    };
  });

  return NextResponse.json({ ok: true, items });
}
