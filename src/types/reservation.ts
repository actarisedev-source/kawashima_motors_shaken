export type ReservationStatus = "受付中" | "確定" | "完了" | "キャンセル";

export type Reservation = {
  id: string;
  tenantId: string;
  customerId: string;
  vehicleId: string;
  reservedAt: string;
  status: ReservationStatus;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReservationWithRelations = Reservation & {
  customer: {
    id: string;
    name: string;
    phone: string | null;
  };
  vehicle: {
    id: string;
    modelName: string;
    licensePlate: string | null;
    inspectionExpiresOn: string | null;
  };
};

