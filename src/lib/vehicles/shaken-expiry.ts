export type ShakenExpiryStatus = "expired" | "soon" | "active" | "unknown";

export const normalizeDateInput = (value: string | null) => {
  if (!value) {
    return null;
  }

  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
};

export const getShakenExpiryStatus = (
  value: string | null,
): ShakenExpiryStatus => {
  if (!value) {
    return "unknown";
  }

  const today = new Date();
  const todayStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const expiryDate = new Date(`${value}T00:00:00+09:00`);
  const daysUntilExpiry = Math.ceil(
    (expiryDate.getTime() - todayStart.getTime()) / (24 * 60 * 60 * 1000),
  );

  if (daysUntilExpiry < 0) {
    return "expired";
  }

  if (daysUntilExpiry <= 30) {
    return "soon";
  }

  return "active";
};

export const getShakenExpiryLabel = (value: string | null) => {
  const status = getShakenExpiryStatus(value);

  switch (status) {
    case "expired":
      return "車検期限切れ";
    case "soon":
      return "まもなく車検";
    case "active":
      return "登録済み";
    default:
      return "未登録";
  }
};
