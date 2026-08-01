import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAdminAuthFromRequest } from "@/lib/auth/admin-session";
import {
  getLoanerAssignmentError,
  validateLoanerAssignmentChangeInput,
  validateLoanerReleaseInput,
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

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await getAdminAuthFromRequest(request);
  if (!auth.authenticated) return unauthorizedResponse();

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  if (body.action === "checkout") {
    const { data, error } = await supabaseServer.rpc("checkout_loaner", {
      p_assignment_id: id,
    });

    if (error) {
      console.error("Failed to check out loaner assignment", error);
      const response = getLoanerAssignmentError(error);
      return NextResponse.json(
        { ok: false, message: response.message },
        { status: response.status },
      );
    }

    const assignment = getAssignmentRpcRow(data);
    if (!assignment) {
      return NextResponse.json(
        { ok: false, message: "代車の貸出開始に失敗しました。" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      item: toLoanerAssignment(assignment),
    });
  }

  if (body.action === "change") {
    const validated = validateLoanerAssignmentChangeInput(body);
    if (!validated.ok) {
      return NextResponse.json(
        { ok: false, message: validated.message },
        { status: 400 },
      );
    }

    const { data, error } = await supabaseServer.rpc("change_loaner", {
      p_assignment_id: id,
      p_loaner_vehicle_id: validated.value.loanerVehicleId,
      p_scheduled_start_at: validated.value.scheduledStartAt,
      p_scheduled_end_at: validated.value.scheduledEndAt,
      p_snapshot_staff_name: auth.user.email?.trim() || auth.user.id,
      p_memo: validated.value.memo,
    });

    if (error) {
      console.error("Failed to change loaner assignment", error);
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

  if (body.action === "release") {
    const validated = validateLoanerReleaseInput(body.actualReturnedAt);
    if (!validated.ok) {
      return NextResponse.json(
        { ok: false, message: validated.message },
        { status: 400 },
      );
    }

    const { data, error } = await supabaseServer.rpc("release_loaner", {
      p_assignment_id: id,
      p_actual_returned_at: validated.value,
    });

    if (error) {
      console.error("Failed to release loaner assignment", error);
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

  return NextResponse.json(
    { ok: false, message: "操作が正しくありません。" },
    { status: 400 },
  );
}
