import assert from "node:assert/strict";
import test from "node:test";
import {
  adminLoanerRequestOptions,
  getAdminLoanerRequestLabel,
} from "../src/lib/reservations/admin-loaner-request.ts";

test("管理予約の代車選択肢は代車なしを初期候補として先頭にする", () => {
  assert.deepEqual(adminLoanerRequestOptions, [
    { value: "false", label: "代車なし" },
    { value: "true", label: "代車希望あり" },
  ]);
});

test("予約詳細の代車表示をbooleanと未設定で区別する", () => {
  assert.equal(getAdminLoanerRequestLabel(false), "代車なし");
  assert.equal(getAdminLoanerRequestLabel(true), "代車希望あり");
  assert.equal(getAdminLoanerRequestLabel(null), "未設定");
});
