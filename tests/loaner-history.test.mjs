import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  getLoanerHistoryDateRange,
  loanerAssignmentStatusLabels,
  loanerHistoryPageSize,
  parseLoanerHistorySearchParams,
} from "../src/lib/loaners/loaner-history.ts";
import { canAssignLoanerToReservation } from "../src/lib/reservations/admin-loaner-request.ts";

const readSource = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const api = readSource(
  "src/app/api/admin/loaner-assignments/history/route.ts",
);
const dashboard = readSource(
  "src/app/admin/loaners/history/loaner-history-dashboard.tsx",
);
const reservationDashboard = readSource("src/app/admin/admin-dashboard.tsx");

test("貸出履歴は4状態を業務用の日本語へ変換する", () => {
  assert.deepEqual(loanerAssignmentStatusLabels, {
    scheduled: "貸出予定",
    checked_out: "貸出中",
    returned: "返却済み",
    cancelled: "取消",
  });
});

test("貸出履歴は1ページ25件で検索条件を検証する", () => {
  assert.equal(loanerHistoryPageSize, 25);
  const parsed = parseLoanerHistorySearchParams(
    new URLSearchParams({
      page: "2",
      keyword: "　川島　",
      status: "returned",
      category: "owned",
      date_from: "2026-08-01",
      date_to: "2026-08-31",
    }),
  );

  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.page, 2);
  assert.equal(parsed.value.keyword, "川島");
  assert.equal(parsed.value.status, "returned");
  assert.equal(parsed.value.category, "owned");
});

test("期間検索は日本時間の日初と翌日開始の半開区間を作る", () => {
  const range = getLoanerHistoryDateRange("2026-08-01", "2026-08-31");
  assert.equal(range.ok, true);
  assert.equal(range.value.startAt, "2026-07-31T15:00:00.000Z");
  assert.equal(range.value.exclusiveEndAt, "2026-08-31T15:00:00.000Z");
});

test("終了日が開始日より前の場合は検索を拒否する", () => {
  const range = getLoanerHistoryDateRange("2026-08-10", "2026-08-09");
  assert.deepEqual(range, {
    ok: false,
    message: "終了日は開始日以降を選択してください。",
  });
});

test("不正な状態を拒否する", () => {
  const parsed = parseLoanerHistorySearchParams(
    new URLSearchParams({ status: "unknown" }),
  );
  assert.deepEqual(parsed, {
    ok: false,
    message: "状態の指定が正しくありません。",
  });
});

test("不正な分類を拒否する", () => {
  const parsed = parseLoanerHistorySearchParams(
    new URLSearchParams({ category: "unknown" }),
  );
  assert.deepEqual(parsed, {
    ok: false,
    message: "分類の指定が正しくありません。",
  });
});

test("不正なページ指定は安全な既定値へ戻す", () => {
  const parsed = parseLoanerHistorySearchParams(
    new URLSearchParams({ page: "-3", page_size: "999" }),
  );
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.page, 1);
  assert.equal(parsed.value.pageSize, 25);
});

test("APIは管理者認証・サーバー側ページング・Snapshot検索を使用する", () => {
  assert.match(api, /getAdminAuthFromRequest/);
  assert.match(api, /\.range\(rangeStart, rangeEnd\)/);
  assert.match(api, /snapshot_customer_name\.ilike/);
  assert.match(api, /snapshot_phone\.ilike/);
  assert.match(api, /snapshot_staff_name\.ilike/);
  assert.match(api, /memo\.ilike/);
  assert.match(api, /vehicle_name\.ilike/);
  assert.match(api, /display_name\.ilike/);
  assert.match(api, /plate_number\.ilike/);
});

test("APIは期間の重なりを開始以上・終了未満で絞り込む", () => {
  assert.match(api, /\.gt\("scheduled_end_at", filters\.startAt\)/);
  assert.match(api, /\.lt\("scheduled_start_at", filters\.exclusiveEndAt\)/);
});

test("APIは状態と分類をサーバー側で絞り込む", () => {
  assert.match(api, /query = query\.eq\("status", filters\.status\)/);
  assert.match(api, /query = query\.in\("loaner_vehicle_id", categoryVehicleIds\)/);
});

test("APIレスポンスは仕様どおりsnake_caseのページ情報を返す", () => {
  assert.match(api, /page_size: filters\.pageSize/);
  assert.match(api, /total_pages: Math\.max/);
});

test("APIは内部エラーを画面へ直接返さない", () => {
  assert.match(api, /貸出履歴の取得に失敗しました。/);
  assert.doesNotMatch(api, /message: error\.message/);
});

test("一覧はPCテーブル・スマホカード・詳細モーダルを備える", () => {
  assert.match(dashboard, /hidden overflow-x-auto md:block/);
  assert.match(dashboard, /grid gap-3 p-3 md:hidden/);
  assert.match(dashboard, /貸出履歴詳細/);
  assert.match(dashboard, /現在の顧客情報は削除されています。/);
  assert.match(dashboard, /元の予約情報は削除されています。/);
});

test("一覧は分類凡例を表示し、車名の先頭だけに分類色を付ける", () => {
  assert.match(dashboard, /aria-label="代車分類の凡例"/);
  assert.match(
    dashboard,
    /aria-label="代車分類の凡例"[\s\S]*<\/div>\s*<section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">/,
  );
  assert.match(dashboard, /<LoanerCategoryBadge key=\{value\} category=\{value\} \/>/);
  assert.match(dashboard, /<LoanerCategoryDot category=\{item\.vehicle\.category\} \/>/);
  assert.doesNotMatch(dashboard, /<th[^>]*>分類<\/th>/);
});

test("担当者は一覧と詳細の表示から除外する", () => {
  assert.doesNotMatch(dashboard, /<th[^>]*>担当者<\/th>/);
  assert.doesNotMatch(dashboard, /担当者（保存時）/);
});

test("詳細はSnapshot・期間・返却・メモ・作成更新日時を表示する", () => {
  for (const label of [
    "お客様（保存時）",
    "予約日時（保存時）",
    "貸出開始予定",
    "返却予定",
    "実返却日時",
    "メモ",
    "登録日時",
    "更新日時",
  ]) {
    assert.match(dashboard, new RegExp(label));
  }
});

test("顧客・予約リンクは参照先が存在する場合だけ表示する", () => {
  assert.match(dashboard, /item\.customerId && item\.customerExists/);
  assert.match(dashboard, /item\.reservationId && item\.reservationExists/);
  assert.match(dashboard, /\/admin\/customers\/\$\{item\.customerId\}/);
  assert.match(dashboard, /\/admin\?reservation=\$\{item\.reservationId\}/);
});

test("電話番号はコピーとスマホ発信に対応する", () => {
  assert.match(dashboard, /navigator\.clipboard\.writeText\(phone\)/);
  assert.match(dashboard, /href=\{`tel:\$\{callablePhone\}`\}/);
  assert.match(dashboard, /md:hidden/);
});

test("検索はデバウンスし、読み込み中も既存一覧を保持する", () => {
  assert.match(dashboard, /setTimeout\(\(\) => \{/);
  assert.match(dashboard, /350/);
  assert.doesNotMatch(dashboard, /setResult\(\{ ok: true \}\)/);
  assert.match(dashboard, /履歴を読み込み中\.\.\./);
});

test("検索・絞り込み変更と条件クリアは1ページ目へ戻す", () => {
  assert.match(dashboard, /setDebouncedKeyword\(keyword\.trim\(\)\);\s*setPage\(1\)/);
  assert.match(dashboard, /const resetFilters = \(\) => \{/);
  assert.match(dashboard, /setPage\(1\);/);
});

test("空状態と取得失敗は指定の案内を表示する", () => {
  assert.match(dashboard, /貸出履歴がまだありません。/);
  assert.match(dashboard, /条件に一致する貸出履歴はありません。/);
  assert.match(
    dashboard,
    /貸出履歴の取得に失敗しました。時間をおいて再度お試しください。/,
  );
});

test("キーワード入力はIME変換中の値を加工せずdebounce後に検索する", () => {
  assert.match(dashboard, /value=\{keyword\}/);
  assert.match(dashboard, /setKeyword\(event\.target\.value\)/);
  assert.doesNotMatch(dashboard, /onCompositionEnd/);
});

test("過去・完了・キャンセル予約には未割当警告と割当導線を出さない", () => {
  const now = new Date("2026-08-02T03:00:00.000Z");
  assert.equal(
    canAssignLoanerToReservation({
      requested: true,
      status: "受付中",
      reservedAt: "2026-08-02T04:00:00.000Z",
      now,
    }),
    true,
  );
  assert.equal(
    canAssignLoanerToReservation({
      requested: true,
      status: "確定",
      reservedAt: "2026-08-03T04:00:00.000Z",
      now,
    }),
    true,
  );
  for (const status of ["完了", "キャンセル"]) {
    assert.equal(
      canAssignLoanerToReservation({
        requested: true,
        status,
        reservedAt: "2026-08-03T04:00:00.000Z",
        now,
      }),
      false,
    );
  }
  assert.equal(
    canAssignLoanerToReservation({
      requested: true,
      status: "受付中",
      reservedAt: "2026-08-01T04:00:00.000Z",
      now,
    }),
    false,
  );
  assert.match(reservationDashboard, /selectedReservationCanAssignLoaner/);
});
