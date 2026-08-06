import type { LoanerAssignment } from "@/lib/loaners/loaner-assignment";
import type { Database } from "@/types/database";

type LoanerAssignmentRow =
  Database["public"]["Tables"]["loaner_assignments"]["Row"];

export const toLoanerAssignment = (
  row: LoanerAssignmentRow,
): LoanerAssignment => ({
  id: row.id,
  loanerVehicleId: row.loaner_vehicle_id,
  reservationId: row.reservation_id,
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
});

export const getAssignmentRpcRow = (rows: LoanerAssignmentRow[] | null) =>
  rows?.[0] ?? null;
