import assert from "node:assert/strict";
import test from "node:test";
import {
  countReservationsByJstMonth,
  getUpcomingJstMonthRanges,
} from "../src/lib/reservations/monthly-counts.ts";

test("JSTの月初から翌月月初までを半開区間で集計する", () => {
  const ranges = getUpcomingJstMonthRanges(
    new Date("2026-07-15T12:00:00+09:00"),
  );
  const counts = countReservationsByJstMonth(
    [
      { reserved_at: "2026-06-30T14:59:59.999Z", status: "確定" },
      { reserved_at: "2026-06-30T15:00:00.000Z", status: "受付中" },
      { reserved_at: "2026-07-31T14:59:59.999Z", status: "完了" },
      { reserved_at: "2026-07-31T15:00:00.000Z", status: "確定" },
      { reserved_at: "2026-08-31T14:59:59.999Z", status: "キャンセル" },
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
  assert.equal(counts[0].count, 2);
  assert.equal(counts[1].count, 1);
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
