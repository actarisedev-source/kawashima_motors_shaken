import assert from "node:assert/strict";
import test from "node:test";
import {
  createLoanerDatePeriod,
  getLoanerReturnDateKey,
} from "../src/lib/loaners/loaner-period.ts";

test("JSTの日付を返却予定日込みの半開区間へ変換する", () => {
  assert.deepEqual(createLoanerDatePeriod("2026-08-05", "2026-08-08"), {
    ok: true,
    value: {
      startDate: "2026-08-05",
      endDate: "2026-08-08",
      scheduledStartAt: "2026-08-04T15:00:00.000Z",
      scheduledEndAt: "2026-08-08T15:00:00.000Z",
    },
  });
});

test("同日、月跨ぎ、年跨ぎを日付包含方式で扱う", () => {
  const sameDay = createLoanerDatePeriod("2026-08-31", "2026-08-31");
  const monthBoundary = createLoanerDatePeriod("2026-08-31", "2026-09-02");
  const yearBoundary = createLoanerDatePeriod("2026-12-31", "2027-01-02");

  assert.equal(sameDay.ok, true);
  assert.equal(
    sameDay.ok && getLoanerReturnDateKey(sameDay.value.scheduledEndAt),
    "2026-08-31",
  );
  assert.equal(
    monthBoundary.ok && monthBoundary.value.scheduledEndAt,
    "2026-09-02T15:00:00.000Z",
  );
  assert.equal(
    yearBoundary.ok && yearBoundary.value.scheduledEndAt,
    "2027-01-02T15:00:00.000Z",
  );
});

test("開始日が返却予定日より後の場合は拒否する", () => {
  assert.deepEqual(createLoanerDatePeriod("2026-08-09", "2026-08-08"), {
    ok: false,
    message: "返却予定日は貸出開始日以降を選択してください。",
  });
});
