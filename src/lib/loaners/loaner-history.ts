import type { LoanerAssignmentStatus } from "./loaner-assignment";
import type { LoanerCategory } from "./loaner-vehicle";

export const loanerHistoryPageSize = 25;

export const loanerAssignmentStatusLabels: Record<
  LoanerAssignmentStatus,
  string
> = {
  checked_out: "貸出中",
  returned: "返却済み",
  cancelled: "キャンセル",
};

const supportedLoanerCategories: LoanerCategory[] = [
  "rental",
  "owned",
  "sales",
];

export type LoanerHistoryItem = {
  id: string;
  loanerVehicleId: string;
  reservationId: string | null;
  customerId: string | null;
  scheduledStartAt: string;
  scheduledEndAt: string;
  actualReturnedAt: string | null;
  status: LoanerAssignmentStatus;
  memo: string;
  snapshotCustomerName: string;
  snapshotPhone: string;
  snapshotReservedAt: string;
  snapshotStaffName: string;
  createdAt: string;
  updatedAt: string;
  vehicle: {
    id: string;
    vehicleName: string;
    displayName: string;
    plateNumber: string;
    category: LoanerCategory;
  };
  customerExists: boolean;
  reservationExists: boolean;
};

export type LoanerHistoryResponse = {
  ok: boolean;
  items?: LoanerHistoryItem[];
  total?: number;
  page?: number;
  page_size?: number;
  total_pages?: number;
  message?: string;
};

const dateKeyPattern = /^\d{4}-\d{2}-\d{2}$/;

const isValidDateKey = (value: string) => {
  if (!dateKeyPattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return false;
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date) === value;
};

export const getLoanerHistoryDateRange = (
  startDate: string,
  endDate: string,
) => {
  if ((startDate && !isValidDateKey(startDate)) || (endDate && !isValidDateKey(endDate))) {
    return { ok: false as const, message: "期間を正しく入力してください。" };
  }
  if (startDate && endDate && startDate > endDate) {
    return {
      ok: false as const,
      message: "終了日は開始日以降を選択してください。",
    };
  }

  const exclusiveEndAt = endDate
    ? new Date(new Date(`${endDate}T00:00:00+09:00`).getTime() + 86_400_000).toISOString()
    : null;

  return {
    ok: true as const,
    value: {
      startAt: startDate
        ? new Date(`${startDate}T00:00:00+09:00`).toISOString()
        : null,
      exclusiveEndAt,
    },
  };
};

export const parseLoanerHistorySearchParams = (searchParams: URLSearchParams) => {
  const rawPage = Number(searchParams.get("page") ?? "1");
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const rawPageSize = Number(
    searchParams.get("page_size") ?? String(loanerHistoryPageSize),
  );
  const pageSize =
    Number.isInteger(rawPageSize) && rawPageSize > 0 && rawPageSize <= 100
      ? rawPageSize
      : loanerHistoryPageSize;
  const keyword = (searchParams.get("keyword") ?? "")
    .normalize("NFKC")
    .trim();
  const statusValue = searchParams.get("status") ?? "all";
  const categoryValue = searchParams.get("category") ?? "all";
  const startDate = searchParams.get("date_from") ?? "";
  const endDate = searchParams.get("date_to") ?? "";

  if (keyword.length > 100) {
    return { ok: false as const, message: "検索文字は100文字以内で入力してください。" };
  }
  if (
    statusValue !== "all" &&
    !Object.hasOwn(loanerAssignmentStatusLabels, statusValue)
  ) {
    return { ok: false as const, message: "状態の指定が正しくありません。" };
  }
  if (
    categoryValue !== "all" &&
    !supportedLoanerCategories.includes(categoryValue as LoanerCategory)
  ) {
    return { ok: false as const, message: "分類の指定が正しくありません。" };
  }

  const dateRange = getLoanerHistoryDateRange(startDate, endDate);
  if (!dateRange.ok) return dateRange;

  return {
    ok: true as const,
    value: {
      page,
      pageSize,
      keyword,
      status:
        statusValue === "all"
          ? null
          : (statusValue as LoanerAssignmentStatus),
      category:
        categoryValue === "all" ? null : (categoryValue as LoanerCategory),
      startDate,
      endDate,
      ...dateRange.value,
    },
  };
};
