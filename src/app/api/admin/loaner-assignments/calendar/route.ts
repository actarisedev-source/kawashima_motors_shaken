import { NextResponse, type NextRequest } from "next/server";
import { getAdminAuthFromRequest } from "@/lib/auth/admin-session";
import { fetchHolidays, findHolidayForDate } from "@/lib/holidays/holidays";
import {
  filterLoanerCalendarVehicles,
  parseLoanerCalendarSearchParams,
  type LoanerCalendarVehicle,
} from "@/lib/loaners/loaner-calendar";
import type { LoanerHistoryItem } from "@/lib/loaners/loaner-history";
import { toLoanerVehicle } from "@/lib/loaners/server";
import { supabaseServer } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type AssignmentRow =
  Database["public"]["Tables"]["loaner_assignments"]["Row"];

const internalErrorResponse = (context: string, error: unknown) => {
  console.error(`[loaner-calendar] ${context}`, error);
  return NextResponse.json(
    {
      ok: false,
      message:
        "代車カレンダーの取得に失敗しました。時間をおいて再度お試しください。",
    },
    { status: 500 },
  );
};

export async function GET(request: NextRequest) {
  const auth = await getAdminAuthFromRequest(request);
  if (!auth.authenticated) {
    return NextResponse.json(
      { ok: false, message: "ログインが必要です。" },
      { status: 401 },
    );
  }

  const parsed = parseLoanerCalendarSearchParams(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, message: parsed.message },
      { status: 400 },
    );
  }

  const filters = parsed.value;
  const [vehiclesResult, holidaysResult] = await Promise.all([
    supabaseServer
      .from("loaner_vehicles")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("display_name", { ascending: true }),
    fetchHolidays(),
  ]);

  if (vehiclesResult.error) {
    return internalErrorResponse("vehicle query", vehiclesResult.error);
  }

  const vehicles = filterLoanerCalendarVehicles(
    (vehiclesResult.data ?? []).map(toLoanerVehicle),
    filters,
  );
  const vehicleIds = vehicles.map((vehicle) => vehicle.id);
  let assignmentQuery = supabaseServer
    .from("loaner_assignments")
    .select("*")
    .in("status", ["scheduled", "checked_out"])
    .lt("scheduled_start_at", filters.exclusiveEndAt)
    .gt("scheduled_end_at", filters.startAt);

  if (vehicleIds.length) {
    assignmentQuery = assignmentQuery.in("loaner_vehicle_id", vehicleIds);
  }
  if (filters.assignmentStatus) {
    assignmentQuery = assignmentQuery.eq("status", filters.assignmentStatus);
  }

  const assignmentsResult = vehicleIds.length
    ? await assignmentQuery.order("scheduled_start_at", { ascending: true })
    : { data: [] as AssignmentRow[], error: null };

  if (assignmentsResult.error) {
    return internalErrorResponse("assignment query", assignmentsResult.error);
  }

  const rows = (assignmentsResult.data ?? []) as AssignmentRow[];
  const customerIds = [
    ...new Set(
      rows
        .map((row) => row.customer_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const reservationIds = [
    ...new Set(
      rows
        .map((row) => row.reservation_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const [customersResult, reservationsResult] = await Promise.all([
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

  if (customersResult.error) {
    return internalErrorResponse("customer existence query", customersResult.error);
  }
  if (reservationsResult.error) {
    return internalErrorResponse(
      "reservation existence query",
      reservationsResult.error,
    );
  }

  const existingCustomerIds = new Set(
    (customersResult.data ?? []).map((customer) => customer.id),
  );
  const existingReservationIds = new Set(
    (reservationsResult.data ?? []).map((reservation) => reservation.id),
  );
  const vehiclesById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const assignmentsByVehicleId = new Map<string, LoanerHistoryItem[]>();

  for (const row of rows) {
    const vehicle = vehiclesById.get(row.loaner_vehicle_id);
    if (!vehicle) continue;
    const assignment: LoanerHistoryItem = {
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
        vehicleName: vehicle.vehicleName,
        displayName: vehicle.displayName,
        plateNumber: vehicle.plateNumber,
        category: vehicle.category,
      },
      customerExists:
        Boolean(row.customer_id) &&
        existingCustomerIds.has(row.customer_id ?? ""),
      reservationExists:
        Boolean(row.reservation_id) &&
        existingReservationIds.has(row.reservation_id ?? ""),
    };
    const current = assignmentsByVehicleId.get(vehicle.id) ?? [];
    current.push(assignment);
    assignmentsByVehicleId.set(vehicle.id, current);
  }

  const calendarVehicles = vehicles
    .filter(
      (vehicle) =>
        !filters.assignmentStatus ||
        (assignmentsByVehicleId.get(vehicle.id)?.length ?? 0) > 0,
    )
    .map<LoanerCalendarVehicle>((vehicle) => ({
      ...vehicle,
      assignments: assignmentsByVehicleId.get(vehicle.id) ?? [],
    }));

  let holidays: string[] = [];
  if (!holidaysResult.error) {
    holidays = filters.dateKeys.filter((dateKey) =>
      Boolean(
        findHolidayForDate(
          new Date(`${dateKey}T00:00:00+09:00`),
          holidaysResult.data ?? [],
        ),
      ),
    );
  } else if (holidaysResult.error.code !== "PGRST205") {
    console.error("[loaner-calendar] holiday query", holidaysResult.error);
  }

  return NextResponse.json({
    ok: true,
    periodStart: filters.periodStart,
    periodEnd: filters.periodEnd,
    dateKeys: filters.dateKeys,
    holidays,
    vehicles: calendarVehicles,
  });
}
