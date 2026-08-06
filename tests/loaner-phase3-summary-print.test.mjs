import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { summarizeLoanerFleet } from "../src/lib/loaners/loaner-summary.ts";

const loanersDashboard = readFileSync(
  new URL("../src/app/admin/loaners/loaners-dashboard.tsx", import.meta.url),
  "utf8",
);
const adminDashboard = readFileSync(
  new URL("../src/app/admin/admin-dashboard.tsx", import.meta.url),
  "utf8",
);

test("代車一覧は総台数・貸出中・空車・使用停止を集計する", () => {
  const summary = summarizeLoanerFleet(
    [
      { id: "active-loaned", isActive: true },
      { id: "active-empty", isActive: true },
      { id: "inactive-loaned", isActive: false },
    ],
    ["active-loaned", "inactive-loaned", "active-loaned", "deleted"],
  );

  assert.deepEqual(summary, {
    total: 3,
    loaned: 2,
    available: 1,
    inactive: 1,
  });
  assert.match(loanersDashboard, /status=checked_out&page_size=100/);
  assert.match(loanersDashboard, /label: "貸出中"/);
  assert.match(loanersDashboard, /label: "空車"/);
});

test("印刷一覧は代車希望・車両・ナンバー・貸出期間と未割当を表示する", () => {
  assert.match(adminDashboard, /代車情報/);
  assert.match(adminDashboard, /代車希望あり/);
  assert.match(adminDashboard, /代車希望なし/);
  assert.match(adminDashboard, /未割当/);
  assert.match(adminDashboard, /loanerAssignment\.vehicle\.displayName/);
  assert.match(adminDashboard, /loanerAssignment\.vehicle\.plateNumber/);
  assert.match(adminDashboard, /getLoanerReturnDateKey/);
});
