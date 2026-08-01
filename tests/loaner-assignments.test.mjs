import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  getLoanerAssignmentError,
  hasLoanerAssignmentOverlap,
  isLoanerAssignmentOverlapError,
  isLoanerAssignmentReservationConflictError,
  validateLoanerAssignmentChangeInput,
  validateLoanerAssignmentInput,
  validateLoanerReleaseInput,
} from "../src/lib/loaners/loaner-assignment.ts";

const vehicleA = "11111111-1111-4111-8111-111111111111";
const vehicleB = "22222222-2222-4222-8222-222222222222";
const reservationId = "33333333-3333-4333-8333-333333333333";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/202607310002_create_loaner_assignments.sql",
    import.meta.url,
  ),
  "utf8",
);
const activeReservationMigration = readFileSync(
  new URL(
    "../supabase/migrations/202608010001_add_active_loaner_assignment_reservation_unique_index.sql",
    import.meta.url,
  ),
  "utf8",
);
const assignmentApi = readFileSync(
  new URL(
    "../src/app/api/admin/loaner-assignments/route.ts",
    import.meta.url,
  ),
  "utf8",
);

test("正常な代車割当入力をRPC用の値へ正規化する", () => {
  const result = validateLoanerAssignmentInput({
    loanerVehicleId: vehicleA,
    reservationId,
    scheduledStartAt: "2026-08-01T09:00:00+09:00",
    scheduledEndAt: "2026-08-01T18:00:00+09:00",
    memo: "  禁煙車を希望  ",
  });

  assert.deepEqual(result, {
    ok: true,
    value: {
      loanerVehicleId: vehicleA,
      reservationId,
      scheduledStartAt: "2026-08-01T00:00:00.000Z",
      scheduledEndAt: "2026-08-01T09:00:00.000Z",
      memo: "禁煙車を希望",
    },
  });
  assert.match(migration, /create function public\.assign_loaner\(/);
  assert.match(migration, /snapshot_customer_name/);
  assert.match(migration, /snapshot_reserved_at/);
});

test("同一代車の有効な期間重複を検出し、境界が接するだけなら許可する", () => {
  const assignments = [
    {
      scheduledStartAt: "2026-08-01T00:00:00.000Z",
      scheduledEndAt: "2026-08-01T09:00:00.000Z",
      status: "scheduled",
    },
    {
      scheduledStartAt: "2026-08-02T00:00:00.000Z",
      scheduledEndAt: "2026-08-02T09:00:00.000Z",
      status: "cancelled",
    },
  ];

  assert.equal(
    hasLoanerAssignmentOverlap(assignments, {
      scheduledStartAt: "2026-08-01T08:00:00.000Z",
      scheduledEndAt: "2026-08-01T10:00:00.000Z",
    }),
    true,
  );
  assert.equal(
    hasLoanerAssignmentOverlap(assignments, {
      scheduledStartAt: "2026-08-01T09:00:00.000Z",
      scheduledEndAt: "2026-08-01T10:00:00.000Z",
    }),
    false,
  );
  assert.equal(
    getLoanerAssignmentError({ code: "23P01" }).status,
    409,
  );
  assert.match(migration, /exclude using gist/);
  assert.match(migration, /tstzrange\(scheduled_start_at, scheduled_end_at, '\[\)'\)/);
});

test("同一予約への異なる代車の有効な同時割当をDB制約で拒否する", () => {
  assert.match(
    activeReservationMigration,
    /create unique index loaner_assignments_active_reservation_unique_idx/,
  );
  assert.match(
    activeReservationMigration,
    /on public\.loaner_assignments \(reservation_id\)/,
  );
  assert.match(
    activeReservationMigration,
    /where reservation_id is not null\s+and status in \('scheduled', 'checked_out'\)/,
  );
  assert.doesNotMatch(
    activeReservationMigration,
    /status in \([^)]*(?:'cancelled'|'returned')/,
  );

  const conflict = {
    code: "23505",
    message:
      'duplicate key value violates unique constraint "loaner_assignments_active_reservation_unique_idx"',
    details:
      "Key (reservation_id)=(33333333-3333-4333-8333-333333333333) already exists.",
  };
  assert.equal(isLoanerAssignmentReservationConflictError(conflict), true);
  assert.deepEqual(getLoanerAssignmentError(conflict), {
    status: 409,
    message:
      "この予約にはすでに代車が割り当てられています。画面を更新してご確認ください。",
  });
  assert.equal(
    isLoanerAssignmentReservationConflictError({
      code: "23505",
      message: "another_unique_constraint",
    }),
    false,
  );
});

test("代車変更入力を検証し、旧割当をcancelledで残して新規割当を作る", () => {
  const result = validateLoanerAssignmentChangeInput({
    loanerVehicleId: vehicleB,
    scheduledStartAt: "2026-08-03T09:00:00+09:00",
    scheduledEndAt: "2026-08-03T18:00:00+09:00",
    memo: "変更後",
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.loanerVehicleId, vehicleB);
    assert.equal(result.value.memo, "変更後");
  }
  assert.match(migration, /create function public\.change_loaner\(/);
  assert.match(
    migration,
    /update public\.loaner_assignments\s+set status = 'cancelled'/,
  );
  assert.match(migration, /v_current\.snapshot_customer_name/);
  assert.ok(
    migration.indexOf("set status = 'cancelled'") <
      migration.indexOf(
        "insert into public.loaner_assignments (",
        migration.indexOf("create function public.change_loaner("),
      ),
    "change_loanerは旧割当をcancelledにしてから新割当を作成する",
  );
});

test("解除日時を検証し、release RPCが現在状態に応じた終了状態へ更新する", () => {
  const result = validateLoanerReleaseInput("2026-08-03T17:30:00+09:00");

  assert.deepEqual(result, {
    ok: true,
    value: "2026-08-03T08:30:00.000Z",
  });
  assert.match(migration, /create function public\.release_loaner\(/);
  assert.match(
    migration,
    /when v_assignment\.status = 'scheduled' then 'cancelled'/,
  );
  assert.match(
    migration,
    /when v_assignment\.status = 'checked_out' then p_actual_returned_at/,
  );
  assert.match(migration, /else 'returned'/);
  assert.match(
    migration,
    /scheduled=貸出予定\s+checked_out=貸出中\s+returned=返却済み\s+cancelled=貸出前キャンセル/,
  );
  assert.doesNotMatch(migration, /delete from public\.loaner_assignments/);
  assert.match(
    activeReservationMigration,
    /status in \('scheduled', 'checked_out'\)/,
  );
});

test("不正な期間と不正な返却日時を拒否する", () => {
  assert.deepEqual(
    validateLoanerAssignmentInput({
      loanerVehicleId: vehicleA,
      reservationId,
      scheduledStartAt: "2026-08-01T18:00:00+09:00",
      scheduledEndAt: "2026-08-01T09:00:00+09:00",
    }),
    {
      ok: false,
      message: "返却予定日時は貸出予定日時より後にしてください。",
    },
  );
  assert.deepEqual(validateLoanerReleaseInput("invalid"), {
    ok: false,
    message: "返却日時が正しくありません。",
  });
});

test("割当APIは認証・代車希望・サーバー側Snapshot・競合メッセージを保証する", () => {
  assert.match(assignmentApi, /getAdminAuthFromRequest/);
  assert.match(assignmentApi, /loaner_car_requested/);
  assert.match(assignmentApi, /reservation\.loaner_car_requested !== true/);
  assert.match(assignmentApi, /auth\.user\.email\?\.trim\(\) \|\| auth\.user\.id/);
  assert.doesNotMatch(assignmentApi, /snapshotCustomerName/);
  assert.equal(isLoanerAssignmentOverlapError({ code: "23P01" }), true);
  assert.match(
    assignmentApi,
    /この代車はほかの予約で使用されました。別の代車を選択してください。/,
  );
  assert.match(
    assignmentApi,
    /この予約にはすでに代車が割り当てられています。画面を更新してご確認ください。/,
  );
});
