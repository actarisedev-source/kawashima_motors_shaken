import type { LoanerHistoryItem } from "./loaner-history";
import type { LoanerAssignmentStatus } from "./loaner-assignment";
import type { LoanerCategory, LoanerVehicle } from "./loaner-vehicle";

const supportedLoanerCategories: LoanerCategory[] = [
  "rental",
  "owned",
  "sales",
];

const getCalendarJstDateKey = (value: string | Date) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(typeof value === "string" ? new Date(value) : value);

const normalizeCalendarText = (value: unknown) =>
  typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ")
    : "";

const weekdayKeys = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const getCalendarJstWeekday = (dateKey: string) => {
  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "Asia/Tokyo",
  }).format(new Date(`${dateKey}T00:00:00+09:00`));
  return weekdayKeys.indexOf(weekday);
};

const getCalendarReturnDateKey = (scheduledEndAt: string) => {
  const exclusiveEnd = new Date(scheduledEndAt);
  if (Number.isNaN(exclusiveEnd.getTime())) return "";
  return getCalendarJstDateKey(new Date(exclusiveEnd.getTime() - 1));
};

export const loanerCalendarAssignmentStatuses = [
  "checked_out",
] as const;

export type LoanerCalendarAssignmentStatus =
  (typeof loanerCalendarAssignmentStatuses)[number];

export type LoanerCalendarVehicleStatus = "active" | "inactive";

export type LoanerCalendarVehicle = LoanerVehicle & {
  assignments: LoanerHistoryItem[];
};

export type LoanerCalendarResponse = {
  ok: boolean;
  periodStart?: string;
  periodEnd?: string;
  dateKeys?: string[];
  holidays?: string[];
  vehicles?: LoanerCalendarVehicle[];
  message?: string;
};

const dateKeyPattern = /^\d{4}-\d{2}-\d{2}$/;

export const isLoanerCalendarDateKey = (value: string) => {
  if (!dateKeyPattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00+09:00`);
  return !Number.isNaN(date.getTime()) && getCalendarJstDateKey(date) === value;
};

export const addLoanerCalendarDays = (dateKey: string, amount: number) => {
  const date = new Date(`${dateKey}T00:00:00+09:00`);
  date.setUTCDate(date.getUTCDate() + amount);
  return getCalendarJstDateKey(date);
};

export const getLoanerCalendarWeekStart = (dateKey: string) =>
  addLoanerCalendarDays(dateKey, -getCalendarJstWeekday(dateKey));

export const createLoanerCalendarPeriod = (dateKey: string, days = 7) => {
  if (!isLoanerCalendarDateKey(dateKey)) {
    return { ok: false as const, message: "表示日を正しく指定してください。" };
  }
  if (!Number.isInteger(days) || days < 1 || days > 14) {
    return { ok: false as const, message: "表示日数を正しく指定してください。" };
  }

  const periodEnd = addLoanerCalendarDays(dateKey, days - 1);
  const exclusiveEndDate = addLoanerCalendarDays(dateKey, days);

  return {
    ok: true as const,
    value: {
      periodStart: dateKey,
      periodEnd,
      dateKeys: Array.from({ length: days }, (_, index) =>
        addLoanerCalendarDays(dateKey, index),
      ),
      startAt: new Date(`${dateKey}T00:00:00+09:00`).toISOString(),
      exclusiveEndAt: new Date(
        `${exclusiveEndDate}T00:00:00+09:00`,
      ).toISOString(),
    },
  };
};

export const parseLoanerCalendarSearchParams = (
  searchParams: URLSearchParams,
  today = getCalendarJstDateKey(new Date()),
) => {
  const date = searchParams.get("date")?.trim() || today;
  const days = Number(searchParams.get("days") ?? "7");
  const keyword = normalizeCalendarText(searchParams.get("keyword") ?? "");
  const categoryValue = searchParams.get("category") ?? "all";
  const assignmentStatusValue = searchParams.get("assignment_status") ?? "all";
  const vehicleStatusValue = searchParams.get("vehicle_status") ?? "all";
  const period = createLoanerCalendarPeriod(date, days);

  if (!period.ok) return period;
  if (keyword.length > 100) {
    return { ok: false as const, message: "検索文字は100文字以内で入力してください。" };
  }
  if (
    categoryValue !== "all" &&
    !supportedLoanerCategories.includes(categoryValue as LoanerCategory)
  ) {
    return { ok: false as const, message: "分類の指定が正しくありません。" };
  }
  if (
    assignmentStatusValue !== "all" &&
    !loanerCalendarAssignmentStatuses.includes(
      assignmentStatusValue as LoanerCalendarAssignmentStatus,
    )
  ) {
    return { ok: false as const, message: "割当状態の指定が正しくありません。" };
  }
  if (
    vehicleStatusValue !== "all" &&
    vehicleStatusValue !== "active" &&
    vehicleStatusValue !== "inactive"
  ) {
    return { ok: false as const, message: "車両状態の指定が正しくありません。" };
  }

  return {
    ok: true as const,
    value: {
      ...period.value,
      keyword,
      category:
        categoryValue === "all" ? null : (categoryValue as LoanerCategory),
      assignmentStatus:
        assignmentStatusValue === "all"
          ? null
          : (assignmentStatusValue as LoanerCalendarAssignmentStatus),
      vehicleStatus:
        vehicleStatusValue === "all"
          ? null
          : (vehicleStatusValue as LoanerCalendarVehicleStatus),
    },
  };
};

export const filterLoanerCalendarVehicles = (
  vehicles: LoanerVehicle[],
  filters: {
    keyword: string;
    category: LoanerCategory | null;
    vehicleStatus: LoanerCalendarVehicleStatus | null;
  },
) => {
  const keyword = normalizeCalendarText(filters.keyword).toLocaleLowerCase("ja");

  return vehicles
    .filter((vehicle) => {
      if (filters.category && vehicle.category !== filters.category) return false;
      if (filters.vehicleStatus === "active" && !vehicle.isActive) return false;
      if (filters.vehicleStatus === "inactive" && vehicle.isActive) return false;
      if (!keyword) return true;

      return [vehicle.vehicleName, vehicle.displayName, vehicle.plateNumber].some(
        (value) => value.toLocaleLowerCase("ja").includes(keyword),
      );
    })
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        left.displayName.localeCompare(right.displayName, "ja"),
    );
};

const differenceInCalendarDays = (fromDateKey: string, toDateKey: string) =>
  Math.round(
    (new Date(`${toDateKey}T00:00:00+09:00`).getTime() -
      new Date(`${fromDateKey}T00:00:00+09:00`).getTime()) /
      86_400_000,
  );

export const getLoanerCalendarAssignmentSegment = (
  assignment: Pick<
    LoanerHistoryItem,
    "scheduledStartAt" | "scheduledEndAt"
  >,
  periodStart: string,
  days: number,
) => {
  const period = createLoanerCalendarPeriod(periodStart, days);
  if (!period.ok) return null;

  const assignmentStart = getCalendarJstDateKey(assignment.scheduledStartAt);
  const assignmentReturnDate = getCalendarReturnDateKey(
    assignment.scheduledEndAt,
  );
  if (!assignmentReturnDate) return null;
  const assignmentExclusiveEnd = addLoanerCalendarDays(
    assignmentReturnDate,
    1,
  );
  const periodExclusiveEnd = addLoanerCalendarDays(periodStart, days);
  const visibleStart = assignmentStart < periodStart ? periodStart : assignmentStart;
  const visibleEnd =
    assignmentExclusiveEnd > periodExclusiveEnd
      ? periodExclusiveEnd
      : assignmentExclusiveEnd;

  if (visibleStart >= visibleEnd) return null;

  const startIndex = differenceInCalendarDays(periodStart, visibleStart);
  const span = differenceInCalendarDays(visibleStart, visibleEnd);

  return {
    startIndex,
    span,
    continuesBefore: assignmentStart < periodStart,
    continuesAfter: assignmentExclusiveEnd > periodExclusiveEnd,
  };
};

export const isLoanerAssignmentOnDate = (
  assignment: Pick<
    LoanerHistoryItem,
    "scheduledStartAt" | "scheduledEndAt"
  >,
  dateKey: string,
) => {
  const start = new Date(`${dateKey}T00:00:00+09:00`).getTime();
  const end = new Date(
    `${addLoanerCalendarDays(dateKey, 1)}T00:00:00+09:00`,
  ).getTime();
  return (
    new Date(assignment.scheduledStartAt).getTime() < end &&
    new Date(assignment.scheduledEndAt).getTime() > start
  );
};

export const isActiveLoanerCalendarStatus = (
  status: LoanerAssignmentStatus,
): status is LoanerCalendarAssignmentStatus =>
  loanerCalendarAssignmentStatuses.includes(
    status as LoanerCalendarAssignmentStatus,
  );
