import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAdminAuthFromRequest } from "@/lib/auth/admin-session";
import {
  getLoanerAssignmentError,
  isLoanerAssignmentOverlapError,
  isLoanerAssignmentStatus,
  validateLoanerAssignmentInput,
} from "@/lib/loaners/loaner-assignment";
import { createLoanerDatePeriod } from "@/lib/loaners/loaner-period";
import {
  getAssignmentRpcRow,
  toLoanerAssignment,
} from "@/lib/loaners/assignment-server";
import { supabaseServer } from "@/lib/supabase/server";

const unauthorizedResponse = () =>
  NextResponse.json(
    { ok: false, message: "ログインが必要です。" },
    { status: 401 },
  );

export async function GET(request: NextRequest) {
  const auth = await getAdminAuthFromRequest(request);
  if (!auth.authenticated) return unauthorizedResponse();

  const searchParams = request.nextUrl.searchParams;
  const reservationId = searchParams.get("reservationId")?.trim();
  const loanerVehicleId = searchParams.get("loanerVehicleId")?.trim();
  const status = searchParams.get("status")?.trim();
  const assignmentStatus = isLoanerAssignmentStatus(status) ? status : null;

  if (status && !assignmentStatus) {
    return NextResponse.json(
      { ok: false, message: "状態が正しくありません。" },
      { status: 400 },
    );
  }

  let query = supabaseServer
    .from("loaner_assignments")
    .select("*")
    .order("scheduled_start_at", { ascending: false });

  if (reservationId) query = query.eq("reservation_id", reservationId);
  if (loanerVehicleId) {
    query = query.eq("loaner_vehicle_id", loanerVehicleId);
  }
  if (assignmentStatus) query = query.eq("status", assignmentStatus);

  const { data, error } = await query;

  if (error) {
    console.error("Failed to load loaner assignments", error);
    return NextResponse.json(
      { ok: false, message: "代車割当の取得に失敗しました。" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    items: (data ?? []).map(toLoanerAssignment),
  });
}

export async function POST(request: NextRequest) {
  const auth = await getAdminAuthFromRequest(request);
  if (!auth.authenticated) return unauthorizedResponse();

  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const datePeriod =
    typeof body.startDate === "string" || typeof body.endDate === "string"
      ? createLoanerDatePeriod(
          typeof body.startDate === "string" ? body.startDate : "",
          typeof body.endDate === "string" ? body.endDate : "",
        )
      : null;

  if (datePeriod && !datePeriod.ok) {
    return NextResponse.json(
      { ok: false, message: datePeriod.message },
      { status: 400 },
    );
  }

  const validated = validateLoanerAssignmentInput({
    ...body,
    scheduledStartAt: datePeriod?.ok
      ? datePeriod.value.scheduledStartAt
      : body.scheduledStartAt,
    scheduledEndAt: datePeriod?.ok
      ? datePeriod.value.scheduledEndAt
      : body.scheduledEndAt,
  });

  if (!validated.ok) {
    return NextResponse.json(
      { ok: false, message: validated.message },
      { status: 400 },
    );
  }

  const { data: reservation, error: reservationError } = await supabaseServer
    .from("reservations")
    .select("id,customer_id,loaner_car_requested")
    .eq("id", validated.value.reservationId)
    .maybeSingle();

  if (reservationError) {
    console.error("Failed to verify loaner reservation", reservationError);
    return NextResponse.json(
      { ok: false, message: "予約情報の確認に失敗しました。" },
      { status: 500 },
    );
  }
  if (!reservation) {
    return NextResponse.json(
      { ok: false, message: "予約が見つかりません。" },
      { status: 404 },
    );
  }
  if (reservation.loaner_car_requested !== true) {
    return NextResponse.json(
      { ok: false, message: "代車希望のない予約には割り当てできません。" },
      { status: 409 },
    );
  }

  const [customerResult, vehicleResult, activeAssignmentResult] =
    await Promise.all([
      supabaseServer
        .from("customers")
        .select("id")
        .eq("id", reservation.customer_id)
        .maybeSingle(),
      supabaseServer
        .from("loaner_vehicles")
        .select("id,is_active")
        .eq("id", validated.value.loanerVehicleId)
        .maybeSingle(),
      supabaseServer
        .from("loaner_assignments")
        .select("id")
        .eq("reservation_id", reservation.id)
        .in("status", ["scheduled", "checked_out"])
        .limit(1)
        .maybeSingle(),
    ]);

  if (
    customerResult.error ||
    vehicleResult.error ||
    activeAssignmentResult.error
  ) {
    console.error(
      "Failed to verify loaner assignment references",
      customerResult.error ??
        vehicleResult.error ??
        activeAssignmentResult.error,
    );
    return NextResponse.json(
      { ok: false, message: "代車割当の確認に失敗しました。" },
      { status: 500 },
    );
  }
  if (!customerResult.data) {
    return NextResponse.json(
      { ok: false, message: "顧客情報が見つかりません。" },
      { status: 404 },
    );
  }
  if (!vehicleResult.data) {
    return NextResponse.json(
      { ok: false, message: "代車が見つかりません。" },
      { status: 404 },
    );
  }
  if (!vehicleResult.data.is_active) {
    return NextResponse.json(
      { ok: false, message: "指定した代車は使用停止中です。" },
      { status: 409 },
    );
  }
  if (activeAssignmentResult.data) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "この予約にはすでに代車が割り当てられています。画面を更新してご確認ください。",
      },
      { status: 409 },
    );
  }

  const { data, error } = await supabaseServer.rpc("assign_loaner", {
    p_loaner_vehicle_id: validated.value.loanerVehicleId,
    p_reservation_id: validated.value.reservationId,
    p_scheduled_start_at: validated.value.scheduledStartAt,
    p_scheduled_end_at: validated.value.scheduledEndAt,
    p_snapshot_staff_name: auth.user.email?.trim() || auth.user.id,
    p_memo: validated.value.memo,
  });

  if (error) {
    console.error("Failed to assign loaner", error);
    if (isLoanerAssignmentOverlapError(error)) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "この代車はほかの予約で使用されました。別の代車を選択してください。",
        },
        { status: 409 },
      );
    }
    const response = getLoanerAssignmentError(error);
    return NextResponse.json(
      { ok: false, message: response.message },
      { status: response.status },
    );
  }

  const assignment = getAssignmentRpcRow(data);
  if (!assignment) {
    return NextResponse.json(
      { ok: false, message: "代車割当の処理に失敗しました。" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    item: toLoanerAssignment(assignment),
  });
}
