import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAdminAuthFromRequest } from "@/lib/auth/admin-session";
import { getLoanerAssignmentError } from "@/lib/loaners/loaner-assignment";
import {
  createReservation,
  type ReservationCreateRequest,
} from "@/lib/reservations/create-reservation";
import { getJstDateKey } from "@/lib/reservations/slots";
import { supabaseServer } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

const reservationStatuses = ["受付中", "確定", "完了", "キャンセル"] as const;

type ReservationStatus = (typeof reservationStatuses)[number];
type ReservationRow = Database["public"]["Tables"]["reservations"]["Row"];
type CustomerRow = Database["public"]["Tables"]["customers"]["Row"];
type VehicleRow = Database["public"]["Tables"]["vehicles"]["Row"];
type LoanerVehicleRow =
  Database["public"]["Tables"]["loaner_vehicles"]["Row"];

const isReservationStatus = (value: unknown): value is ReservationStatus =>
  typeof value === "string" &&
  reservationStatuses.includes(value as ReservationStatus);

const unauthorizedResponse = () =>
  NextResponse.json(
    { ok: false, message: "ログインが必要です。" },
    { status: 401 },
  );

const isAuthenticated = async (request: NextRequest) =>
  (await getAdminAuthFromRequest(request)).authenticated;

const buildReservationItem = ({
  reservationId,
  customerId,
  reservedAt,
  status,
  customerName,
  phone,
  vehicleModel,
  licensePlate,
  loanerCarRequested,
  loanerAssignment = null,
  createdAt,
}: {
  reservationId: string;
  customerId: string;
  reservedAt: string;
  status: string;
  customerName: string;
  phone: string;
  vehicleModel: string;
  licensePlate: string | null;
  loanerCarRequested: boolean | null;
  loanerAssignment?: {
    id: string;
    status: "scheduled" | "checked_out";
    scheduledStartAt: string;
    scheduledEndAt: string;
    vehicle: {
      id: string;
      vehicleName: string;
      displayName: string;
      plateNumber: string;
      category: "rental" | "owned" | "sales";
    };
  } | null;
  createdAt: string;
}) => ({
  id: reservationId,
  customerId,
  reservedAt,
  status,
  customerName,
  phone,
  vehicleModel,
  licensePlate: licensePlate ?? "",
  loanerCarRequested,
  loanerAssignment,
  createdAt,
});

export async function GET(request: NextRequest) {
  if (!(await isAuthenticated(request))) {
    return unauthorizedResponse();
  }

  const { data: reservations, error: reservationsError } = await supabaseServer
    .from("reservations")
    .select("*")
    .order("created_at", { ascending: false });

  if (reservationsError) {
    return NextResponse.json(
      { ok: false, message: reservationsError.message },
      { status: 500 },
    );
  }

  const customerIds = [
    ...new Set(reservations.map((reservation) => reservation.customer_id)),
  ];
  const vehicleIds = [
    ...new Set(reservations.map((reservation) => reservation.vehicle_id)),
  ];

  const [customersResult, vehiclesResult, assignmentsResult] = await Promise.all([
    customerIds.length
      ? supabaseServer.from("customers").select("*").in("id", customerIds)
      : Promise.resolve({ data: [] as CustomerRow[], error: null }),
    vehicleIds.length
      ? supabaseServer.from("vehicles").select("*").in("id", vehicleIds)
      : Promise.resolve({ data: [] as VehicleRow[], error: null }),
    reservations.length
      ? supabaseServer
          .from("loaner_assignments")
          .select("*")
          .in("reservation_id", reservations.map((item) => item.id))
          .in("status", ["scheduled", "checked_out"])
          .order("created_at", { ascending: false })
      : Promise.resolve({
          data: [] as Database["public"]["Tables"]["loaner_assignments"]["Row"][],
          error: null,
        }),
  ]);

  if (customersResult.error) {
    return NextResponse.json(
      { ok: false, message: customersResult.error.message },
      { status: 500 },
    );
  }

  if (vehiclesResult.error) {
    return NextResponse.json(
      { ok: false, message: vehiclesResult.error.message },
      { status: 500 },
    );
  }

  if (assignmentsResult.error) {
    return NextResponse.json(
      { ok: false, message: assignmentsResult.error.message },
      { status: 500 },
    );
  }

  const assignmentRows = assignmentsResult.data ?? [];
  const loanerVehicleIds = [
    ...new Set(assignmentRows.map((item) => item.loaner_vehicle_id)),
  ];
  const loanerVehiclesResult = loanerVehicleIds.length
    ? await supabaseServer
        .from("loaner_vehicles")
        .select("*")
        .in("id", loanerVehicleIds)
    : { data: [] as LoanerVehicleRow[], error: null };

  if (loanerVehiclesResult.error) {
    return NextResponse.json(
      { ok: false, message: loanerVehiclesResult.error.message },
      { status: 500 },
    );
  }

  const customersById = new Map(
    (customersResult.data ?? []).map((customer) => [customer.id, customer]),
  );
  const vehiclesById = new Map(
    (vehiclesResult.data ?? []).map((vehicle) => [vehicle.id, vehicle]),
  );
  const loanerVehiclesById = new Map(
    (loanerVehiclesResult.data ?? []).map((vehicle) => [vehicle.id, vehicle]),
  );
  const assignmentsByReservationId = new Map<
    string,
    (typeof assignmentRows)[number]
  >();
  for (const assignment of assignmentRows) {
    if (!assignmentsByReservationId.has(assignment.reservation_id)) {
      assignmentsByReservationId.set(assignment.reservation_id, assignment);
    }
  }

  const items = reservations.map((reservation: ReservationRow) => {
    const customer = customersById.get(reservation.customer_id);
    const vehicle = vehiclesById.get(reservation.vehicle_id);
    const loanerAssignment = assignmentsByReservationId.get(reservation.id);
    const loanerVehicle = loanerAssignment
      ? loanerVehiclesById.get(loanerAssignment.loaner_vehicle_id)
      : null;

    return {
      id: reservation.id,
      customerId: reservation.customer_id,
      reservedAt: reservation.reserved_at,
      status: reservation.status,
      customerName: customer?.name ?? "未登録",
      phone: customer?.phone ?? "",
      vehicleModel: vehicle?.model_name ?? "未登録",
      licensePlate: vehicle?.plate_number ?? "",
      loanerCarRequested: reservation.loaner_car_requested ?? null,
      loanerAssignment:
        loanerAssignment && loanerVehicle
          ? {
              id: loanerAssignment.id,
              status: loanerAssignment.status as "scheduled" | "checked_out",
              scheduledStartAt: loanerAssignment.scheduled_start_at,
              scheduledEndAt: loanerAssignment.scheduled_end_at,
              vehicle: {
                id: loanerVehicle.id,
                vehicleName: loanerVehicle.vehicle_name,
                displayName: loanerVehicle.display_name,
                plateNumber: loanerVehicle.plate_number,
                category: loanerVehicle.category,
              },
            }
          : null,
      createdAt: reservation.created_at,
    };
  });

  return NextResponse.json({ ok: true, items });
}

export async function POST(request: NextRequest) {
  if (!(await isAuthenticated(request))) {
    return unauthorizedResponse();
  }

  const body = (await request.json()) as ReservationCreateRequest;
  const result = await createReservation({
    body,
    mode: "admin",
    requestUrl: request.url,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, message: result.message },
      { status: result.statusCode },
    );
  }

  return NextResponse.json({
    ok: true,
    reservationId: result.reservationId,
    status: result.reservationStatus,
    confirmationUrl: result.confirmationUrl,
    lineLinkWarning: result.lineLinkWarning,
    lineLinked: result.lineLinked,
    item: buildReservationItem({
      reservationId: result.reservationId,
      customerId: result.customerId,
      reservedAt: result.reservedAt,
      status: result.reservationStatus,
      customerName: result.customerName,
      phone: result.phone,
      vehicleModel: result.vehicleModel,
      licensePlate: result.licensePlate,
      loanerCarRequested: result.loanerCarRequested,
      createdAt: new Date().toISOString(),
    }),
  });
}

export async function PATCH(request: NextRequest) {
  if (!(await isAuthenticated(request))) {
    return unauthorizedResponse();
  }

  const body = (await request.json()) as {
    reservationId?: unknown;
    status?: unknown;
  };

  if (typeof body.reservationId !== "string" || !body.reservationId) {
    return NextResponse.json(
      { ok: false, message: "reservationId is required." },
      { status: 400 },
    );
  }

  if (!isReservationStatus(body.status)) {
    return NextResponse.json(
      { ok: false, message: "Invalid reservation status." },
      { status: 400 },
    );
  }

  const { data: existingReservation, error: reservationLookupError } =
    await supabaseServer
      .from("reservations")
      .select("id,reserved_at,status")
      .eq("id", body.reservationId)
      .maybeSingle();

  if (reservationLookupError) {
    return NextResponse.json(
      { ok: false, message: reservationLookupError.message },
      { status: 500 },
    );
  }

  if (!existingReservation) {
    return NextResponse.json(
      { ok: false, message: "予約が見つかりません。" },
      { status: 404 },
    );
  }

  if (
    getJstDateKey(existingReservation.reserved_at) < getJstDateKey(new Date()) &&
    body.status !== "完了"
  ) {
    return NextResponse.json(
      { ok: false, message: "過去の予約は変更できません。" },
      { status: 409 },
    );
  }

  if (body.status === "キャンセル") {
    const { data, error } = await supabaseServer.rpc(
      "cancel_reservation_with_loaner",
      {
        p_reservation_id: body.reservationId,
        p_expected_status: existingReservation.status,
      },
    );

    if (error) {
      const response = getLoanerAssignmentError(error);
      return NextResponse.json(
        { ok: false, message: response.message },
        { status: response.status },
      );
    }

    const reservation = data?.[0];
    if (!reservation) {
      return NextResponse.json(
        { ok: false, message: "予約のキャンセルに失敗しました。" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      reservation: { id: reservation.id, status: reservation.status },
    });
  }

  const { data, error } = await supabaseServer
    .from("reservations")
    .update({ status: body.status })
    .eq("id", body.reservationId)
    .select("id,status")
    .single();

  if (error) {
    return NextResponse.json(
      { ok: false, message: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, reservation: data });
}
