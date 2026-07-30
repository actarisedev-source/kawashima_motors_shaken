import assert from "node:assert/strict";
import test from "node:test";
import {
  countAdminCalendarReservationsByJstMonth,
  getUpcomingJstMonthRanges,
} from "../src/lib/reservations/monthly-counts.ts";

test("予約カレンダーの日別件数を対象月だけ合計する", () => {
  const ranges = getUpcomingJstMonthRanges(
    new Date("2026-07-15T12:00:00+09:00"),
  );
  const counts = countAdminCalendarReservationsByJstMonth(
    {
      "2026-06-30": { accepting: 4, confirmed: 2 },
      "2026-07-01": { accepting: 1, confirmed: 0 },
      "2026-07-07": { accepting: 1, confirmed: 0 },
      "2026-07-18": { accepting: 1, confirmed: 0 },
      "2026-07-23": { accepting: 1, confirmed: 1 },
      "2026-08-01": { accepting: 0, confirmed: 1 },
    },
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
  assert.equal(counts[0].count, 5);
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
