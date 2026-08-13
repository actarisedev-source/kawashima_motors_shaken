import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const migration = readSource(
  "supabase/migrations/202608020001_simplify_loaner_assignment_statuses.sql",
);
const assignmentApi = readSource(
  "src/app/api/admin/loaner-assignments/[id]/route.ts",
);
const requestApi = readSource(
  "src/app/api/admin/reservations/[id]/loaner-request/route.ts",
);
const adminReservationApi = readSource(
  "src/app/api/admin/reservations/route.ts",
);
const publicCancellationApi = readSource(
  "src/app/api/reservations/confirmation/[token]/route.ts",
);
const dashboard = readSource("src/app/admin/admin-dashboard.tsx");
const actions = readSource(
  "src/app/admin/loaners/loaner-assignment-actions.tsx",
);
const dateRangePicker = readSource(
  "src/app/admin/loaners/loaner-date-range-picker.tsx",
);
const availabilityModal = readSource(
  "src/app/admin/loaners/loaner-availability-modal.tsx",
);
const assignmentPicker = readSource(
  "src/app/admin/loaners/loaner-assignment-picker.tsx",
);
const categoryBadge = readSource(
  "src/app/admin/loaners/loaner-category-badge.tsx",
);

test("簡素化Migrationは5 RPCを同じ予約単位ロックで保護する", () => {
  const functions = [
    "assign_loaner",
    "change_loaner",
    "release_loaner",
    "set_reservation_loaner_request",
    "cancel_reservation_with_loaner",
  ];

  for (const functionName of functions) {
    assert.match(
      migration,
      new RegExp(`create or replace function public\\.${functionName}\\(`),
    );
    assert.match(
      migration,
      new RegExp(`grant execute on function public\\.${functionName}\\(`),
    );
  }
  assert.equal(
    migration.match(/loaner-reservation:/g)?.length,
    functions.length,
  );
  assert.match(migration, /security definer/g);
  assert.doesNotMatch(migration, /delete from public\.loaner_assignments/);
  assert.match(migration, /drop function if exists public\.checkout_loaner\(uuid\)/);
});

test("割当は初めからchecked_outで作成する", () => {
  const assign = migration.slice(
    migration.indexOf("create or replace function public.assign_loaner("),
    migration.indexOf("create or replace function public.change_loaner("),
  );

  assert.match(assign, /'checked_out'/);
  assert.doesNotMatch(assign, /'scheduled'/);
});

test("返却はchecked_outだけをreturnedへ更新する", () => {
  const release = migration.slice(
    migration.indexOf("create or replace function public.release_loaner("),
    migration.indexOf(
      "create or replace function public.set_reservation_loaner_request(",
    ),
  );

  assert.match(release, /v_assignment\.status <> 'checked_out'/);
  assert.match(release, /set status = 'returned'/);
  assert.doesNotMatch(release, /status = 'cancelled'/);
});

test("貸出中の車両変更・代車不要・予約キャンセルは履歴をcancelledで残す", () => {
  assert.doesNotMatch(migration, /loaner_checked_out_vehicle_change_not_allowed/);
  assert.doesNotMatch(migration, /loaner_checked_out_requires_return/);
  assert.doesNotMatch(migration, /loaner_checked_out_blocks_reservation_cancel/);
  assert.match(migration, /set status = 'cancelled'/);
});

test("割当APIはchange・releaseを既存認証下で処理する", () => {
  assert.match(assignmentApi, /getAdminAuthFromRequest/);
  assert.doesNotMatch(assignmentApi, /checkout/);
  assert.match(assignmentApi, /body\.action === "change"/);
  assert.match(assignmentApi, /rpc\("change_loaner"/);
  assert.match(assignmentApi, /body\.action === "release"/);
  assert.match(assignmentApi, /rpc\("release_loaner"/);
});

test("代車希望変更と公開・管理キャンセルは専用RPCを使用する", () => {
  assert.match(requestApi, /getAdminAuthFromRequest/);
  assert.match(requestApi, /rpc\(\s*"set_reservation_loaner_request"/);
  assert.match(
    adminReservationApi,
    /rpc\(\s*"cancel_reservation_with_loaner"/,
  );
  assert.match(
    publicCancellationApi,
    /rpc\("cancel_reservation_with_loaner"/,
  );
  assert.doesNotMatch(
    publicCancellationApi,
    /\.update\(\{ status: "キャンセル" \}\)/,
  );
});

test("予約詳細は貸出中の代車操作と確認UIを提供する", () => {
  assert.match(dashboard, /<LoanerAssignmentActions/);
  assert.match(dashboard, /<LoanerRequestControl/);
  assert.match(actions, /代車を変更/);
  assert.match(actions, /貸出期間を変更/);
  assert.doesNotMatch(actions, /貸出開始/);
  assert.match(actions, /返却済みにする/);
  assert.match(actions, /actualReturnedAt/);
  assert.doesNotMatch(actions, /updatedAt/);
});

test("代車検索モーダルは固定上部とスクロール一覧を分離しPCで5列表示する", () => {
  assert.match(availabilityModal, />\s*代車検索\s*</);
  assert.match(availabilityModal, /h-\[90dvh\]/);
  assert.match(availabilityModal, /w-\[90vw\]/);
  assert.match(availabilityModal, /max-w-\[1600px\]/);
  assert.match(availabilityModal, /shrink-0 border-b/);
  assert.match(availabilityModal, /min-h-0 flex-1 overflow-y-auto/);
  assert.match(availabilityModal, /md:grid-cols-3/);
  assert.match(availabilityModal, /lg:grid-cols-4/);
  assert.match(availabilityModal, /xl:grid-cols-5/);
  assert.match(availabilityModal, /aria-pressed=\{isCurrent\}/);
  assert.match(availabilityModal, /onClick=\{\(\) => onSelect\(item\)\}/);
  assert.match(availabilityModal, /h-\[88px\]/);
  assert.match(availabilityModal, /shadow-sm transition/);
  assert.match(availabilityModal, /flex h-full min-w-0 flex-col justify-center/);
  assert.match(availabilityModal, /hover:border-blue-200 hover:bg-blue-50\/60/);
  assert.match(availabilityModal, /border-blue-600 bg-blue-600 text-white/);
  assert.doesNotMatch(availabilityModal, /現在選択中/);
  assert.doesNotMatch(availabilityModal, /item\.available \? "選択"/);
});

test("貸出中カードは貸出期間を1行表示してカード高88pxを維持する", () => {
  assert.match(availabilityModal, /h-\[88px\]/);
  assert.match(availabilityModal, /bg-slate-100 text-slate-500/);
  assert.match(availabilityModal, /text-\[11px\] font-semibold leading-4/);
  assert.match(availabilityModal, />\s*貸出中\{" "\}/);
  assert.match(availabilityModal, /getLoanerReturnDateKey\(conflict\.scheduledEndAt\)/);
  assert.doesNotMatch(availabilityModal, /line-clamp-2/);
});

test("新規予約の代車検索は現在選択中IDを再表示モーダルへ渡す", () => {
  assert.match(
    assignmentPicker,
    /currentLoanerVehicleId=\{selectedLoaner\?\.id\}/,
  );
  assert.match(availabilityModal, /const isCurrent = item\.id === currentLoanerVehicleId/);
  assert.match(availabilityModal, /aria-pressed=\{isCurrent\}/);
  assert.match(availabilityModal, /border-blue-600 bg-blue-600 text-white/);
});

test("代車検索モーダルは共通分類色と処理中表示を使用する", () => {
  assert.match(categoryBadge, /export function LoanerCategoryDot/);
  assert.match(availabilityModal, /<LoanerCategoryBadge/);
  assert.match(availabilityModal, /<LoanerCategoryDot/);
  assert.match(availabilityModal, /検索中\.\.\./);
  assert.match(dateRangePicker, /変更中\.\.\./);
  assert.match(actions, /処理中\.\.\./);
});
