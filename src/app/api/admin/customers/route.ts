import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  adminSessionCookieName,
  verifyAdminSessionValue,
} from "@/lib/auth/admin-session";
import { normalizeBirthDateInput } from "@/lib/customers/birth-date";
import { isValidNormalizedPhone, normalizePhone } from "@/lib/customers/phone";
import { supabaseServer } from "@/lib/supabase/server";
import {
  getShakenExpiryLabel,
  getShakenExpiryStatus,
  normalizeDateInput,
} from "@/lib/vehicles/shaken-expiry";
import type { Database } from "@/types/database";

type CustomerRow = Database["public"]["Tables"]["customers"]["Row"];
type ReservationRow = Database["public"]["Tables"]["reservations"]["Row"];
type VehicleRow = Database["public"]["Tables"]["vehicles"]["Row"];

type CreateCustomerRequest = {
  name?: string;
  nameKana?: string;
  phone?: string;
  birthDate?: string;
  memo?: string;
  vehicleModel?: string;
  plateNumber?: string;
  shakenExpiryDate?: string;
  vehicleMemo?: string;
};

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

const normalizeOptional = (value: unknown) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export async function GET(request: NextRequest) {
  if (!isAuthenticated(request)) {
    return unauthorizedResponse();
  }

  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q")?.trim();
  const name = searchParams.get("name")?.trim();
  const phone = searchParams.get("phone")?.trim();

  let customersQuery = supabaseServer
    .from("customers")
    .select("*")
    .order("created_at", { ascending: false });

  if (query) {
    const normalizedQuery = normalizePhone(query);
    const filters = [`name.ilike.%${query}%`, `phone.ilike.%${query}%`];

    if (normalizedQuery) {
      filters.push(`normalized_phone.ilike.%${normalizedQuery}%`);
    }

    customersQuery = customersQuery.or(filters.join(","));
  }

  if (name) {
    customersQuery = customersQuery.ilike("name", `%${name}%`);
  }

  if (phone) {
    const normalizedPhone = normalizePhone(phone);
    customersQuery = normalizedPhone
      ? customersQuery.or(
          `phone.ilike.%${phone}%,normalized_phone.ilike.%${normalizedPhone}%`,
        )
      : customersQuery.ilike("phone", `%${phone}%`);
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
    const sortedExpiryDates = vehicles
      .map((vehicle) => vehicle.shaken_expiry_date)
      .filter((value): value is string => Boolean(value))
      .sort(
        (a, b) =>
          new Date(`${a}T00:00:00+09:00`).getTime() -
          new Date(`${b}T00:00:00+09:00`).getTime(),
      );
    const nearestShakenExpiryDate = sortedExpiryDates[0] ?? null;

    return {
      id: customer.id,
      name: customer.name,
      phone: customer.phone ?? "",
      createdAt: customer.created_at,
      vehicleCount: vehicles.length,
      reservationCount: reservations.length,
      latestReservedAt: getLatestReservedAt(reservations),
      nearestShakenExpiryDate,
      shakenExpiryStatus: getShakenExpiryStatus(nearestShakenExpiryDate),
      shakenExpiryLabel: getShakenExpiryLabel(nearestShakenExpiryDate),
    };
  });

  return NextResponse.json({ ok: true, items });
}

export async function POST(request: NextRequest) {
  if (!isAuthenticated(request)) {
    return unauthorizedResponse();
  }

  const body = (await request.json()) as CreateCustomerRequest;
  const name = normalizeOptional(body.name);
  const nameKana = normalizeOptional(body.nameKana);
  const phone = normalizeOptional(body.phone);
  const normalizedPhone = phone ? normalizePhone(phone) : "";
  const birthDate = normalizeBirthDateInput(normalizeOptional(body.birthDate));
  const memo = normalizeOptional(body.memo);
  const vehicleModel = normalizeOptional(body.vehicleModel);
  const plateNumber = normalizeOptional(body.plateNumber);
  const shakenExpiryDate = normalizeDateInput(
    normalizeOptional(body.shakenExpiryDate),
  );
  const vehicleMemo = normalizeOptional(body.vehicleMemo);

  if (!name) {
    return NextResponse.json(
      { ok: false, message: "氏名を入力してください。" },
      { status: 400 },
    );
  }

  if (!phone || !isValidNormalizedPhone(normalizedPhone)) {
    return NextResponse.json(
      { ok: false, message: "電話番号を入力してください。" },
      { status: 400 },
    );
  }

  if (body.birthDate && !birthDate) {
    return NextResponse.json(
      { ok: false, message: "生年月日は今日以前の日付を入力してください。" },
      { status: 400 },
    );
  }

  if (body.shakenExpiryDate && !shakenExpiryDate) {
    return NextResponse.json(
      { ok: false, message: "車検満了日の形式が正しくありません。" },
      { status: 400 },
    );
  }

  const hasVehicleInput = Boolean(
    vehicleModel || plateNumber || shakenExpiryDate || vehicleMemo,
  );

  if (hasVehicleInput && !vehicleModel) {
    return NextResponse.json(
      {
        ok: false,
        message: "車両情報を登録する場合は車種を入力してください。",
      },
      { status: 400 },
    );
  }

  const { data: existingCustomer, error: existingCustomerError } =
    await supabaseServer
      .from("customers")
      .select("id,name,phone")
      .eq("normalized_phone", normalizedPhone)
      .maybeSingle();

  if (existingCustomerError) {
    return NextResponse.json(
      { ok: false, message: existingCustomerError.message },
      { status: 500 },
    );
  }

  if (existingCustomer) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "同じ電話番号の顧客が既に登録されています。既存顧客の詳細を確認してください。",
        existingCustomerId: existingCustomer.id,
        existingCustomerName: existingCustomer.name,
      },
      { status: 409 },
    );
  }

  const { data: customer, error: customerError } = await supabaseServer
    .from("customers")
    .insert({
      name,
      name_kana: nameKana,
      phone,
      normalized_phone: normalizedPhone,
      birth_date: birthDate,
      memo,
    })
    .select("id")
    .single();

  if (customerError) {
    return NextResponse.json(
      { ok: false, message: customerError.message },
      { status: 500 },
    );
  }

  let vehicleId: string | null = null;

  if (hasVehicleInput && vehicleModel) {
    let vehicleQuery = supabaseServer
      .from("vehicles")
      .select("id")
      .eq("customer_id", customer.id)
      .eq("model_name", vehicleModel);

    vehicleQuery = plateNumber
      ? vehicleQuery.eq("plate_number", plateNumber)
      : vehicleQuery.is("plate_number", null);

    const { data: existingVehicle, error: existingVehicleError } =
      await vehicleQuery.maybeSingle();

    if (existingVehicleError) {
      return NextResponse.json(
        { ok: false, message: existingVehicleError.message },
        { status: 500 },
      );
    }

    if (existingVehicle) {
      vehicleId = existingVehicle.id;
    } else {
      const { data: vehicle, error: vehicleError } = await supabaseServer
        .from("vehicles")
        .insert({
          customer_id: customer.id,
          model_name: vehicleModel,
          plate_number: plateNumber,
          shaken_expiry_date: shakenExpiryDate,
          memo: vehicleMemo,
        })
        .select("id")
        .single();

      if (vehicleError) {
        return NextResponse.json(
          { ok: false, message: vehicleError.message },
          { status: 500 },
        );
      }

      vehicleId = vehicle.id;
    }
  }

  return NextResponse.json({
    ok: true,
    customerId: customer.id,
    vehicleId,
  });
}
