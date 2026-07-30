export type JstMonthRange = {
  key: string;
  label: string;
  start: Date;
  end: Date;
};

type ReservationForMonthlySummary = {
  reservedAt: string;
  status: string;
};

export type MonthlyReservationSummary = {
  key: string;
  label: string;
  accepting: number;
  confirmed: number;
  completed: number;
  count: number;
};

const jstYearMonthFormatter = new Intl.DateTimeFormat("sv-SE", {
  year: "numeric",
  month: "2-digit",
  timeZone: "Asia/Tokyo",
});

const formatMonthKey = (year: number, month: number) =>
  `${year}-${String(month).padStart(2, "0")}`;

export const getUpcomingJstMonthRanges = (
  now = new Date(),
  count = 4,
): JstMonthRange[] => {
  const [currentYear, currentMonth] = jstYearMonthFormatter
    .format(now)
    .split("-")
    .map(Number);

  return Array.from({ length: count }, (_, offset) => {
    const normalizedMonth = new Date(
      Date.UTC(currentYear, currentMonth - 1 + offset, 1),
    );
    const year = normalizedMonth.getUTCFullYear();
    const month = normalizedMonth.getUTCMonth() + 1;
    const nextMonth = new Date(Date.UTC(year, month, 1));
    const nextYear = nextMonth.getUTCFullYear();
    const nextMonthNumber = nextMonth.getUTCMonth() + 1;
    const key = formatMonthKey(year, month);

    return {
      key,
      label: `${month}月`,
      start: new Date(`${key}-01T00:00:00+09:00`),
      end: new Date(
        `${formatMonthKey(nextYear, nextMonthNumber)}-01T00:00:00+09:00`,
      ),
    };
  });
};

export const summarizeReservationsByJstMonth = (
  reservations: ReservationForMonthlySummary[],
  ranges: JstMonthRange[],
): MonthlyReservationSummary[] =>
  ranges.map((range) => {
    const startTime = range.start.getTime();
    const endTime = range.end.getTime();
    let accepting = 0;
    let confirmed = 0;
    let completed = 0;

    for (const reservation of reservations) {
      const reservedAt = new Date(reservation.reservedAt).getTime();

      if (reservedAt < startTime || reservedAt >= endTime) {
        continue;
      }

      if (reservation.status === "受付中") {
        accepting += 1;
      } else if (reservation.status === "確定") {
        confirmed += 1;
      } else if (reservation.status === "完了") {
        completed += 1;
      }
    }

    return {
      key: range.key,
      label: range.label,
      accepting,
      confirmed,
      completed,
      count: accepting + confirmed + completed,
    };
  });
