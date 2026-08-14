import type { LoanerVehicle } from "./loaner-vehicle";

export const loanerFleetStatuses = ["loaned", "available", "inactive"] as const;

export type LoanerFleetStatus = (typeof loanerFleetStatuses)[number];

export type LoanerFleetSummary = {
  total: number;
  loaned: number;
  available: number;
  inactive: number;
};

export type LoanerFleetAssignment = {
  loanerVehicleId: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
};

export const emptyLoanerFleetSummary: LoanerFleetSummary = {
  total: 0,
  loaned: 0,
  available: 0,
  inactive: 0,
};

const getTime = (value: string) => {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
};

export const isLoanerAssignmentCurrent = (
  assignment: Pick<LoanerFleetAssignment, "scheduledStartAt" | "scheduledEndAt">,
  referenceAt: string,
) => {
  const referenceTime = getTime(referenceAt);
  const startTime = getTime(assignment.scheduledStartAt);
  const endTime = getTime(assignment.scheduledEndAt);

  if (referenceTime === null || startTime === null || endTime === null) {
    return false;
  }

  return startTime <= referenceTime && endTime > referenceTime;
};

export const getRepresentativeLoanerAssignment = (
  assignments: LoanerFleetAssignment[],
  referenceAt: string,
) => {
  const referenceTime = getTime(referenceAt);
  if (referenceTime === null) return null;

  const validAssignments = assignments
    .map((assignment) => ({
      assignment,
      startTime: getTime(assignment.scheduledStartAt),
      endTime: getTime(assignment.scheduledEndAt),
    }))
    .filter(
      (
        item,
      ): item is {
        assignment: LoanerFleetAssignment;
        startTime: number;
        endTime: number;
      } => item.startTime !== null && item.endTime !== null,
    );

  const current = validAssignments
    .filter((item) => item.startTime <= referenceTime && item.endTime > referenceTime)
    .sort((left, right) => left.startTime - right.startTime)[0];
  if (current) return current.assignment;

  const next = validAssignments
    .filter((item) => item.startTime > referenceTime)
    .sort((left, right) => left.startTime - right.startTime)[0];
  return next?.assignment ?? null;
};

export const getLoanerFleetStatus = (
  vehicle: Pick<LoanerVehicle, "id" | "isActive">,
  checkedOutVehicleIds: ReadonlySet<string>,
): LoanerFleetStatus => {
  if (!vehicle.isActive) return "inactive";
  return checkedOutVehicleIds.has(vehicle.id) ? "loaned" : "available";
};

export const filterLoanerFleetByStatus = (
  vehicles: LoanerVehicle[],
  checkedOutVehicleIds: ReadonlySet<string>,
  status: LoanerFleetStatus | "all",
) =>
  status === "all"
    ? vehicles
    : vehicles.filter(
        (vehicle) => getLoanerFleetStatus(vehicle, checkedOutVehicleIds) === status,
      );

export const summarizeLoanerFleet = (
  vehicles: Pick<LoanerVehicle, "id" | "isActive">[],
  checkedOutVehicleIds: Iterable<string>,
): LoanerFleetSummary => {
  const registeredIds = new Set(vehicles.map((vehicle) => vehicle.id));
  const checkedOutIds = new Set(
    [...checkedOutVehicleIds].filter((id) => registeredIds.has(id)),
  );

  const counts = vehicles.reduce(
    (summary, vehicle) => {
      summary[getLoanerFleetStatus(vehicle, checkedOutIds)] += 1;
      return summary;
    },
    { loaned: 0, available: 0, inactive: 0 },
  );

  return {
    total: vehicles.length,
    ...counts,
  };
};
