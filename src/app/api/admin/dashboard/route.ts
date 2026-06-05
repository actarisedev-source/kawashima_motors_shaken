import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  adminSessionCookieName,
  verifyAdminSessionValue,
} from "@/lib/auth/admin-session";
import { getMonthRangeFromJstMonth } from "@/lib/reservations/slots";
import { supabaseServer } from "@/lib/supabase/server";
import {
  getShakenExpiryLabel,
  getShakenExpiryStatus,
} from "@/lib/vehicles/shaken-expiry";
import type { Database } from "@/types/database";

type CustomerRow = Database["public"]["Tables"]["customers"]["Row"];
type VehicleRow = Database["public"]["Tables"]["vehicles"]["Row"];

const unauthorizedResponse = () =>
  NextResponse.json(
    { ok: false, message: "ログインが必要です。" },
    { status: 401 },
  );

const isAuthenticated = (request: NextRequest) =>
  verifyAdminSessionValue(request.cookies.get(adminSessionCookieName)?.value);

const getCurrentJstMonth = () =>
  new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(new Date());

const compareExpiryDate = (a: string | null, b: string | null) => {
  if (!a && !b) {
    return 0;
  }

  if (!a) {
    return 1;
  }

  if (!b) {
    return -1;
  }

  return (
    new Date(`${a}T00:00:00+09:00`).getTime() -
    new Date(`${b}T00:00:00+09:00`).getTime()
  );
};

export async function GET(request: NextRequest) {
  if (!isAuthenticated(request)) {
    return unauthorizedResponse();
  }

  const monthRange = getMonthRangeFromJstMonth(getCurrentJstMonth());

  if (!monthRange) {
    return NextResponse.json(
      { ok: false, message: "月次集計の初期化に失敗しました。" },
      { status: 500 },
    );
  }

  const [customersResult, vehiclesResult, reservationsResult] =
    await Promise.all([
      supabaseServer.from("customers").select("*"),
      supabaseServer.from("vehicles").select("*"),
      supabaseServer
        .from("reservations")
        .select("id")
        .gte("reserved_at", monthRange.start.toISOString())
        .lt("reserved_at", monthRange.end.toISOString()),
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

  if (reservationsResult.error) {
    return NextResponse.json(
      { ok: false, message: reservationsResult.error.message },
      { status: 500 },
    );
  }

  const customersById = new Map(
    (customersResult.data ?? []).map((customer: CustomerRow) => [
      customer.id,
      customer,
    ]),
  );

  const vehiclesWithCustomers = (vehiclesResult.data ?? [])
    .map((vehicle: VehicleRow) => {
      const customer = customersById.get(vehicle.customer_id);
      const status = getShakenExpiryStatus(vehicle.shaken_expiry_date);

      return {
        id: vehicle.id,
        customerId: vehicle.customer_id,
        customerName: customer?.name ?? "未登録",
        phone: customer?.phone ?? "",
        modelName: vehicle.model_name,
        shakenExpiryDate: vehicle.shaken_expiry_date,
        shakenExpiryStatus: status,
        shakenExpiryLabel: getShakenExpiryLabel(vehicle.shaken_expiry_date),
      };
    })
    .sort((a, b) =>
      compareExpiryDate(a.shakenExpiryDate, b.shakenExpiryDate),
    );

  const expiringSoonVehicles = vehiclesWithCustomers.filter(
    (vehicle) => vehicle.shakenExpiryStatus === "soon",
  );
  const expiredVehicles = vehiclesWithCustomers.filter(
    (vehicle) => vehicle.shakenExpiryStatus === "expired",
  );

  return NextResponse.json({
    ok: true,
    kpis: {
      totalCustomers: customersResult.data?.length ?? 0,
      totalVehicles: vehiclesResult.data?.length ?? 0,
      currentMonthReservations: reservationsResult.data?.length ?? 0,
      expiringSoonVehicles: expiringSoonVehicles.length,
      expiredVehicles: expiredVehicles.length,
    },
    expiringSoonVehicles,
    expiredVehicles,
  });
}
