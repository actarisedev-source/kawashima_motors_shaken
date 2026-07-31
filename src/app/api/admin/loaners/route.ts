import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAdminAuthFromRequest } from "@/lib/auth/admin-session";
import {
  filterAndSortLoanerVehicles,
  isLoanerCategory,
  validateLoanerVehicleInput,
} from "@/lib/loaners/loaner-vehicle";
import {
  findDuplicateLoanerVehicle,
  getDuplicateLoanerMessage,
  getLoanerDatabaseErrorMessage,
  getNextLoanerSortOrder,
  toLoanerVehicle,
} from "@/lib/loaners/server";
import { supabaseServer } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

const unauthorizedResponse = () =>
  NextResponse.json(
    { ok: false, message: "ログインが必要です。" },
    { status: 401 },
  );

export async function GET(request: NextRequest) {
  const auth = await getAdminAuthFromRequest(request);
  if (!auth.authenticated) return unauthorizedResponse();

  const { data, error } = await supabaseServer
    .from("loaner_vehicles")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("display_name", { ascending: true });

  if (error) {
    console.error("Failed to load loaner vehicles", error);
    return NextResponse.json(
      { ok: false, message: "代車一覧の取得に失敗しました。" },
      { status: 500 },
    );
  }

  const allItems = (data ?? []).map(toLoanerVehicle);
  const searchParams = request.nextUrl.searchParams;
  const categoryParam = searchParams.get("category") ?? "all";
  const statusParam = searchParams.get("status") ?? "all";
  const category = isLoanerCategory(categoryParam) ? categoryParam : "all";
  const status =
    statusParam === "active" || statusParam === "inactive"
      ? statusParam
      : "all";
  const items = filterAndSortLoanerVehicles(allItems, {
    query: searchParams.get("q") ?? "",
    category,
    status,
  });

  return NextResponse.json({
    ok: true,
    items,
    summary: {
      total: allItems.length,
      active: allItems.filter((item) => item.isActive).length,
      inactive: allItems.filter((item) => !item.isActive).length,
    },
    suggestedNextSortOrder: getNextLoanerSortOrder(allItems),
  });
}

export async function POST(request: NextRequest) {
  const auth = await getAdminAuthFromRequest(request);
  if (!auth.authenticated) return unauthorizedResponse();

  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  let sortOrder = body.sortOrder;

  if (sortOrder === undefined || sortOrder === null || sortOrder === "") {
    const { data: existing, error: sortError } = await supabaseServer
      .from("loaner_vehicles")
      .select("sort_order");

    if (sortError) {
      console.error("Failed to calculate loaner sort order", sortError);
      return NextResponse.json(
        { ok: false, message: "代車の保存に失敗しました。" },
        { status: 500 },
      );
    }

    sortOrder = getNextLoanerSortOrder(
      (existing ?? []).map((item) => ({ sortOrder: item.sort_order })),
    );
  }

  const validated = validateLoanerVehicleInput({
    ...body,
    isActive: body.isActive ?? true,
    sortOrder,
  });

  if (!validated.ok) {
    return NextResponse.json(
      { ok: false, message: validated.message },
      { status: 400 },
    );
  }

  try {
    const duplicate = await findDuplicateLoanerVehicle(validated.value);
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

  const payload: Database["public"]["Tables"]["loaner_vehicles"]["Insert"] = {
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
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    console.error("Failed to create loaner vehicle", error);
    return NextResponse.json(
      { ok: false, message: getLoanerDatabaseErrorMessage(error) },
      { status: error.code === "23505" ? 409 : 500 },
    );
  }

  return NextResponse.json({ ok: true, item: toLoanerVehicle(data) });
}
