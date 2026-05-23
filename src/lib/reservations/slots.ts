export const reservationTimeSlots = [
  "09:00",
  "10:00",
  "11:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
] as const;

export const reservationSlotCapacity = 1;
export const reservationSlotMinutes = 60;

export type ReservationTimeSlot = (typeof reservationTimeSlots)[number];

export const isReservationTimeSlot = (
  value: unknown,
): value is ReservationTimeSlot =>
  typeof value === "string" &&
  reservationTimeSlots.includes(value as ReservationTimeSlot);

export const createReservedAtFromJst = (
  date: string,
  time: ReservationTimeSlot,
) => new Date(`${date}T${time}:00+09:00`);

export const getJstDateKey = (value: string | Date) => {
  const date = typeof value === "string" ? new Date(value) : value;

  return new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(date);
};

export const getJstTimeKey = (value: string | Date) => {
  const date = typeof value === "string" ? new Date(value) : value;

  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
  }).format(date);
};

export const getMonthRangeFromJstMonth = (month: string) => {
  const [year, monthNumber] = month.split("-").map(Number);

  if (!year || !monthNumber || monthNumber < 1 || monthNumber > 12) {
    return null;
  }

  const start = new Date(
    `${year}-${String(monthNumber).padStart(2, "0")}-01T00:00:00+09:00`,
  );
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  const end = new Date(
    `${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00+09:00`,
  );

  return { start, end };
};

export const getSlotEnd = (start: Date) =>
  new Date(start.getTime() + reservationSlotMinutes * 60 * 1000);
