import {
  type LoanerVehicle,
  type LoanerVehicleInput,
  findLoanerDuplicate,
} from "@/lib/loaners/loaner-vehicle";
import { supabaseServer } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type LoanerVehicleRow = Database["public"]["Tables"]["loaner_vehicles"]["Row"];

export const toLoanerVehicle = (row: LoanerVehicleRow): LoanerVehicle => ({
  id: row.id,
  vehicleName: row.vehicle_name,
  displayName: row.display_name,
  plateNumber: row.plate_number,
  category: row.category,
  isActive: row.is_active,
  sortOrder: row.sort_order,
  memo: row.memo ?? "",
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const getNextLoanerSortOrder = (
  items: Pick<LoanerVehicle, "sortOrder">[],
) =>
  items.length
    ? Math.ceil(Math.max(...items.map((item) => item.sortOrder)) / 10) * 10 + 10
    : 10;

export async function findDuplicateLoanerVehicle(
  input: Pick<LoanerVehicleInput, "displayName" | "plateNumber">,
  excludeId?: string,
) {
  const { data, error } = await supabaseServer
    .from("loaner_vehicles")
    .select("id,display_name,plate_number");

  if (error) throw error;

  return findLoanerDuplicate(
    (data ?? []).map((item) => ({
      id: item.id,
      displayName: item.display_name,
      plateNumber: item.plate_number,
    })),
    input,
    excludeId,
  );
}

export const getDuplicateLoanerMessage = (
  duplicate: "plateNumber" | "displayName" | null,
) => {
  if (duplicate === "plateNumber") {
    return "同じナンバーの代車が登録されています。";
  }
  if (duplicate === "displayName") {
    return "同じ車名とナンバーの代車が登録されています。";
  }
  return null;
};

export const getLoanerDatabaseErrorMessage = (error: {
  code?: string;
  message?: string;
}) => {
  if (error.code === "23505") {
    if (error.message?.includes("plate_number")) {
      return "同じナンバーの代車が登録されています。";
    }
    if (error.message?.includes("display_name")) {
      return "同じ車名とナンバーの代車が登録されています。";
    }
  }
  if (error.code === "23503") {
    return "貸出履歴がある代車は削除できません。使用停止にしてください。";
  }
  return "代車の保存に失敗しました。";
};
