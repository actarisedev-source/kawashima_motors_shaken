import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  getLoanerAssignmentError,
  hasLoanerAssignmentOverlap,
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
