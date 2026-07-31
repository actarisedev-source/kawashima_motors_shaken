import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAdminAuthFromRequest } from "@/lib/auth/admin-session";
import {
  getLoanerAssignmentError,
  isLoanerAssignmentStatus,
  validateLoanerAssignmentInput,
} from "@/lib/loaners/loaner-assignment";
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
  const validated = validateLoanerAssignmentInput(body);

  if (!validated.ok) {
    return NextResponse.json(
      { ok: false, message: validated.message },
      { status: 400 },
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
