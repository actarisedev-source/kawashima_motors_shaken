import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  cancelledReservationStatus,
  filterActiveAdminReservations,
  getAdminReservationSlotLabel,
  groupAdminReservationsByTime,
} from "../src/lib/reservations/admin-reservation-list.ts";

const customerDetailApi = readFileSync(
  new URL("../src/app/api/admin/customers/[id]/route.ts", import.meta.url),
  "utf8",
);

const reservation = (id, status, time = "11:00") => ({
  id,
  reservedAt: `2026-08-18T${time}:00+09:00`,
  status,
});

test("予約管理一覧はキャンセル済みだけの時間枠を予約なしとして扱う", () => {
  const grouped = groupAdminReservationsByTime([
    reservation("cancelled-1", cancelledReservationStatus),
  ]);

  assert.equal(grouped.get("11:00")?.length ?? 0, 0);
  assert.equal(filterActiveAdminReservations([
    reservation("cancelled-1", cancelledReservationStatus),
  ]).length, 0);
});

test("予約管理一覧は有効予約1件とキャンセル1件を1枠分として扱う", () => {
  const grouped = groupAdminReservationsByTime([
    reservation("active-1", "受付中"),
    reservation("cancelled-1", cancelledReservationStatus),
  ]);
  const timeItems = grouped.get("11:00") ?? [];

  assert.deepEqual(timeItems.map((item) => item.id), ["active-1"]);
  assert.equal(getAdminReservationSlotLabel(0, 2), "1 / 2");
});

test("予約管理一覧は有効予約2件とキャンセル1件を2枠分として扱う", () => {
  const grouped = groupAdminReservationsByTime([
    reservation("active-1", "受付中"),
    reservation("active-2", "確定"),
    reservation("cancelled-1", cancelledReservationStatus),
  ]);
  const timeItems = grouped.get("11:00") ?? [];

  assert.deepEqual(timeItems.map((item) => item.id), ["active-1", "active-2"]);
  assert.equal(getAdminReservationSlotLabel(0, 2), "1 / 2");
  assert.equal(getAdminReservationSlotLabel(1, 2), "2 / 2");
});

test("キャンセル済み予約しかない時間枠は新規予約可能な空き枠として残る", () => {
  const activeReservations = filterActiveAdminReservations([
    reservation("cancelled-1", cancelledReservationStatus),
  ]);
  const capacity = 2;

  assert.equal(activeReservations.length, 0);
  assert.equal(activeReservations.length < capacity, true);
});

test("顧客詳細APIはキャンセル済み予約履歴を除外しない", () => {
  const reservationQueryStart = customerDetailApi.indexOf(
    '.from("reservations")',
  );
  const reservationQueryEnd = customerDetailApi.indexOf(
    '.from("line_message_logs")',
  );
  const reservationQuery = customerDetailApi.slice(
    reservationQueryStart,
    reservationQueryEnd,
  );

  assert.match(reservationQuery, /order\("reserved_at"/);
  assert.doesNotMatch(reservationQuery, /neq\("status", "キャンセル"\)/);
});
