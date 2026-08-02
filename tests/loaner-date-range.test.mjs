import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  addLoanerRangeMonths,
  getLoanerRangeCalendarDates,
  isLoanerDateWithinRange,
  selectLoanerDateRange,
} from "../src/lib/loaners/loaner-date-range.ts";
import { createLoanerDatePeriod } from "../src/lib/loaners/loaner-period.ts";

const readSource = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const picker = readSource(
  "src/app/admin/loaners/loaner-date-range-picker.tsx",
);
const actions = readSource(
  "src/app/admin/loaners/loaner-assignment-actions.tsx",
);

test("期間選択は開始、返却の順で確定し、同日返却も許可する", () => {
  assert.deepEqual(
    selectLoanerDateRange({ startDate: "", endDate: "" }, "2026-08-04"),
    { startDate: "2026-08-04", endDate: "" },
  );
  assert.deepEqual(
    selectLoanerDateRange(
      { startDate: "2026-08-04", endDate: "" },
      "2026-08-10",
    ),
    { startDate: "2026-08-04", endDate: "2026-08-10" },
  );
  assert.deepEqual(
    selectLoanerDateRange(
      { startDate: "2026-08-04", endDate: "" },
      "2026-08-04",
    ),
    { startDate: "2026-08-04", endDate: "2026-08-04" },
  );
});

test("逆順クリックと確定後の再選択は新しい開始日にリセットする", () => {
  assert.deepEqual(
    selectLoanerDateRange(
      { startDate: "2026-08-10", endDate: "" },
      "2026-08-06",
    ),
    { startDate: "2026-08-06", endDate: "" },
  );
  assert.deepEqual(
    selectLoanerDateRange(
      { startDate: "2026-08-04", endDate: "2026-08-10" },
      "2026-08-06",
    ),
    { startDate: "2026-08-06", endDate: "" },
  );
});

test("選択範囲の中間日だけを帯表示対象にする", () => {
  assert.equal(
    isLoanerDateWithinRange("2026-08-07", "2026-08-04", "2026-08-10"),
    true,
  );
  assert.equal(
    isLoanerDateWithinRange("2026-08-04", "2026-08-04", "2026-08-10"),
    false,
  );
  assert.equal(
    isLoanerDateWithinRange("2026-08-10", "2026-08-04", "2026-08-10"),
    false,
  );
});

test("月移動は年またぎを保ち、各月は日曜始まりの42セルを返す", () => {
  assert.equal(addLoanerRangeMonths("2026-12", 1), "2027-01");
  assert.equal(addLoanerRangeMonths("2027-01", -1), "2026-12");

  const august = getLoanerRangeCalendarDates("2026-08");
  assert.equal(august.length, 42);
  assert.equal(august[0].weekday, 0);
  assert.ok(august.some((date) => date.dateKey === "2026-08-31"));
});

test("既存のJST半開区間変換は同日・月またぎ・年またぎで維持される", () => {
  assert.deepEqual(createLoanerDatePeriod("2026-08-04", "2026-08-04"), {
    ok: true,
    value: {
      startDate: "2026-08-04",
      endDate: "2026-08-04",
      scheduledStartAt: "2026-08-03T15:00:00.000Z",
      scheduledEndAt: "2026-08-04T15:00:00.000Z",
    },
  });
  assert.equal(
    createLoanerDatePeriod("2026-08-28", "2026-09-03").ok,
    true,
  );
  assert.equal(
    createLoanerDatePeriod("2026-12-29", "2027-01-04").ok,
    true,
  );
});

test("期間変更UIはPC 2か月、スマホ1か月、中央だけをスクロールする", () => {
  assert.match(picker, /max-h-\[900px\]/);
  assert.match(picker, /max-w-\[1200px\]/);
  assert.match(picker, /sm:h-\[90dvh\]/);
  assert.match(picker, /sm:w-\[90vw\]/);
  assert.match(picker, /md:grid-cols-2/);
  assert.match(picker, /hidden md:block/);
  assert.match(picker, /min-h-0 flex-1 overflow-y-auto overflow-x-hidden/);
  assert.doesNotMatch(picker, /overflow-x-auto/);
  assert.match(picker, /<header className="shrink-0/);
  assert.match(picker, /<footer className="shrink-0/);
});

test("期間変更UIは未確定・保存中を無効化し既存PATCH保存を利用する", () => {
  assert.match(picker, /disabled=\{!hasValidRange \|\| isSaving\}/);
  assert.match(picker, /この期間に変更/);
  assert.match(picker, /変更中\.\.\./);
  assert.match(actions, /<LoanerDateRangePicker/);
  assert.match(actions, /createLoanerDatePeriod\(startDate, endDate\)/);
  assert.match(actions, /method: "PATCH"/);
  assert.match(actions, /action: "change"/);
});
