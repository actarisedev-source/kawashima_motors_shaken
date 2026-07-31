export const adminLoanerRequestOptions = [
  { value: "false", label: "代車なし" },
  { value: "true", label: "代車希望あり" },
] as const;

export const getAdminLoanerRequestLabel = (value: boolean | null) => {
  if (value === true) return "代車希望あり";
  if (value === false) return "代車なし";
  return "未設定";
};
