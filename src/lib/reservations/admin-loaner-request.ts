export const adminLoanerRequestOptions = [
  { value: "false", label: "代車なし" },
  { value: "true", label: "代車希望あり" },
] as const;

export const getAdminLoanerRequestLabel = (value: boolean | null) => {
  if (value === true) return "代車希望あり";
  if (value === false) return "代車なし";
  return "未設定";
};

const getJstDateKey = (value: string | Date) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value instanceof Date ? value : new Date(value));

export const canAssignLoanerToReservation = ({
  requested,
  status,
  reservedAt,
  now = new Date(),
}: {
  requested: boolean | null;
  status: string;
  reservedAt: string;
  now?: Date;
}) =>
  requested === true &&
  (status === "受付中" || status === "確定") &&
  getJstDateKey(reservedAt) >= getJstDateKey(now);
