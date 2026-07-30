import assert from "node:assert/strict";
import test from "node:test";
import {
  getUpcomingJstMonthRanges,
  summarizeReservationsByJstMonth,
} from "../src/lib/reservations/monthly-counts.ts";

test("対象月の受付中・確定・完了だけをステータス別に集計する", () => {
  const ranges = getUpcomingJstMonthRanges(
    new Date("2026-07-15T12:00:00+09:00"),
  );
  const summaries = summarizeReservationsByJstMonth(
    [
      { reservedAt: "2026-06-30T14:59:59.999Z", status: "受付中" },
      { reservedAt: "2026-06-30T15:00:00.000Z", status: "受付中" },
      { reservedAt: "2026-07-07T00:00:00.000Z", status: "完了" },
      { reservedAt: "2026-07-23T02:00:00.000Z", status: "確定" },
      { reservedAt: "2026-07-23T03:00:00.000Z", status: "キャンセル" },
      { reservedAt: "2026-07-31T14:59:59.999Z", status: "完了" },
      { reservedAt: "2026-07-31T15:00:00.000Z", status: "受付中" },
    ],
    ranges,
  );

  assert.deepEqual(
    ranges.slice(0, 2).map(({ key, start, end }) => ({
      key,
      start: start.toISOString(),
      end: end.toISOString(),
    })),
    [
      {
        key: "2026-07",
        start: "2026-06-30T15:00:00.000Z",
        end: "2026-07-31T15:00:00.000Z",
      },
      {
        key: "2026-08",
        start: "2026-07-31T15:00:00.000Z",
        end: "2026-08-31T15:00:00.000Z",
      },
    ],
  );
  assert.deepEqual(summaries[0], {
    key: "2026-07",
    label: "7月",
    accepting: 1,
    confirmed: 1,
    completed: 2,
    count: 4,
  });
  assert.deepEqual(summaries[1], {
    key: "2026-08",
    label: "8月",
    accepting: 1,
    confirmed: 0,
    completed: 0,
    count: 1,
  });
});

test("12月から翌年1月への年またぎを正しく処理する", () => {
  const ranges = getUpcomingJstMonthRanges(
    new Date("2026-12-20T12:00:00+09:00"),
  );

  assert.deepEqual(
    ranges.map(({ key }) => key),
    ["2026-12", "2027-01", "2027-02", "2027-03"],
  );
  assert.equal(ranges[0].start.toISOString(), "2026-11-30T15:00:00.000Z");
  assert.equal(ranges[0].end.toISOString(), "2026-12-31T15:00:00.000Z");
  assert.equal(ranges[1].start.toISOString(), "2026-12-31T15:00:00.000Z");
  assert.equal(ranges[1].end.toISOString(), "2027-01-31T15:00:00.000Z");
});
