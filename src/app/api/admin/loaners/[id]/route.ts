import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAdminAuthFromRequest } from "@/lib/auth/admin-session";
import { validateLoanerVehicleInput } from "@/lib/loaners/loaner-vehicle";
import {
  findDuplicateLoanerVehicle,
  getDuplicateLoanerMessage,
  getLoanerDatabaseErrorMessage,
  toLoanerVehicle,
} from "@/lib/loaners/server";
import { supabaseServer } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

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
  const { data: current, error: currentError } = await supabaseServer
    .from("loaner_vehicles")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (currentError) {
    console.error("Failed to load loaner vehicle", currentError);
    return NextResponse.json(
      { ok: false, message: "代車の保存に失敗しました。" },
      { status: 500 },
    );
  }
  if (!current) {
    return NextResponse.json(
      { ok: false, message: "代車が見つかりません。" },
      { status: 404 },
    );
  }

  const validated = validateLoanerVehicleInput({
    vehicleName:
      body.vehicleName === undefined ? current.vehicle_name : body.vehicleName,
    displayName:
      body.displayName === undefined ? current.display_name : body.displayName,
    plateNumber:
      body.plateNumber === undefined ? current.plate_number : body.plateNumber,
    category: body.category === undefined ? current.category : body.category,
    isActive: body.isActive === undefined ? current.is_active : body.isActive,
    sortOrder:
      body.sortOrder === undefined ? current.sort_order : body.sortOrder,
    memo: body.memo === undefined ? current.memo : body.memo,
  });

  if (!validated.ok) {
    return NextResponse.json(
      { ok: false, message: validated.message },
      { status: 400 },
    );
  }

  try {
    const duplicate = await findDuplicateLoanerVehicle(validated.value, id);
    const duplicateMessage = getDuplicateLoanerMessage(duplicate);
    if (duplicateMessage) {
      return NextResponse.json(
        { ok: false, message: duplicateMessage },
        { status: 409 },
      );
    }
  } catch (error) {
    console.error("Failed to check loaner duplicates", error);
    return NextResponse.json(
      { ok: false, message: "代車の保存に失敗しました。" },
      { status: 500 },
    );
  }

  const payload: Database["public"]["Tables"]["loaner_vehicles"]["Update"] = {
    vehicle_name: validated.value.vehicleName,
    display_name: validated.value.displayName,
    plate_number: validated.value.plateNumber,
    category: validated.value.category,
    is_active: validated.value.isActive,
    sort_order: validated.value.sortOrder,
    memo: validated.value.memo,
  };
  const { data, error } = await supabaseServer
    .from("loaner_vehicles")
    .update(payload)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    console.error("Failed to update loaner vehicle", error);
    return NextResponse.json(
      { ok: false, message: getLoanerDatabaseErrorMessage(error) },
      { status: error.code === "23505" ? 409 : 500 },
    );
  }

  return NextResponse.json({ ok: true, item: toLoanerVehicle(data) });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await getAdminAuthFromRequest(request);
  if (!auth.authenticated) return unauthorizedResponse();

  const { id } = await context.params;
  const { data: current, error: currentError } = await supabaseServer
    .from("loaner_vehicles")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (currentError) {
    console.error("Failed to load loaner vehicle before deletion", currentError);
    return NextResponse.json(
      { ok: false, message: "代車の削除に失敗しました。" },
      { status: 500 },
    );
  }
  if (!current) {
    return NextResponse.json(
      { ok: false, message: "代車が見つかりません。" },
      { status: 404 },
    );
  }

  const { error } = await supabaseServer
    .from("loaner_vehicles")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("Failed to delete loaner vehicle", error);
    const message = getLoanerDatabaseErrorMessage(error);
    return NextResponse.json(
      {
        ok: false,
        message:
          error.code === "23503" ? message : "代車の削除に失敗しました。",
      },
      { status: error.code === "23503" ? 409 : 500 },
    );
  }

  return NextResponse.json({ ok: true, message: "代車を削除しました。" });
}
