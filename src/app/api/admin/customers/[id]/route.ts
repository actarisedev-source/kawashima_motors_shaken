import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  adminSessionCookieName,
  verifyAdminSessionValue,
} from "@/lib/auth/admin-session";
import { normalizeBirthDateInput } from "@/lib/customers/birth-date";
import { isValidHiragana, kanaErrorMessage } from "@/lib/customers/kana";
import { isValidNormalizedPhone, normalizePhone } from "@/lib/customers/phone";
import { supabaseServer } from "@/lib/supabase/server";
import { normalizeDateInput } from "@/lib/vehicles/shaken-expiry";
import type { Database } from "@/types/database";

type VehicleRow = Database["public"]["Tables"]["vehicles"]["Row"];

type VehicleInput = {
  id?: unknown;
  modelName?: unknown;
  plateNumber?: unknown;
  shakenExpiryDate?: unknown;
  memo?: unknown;
};

const unauthorizedResponse = () =>
  NextResponse.json(
    { ok: false, message: "ログインが必要です。" },
    { status: 401 },
  );

const isAuthenticated = (request: NextRequest) =>
  verifyAdminSessionValue(request.cookies.get(adminSessionCookieName)?.value);

const normalizeOptional = (value: unknown) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

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
      birthDate: customer.birth_date,
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
    name?: unknown;
    nameKana?: unknown;
    phone?: unknown;
    birthDate?: unknown;
    memo?: unknown;
    vehicles?: unknown;
  };

  if (typeof body.vehicleId !== "string" || !body.vehicleId) {
    const name = normalizeOptional(body.name);
    const nameKana = normalizeOptional(body.nameKana);
    const phone = normalizeOptional(body.phone);
    const normalizedPhone = phone ? normalizePhone(phone) : "";
    const birthDate =
      typeof body.birthDate === "string"
        ? normalizeBirthDateInput(body.birthDate)
        : null;
    const memo = normalizeOptional(body.memo);
    const vehicleInputs: VehicleInput[] = Array.isArray(body.vehicles)
      ? body.vehicles
      : [];

    if (!name) {
      return NextResponse.json(
        { ok: false, message: "氏名を入力してください。" },
        { status: 400 },
      );
    }

    if (nameKana && !isValidHiragana(nameKana)) {
      return NextResponse.json(
        { ok: false, message: kanaErrorMessage },
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

    const normalizedVehicles = vehicleInputs.map((vehicle) => ({
      id: typeof vehicle.id === "string" ? vehicle.id : null,
      modelName: normalizeOptional(vehicle.modelName),
      plateNumber: normalizeOptional(vehicle.plateNumber),
      shakenExpiryDate:
        typeof vehicle.shakenExpiryDate === "string"
          ? normalizeDateInput(vehicle.shakenExpiryDate)
          : null,
      memo: normalizeOptional(vehicle.memo),
      rawShakenExpiryDate: vehicle.shakenExpiryDate,
    }));

    const invalidVehicle = normalizedVehicles.find(
      (vehicle) =>
        !vehicle.modelName ||
        (vehicle.rawShakenExpiryDate && !vehicle.shakenExpiryDate),
    );

    if (invalidVehicle) {
      return NextResponse.json(
        {
          ok: false,
          message: !invalidVehicle.modelName
            ? "車名を入力してください。"
            : "車検満了日の形式が正しくありません。",
        },
        { status: 400 },
      );
    }

    const vehicleKeys = new Set<string>();
    for (const vehicle of normalizedVehicles) {
      const key = `${vehicle.modelName}::${vehicle.plateNumber ?? ""}`;
      if (vehicleKeys.has(key)) {
        return NextResponse.json(
          {
            ok: false,
            message:
              "同じ車名とナンバーの車両が重複しています。内容を確認してください。",
          },
          { status: 409 },
        );
      }
      vehicleKeys.add(key);
    }

    const { data: existingCustomer, error: existingCustomerError } =
      await supabaseServer
        .from("customers")
        .select("id,name")
        .eq("normalized_phone", normalizedPhone)
        .neq("id", id)
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
            "同じ電話番号の顧客が既に登録されています。別の電話番号を入力してください。",
          existingCustomerId: existingCustomer.id,
          existingCustomerName: existingCustomer.name,
        },
        { status: 409 },
      );
    }

    const { data: customer, error: customerError } = await supabaseServer
      .from("customers")
      .update({
        name,
        name_kana: nameKana,
        phone,
        normalized_phone: normalizedPhone,
        birth_date: birthDate,
        memo,
      })
      .eq("id", id)
      .select("id,name,name_kana,phone,birth_date,memo")
      .single();

    if (customerError) {
      return NextResponse.json(
        { ok: false, message: customerError.message },
        { status: 500 },
      );
    }

    let vehicles: VehicleRow[] | null = null;

    if (Array.isArray(body.vehicles)) {
      const { data: currentVehicles, error: currentVehiclesError } =
        await supabaseServer
          .from("vehicles")
          .select("*")
          .eq("customer_id", id);

      if (currentVehiclesError) {
        return NextResponse.json(
          { ok: false, message: currentVehiclesError.message },
          { status: 500 },
        );
      }

      const currentVehicleIds = new Set(
        (currentVehicles ?? []).map((vehicle) => vehicle.id),
      );
      const submittedExistingIds = new Set(
        normalizedVehicles
          .map((vehicle) => vehicle.id)
          .filter((vehicleId): vehicleId is string => Boolean(vehicleId)),
      );
      const deleteIds = [...currentVehicleIds].filter(
        (vehicleId) => !submittedExistingIds.has(vehicleId),
      );

      if (deleteIds.length > 0) {
        const { error: deleteError } = await supabaseServer
          .from("vehicles")
          .delete()
          .eq("customer_id", id)
          .in("id", deleteIds);

        if (deleteError) {
          return NextResponse.json(
            { ok: false, message: deleteError.message },
            { status: 500 },
          );
        }
      }

      for (const vehicle of normalizedVehicles) {
        if (vehicle.id) {
          const { error: vehicleUpdateError } = await supabaseServer
            .from("vehicles")
            .update({
              model_name: vehicle.modelName ?? "",
              plate_number: vehicle.plateNumber,
              shaken_expiry_date: vehicle.shakenExpiryDate,
              memo: vehicle.memo,
            })
            .eq("id", vehicle.id)
            .eq("customer_id", id);

          if (vehicleUpdateError) {
            return NextResponse.json(
              { ok: false, message: vehicleUpdateError.message },
              { status: 500 },
            );
          }
        } else {
          const { error: vehicleInsertError } = await supabaseServer
            .from("vehicles")
            .insert({
              customer_id: id,
              model_name: vehicle.modelName ?? "",
              plate_number: vehicle.plateNumber,
              shaken_expiry_date: vehicle.shakenExpiryDate,
              memo: vehicle.memo,
            });

          if (vehicleInsertError) {
            return NextResponse.json(
              { ok: false, message: vehicleInsertError.message },
              { status: 500 },
            );
          }
        }
      }

      const { data: updatedVehicles, error: updatedVehiclesError } =
        await supabaseServer
          .from("vehicles")
          .select("*")
          .eq("customer_id", id)
          .order("created_at", { ascending: false });

      if (updatedVehiclesError) {
        return NextResponse.json(
          { ok: false, message: updatedVehiclesError.message },
          { status: 500 },
        );
      }

      vehicles = updatedVehicles ?? [];
    }

    return NextResponse.json({
      ok: true,
      customer: {
        id: customer.id,
        name: customer.name,
        nameKana: customer.name_kana ?? "",
        phone: customer.phone ?? "",
        birthDate: customer.birth_date,
        memo: customer.memo ?? "",
        vehicles: vehicles?.map((vehicle) => ({
          id: vehicle.id,
          modelName: vehicle.model_name,
          plateNumber: vehicle.plate_number ?? "",
          shakenExpiryDate: vehicle.shaken_expiry_date,
          memo: vehicle.memo ?? "",
          createdAt: vehicle.created_at,
        })),
      },
    });
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
