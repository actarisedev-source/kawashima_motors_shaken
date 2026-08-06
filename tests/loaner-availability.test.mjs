import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLoanerAvailability,
  filterLoanerAvailability,
} from "../src/lib/loaners/loaner-availability.ts";

const vehicle = (overrides) => ({
  id: crypto.randomUUID(),
  vehicleName: "プリウス",
  displayName: "プリウス1",
  plateNumber: "長野 500 あ 12-34",
  category: "owned",
  isActive: true,
  sortOrder: 10,
  memo: "禁煙",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  ...overrides,
});

const period = {
  scheduledStartAt: "2026-08-04T15:00:00.000Z",
  scheduledEndAt: "2026-08-08T15:00:00.000Z",
};

test("重複割当と使用停止車両を選択不可にする", () => {
  const available = vehicle({ id: "available", sortOrder: 2 });
  const checkedOut = vehicle({ id: "checked-out", sortOrder: 1 });
  const stopped = vehicle({ id: "stopped", isActive: false, sortOrder: 3 });
  const result = buildLoanerAvailability(
    [available, checkedOut, stopped],
    [
      {
        loanerVehicleId: "checked-out",
        status: "checked_out",
        scheduledStartAt: "2026-08-06T15:00:00.000Z",
        scheduledEndAt: "2026-08-09T15:00:00.000Z",
      },
    ],
    period,
  );

  assert.equal(result.find((item) => item.id === "available")?.available, true);
  assert.equal(
    result.find((item) => item.id === "checked-out")?.unavailableReason,
    "指定期間に貸出中",
  );
  assert.equal(
    result.find((item) => item.id === "stopped")?.unavailableReason,
    "使用停止中",
  );
});

test("半開区間の境界が接する割当は重複しない", () => {
  const item = vehicle({ id: "boundary" });
  const result = buildLoanerAvailability(
    [item],
    [
      {
        loanerVehicleId: item.id,
        status: "checked_out",
        scheduledStartAt: period.scheduledEndAt,
        scheduledEndAt: "2026-08-10T15:00:00.000Z",
      },
    ],
    period,
  );

  assert.equal(result[0].available, true);
});

test("分類・キーワード・空車のみを絞り込み、表示順で並べる", () => {
  const items = buildLoanerAvailability(
    [
      vehicle({ id: "b", displayName: "販売車B", category: "sales", sortOrder: 2 }),
      vehicle({ id: "a", displayName: "販売車A", category: "sales", sortOrder: 1 }),
      vehicle({ id: "c", displayName: "保有車", category: "owned", sortOrder: 0 }),
    ],
    [],
    period,
  );

  assert.deepEqual(
    filterLoanerAvailability(items, {
      keyword: "販売車",
      category: "sales",
      availableOnly: true,
    }).map((item) => item.id),
    ["a", "b"],
  );
});

test("利用可能台数は検索条件内の空車だけを数える", () => {
  const available = vehicle({
    id: "available-owned",
    displayName: "保有車A",
    category: "owned",
  });
  const unavailable = vehicle({
    id: "unavailable-owned",
    displayName: "保有車B",
    category: "owned",
  });
  const otherCategory = vehicle({
    id: "available-sales",
    displayName: "販売車",
    category: "sales",
  });
  const items = buildLoanerAvailability(
    [available, unavailable, otherCategory],
    [
      {
        loanerVehicleId: unavailable.id,
        status: "checked_out",
        scheduledStartAt: period.scheduledStartAt,
        scheduledEndAt: period.scheduledEndAt,
      },
    ],
    period,
  );

  const availableOwned = filterLoanerAvailability(items, {
    category: "owned",
    availableOnly: true,
  });

  assert.deepEqual(availableOwned.map((item) => item.id), [available.id]);
  assert.equal(
    items.find((item) => item.id === unavailable.id)?.unavailableReason,
    "指定期間に貸出中",
  );
});
