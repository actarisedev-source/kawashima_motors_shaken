import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getLoanerAssignmentError } from "../src/lib/loaners/loaner-assignment.ts";

const readSource = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const migration = readSource(
  "supabase/migrations/202608010002_add_loaner_assignment_workflow_guards.sql",
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

test("Phase 2-4 Migrationは6 RPCを同じ予約単位ロックで保護する", () => {
  const functions = [
    "assign_loaner",
    "change_loaner",
    "checkout_loaner",
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
});

test("貸出開始はscheduledだけを同じ行のchecked_outへ更新する", () => {
  const checkout = migration.slice(
    migration.indexOf("create or replace function public.checkout_loaner("),
    migration.indexOf("create or replace function public.release_loaner("),
  );

  assert.match(checkout, /v_assignment\.status <> 'scheduled'/);
  assert.match(checkout, /v_reservation_status = 'キャンセル'/);
  assert.match(checkout, /set status = 'checked_out'/);
  assert.doesNotMatch(checkout, /insert into public\.loaner_assignments/);
  assert.doesNotMatch(checkout, /actual_returned_at\s*=/);
  assert.match(checkout, /actual_checked_out_at is intentionally not stored/);
});

test("解除と返却はscheduled・checked_outを業務状態どおりに更新する", () => {
  const release = migration.slice(
    migration.indexOf("create or replace function public.release_loaner("),
    migration.indexOf(
      "create or replace function public.set_reservation_loaner_request(",
    ),
  );

  assert.match(release, /when v_assignment\.status = 'scheduled' then 'cancelled'/);
  assert.match(release, /else 'returned'/);
  assert.match(
    release,
    /when v_assignment\.status = 'checked_out' then p_actual_returned_at/,
  );
});

test("貸出中は車両変更・代車不要・予約キャンセルを拒否する", () => {
  assert.match(
    migration,
    /loaner_checked_out_vehicle_change_not_allowed/,
  );
  assert.match(migration, /loaner_checked_out_requires_return/);
  assert.match(migration, /loaner_checked_out_blocks_reservation_cancel/);

  assert.deepEqual(
    getLoanerAssignmentError({
      message: "loaner_checked_out_requires_return",
    }),
    {
      status: 409,
      message:
        "貸出中の代車は、返却処理を完了してから代車不要へ変更してください。",
    },
  );
});

test("割当APIはcheckout・change・releaseを既存認証下で処理する", () => {
  assert.match(assignmentApi, /getAdminAuthFromRequest/);
  assert.match(assignmentApi, /body\.action === "checkout"/);
  assert.match(assignmentApi, /rpc\("checkout_loaner"/);
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

test("予約詳細は状態別の代車操作と確認UIを提供する", () => {
  assert.match(dashboard, /<LoanerAssignmentActions/);
  assert.match(dashboard, /<LoanerRequestControl/);
  assert.match(actions, /代車を変更/);
  assert.match(actions, /貸出期間を変更/);
  assert.match(actions, /割り当てを解除/);
  assert.match(actions, /貸出開始/);
  assert.match(actions, /返却済みにする/);
  assert.match(actions, /assignment\.status === "scheduled"/);
  assert.match(actions, /貸出開始日時/);
  assert.match(actions, /actualReturnedAt/);
  assert.doesNotMatch(actions, /updatedAt/);
});
