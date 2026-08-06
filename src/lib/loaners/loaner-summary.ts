import type { LoanerVehicle } from "./loaner-vehicle";

export const loanerFleetStatuses = ["loaned", "available", "inactive"] as const;

export type LoanerFleetStatus = (typeof loanerFleetStatuses)[number];

export type LoanerFleetSummary = {
  total: number;
  loaned: number;
  available: number;
  inactive: number;
};

export const emptyLoanerFleetSummary: LoanerFleetSummary = {
  total: 0,
  loaned: 0,
  available: 0,
  inactive: 0,
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
