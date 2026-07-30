export type JstMonthRange = {
  key: string;
  label: string;
  start: Date;
  end: Date;
};

type AdminCalendarCounts = {
  accepting: number;
  confirmed: number;
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

export const countAdminCalendarReservationsByJstMonth = (
  countsByDate: Record<string, AdminCalendarCounts>,
  ranges: JstMonthRange[],
) =>
  ranges.map((range) => {
    const monthPrefix = `${range.key}-`;
    const count = Object.entries(countsByDate).reduce(
      (total, [dateKey, counts]) =>
        dateKey.startsWith(monthPrefix)
          ? total + counts.accepting + counts.confirmed
          : total,
      0,
    );

    return {
      key: range.key,
      label: range.label,
      count,
    };
  });
