import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  adminSessionCookieName,
  verifyAdminPassword,
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

  const [vehiclesResult, reservationsResult, lineMessageLogsResult] =
    await Promise.all([
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
    supabaseServer
      .from("line_message_logs")
      .select(
        "id,target_type,title,body,image_url,status,error_message,sent_at,created_at,automation_type",
      )
      .eq("customer_id", id)
      .order("created_at", { ascending: false }),
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

  if (lineMessageLogsResult.error) {
    return NextResponse.json(
      { ok: false, message: lineMessageLogsResult.error.message },
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
      gender: customer.gender ?? "未設定",
      lineStatus: customer.line_status,
      lineDisplayName: customer.line_display_name,
      linePictureUrl: customer.line_picture_url,
      lineLinkedAt: customer.line_linked_at,
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
      lineMessageLogs: (lineMessageLogsResult.data ?? []).map((log) => ({
        id: log.id,
        sentAt: log.sent_at ?? log.created_at,
        deliveryType:
          log.automation_type || log.target_type.startsWith("自動配信")
            ? "自動"
            : log.target_type.includes("個別") ||
                log.target_type === "LINE連携済み全員"
              ? "手動"
              : "セグメント",
        targetType: log.target_type,
        title: log.title,
        body: log.body,
        imageUrl: log.image_url,
        status: log.status,
        errorMessage: log.error_message,
      })),
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
    unlinkLine?: unknown;
    vehicleId?: unknown;
    shakenExpiryDate?: unknown;
    name?: unknown;
    nameKana?: unknown;
    phone?: unknown;
    birthDate?: unknown;
    gender?: unknown;
    memo?: unknown;
    vehicles?: unknown;
  };

  if (body.unlinkLine === true) {
    const { data: customer, error } = await supabaseServer
      .from("customers")
      .update({
        line_user_id: null,
        line_display_name: null,
        line_picture_url: null,
        line_linked_at: null,
        line_status: "未連携",
      })
      .eq("id", id)
      .select("id,line_status,line_display_name,line_picture_url,line_linked_at")
      .single();

    if (error) {
      return NextResponse.json(
        { ok: false, message: error.message },
        { status: error.code === "PGRST116" ? 404 : 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      customer: {
        id: customer.id,
        lineStatus: customer.line_status,
        lineDisplayName: customer.line_display_name,
        linePictureUrl: customer.line_picture_url,
        lineLinkedAt: customer.line_linked_at,
      },
      message: "LINE連携情報を削除しました。",
    });
  }

  if (typeof body.vehicleId !== "string" || !body.vehicleId) {
    const name = normalizeOptional(body.name);
    const nameKana = normalizeOptional(body.nameKana);
    const phone = normalizeOptional(body.phone);
    const normalizedPhone = phone ? normalizePhone(phone) : "";
    const birthDate =
      typeof body.birthDate === "string"
        ? normalizeBirthDateInput(body.birthDate)
        : null;
    const gender = ["男性", "女性", "未設定"].includes(String(body.gender))
      ? (body.gender as "男性" | "女性" | "未設定")
      : "未設定";
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
        gender,
        memo,
      })
      .eq("id", id)
      .select("id,name,name_kana,phone,birth_date,gender,memo")
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
        gender: customer.gender,
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

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!isAuthenticated(request)) {
    return unauthorizedResponse();
  }

  const body = (await request.json()) as { password?: unknown };

  if (typeof body.password !== "string" || !body.password) {
    return NextResponse.json(
      { ok: false, message: "管理者パスワードを入力してください。" },
      { status: 400 },
    );
  }

  if (!process.env.ADMIN_PASSWORD) {
    return NextResponse.json(
      { ok: false, message: "ADMIN_PASSWORD が設定されていません。" },
      { status: 500 },
    );
  }

  if (!verifyAdminPassword(body.password)) {
    return NextResponse.json(
      { ok: false, message: "管理者パスワードが正しくありません" },
      { status: 401 },
    );
  }

  const { id } = await context.params;
  const { data: customer, error: customerError } = await supabaseServer
    .from("customers")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (customerError) {
    return NextResponse.json(
      { ok: false, message: customerError.message },
      { status: 500 },
    );
  }

  if (!customer) {
    return NextResponse.json(
      { ok: false, message: "対象の顧客が見つかりません。" },
      { status: 404 },
    );
  }

  const relatedDeletes = [
    { table: "line_message_logs" as const, label: "LINE配信履歴" },
    { table: "reservations" as const, label: "予約履歴" },
    { table: "vehicles" as const, label: "車両情報" },
  ];

  for (const target of relatedDeletes) {
    const { error } = await supabaseServer
      .from(target.table)
      .delete()
      .eq("customer_id", id);

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          message: `${target.label}の削除に失敗しました。${error.message}`,
        },
        { status: 500 },
      );
    }
  }

  const { error: deleteCustomerError } = await supabaseServer
    .from("customers")
    .delete()
    .eq("id", id);

  if (deleteCustomerError) {
    return NextResponse.json(
      {
        ok: false,
        message: `顧客情報の削除に失敗しました。${deleteCustomerError.message}`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    message: "顧客情報を削除しました。",
  });
}
