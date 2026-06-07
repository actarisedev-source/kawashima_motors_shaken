const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const getTodayJstDateKey = () =>
  new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(new Date());

const isValidDateKey = (value: string) => {
  if (!datePattern.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

export const normalizeBirthDateInput = (value: string | null) => {
  if (!value) {
    return null;
  }

  if (!isValidDateKey(value) || value > getTodayJstDateKey()) {
    return null;
  }

  return value;
};

export const getAgeFromBirthDate = (value: string | null) => {
  if (!value || !isValidDateKey(value)) {
    return null;
  }

  const today = getTodayJstDateKey();
  const [todayYear, todayMonth, todayDay] = today.split("-").map(Number);
  const [birthYear, birthMonth, birthDay] = value.split("-").map(Number);
  const hasBirthdayPassed =
    todayMonth > birthMonth ||
    (todayMonth === birthMonth && todayDay >= birthDay);

  return todayYear - birthYear - (hasBirthdayPassed ? 0 : 1);
};
