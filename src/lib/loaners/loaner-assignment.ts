export const loanerAssignmentStatuses = [
  "scheduled",
  "checked_out",
  "returned",
  "cancelled",
] as const;

export type LoanerAssignmentStatus =
  (typeof loanerAssignmentStatuses)[number];

export type LoanerAssignment = {
  id: string;
  loanerVehicleId: string;
  reservationId: string;
  customerId: string | null;
  scheduledStartAt: string;
  scheduledEndAt: string;
  actualReturnedAt: string | null;
  status: LoanerAssignmentStatus;
  memo: string;
  snapshotCustomerName: string;
  snapshotPhone: string;
  snapshotReservedAt: string;
  snapshotStaffName: string;
  createdAt: string;
  updatedAt: string;
};

export type LoanerAssignmentInput = {
  loanerVehicleId: string;
  reservationId: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  memo: string | null;
};

export type LoanerAssignmentChangeInput = Omit<
  LoanerAssignmentInput,
  "reservationId"
>;

type AssignmentPeriod = {
  scheduledStartAt: string;
  scheduledEndAt: string;
  status?: LoanerAssignmentStatus;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const normalizeMemo = (value: unknown) => {
  if (typeof value !== "string") return null;
  const memo = value.normalize("NFKC").trim();
  return memo || null;
};

const normalizeDateTime = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
};

export const isLoanerAssignmentStatus = (
  value: unknown,
): value is LoanerAssignmentStatus =>
  typeof value === "string" &&
  loanerAssignmentStatuses.includes(value as LoanerAssignmentStatus);

export const validateLoanerAssignmentInput = (input: {
  loanerVehicleId?: unknown;
  reservationId?: unknown;
  scheduledStartAt?: unknown;
  scheduledEndAt?: unknown;
  memo?: unknown;
}):
  | { ok: true; value: LoanerAssignmentInput }
  | { ok: false; message: string } => {
  const loanerVehicleId =
    typeof input.loanerVehicleId === "string"
      ? input.loanerVehicleId.trim()
      : "";
  const reservationId =
    typeof input.reservationId === "string" ? input.reservationId.trim() : "";
  const scheduledStartAt = normalizeDateTime(input.scheduledStartAt);
  const scheduledEndAt = normalizeDateTime(input.scheduledEndAt);
  const memo = normalizeMemo(input.memo);

  if (!uuidPattern.test(loanerVehicleId)) {
    return { ok: false, message: "代車が正しくありません。" };
  }
  if (!uuidPattern.test(reservationId)) {
    return { ok: false, message: "予約が正しくありません。" };
  }
  if (!scheduledStartAt || !scheduledEndAt) {
    return { ok: false, message: "貸出予定日時が正しくありません。" };
  }
  if (new Date(scheduledStartAt) >= new Date(scheduledEndAt)) {
    return {
      ok: false,
      message: "返却予定日時は貸出予定日時より後にしてください。",
    };
  }
  if (memo && memo.length > 1000) {
    return { ok: false, message: "メモは1000文字以内で入力してください。" };
  }

  return {
    ok: true,
    value: {
      loanerVehicleId,
      reservationId,
      scheduledStartAt,
      scheduledEndAt,
      memo,
    },
  };
};

export const validateLoanerAssignmentChangeInput = (input: {
  loanerVehicleId?: unknown;
  scheduledStartAt?: unknown;
  scheduledEndAt?: unknown;
  memo?: unknown;
}):
  | { ok: true; value: LoanerAssignmentChangeInput }
  | { ok: false; message: string } => {
  const validated = validateLoanerAssignmentInput({
    ...input,
    reservationId: "00000000-0000-4000-8000-000000000000",
  });

  if (!validated.ok) return validated;

  return {
    ok: true,
    value: {
      loanerVehicleId: validated.value.loanerVehicleId,
      scheduledStartAt: validated.value.scheduledStartAt,
      scheduledEndAt: validated.value.scheduledEndAt,
      memo: validated.value.memo,
    },
  };
};

export const validateLoanerReleaseInput = (value: unknown) => {
  if (value === undefined || value === null || value === "") {
    return { ok: true as const, value: new Date().toISOString() };
  }

  const actualReturnedAt = normalizeDateTime(value);
  if (!actualReturnedAt) {
    return { ok: false as const, message: "返却日時が正しくありません。" };
  }

  return { ok: true as const, value: actualReturnedAt };
};

export const hasLoanerAssignmentOverlap = (
  assignments: AssignmentPeriod[],
  candidate: Pick<AssignmentPeriod, "scheduledStartAt" | "scheduledEndAt">,
) => {
  const candidateStart = new Date(candidate.scheduledStartAt).getTime();
  const candidateEnd = new Date(candidate.scheduledEndAt).getTime();

  return assignments.some((assignment) => {
    if (
      assignment.status === "returned" ||
      assignment.status === "cancelled"
    ) {
      return false;
    }

    const assignmentStart = new Date(assignment.scheduledStartAt).getTime();
    const assignmentEnd = new Date(assignment.scheduledEndAt).getTime();
    return assignmentStart < candidateEnd && assignmentEnd > candidateStart;
  });
};

const activeReservationUniqueIndexName =
  "loaner_assignments_active_reservation_unique_idx";

export const isLoanerAssignmentReservationConflictError = (error: {
  code?: string;
  message?: string;
  details?: string;
}) =>
  error.code === "23505" &&
  [error.message, error.details].some(
    (value) =>
      value?.includes(activeReservationUniqueIndexName) ||
      value?.includes("(reservation_id)"),
  );

export const getLoanerAssignmentError = (error: {
  code?: string;
  message?: string;
  details?: string;
}) => {
  const message = error.message ?? "";

  if (isLoanerAssignmentReservationConflictError(error)) {
    return {
      status: 409,
      message:
        "この予約にはすでに代車が割り当てられています。画面を更新してご確認ください。",
    };
  }
  if (message.includes("loaner_assignment_overlap") || error.code === "23P01") {
    return { status: 409, message: "指定した期間は代車が重複しています。" };
  }
  if (message.includes("loaner_vehicle_unavailable")) {
    return { status: 409, message: "指定した代車は使用できません。" };
  }
  if (message.includes("loaner_reservation_not_found")) {
    return { status: 404, message: "予約が見つかりません。" };
  }
  if (message.includes("loaner_assignment_not_found")) {
    return { status: 404, message: "代車割当が見つかりません。" };
  }
  if (message.includes("loaner_assignment_not_changeable")) {
    return { status: 409, message: "この代車割当は変更できません。" };
  }
  if (message.includes("loaner_assignment_not_releasable")) {
    return { status: 409, message: "この代車割当は解除できません。" };
  }
  if (message.includes("loaner_assignment_invalid_input")) {
    return { status: 400, message: "代車割当の入力内容が正しくありません。" };
  }

  return { status: 500, message: "代車割当の処理に失敗しました。" };
};

export const isLoanerAssignmentOverlapError = (error: {
  code?: string;
  message?: string;
}) =>
  error.code === "23P01" ||
  (error.message ?? "").includes("loaner_assignment_overlap");
