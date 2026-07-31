const getJstDateKey = (value: string | Date) => {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
};

const dateKeyPattern = /^\d{4}-\d{2}-\d{2}$/;

const isValidDateKey = (value: string) => {
  if (!dateKeyPattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00+09:00`);
  return !Number.isNaN(date.getTime()) && getJstDateKey(date) === value;
};

const addJstDays = (dateKey: string, days: number) => {
  const date = new Date(`${dateKey}T00:00:00+09:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return getJstDateKey(date);
};

export type LoanerDatePeriod = {
  startDate: string;
  endDate: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
};

// UIの返却予定日は利用最終日。DBでは翌日0時を半開区間の終端にする。
export const createLoanerDatePeriod = (
  startDate: string,
  endDate: string,
):
  | { ok: true; value: LoanerDatePeriod }
  | { ok: false; message: string } => {
  if (!isValidDateKey(startDate) || !isValidDateKey(endDate)) {
    return {
      ok: false,
      message: "貸出開始日と返却予定日を選択してください。",
    };
  }

  if (startDate > endDate) {
    return {
      ok: false,
      message: "返却予定日は貸出開始日以降を選択してください。",
    };
  }

  const exclusiveEndDate = addJstDays(endDate, 1);

  return {
    ok: true,
    value: {
      startDate,
      endDate,
      scheduledStartAt: new Date(
        `${startDate}T00:00:00+09:00`,
      ).toISOString(),
      scheduledEndAt: new Date(
        `${exclusiveEndDate}T00:00:00+09:00`,
      ).toISOString(),
    },
  };
};

export const getLoanerReturnDateKey = (scheduledEndAt: string) => {
  const exclusiveEnd = new Date(scheduledEndAt);
  if (Number.isNaN(exclusiveEnd.getTime())) return "";
  return getJstDateKey(new Date(exclusiveEnd.getTime() - 1));
};

export const formatLoanerDate = (dateKey: string) =>
  dateKey
    ? new Intl.DateTimeFormat("ja-JP", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        timeZone: "Asia/Tokyo",
      }).format(new Date(`${dateKey}T00:00:00+09:00`))
    : "未選択";
