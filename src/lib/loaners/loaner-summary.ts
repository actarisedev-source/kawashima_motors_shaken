import type { LoanerVehicle } from "./loaner-vehicle";

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

export const summarizeLoanerFleet = (
  vehicles: Pick<LoanerVehicle, "id" | "isActive">[],
  checkedOutVehicleIds: Iterable<string>,
): LoanerFleetSummary => {
  const registeredIds = new Set(vehicles.map((vehicle) => vehicle.id));
  const loanedIds = new Set(
    [...checkedOutVehicleIds].filter((id) => registeredIds.has(id)),
  );

  return {
    total: vehicles.length,
    loaned: loanedIds.size,
    available: vehicles.filter(
      (vehicle) => vehicle.isActive && !loanedIds.has(vehicle.id),
    ).length,
    inactive: vehicles.filter((vehicle) => !vehicle.isActive).length,
  };
};
