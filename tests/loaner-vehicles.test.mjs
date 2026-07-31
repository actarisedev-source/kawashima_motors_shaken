import assert from "node:assert/strict";
import test from "node:test";
import {
  filterAndSortLoanerVehicles,
  findLoanerDuplicate,
  isLoanerCategory,
  loanerCategories,
  normalizeLoanerPlateKey,
  validateLoanerVehicleInput,
} from "../src/lib/loaners/loaner-vehicle.ts";

const createVehicle = (overrides = {}) => ({
  id: "vehicle-1",
  vehicleName: "プリウス",
  displayName: "プリウス1",
  plateNumber: "長野 500 あ 12-34",
  category: "owned",
  isActive: true,
  sortOrder: 10,
  memo: "禁煙",
  createdAt: "2026-07-31T00:00:00.000Z",
  updatedAt: "2026-07-31T00:00:00.000Z",
  ...overrides,
});

test("代車分類は3種類だけを許可する", () => {
  assert.deepEqual(loanerCategories, ["rental", "owned", "sales"]);
  assert.equal(isLoanerCategory("rental"), true);
  assert.equal(isLoanerCategory("owned"), true);
  assert.equal(isLoanerCategory("sales"), true);
  assert.equal(isLoanerCategory("other"), false);
});

test("必須項目と不正な分類を拒否する", () => {
  const base = {
    vehicleName: "プリウス",
    displayName: "プリウス1",
    plateNumber: "長野 500 あ 12-34",
    category: "owned",
    isActive: true,
    sortOrder: 10,
    memo: "",
  };

  assert.deepEqual(validateLoanerVehicleInput({ ...base, vehicleName: "" }), {
    ok: false,
    message: "車名を入力してください。",
  });
  assert.deepEqual(validateLoanerVehicleInput({ ...base, displayName: "" }), {
    ok: false,
    message: "表示名を入力してください。",
  });
  assert.deepEqual(validateLoanerVehicleInput({ ...base, plateNumber: "" }), {
    ok: false,
    message: "ナンバーを入力してください。",
  });
  assert.deepEqual(validateLoanerVehicleInput({ ...base, category: "other" }), {
    ok: false,
    message: "分類が正しくありません。",
  });
});

test("正しい入力を登録・編集用の正規化済み値へ変換する", () => {
  const result = validateLoanerVehicleInput({
    vehicleName: "  プリウス  ",
    displayName: " プリウス  1 ",
    plateNumber: "長野 500 あ 12-34",
    category: "owned",
    isActive: false,
    sortOrder: "20",
    memo: "  左リア傷あり  ",
  });

  assert.deepEqual(result, {
    ok: true,
    value: {
      vehicleName: "プリウス",
      displayName: "プリウス 1",
      plateNumber: "長野 500 あ 12-34",
      category: "owned",
      isActive: false,
      sortOrder: 20,
      memo: "左リア傷あり",
    },
  });
});

test("空白・全角半角・ダッシュ差を吸収してナンバー重複を検出する", () => {
  assert.equal(
    normalizeLoanerPlateKey("長野 ５００ あ １２ー３４"),
    normalizeLoanerPlateKey("長野500あ12-34"),
  );
  assert.equal(
    findLoanerDuplicate(
      [createVehicle()],
      { displayName: "別の代車", plateNumber: "長野５００あ１２ー３４" },
    ),
    "plateNumber",
  );
});

test("大文字小文字と余分な空白を吸収して表示名重複を検出する", () => {
  assert.equal(
    findLoanerDuplicate(
      [createVehicle({ displayName: "AQUA 1" })],
      { displayName: " aqua   1 ", plateNumber: "長野 500 あ 99-99" },
    ),
    "displayName",
  );
});

test("検索・分類・状態絞り込みと表示順を適用する", () => {
  const items = [
    createVehicle({
      id: "3",
      displayName: "販売車B",
      vehicleName: "アクア",
      category: "sales",
      sortOrder: 20,
    }),
    createVehicle({
      id: "2",
      displayName: "レンタカーA",
      vehicleName: "ヤリス",
      category: "rental",
      isActive: false,
      sortOrder: 10,
    }),
    createVehicle({ id: "1", displayName: "プリウスA", sortOrder: 10 }),
  ];

  assert.deepEqual(
    filterAndSortLoanerVehicles(items, {
      category: "all",
      status: "all",
    }).map((item) => item.id),
    ["1", "2", "3"],
  );
  assert.deepEqual(
    filterAndSortLoanerVehicles(items, {
      query: "ヤリス",
      category: "rental",
      status: "inactive",
    }).map((item) => item.id),
    ["2"],
  );
  assert.deepEqual(
    filterAndSortLoanerVehicles(items, {
      query: "禁煙",
      category: "owned",
      status: "active",
    }).map((item) => item.id),
    ["1"],
  );
});
