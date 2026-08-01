import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAdminAuthFromRequest } from "@/lib/auth/admin-session";
import { getLoanerAssignmentError } from "@/lib/loaners/loaner-assignment";
import { supabaseServer } from "@/lib/supabase/server";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await getAdminAuthFromRequest(request);
  if (!auth.authenticated) {
    return NextResponse.json(
      { ok: false, message: "ログインが必要です。" },
      { status: 401 },
    );
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    requested?: unknown;
  };

  if (typeof body.requested !== "boolean") {
    return NextResponse.json(
      { ok: false, message: "代車希望の指定が正しくありません。" },
      { status: 400 },
    );
  }

  const { data, error } = await supabaseServer.rpc(
    "set_reservation_loaner_request",
    {
      p_reservation_id: id,
      p_requested: body.requested,
    },
  );

  if (error) {
    console.error("Failed to update reservation loaner request", error);
    const response = getLoanerAssignmentError(error);
    return NextResponse.json(
      { ok: false, message: response.message },
      { status: response.status },
    );
  }

  const reservation = data?.[0];
  if (!reservation) {
    return NextResponse.json(
      { ok: false, message: "代車希望の変更に失敗しました。" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    reservation: {
      id: reservation.id,
      loanerCarRequested: reservation.loaner_car_requested,
    },
  });
}
