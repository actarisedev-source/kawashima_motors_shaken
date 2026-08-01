export const loanerCategories = ["rental", "owned", "sales"] as const;

export type LoanerCategory = (typeof loanerCategories)[number];

export type LoanerVehicle = {
  id: string;
  vehicleName: string;
  displayName: string;
  plateNumber: string;
  category: LoanerCategory;
  isActive: boolean;
  sortOrder: number;
  memo: string;
  createdAt: string;
  updatedAt: string;
};

export type LoanerVehicleInput = {
  vehicleName: string;
  displayName: string;
  plateNumber: string;
  category: LoanerCategory;
  isActive: boolean;
  sortOrder: number;
  memo: string | null;
};

export type LoanerVehicleFilter = {
  query?: string;
  category?: LoanerCategory | "all";
  status?: "active" | "inactive" | "all";
};

export const loanerCategoryLabels: Record<LoanerCategory, string> = {
  rental: "レンタカー",
  owned: "自社保有",
  sales: "販売車",
};

export const isLoanerCategory = (value: unknown): value is LoanerCategory =>
  typeof value === "string" &&
  loanerCategories.includes(value as LoanerCategory);

export const normalizeLoanerText = (value: unknown) =>
  typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ")
    : "";

export const normalizeLoanerPlateKey = (value: unknown) =>
  normalizeLoanerText(value)
    .toLocaleLowerCase("ja")
    .replace(/[\s\-‐‑‒–—―ー]/g, "");

export const normalizeLoanerDisplayNameKey = (value: unknown) =>
  normalizeLoanerText(value).toLocaleLowerCase("ja");

const normalizeMemo = (value: unknown) => {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim();
  return normalized || null;
};

export const validateLoanerVehicleInput = (input: {
  vehicleName?: unknown;
  displayName?: unknown;
  plateNumber?: unknown;
  category?: unknown;
  isActive?: unknown;
  sortOrder?: unknown;
  memo?: unknown;
}): { ok: true; value: LoanerVehicleInput } | { ok: false; message: string } => {
  const vehicleName = normalizeLoanerText(input.vehicleName);
  const displayName = normalizeLoanerText(input.displayName);
  const plateNumber = normalizeLoanerText(input.plateNumber);
  const sortOrder = Number(input.sortOrder);
  const memo = normalizeMemo(input.memo);

  if (!vehicleName) return { ok: false, message: "車名を入力してください。" };
  if (!displayName) return { ok: false, message: "表示名を入力してください。" };
  if (!plateNumber) return { ok: false, message: "ナンバーを入力してください。" };
  if (!isLoanerCategory(input.category)) {
    return { ok: false, message: "分類が正しくありません。" };
  }
  if (typeof input.isActive !== "boolean") {
    return { ok: false, message: "状態が正しくありません。" };
  }
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 99999) {
    return {
      ok: false,
      message: "表示順は0から99999までの整数で入力してください。",
    };
  }
  if (vehicleName.length > 100 || displayName.length > 100) {
    return { ok: false, message: "車名と表示名は100文字以内で入力してください。" };
  }
  if (plateNumber.length > 50) {
    return { ok: false, message: "ナンバーは50文字以内で入力してください。" };
  }
  if (memo && memo.length > 1000) {
    return { ok: false, message: "メモは1000文字以内で入力してください。" };
  }

  return {
    ok: true,
    value: {
      vehicleName,
      displayName,
      plateNumber,
      category: input.category,
      isActive: input.isActive,
      sortOrder,
      memo,
    },
  };
};

export const findLoanerDuplicate = (
  items: Pick<LoanerVehicle, "id" | "displayName" | "plateNumber">[],
  candidate: Pick<LoanerVehicleInput, "displayName" | "plateNumber">,
  excludeId?: string,
) => {
  const displayNameKey = normalizeLoanerDisplayNameKey(candidate.displayName);
  const plateNumberKey = normalizeLoanerPlateKey(candidate.plateNumber);

  for (const item of items) {
    if (item.id === excludeId) continue;
    if (normalizeLoanerPlateKey(item.plateNumber) === plateNumberKey) {
      return "plateNumber" as const;
    }
    if (normalizeLoanerDisplayNameKey(item.displayName) === displayNameKey) {
      return "displayName" as const;
    }
  }

  return null;
};

export const filterAndSortLoanerVehicles = (
  items: LoanerVehicle[],
  filter: LoanerVehicleFilter,
) => {
  const query = normalizeLoanerText(filter.query).toLocaleLowerCase("ja");

  return items
    .filter((item) => {
      if (filter.category && filter.category !== "all" && item.category !== filter.category) {
        return false;
      }
      if (filter.status === "active" && !item.isActive) return false;
      if (filter.status === "inactive" && item.isActive) return false;
      if (!query) return true;

      return [item.vehicleName, item.displayName, item.plateNumber, item.memo]
        .some((value) => value.toLocaleLowerCase("ja").includes(query));
    })
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        left.displayName.localeCompare(right.displayName, "ja"),
    );
};
