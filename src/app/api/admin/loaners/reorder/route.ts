import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAdminAuthFromRequest } from "@/lib/auth/admin-session";
import { buildLoanerSortOrderUpdates } from "@/lib/loaners/loaner-vehicle";
import { supabaseServer } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

const unauthorizedResponse = () =>
  NextResponse.json(
    { ok: false, message: "ログインが必要です。" },
    { status: 401 },
  );

const validateOrderedIds = (value: unknown) => {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((id) => typeof id !== "string" || !id.trim())
  ) {
    return null;
  }

  const orderedIds = value.map((id) => id.trim());
  return new Set(orderedIds).size === orderedIds.length ? orderedIds : null;
};

export async function PATCH(request: NextRequest) {
  const auth = await getAdminAuthFromRequest(request);
  if (!auth.authenticated) return unauthorizedResponse();

  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const orderedIds = validateOrderedIds(body.orderedIds);

  if (!orderedIds) {
    return NextResponse.json(
      { ok: false, message: "並び順の指定が正しくありません。" },
      { status: 400 },
    );
  }

  const { data: vehicles, error: loadError } = await supabaseServer
    .from("loaner_vehicles")
    .select("*");

  if (loadError) {
    console.error("Failed to load loaner vehicles before reorder", loadError);
    return NextResponse.json(
      { ok: false, message: "並び順の保存に失敗しました。" },
      { status: 500 },
    );
  }

  const existingIds = new Set((vehicles ?? []).map((vehicle) => vehicle.id));
  const includesAllVehicles =
    existingIds.size === orderedIds.length &&
    orderedIds.every((id) => existingIds.has(id));

  if (!includesAllVehicles) {
    return NextResponse.json(
      {
        ok: false,
        message: "全件表示の最新状態で並び替えてください。",
      },
      { status: 409 },
    );
  }

  const sortOrderById = new Map(
    buildLoanerSortOrderUpdates(orderedIds).map((item) => [
      item.id,
      item.sortOrder,
    ]),
  );
  const updates: Database["public"]["Tables"]["loaner_vehicles"]["Insert"][] =
    (vehicles ?? []).map((vehicle) => ({
      id: vehicle.id,
      vehicle_name: vehicle.vehicle_name,
      display_name: vehicle.display_name,
      plate_number: vehicle.plate_number,
      category: vehicle.category,
      is_active: vehicle.is_active,
      sort_order: sortOrderById.get(vehicle.id) ?? vehicle.sort_order,
      memo: vehicle.memo,
      created_at: vehicle.created_at,
      updated_at: vehicle.updated_at,
    }));
  const { error: updateError } = await supabaseServer
    .from("loaner_vehicles")
    .upsert(updates, { onConflict: "id" });

  if (updateError) {
    console.error("Failed to reorder loaner vehicles", updateError);
    return NextResponse.json(
      { ok: false, message: "並び順の保存に失敗しました。" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
