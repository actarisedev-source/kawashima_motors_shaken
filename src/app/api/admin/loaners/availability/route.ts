import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAdminAuthFromRequest } from "@/lib/auth/admin-session";
import {
  buildLoanerAvailability,
  filterLoanerAvailability,
} from "@/lib/loaners/loaner-availability";
import { createLoanerDatePeriod } from "@/lib/loaners/loaner-period";
import { isLoanerCategory } from "@/lib/loaners/loaner-vehicle";
import { toLoanerVehicle } from "@/lib/loaners/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const auth = await getAdminAuthFromRequest(request);
  if (!auth.authenticated) {
    return NextResponse.json(
      { ok: false, message: "ログインが必要です。" },
      { status: 401 },
    );
  }

  const params = request.nextUrl.searchParams;
  const period = createLoanerDatePeriod(
    params.get("start_date")?.trim() ?? "",
    params.get("end_date")?.trim() ?? "",
  );
  if (!period.ok) {
    return NextResponse.json(
      { ok: false, message: period.message },
      { status: 400 },
    );
  }

  const categoryParam = params.get("category")?.trim() ?? "all";
  if (categoryParam !== "all" && !isLoanerCategory(categoryParam)) {
    return NextResponse.json(
      { ok: false, message: "分類が正しくありません。" },
      { status: 400 },
    );
  }

  const [vehiclesResult, assignmentsResult] = await Promise.all([
    supabaseServer.from("loaner_vehicles").select("*"),
    supabaseServer
      .from("loaner_assignments")
      .select(
        "loaner_vehicle_id,scheduled_start_at,scheduled_end_at,status",
      )
      .in("status", ["scheduled", "checked_out"])
      .lt("scheduled_start_at", period.value.scheduledEndAt)
      .gt("scheduled_end_at", period.value.scheduledStartAt),
  ]);

  if (vehiclesResult.error || assignmentsResult.error) {
    console.error(
      "Failed to load loaner availability",
      vehiclesResult.error ?? assignmentsResult.error,
    );
    return NextResponse.json(
      { ok: false, message: "代車の空き状況を取得できませんでした。" },
      { status: 500 },
    );
  }

  const allItems = buildLoanerAvailability(
    (vehiclesResult.data ?? []).map(toLoanerVehicle),
    (assignmentsResult.data ?? []).map((assignment) => ({
      loanerVehicleId: assignment.loaner_vehicle_id,
      scheduledStartAt: assignment.scheduled_start_at,
      scheduledEndAt: assignment.scheduled_end_at,
      status: assignment.status as "scheduled" | "checked_out",
    })),
    period.value,
  );
  const availableOnly = params.get("available_only") !== "false";
  const items = filterLoanerAvailability(allItems, {
    keyword: params.get("keyword") ?? "",
    category:
      categoryParam === "all" ? "all" : categoryParam,
    availableOnly,
  });
  const availableCount = filterLoanerAvailability(allItems, {
    keyword: params.get("keyword") ?? "",
    category: categoryParam === "all" ? "all" : categoryParam,
    availableOnly: true,
  }).length;

  return NextResponse.json({
    ok: true,
    period: period.value,
    availableCount,
    items,
  });
}
