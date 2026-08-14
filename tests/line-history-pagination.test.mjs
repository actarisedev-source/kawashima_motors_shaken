import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("LINE配信履歴APIは20件単位のDBページングと総件数取得に対応する", () => {
  const route = readSource("src/app/api/admin/line/logs/route.ts");

  assert.match(route, /const defaultPageSize = 20/);
  assert.match(route, /const maxPageSize = 100/);
  assert.match(route, /page_size/);
  assert.match(route, /select\([^)]*\{ count: "exact" \}/s);
  assert.match(route, /\.order\("created_at", \{ ascending: false \}\)/);
  assert.match(route, /query\.range\(rangeStart, rangeEnd\)/);
  assert.match(route, /total_pages: Math\.max\(1, Math\.ceil\(total \/ pageSize\)\)/);
  assert.doesNotMatch(route, /\.limit\(20\)/);
});

test("LINE配信履歴検索は履歴本文と顧客情報をDB側条件に含める", () => {
  const route = readSource("src/app/api/admin/line/logs/route.ts");

  assert.match(route, /\.from\("customers"\)/);
  assert.match(route, /name\.ilike/);
  assert.match(route, /line_display_name\.ilike/);
  assert.match(route, /phone\.ilike/);
  assert.match(route, /target_type\.ilike/);
  assert.match(route, /title\.ilike/);
  assert.match(route, /body\.ilike/);
  assert.match(route, /automation_type\.ilike/);
  assert.match(route, /customer_id\.in/);
  assert.match(route, /検索文字は100文字以内/);
});

test("LINE配信画面は最近5件と履歴20件ページングを分離する", () => {
  const source = readSource("src/app/admin/line/line-distribution.tsx");

  assert.match(source, /const lineHistoryPageSize = 20/);
  assert.match(source, /recentLogs/);
  assert.match(source, /page=1&page_size=5/);
  assert.match(source, /page_size: String\(lineHistoryPageSize\)/);
  assert.match(source, /logTotal/);
  assert.match(source, /logTotalPages/);
  assert.match(source, /全\$\{logTotal\}件中/);
  assert.match(source, /履歴検索/);
  assert.match(source, /setLogPage\(1\)/);
  assert.match(source, /前へ/);
  assert.match(source, /次へ/);
});

test("LINE配信履歴削除はStorage参照削除を維持しつつ一覧を再読込する", () => {
  const [ui, deleteRoute] = [
    readSource("src/app/admin/line/line-distribution.tsx"),
    readSource("src/app/api/admin/line/logs/[id]/route.ts"),
  ];

  assert.match(ui, /await loadRecentLogs\(\)/);
  assert.match(ui, /await loadLogs\(\)/);
  assert.match(deleteRoute, /removeLineImages\(removableImageUrls\)/);
  assert.match(deleteRoute, /\.from\("line_message_logs"\)/);
  assert.match(deleteRoute, /\.from\("line_scheduled_messages"\)/);
});

test("LINE予約配信一覧APIは25件単位のページング・検索・状態フィルターに対応する", () => {
  const route = readSource("src/app/api/admin/line/scheduled/route.ts");

  assert.match(route, /const defaultPageSize = 25/);
  assert.match(route, /scheduledStatuses = \["予約中", "送信済み", "取消済み", "失敗"\]/);
  assert.match(route, /page_size/);
  assert.match(route, /select\("\*", \{ count: "exact" \}\)/);
  assert.match(route, /\.order\("scheduled_at", \{ ascending: false \}\)/);
  assert.match(route, /query = query\.eq\("status", status\)/);
  assert.match(route, /title\.ilike/);
  assert.match(route, /body\.ilike/);
  assert.match(route, /target_label\.ilike/);
  assert.match(route, /query\.range\(rangeStart, rangeEnd\)/);
  assert.doesNotMatch(route, /\.limit\(100\)/);
});

test("LINE予約配信画面は25件ページングで古い予約も到達可能にする", () => {
  const source = readSource("src/app/admin/line/line-scheduled-distribution.tsx");

  assert.match(source, /const scheduledHistoryPageSize = 25/);
  assert.match(source, /scheduledTotal/);
  assert.match(source, /scheduledTotalPages/);
  assert.match(source, /scheduledSearch/);
  assert.match(source, /scheduledStatusFilter/);
  assert.match(source, /page_size: String\(scheduledHistoryPageSize\)/);
  assert.match(source, /status: scheduledStatusFilter/);
  assert.match(source, /全\$\{scheduledTotal\}件中/);
  assert.match(source, /予約配信検索/);
  assert.match(source, /前へ/);
  assert.match(source, /次へ/);
});

test("顧客詳細のLINE履歴表示は今回の全体履歴ページングと分離して維持する", () => {
  const source = readSource("src/app/admin/customers/[id]/customer-detail.tsx");

  assert.match(source, /lineMessageLogs\.slice\(0, 1\)/);
  assert.match(source, /showAllLineMessageLogs/);
  assert.match(source, /すべて見る/);
  assert.doesNotMatch(source, /lineHistoryPageSize/);
});
