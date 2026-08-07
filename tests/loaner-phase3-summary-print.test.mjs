import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  filterLoanerFleetByStatus,
  getLoanerFleetStatus,
  summarizeLoanerFleet,
} from "../src/lib/loaners/loaner-summary.ts";

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
    loaned: 1,
    available: 1,
    inactive: 1,
  });
  assert.equal(
    summary.total,
    summary.loaned + summary.available + summary.inactive,
  );
  assert.match(loanersDashboard, /status=checked_out&page_size=100/);
  assert.match(loanersDashboard, /label: "貸出中"/);
  assert.match(loanersDashboard, /label: "空車"/);
});

test("使用停止・貸出中・空車の優先判定を一覧絞り込みでも共通利用する", () => {
  const vehicles = [
    { id: "loaned", isActive: true },
    { id: "available", isActive: true },
    { id: "inactive", isActive: false },
  ];
  const checkedOutIds = new Set(["loaned", "inactive"]);

  assert.equal(getLoanerFleetStatus(vehicles[0], checkedOutIds), "loaned");
  assert.equal(getLoanerFleetStatus(vehicles[1], checkedOutIds), "available");
  assert.equal(getLoanerFleetStatus(vehicles[2], checkedOutIds), "inactive");
  assert.deepEqual(
    filterLoanerFleetByStatus(vehicles, checkedOutIds, "loaned").map(
      (vehicle) => vehicle.id,
    ),
    ["loaned"],
  );
  assert.deepEqual(
    filterLoanerFleetByStatus(vehicles, checkedOutIds, "available").map(
      (vehicle) => vehicle.id,
    ),
    ["available"],
  );
  assert.deepEqual(
    filterLoanerFleetByStatus(vehicles, checkedOutIds, "inactive").map(
      (vehicle) => vehicle.id,
    ),
    ["inactive"],
  );
});

test("集計カードだけでstatus stateを変更し、検索条件をまとめて解除する", () => {
  assert.match(loanersDashboard, /aria-pressed={status === filter}/);
  assert.ok(loanersDashboard.includes("onClick={() => setStatus(filter)}"));
  assert.doesNotMatch(loanersDashboard, /value={status}/);
  assert.doesNotMatch(loanersDashboard, /<option value="loaned">/);
  assert.doesNotMatch(loanersDashboard, /type="submit"/);
  assert.doesNotMatch(loanersDashboard, /handleSearch/);
  assert.match(loanersDashboard, /hasActiveFilters \? \(/);
  assert.match(loanersDashboard, /setQueryInput\(""\)/);
  assert.match(loanersDashboard, /setQuery\(""\)/);
  assert.match(loanersDashboard, /setCategory\("all"\)/);
  assert.match(loanersDashboard, /setStatus\("all"\)/);
});

test("キーワード検索はIME変換中を除外してdebounce後に自動実行する", () => {
  assert.match(loanersDashboard, /setTimeout\(\(\) => \{/);
  assert.match(loanersDashboard, /}, 350\)/);
  assert.match(loanersDashboard, /if \(isQueryComposing\) return/);
  assert.match(loanersDashboard, /onCompositionStart/);
  assert.match(loanersDashboard, /onCompositionEnd/);
  assert.match(loanersDashboard, /setQuery\(queryInput\.trim\(\)\)/);
});

test("印刷一覧は代車情報を割当済み2行・未割当または希望なし1行で表示する", () => {
  assert.match(adminDashboard, /代車情報/);
  assert.doesNotMatch(adminDashboard, /代車希望あり/);
  assert.match(adminDashboard, /代車希望なし/);
  assert.match(adminDashboard, /未割当/);
  assert.match(adminDashboard, /font-semibold">代車：/);
  assert.match(adminDashboard, /font-semibold">貸出期間：/);
  assert.match(adminDashboard, /loanerAssignment\.vehicle\.displayName/);
  assert.match(adminDashboard, /loanerAssignment\.vehicle\.plateNumber/);
  assert.match(adminDashboard, /getLoanerReturnDateKey/);
  assert.match(adminDashboard, /whitespace-nowrap/);
  assert.match(adminDashboard, /<span> ～ <\/span>/);
  assert.doesNotMatch(adminDashboard, /<br \/>～<br \/>/);
  assert.match(adminDashboard, /px-3 py-2 align-middle/);
});
