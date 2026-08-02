const monthKeyPattern = /^\d{4}-\d{2}$/;

const formatDateKey = (date: Date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate(),
  ).padStart(2, "0")}`;

export type LoanerDateRangeSelection = {
  startDate: string;
  endDate: string;
};

export const selectLoanerDateRange = (
  current: LoanerDateRangeSelection,
  selectedDate: string,
): LoanerDateRangeSelection => {
  if (!current.startDate || current.endDate || selectedDate < current.startDate) {
    return { startDate: selectedDate, endDate: "" };
  }

  return { startDate: current.startDate, endDate: selectedDate };
};

export const isLoanerDateWithinRange = (
  dateKey: string,
  startDate: string,
  endDate: string,
) => Boolean(startDate && endDate && dateKey > startDate && dateKey < endDate);

export const getLoanerRangeMonthKey = (dateKey: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey.slice(0, 7) : "";

export const addLoanerRangeMonths = (monthKey: string, amount: number) => {
  if (!monthKeyPattern.test(monthKey)) return "";
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};

export const getLoanerRangeCalendarDates = (monthKey: string) => {
  if (!monthKeyPattern.test(monthKey)) return [];
  const [year, month] = monthKey.split("-").map(Number);
  const firstDate = new Date(Date.UTC(year, month - 1, 1));
  const calendarStart = new Date(firstDate);
  calendarStart.setUTCDate(firstDate.getUTCDate() - firstDate.getUTCDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(calendarStart);
    date.setUTCDate(calendarStart.getUTCDate() + index);
    return {
      dateKey: formatDateKey(date),
      day: date.getUTCDate(),
      weekday: date.getUTCDay(),
      isCurrentMonth:
        date.getUTCFullYear() === year && date.getUTCMonth() === month - 1,
    };
  });
};

export const formatLoanerRangeMonthLabel = (monthKey: string) => {
  if (!monthKeyPattern.test(monthKey)) return "";
  const [year, month] = monthKey.split("-").map(Number);
  return `${year}年${month}月`;
};
