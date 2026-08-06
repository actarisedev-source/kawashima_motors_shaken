import type {
  LoanerCategory,
  LoanerVehicle,
} from "./loaner-vehicle";

const normalizeLoanerText = (value: unknown) =>
  typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ")
    : "";

export type LoanerAvailabilityConflict = {
  status: "checked_out";
  scheduledStartAt: string;
  scheduledEndAt: string;
};

export type LoanerAvailabilityItem = LoanerVehicle & {
  available: boolean;
  unavailableReason: string | null;
  conflictingAssignment: LoanerAvailabilityConflict | null;
};

type AvailabilityAssignment = LoanerAvailabilityConflict & {
  loanerVehicleId: string;
};

export const buildLoanerAvailability = (
  vehicles: LoanerVehicle[],
  assignments: AvailabilityAssignment[],
  period: { scheduledStartAt: string; scheduledEndAt: string },
) => {
  const start = new Date(period.scheduledStartAt).getTime();
  const end = new Date(period.scheduledEndAt).getTime();

  return vehicles.map((vehicle): LoanerAvailabilityItem => {
    const conflicts = assignments
      .filter((assignment) => {
        if (assignment.loanerVehicleId !== vehicle.id) return false;
        const assignmentStart = new Date(assignment.scheduledStartAt).getTime();
        const assignmentEnd = new Date(assignment.scheduledEndAt).getTime();
        return assignmentStart < end && assignmentEnd > start;
      })
      .sort((left, right) =>
        left.scheduledStartAt.localeCompare(right.scheduledStartAt),
      );
    const conflict = conflicts[0] ?? null;
    const unavailableReason = !vehicle.isActive
      ? "使用停止中"
      : conflict
        ? "指定期間に貸出中"
        : null;

    return {
      ...vehicle,
      available: unavailableReason === null,
      unavailableReason,
      conflictingAssignment: conflict,
    };
  });
};

export const filterLoanerAvailability = (
  items: LoanerAvailabilityItem[],
  filter: {
    keyword?: string;
    category?: LoanerCategory | "all";
    availableOnly?: boolean;
  },
) => {
  const keyword = normalizeLoanerText(filter.keyword).toLocaleLowerCase("ja");

  return items
    .filter((item) => {
      if (filter.category && filter.category !== "all") {
        if (item.category !== filter.category) return false;
      }
      if (filter.availableOnly && !item.available) return false;
      if (!keyword) return true;

      return [item.vehicleName, item.displayName, item.plateNumber, item.memo]
        .some((value) => value.toLocaleLowerCase("ja").includes(keyword));
    })
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        left.displayName.localeCompare(right.displayName, "ja"),
    );
};
