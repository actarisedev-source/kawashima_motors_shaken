import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildLoanerSortOrderUpdates,
  createLoanerDisplayName,
  filterAndSortLoanerVehicles,
  findLoanerDuplicate,
  isLoanerCategory,
  loanerCategories,
  moveLoanerVehicleById,
  normalizeLoanerPlateKey,
  validateLoanerVehicleInput,
} from "../src/lib/loaners/loaner-vehicle.ts";

const loanersDashboard = readFileSync(
  new URL("../src/app/admin/loaners/loaners-dashboard.tsx", import.meta.url),
  "utf8",
);
const loanerVehicleModal = readFileSync(
  new URL("../src/app/admin/loaners/loaner-vehicle-modal.tsx", import.meta.url),
  "utf8",
);
const loanerReorderRoute = readFileSync(
  new URL(
    "../src/app/api/admin/loaners/reorder/route.ts",
    import.meta.url,
  ),
  "utf8",
);

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
    displayName: " 手入力は使わない ",
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
      displayName: "プリウス 長野 500 あ 12-34",
      plateNumber: "長野 500 あ 12-34",
      category: "owned",
      isActive: false,
      sortOrder: 20,
      memo: "左リア傷あり",
    },
  });
});

test("表示名は車名とナンバーから内部生成しフォームには表示しない", () => {
  assert.equal(
    createLoanerDisplayName(" ワゴンR ", "長野 500 あ 1234"),
    "ワゴンR 長野 500 あ 1234",
  );
  assert.doesNotMatch(loanerVehicleModal, /表示名/);
  assert.doesNotMatch(loanerVehicleModal, /setDisplayName/);
});

test("表示順は入力欄と一覧列には表示せず内部管理にする", () => {
  assert.doesNotMatch(loanerVehicleModal, /表示順/);
  assert.doesNotMatch(loanerVehicleModal, /setSortOrder/);
  assert.doesNotMatch(loanerVehicleModal, /sortOrder,/);
  assert.doesNotMatch(loanersDashboard, />表示順</);
  assert.doesNotMatch(loanersDashboard, /item\.sortOrder/);
  assert.match(loanersDashboard, /並び替え/);
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

test("内部生成された表示名の重複を検出する", () => {
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

test("代車のドラッグ並び替えはID順を移動しsort_orderを1から正規化する", () => {
  const items = [
    createVehicle({ id: "a", sortOrder: 10 }),
    createVehicle({ id: "b", sortOrder: 20 }),
    createVehicle({ id: "c", sortOrder: 30 }),
    createVehicle({ id: "d", sortOrder: 40 }),
  ];

  assert.deepEqual(
    moveLoanerVehicleById(items, "c", "a").map((item) => item.id),
    ["c", "a", "b", "d"],
  );
  assert.deepEqual(
    moveLoanerVehicleById(items, "a", "d").map((item) => item.id),
    ["b", "c", "d", "a"],
  );
  assert.equal(moveLoanerVehicleById(items, "missing", "a"), items);
  assert.deepEqual(buildLoanerSortOrderUpdates(["c", "a", "b", "d"]), [
    { id: "c", sortOrder: 1 },
    { id: "a", sortOrder: 2 },
    { id: "b", sortOrder: 3 },
    { id: "d", sortOrder: 4 },
  ]);
});

test("代車並び替えAPIは全件IDを受け取り一括でsort_orderを保存する", () => {
  assert.match(loanerReorderRoute, /orderedIds/);
  assert.match(loanerReorderRoute, /buildLoanerSortOrderUpdates/);
  assert.match(loanerReorderRoute, /\.upsert\(/);
  assert.match(loanerReorderRoute, /onConflict: "id"/);
  assert.match(loanerReorderRoute, /全件表示の最新状態/);
});

test("代車並び替えUIはフィルター中と保存中にドラッグを無効化する", () => {
  assert.match(loanersDashboard, /canReorderLoaners/);
  assert.match(loanersDashboard, /hasActiveFilters/);
  assert.match(loanersDashboard, /sortSaving/);
  assert.match(loanersDashboard, /並び替えは全件表示時のみ可能です/);
  assert.match(loanersDashboard, /\/api\/admin\/loaners\/reorder/);
  assert.match(loanersDashboard, /setItems\(previousItems\)/);
});

test("代車追加・編集フォームはIME変換中のEnterを横取りしない", () => {
  assert.match(loanerVehicleModal, /onCompositionStartCapture/);
  assert.match(loanerVehicleModal, /onCompositionEndCapture/);
  assert.match(loanerVehicleModal, /isImeCompositionActive/);
  assert.match(loanerVehicleModal, /event\.nativeEvent/);
  assert.match(loanerVehicleModal, /!isImeComposing/);
});
