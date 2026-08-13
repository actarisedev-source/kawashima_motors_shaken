export const cancelledReservationStatus = "キャンセル";

export type AdminListReservation = {
  reservedAt: string;
  status: string;
};

export const isActiveAdminReservation = (reservation: AdminListReservation) =>
  reservation.status !== cancelledReservationStatus;

const getAdminReservationTimeKey = (value: string | Date) => {
  const date = typeof value === "string" ? new Date(value) : value;

  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
  }).format(date);
};

export const filterActiveAdminReservations = <
  TReservation extends AdminListReservation,
>(
  reservations: TReservation[],
) => reservations.filter(isActiveAdminReservation);

export const groupAdminReservationsByTime = <
  TReservation extends AdminListReservation,
>(
  reservations: TReservation[],
) => {
  const map = new Map<string, TReservation[]>();

  for (const reservation of filterActiveAdminReservations(reservations)) {
    const time = getAdminReservationTimeKey(reservation.reservedAt);
    map.set(time, [...(map.get(time) ?? []), reservation]);
  }

  return map;
};

export const getAdminReservationSlotLabel = (
  activeReservationIndex: number,
  capacity: number,
) => `${activeReservationIndex + 1} / ${capacity}`;
