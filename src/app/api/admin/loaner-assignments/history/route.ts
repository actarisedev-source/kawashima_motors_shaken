import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAdminAuthFromRequest } from "@/lib/auth/admin-session";
import {
  parseLoanerHistorySearchParams,
  type LoanerHistoryItem,
} from "@/lib/loaners/loaner-history";
import { supabaseServer } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type AssignmentRow =
  Database["public"]["Tables"]["loaner_assignments"]["Row"];
type LoanerVehicleRow =
  Database["public"]["Tables"]["loaner_vehicles"]["Row"];

const unauthorizedResponse = () =>
  NextResponse.json(
    { ok: false, message: "ログインが必要です。" },
    { status: 401 },
  );

const internalErrorResponse = (context: string, error: unknown) => {
  console.error(`[loaner-history] ${context}`, error);
  return NextResponse.json(
    { ok: false, message: "貸出履歴の取得に失敗しました。" },
    { status: 500 },
  );
};

const quotePostgrestPattern = (keyword: string) =>
  `"*${keyword.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}*"`;

export async function GET(request: NextRequest) {
  const auth = await getAdminAuthFromRequest(request);
  if (!auth.authenticated) return unauthorizedResponse();

  const parsed = parseLoanerHistorySearchParams(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, message: parsed.message },
      { status: 400 },
    );
  }

  const filters = parsed.value;
  let categoryVehicleIds: string[] | null = null;
  let keywordVehicleIds: string[] = [];

  if (filters.category) {
    const { data, error } = await supabaseServer
      .from("loaner_vehicles")
      .select("id")
      .eq("category", filters.category);

    if (error) return internalErrorResponse("category vehicle lookup", error);
    categoryVehicleIds = (data ?? []).map((item) => item.id);
  }

  if (filters.keyword) {
    const pattern = quotePostgrestPattern(filters.keyword);
    const { data, error } = await supabaseServer
      .from("loaner_vehicles")
      .select("id")
      .or(
        [
          `vehicle_name.ilike.${pattern}`,
          `display_name.ilike.${pattern}`,
          `plate_number.ilike.${pattern}`,
        ].join(","),
      );

    if (error) return internalErrorResponse("keyword vehicle lookup", error);
    keywordVehicleIds = (data ?? []).map((item) => item.id);
  }

  if (categoryVehicleIds?.length === 0) {
    return NextResponse.json({
      ok: true,
      items: [],
      total: 0,
      page: filters.page,
      page_size: filters.pageSize,
      total_pages: 1,
    });
  }

  let query = supabaseServer
    .from("loaner_assignments")
    .select("*", { count: "exact" });

  if (filters.status) query = query.eq("status", filters.status);
  if (categoryVehicleIds) {
    query = query.in("loaner_vehicle_id", categoryVehicleIds);
  }
  if (filters.startAt) {
    query = query.gt("scheduled_end_at", filters.startAt);
  }
  if (filters.exclusiveEndAt) {
    query = query.lt("scheduled_start_at", filters.exclusiveEndAt);
  }
  if (filters.keyword) {
    const pattern = quotePostgrestPattern(filters.keyword);
    const conditions = [
      `snapshot_customer_name.ilike.${pattern}`,
      `snapshot_phone.ilike.${pattern}`,
      `snapshot_staff_name.ilike.${pattern}`,
      `memo.ilike.${pattern}`,
    ];
    if (keywordVehicleIds.length) {
      conditions.push(`loaner_vehicle_id.in.(${keywordVehicleIds.join(",")})`);
    }
    query = query.or(conditions.join(","));
  }

  const rangeStart = (filters.page - 1) * filters.pageSize;
  const rangeEnd = rangeStart + filters.pageSize - 1;
  const { data, error, count } = await query
    .order("scheduled_start_at", { ascending: false })
    .order("created_at", { ascending: false })
    .range(rangeStart, rangeEnd);

  if (error) return internalErrorResponse("assignment query", error);

  const rows = (data ?? []) as AssignmentRow[];
  const loanerVehicleIds = [
    ...new Set(rows.map((item) => item.loaner_vehicle_id)),
  ];
  const customerIds = [
    ...new Set(
      rows
        .map((item) => item.customer_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const reservationIds = [
    ...new Set(
      rows
        .map((item) => item.reservation_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const [vehiclesResult, customersResult, reservationsResult] =
    await Promise.all([
      loanerVehicleIds.length
        ? supabaseServer
            .from("loaner_vehicles")
            .select("*")
            .in("id", loanerVehicleIds)
        : Promise.resolve({ data: [] as LoanerVehicleRow[], error: null }),
      customerIds.length
        ? supabaseServer.from("customers").select("id").in("id", customerIds)
        : Promise.resolve({ data: [] as { id: string }[], error: null }),
      reservationIds.length
        ? supabaseServer
            .from("reservations")
            .select("id")
            .in("id", reservationIds)
        : Promise.resolve({ data: [] as { id: string }[], error: null }),
    ]);

  if (vehiclesResult.error) {
    return internalErrorResponse("vehicle hydration", vehiclesResult.error);
  }
  if (customersResult.error) {
    return internalErrorResponse("customer existence lookup", customersResult.error);
  }
  if (reservationsResult.error) {
    return internalErrorResponse(
      "reservation existence lookup",
      reservationsResult.error,
    );
  }

  const vehiclesById = new Map(
    (vehiclesResult.data ?? []).map((vehicle) => [vehicle.id, vehicle]),
  );
  const existingCustomerIds = new Set(
    (customersResult.data ?? []).map((customer) => customer.id),
  );
  const existingReservationIds = new Set(
    (reservationsResult.data ?? []).map((reservation) => reservation.id),
  );

  const items = rows.flatMap<LoanerHistoryItem>((row) => {
    const vehicle = vehiclesById.get(row.loaner_vehicle_id);
    if (!vehicle) return [];

    return [
      {
        id: row.id,
        loanerVehicleId: row.loaner_vehicle_id,
        reservationId: row.reservation_id ?? null,
        customerId: row.customer_id,
        scheduledStartAt: row.scheduled_start_at,
        scheduledEndAt: row.scheduled_end_at,
        actualReturnedAt: row.actual_returned_at,
        status: row.status,
        memo: row.memo ?? "",
        snapshotCustomerName: row.snapshot_customer_name,
        snapshotPhone: row.snapshot_phone,
        snapshotReservedAt: row.snapshot_reserved_at,
        snapshotStaffName: row.snapshot_staff_name,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        vehicle: {
          id: vehicle.id,
          vehicleName: vehicle.vehicle_name,
          displayName: vehicle.display_name,
          plateNumber: vehicle.plate_number,
          category: vehicle.category,
        },
        customerExists:
          Boolean(row.customer_id) && existingCustomerIds.has(row.customer_id ?? ""),
        reservationExists:
          Boolean(row.reservation_id) &&
          existingReservationIds.has(row.reservation_id ?? ""),
      },
    ];
  });

  const total = count ?? 0;
  return NextResponse.json({
    ok: true,
    items,
    total,
    page: filters.page,
    page_size: filters.pageSize,
    total_pages: Math.max(1, Math.ceil(total / filters.pageSize)),
  });
}
