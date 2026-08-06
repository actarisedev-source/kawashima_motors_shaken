import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createLoanerCalendarPeriod,
  filterLoanerCalendarVehicles,
  formatLoanerCalendarDate,
  getLoanerCalendarAssignmentSegment,
  getLoanerCalendarDayDisplay,
  getLoanerCalendarJstDateKey,
  getLoanerCalendarWeekStart,
  isLoanerAssignmentOnDate,
  parseLoanerCalendarSearchParams,
} from "../src/lib/loaners/loaner-calendar.ts";

const readSource = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const api = readSource(
  "src/app/api/admin/loaner-assignments/calendar/route.ts",
);
const dashboard = readSource(
  "src/app/admin/loaners/calendar/loaner-calendar-dashboard.tsx",
);
const tabs = readSource("src/app/admin/loaners/loaner-admin-tabs.tsx");
const page = readSource("src/app/admin/loaners/calendar/page.tsx");

const vehicle = (overrides = {}) => ({
  id: crypto.randomUUID(),
  vehicleName: "ワゴンR",
  displayName: "ワゴンR 1",
  plateNumber: "長野 500 あ 12-34",
  category: "owned",
  isActive: true,
  sortOrder: 10,
  memo: "",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  ...overrides,
});

const assignment = (overrides = {}) => ({
  scheduledStartAt: "2026-08-04T15:00:00.000Z",
  scheduledEndAt: "2026-08-08T15:00:00.000Z",
  ...overrides,
});

test("週間表示は既存カレンダーと同じ日曜開始にする", () => {
  assert.equal(getLoanerCalendarWeekStart("2026-08-05"), "2026-08-02");
  assert.equal(getLoanerCalendarWeekStart("2026-08-02"), "2026-08-02");
});

test("JST日付はUTCとの境界・月末・年末年始でも一定になる", () => {
  assert.equal(
    getLoanerCalendarJstDateKey("2026-08-01T14:59:59.999Z"),
    "2026-08-01",
  );
  assert.equal(
    getLoanerCalendarJstDateKey("2026-08-01T15:00:00.000Z"),
    "2026-08-02",
  );
  assert.equal(
    getLoanerCalendarJstDateKey("2026-08-31T15:00:00.000Z"),
    "2026-09-01",
  );
  assert.equal(
    getLoanerCalendarJstDateKey("2026-12-31T15:00:00.000Z"),
    "2027-01-01",
  );
});

test("曜日と表示日付は実行環境のタイムゾーンに依存しない", () => {
  const originalTimeZone = process.env.TZ;
  const results = [];

  try {
    for (const timeZone of ["UTC", "Asia/Tokyo"]) {
      process.env.TZ = timeZone;
      results.push({
        day: getLoanerCalendarDayDisplay("2026-08-02"),
        date: formatLoanerCalendarDate("2026-08-02"),
        weekStart: getLoanerCalendarWeekStart(
          getLoanerCalendarJstDateKey("2026-08-06T14:59:59.000Z"),
        ),
      });
    }
  } finally {
    if (originalTimeZone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimeZone;
    }
  }

  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(results[0], {
    day: { monthDay: "8/2", weekday: "日", weekdayIndex: 0 },
    date: "2026/08/02(日)",
    weekStart: "2026-08-02",
  });
});

test("サーバーで確定した基準日を初回描画へ渡す", () => {
  assert.match(page, /getLoanerCalendarJstDateKey\(new Date\(\)\)/);
  assert.match(page, /initialToday=\{initialToday\}/);
  assert.match(dashboard, /initialToday: string/);
  assert.match(dashboard, /const today = initialToday/);
  assert.doesNotMatch(dashboard, /getJstDateKey\(new Date\(\)\)/);
});

test("7日間をJSTの半開区間で計算する", () => {
  const result = createLoanerCalendarPeriod("2026-08-02", 7);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.dateKeys, [
    "2026-08-02",
    "2026-08-03",
    "2026-08-04",
    "2026-08-05",
    "2026-08-06",
    "2026-08-07",
    "2026-08-08",
  ]);
  assert.equal(result.value.startAt, "2026-08-01T15:00:00.000Z");
  assert.equal(result.value.exclusiveEndAt, "2026-08-08T15:00:00.000Z");
});

test("月跨ぎと年跨ぎを正しく計算する", () => {
  const month = createLoanerCalendarPeriod("2026-08-30", 7);
  assert.equal(month.ok, true);
  assert.equal(month.value.periodEnd, "2026-09-05");

  const year = createLoanerCalendarPeriod("2026-12-27", 7);
  assert.equal(year.ok, true);
  assert.equal(year.value.periodEnd, "2027-01-02");
});

test("不正な日付・日数・フィルターを拒否する", () => {
  assert.equal(createLoanerCalendarPeriod("2026-02-30", 7).ok, false);
  assert.equal(createLoanerCalendarPeriod("2026-08-02", 40).ok, false);
  assert.equal(
    parseLoanerCalendarSearchParams(
      new URLSearchParams({ assignment_status: "returned" }),
      "2026-08-02",
    ).ok,
    false,
  );
  assert.equal(
    parseLoanerCalendarSearchParams(
      new URLSearchParams({ vehicle_status: "unknown" }),
      "2026-08-02",
    ).ok,
    false,
  );
});

test("複数日バーは占有日数ぶん表示する", () => {
  assert.deepEqual(
    getLoanerCalendarAssignmentSegment(
      assignment(),
      "2026-08-02",
      7,
    ),
    {
      startIndex: 3,
      span: 4,
      continuesBefore: false,
      continuesAfter: false,
    },
  );
});

test("週をまたぐバーを切り取り左右の継続を返す", () => {
  const both = getLoanerCalendarAssignmentSegment(
    assignment({
      scheduledStartAt: "2026-07-31T15:00:00.000Z",
      scheduledEndAt: "2026-08-10T15:00:00.000Z",
    }),
    "2026-08-02",
    7,
  );
  assert.deepEqual(both, {
    startIndex: 0,
    span: 7,
    continuesBefore: true,
    continuesAfter: true,
  });

  const left = getLoanerCalendarAssignmentSegment(
    assignment({ scheduledStartAt: "2026-07-31T15:00:00.000Z" }),
    "2026-08-02",
    7,
  );
  assert.equal(left.continuesBefore, true);
  assert.equal(left.continuesAfter, false);
});

test("1日表示は半開区間の境界で割当を判定する", () => {
  const item = assignment();
  assert.equal(isLoanerAssignmentOnDate(item, "2026-08-05"), true);
  assert.equal(isLoanerAssignmentOnDate(item, "2026-08-08"), true);
  assert.equal(isLoanerAssignmentOnDate(item, "2026-08-09"), false);
});

test("車名・表示名・ナンバーを検索しsort_order順に並べる", () => {
  const items = [
    vehicle({ id: "b", vehicleName: "プリウス", sortOrder: 20 }),
    vehicle({ id: "a", displayName: "プリウス予備", sortOrder: 10 }),
    vehicle({ id: "c", plateNumber: "長野 300 さ 99-99", sortOrder: 0 }),
  ];

  assert.deepEqual(
    filterLoanerCalendarVehicles(items, {
      keyword: "プリウス",
      category: null,
      vehicleStatus: null,
    }).map((item) => item.id),
    ["a", "b"],
  );
  assert.deepEqual(
    filterLoanerCalendarVehicles(items, {
      keyword: "99-99",
      category: null,
      vehicleStatus: null,
    }).map((item) => item.id),
    ["c"],
  );
});

test("分類と使用可能状態を絞り込む", () => {
  const items = [
    vehicle({ id: "owned", category: "owned" }),
    vehicle({ id: "stopped", category: "rental", isActive: false }),
  ];
  assert.deepEqual(
    filterLoanerCalendarVehicles(items, {
      keyword: "",
      category: "rental",
      vehicleStatus: "inactive",
    }).map((item) => item.id),
    ["stopped"],
  );
});

test("40台を表示順のまま処理できる", () => {
  const items = Array.from({ length: 40 }, (_, index) =>
    vehicle({ id: String(index), sortOrder: 39 - index }),
  );
  const result = filterLoanerCalendarVehicles(items, {
    keyword: "",
    category: null,
    vehicleStatus: null,
  });
  assert.equal(result.length, 40);
  assert.equal(result[0].sortOrder, 0);
  assert.equal(result[39].sortOrder, 39);
});

test("APIは管理認証と1週間に重なる有効割当だけを取得する", () => {
  assert.match(api, /getAdminAuthFromRequest/);
  assert.match(api, /status: 401/);
  assert.match(api, /\.eq\("status", "checked_out"\)/);
  assert.match(api, /\.lt\("scheduled_start_at", filters\.exclusiveEndAt\)/);
  assert.match(api, /\.gt\("scheduled_end_at", filters\.startAt\)/);
  assert.doesNotMatch(api, /"returned", "cancelled"/);
});

test("APIはSnapshotと参照先の存在を保持し担当者をレスポンス表示に使わない", () => {
  assert.match(api, /snapshot_customer_name/);
  assert.match(api, /snapshot_phone/);
  assert.match(api, /snapshot_reserved_at/);
  assert.match(api, /row\.reservation_id \?\? null/);
  assert.match(api, /customerExists/);
  assert.match(api, /reservationExists/);
  assert.doesNotMatch(dashboard, /担当者/);
});

test("タブは代車一覧・貸出履歴・カレンダーの3画面を結ぶ", () => {
  assert.match(tabs, /href="\/admin\/loaners"/);
  assert.match(tabs, /href="\/admin\/loaners\/history"/);
  assert.match(tabs, /href="\/admin\/loaners\/calendar"/);
});

test("PCは7日グリッド・固定日付行・固定代車列を使用する", () => {
  assert.match(dashboard, /hidden max-h-\[65vh\] overflow-auto md:block/);
  assert.match(dashboard, /220px repeat\(7, minmax\(145px, 1fr\)\)/);
  assert.match(dashboard, /sticky top-0 z-30/);
  assert.match(dashboard, /sticky left-0 z-10/);
  assert.match(dashboard, /dateKey === today \? "bg-blue-50\/60"/);
  assert.match(dashboard, /\[&>button\]:h-10/);
  assert.match(dashboard, /\[&>span:last-child\]:hidden/);
  assert.doesNotMatch(dashboard, /text-blue-700">今日<\/span>/);
});

test("PCバーは貸出中を文字と色で表示する", () => {
  assert.doesNotMatch(dashboard, /予約済み/);
  assert.match(dashboard, /checked_out: "貸出中"/);
  assert.match(dashboard, /checked_out: "border-amber-500 bg-amber-500/);
  assert.match(dashboard, /segment\.continuesBefore/);
  assert.match(dashboard, /segment\.continuesAfter/);
});

test("スマホは横スクロールなしの1日カードと前日・今日・翌日を表示する", () => {
  assert.match(dashboard, /grid gap-3 p-3 md:hidden/);
  assert.match(dashboard, />\s*前日\s*</);
  assert.match(dashboard, />\s*翌日\s*</);
  assert.match(dashboard, /isLoanerAssignmentOnDate\(item, selectedDate\)/);
  assert.match(dashboard, /vehicle\.isActive \? "空き" : "使用停止中"/);
});

test("検索はIMEを壊さずデバウンスし通信の競合を中止する", () => {
  assert.match(dashboard, /value=\{keyword\}/);
  assert.match(dashboard, /setKeyword\(event\.target\.value\)/);
  assert.match(dashboard, /350/);
  assert.match(dashboard, /new AbortController\(\)/);
  assert.doesNotMatch(dashboard, /onCompositionEnd/);
});

test("詳細は電話コピー・スマホ発信・予約顧客履歴導線を備える", () => {
  assert.match(dashboard, /navigator\.clipboard\.writeText\(phone\)/);
  assert.match(dashboard, /href=\{`tel:\$\{callablePhone\}`\}/);
  assert.match(dashboard, /予約詳細を開く/);
  assert.match(dashboard, /顧客詳細を開く/);
  assert.match(dashboard, /貸出履歴を開く/);
  assert.match(dashboard, /assignment\.reservationExists/);
  assert.match(dashboard, /assignment\.customerExists/);
});

test("分類・状態凡例、休業日、空状態、エラー、読込表示を備える", () => {
  assert.match(dashboard, /aria-label="代車分類の凡例"/);
  assert.match(dashboard, /aria-label="代車割当状態の凡例"/);
  assert.match(dashboard, /休業/);
  assert.match(dashboard, /代車がまだ登録されていません。/);
  assert.match(dashboard, /条件に一致する代車がありません。/);
  assert.match(dashboard, /代車カレンダーの取得に失敗しました。/);
  assert.match(dashboard, /カレンダーを読み込み中/);
});
