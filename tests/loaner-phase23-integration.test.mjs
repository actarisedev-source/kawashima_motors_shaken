import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const availabilityApi = readSource(
  "src/app/api/admin/loaners/availability/route.ts",
);
const assignmentApi = readSource(
  "src/app/api/admin/loaner-assignments/route.ts",
);
const reservationsApi = readSource(
  "src/app/api/admin/reservations/route.ts",
);
const newReservationModal = readSource(
  "src/app/admin/admin-new-reservation-modal.tsx",
);
const adminDashboard = readSource("src/app/admin/admin-dashboard.tsx");

test("空車検索APIは管理認証と半開区間の重複条件を使用する", () => {
  assert.match(availabilityApi, /getAdminAuthFromRequest/);
  assert.match(availabilityApi, /params\.get\("start_date"\)/);
  assert.match(availabilityApi, /params\.get\("end_date"\)/);
  assert.match(availabilityApi, /\.eq\("status", "checked_out"\)/);
  assert.match(availabilityApi, /\.lt\("scheduled_start_at"/);
  assert.match(availabilityApi, /\.gt\("scheduled_end_at"/);
  assert.doesNotMatch(availabilityApi, /snapshot_customer_name/);
  assert.doesNotMatch(availabilityApi, /snapshot_phone/);
});

test("新規予約は予約ID取得後にだけ割当APIを呼び、割当失敗時も予約を残す", () => {
  const reservationRequest = newReservationModal.indexOf(
    'fetch("/api/admin/reservations"',
  );
  const assignmentRequest = newReservationModal.indexOf(
    'fetch("/api/admin/loaner-assignments"',
  );

  assert.ok(reservationRequest >= 0);
  assert.ok(assignmentRequest > reservationRequest);
  assert.match(newReservationModal, /reservationId: result\.item\.id/);
  assert.match(
    newReservationModal,
    /予約は登録されましたが、代車の割り当てに失敗しました。予約詳細から再度割り当ててください。/,
  );
  assert.match(newReservationModal, /setCompletedReservation\(completedItem\)/);
});

test("予約取得レスポンスは有効な代車割当だけを後方互換で追加する", () => {
  assert.match(
    reservationsApi,
    /\.eq\("status", "checked_out"\)/,
  );
  assert.match(reservationsApi, /loanerAssignment = null/);
  assert.match(reservationsApi, /loanerAssignment:/);
  assert.doesNotMatch(reservationsApi, /loaner_vehicle_id.*reservations/);
});

test("予約詳細からの割当も同じ管理APIを使用する", () => {
  assert.match(adminDashboard, /fetch\("\/api\/admin\/loaner-assignments"/);
  assert.match(adminDashboard, /<LoanerAssignmentPicker/);
  assert.match(adminDashboard, /代車を割り当てました。/);
  assert.match(assignmentApi, /p_snapshot_staff_name: auth\.user\.email/);
});
