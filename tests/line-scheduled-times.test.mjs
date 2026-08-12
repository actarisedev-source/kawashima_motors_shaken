import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isAllowedLineScheduledTime,
  lineScheduledTimeOptions,
} from "../src/lib/line/scheduled-time.ts";

const readSource = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("LINE予約配信時刻は08:00から20:00まで15分刻みで生成する", () => {
  assert.deepEqual(lineScheduledTimeOptions.slice(0, 5), [
    "08:00",
    "08:15",
    "08:30",
    "08:45",
    "09:00",
  ]);
  assert.deepEqual(lineScheduledTimeOptions.slice(-5), [
    "19:00",
    "19:15",
    "19:30",
    "19:45",
    "20:00",
  ]);
  assert.equal(lineScheduledTimeOptions.includes("20:15"), false);
  assert.equal(lineScheduledTimeOptions.length, 49);
});

test("LINE予約配信時刻バリデーションは15分境界だけを許可する", () => {
  for (const time of [
    "08:00",
    "08:15",
    "08:30",
    "08:45",
    "09:00",
    "10:15",
    "14:30",
    "19:45",
    "20:00",
  ]) {
    assert.equal(isAllowedLineScheduledTime(time), true, time);
  }

  for (const time of ["07:45", "08:01", "10:10", "10:17", "20:15", "21:00"]) {
    assert.equal(isAllowedLineScheduledTime(time), false, time);
  }
});

test("予約配信UIとAPIは共通の15分刻み時刻定義を使う", () => {
  const scheduledUi = readSource(
    "src/app/admin/line/line-scheduled-distribution.tsx",
  );
  const scheduledApi = readSource("src/app/api/admin/line/scheduled/route.ts");

  assert.match(scheduledUi, /lineScheduledTimeOptions\.map/);
  assert.match(scheduledUi, /15分ごとに確認/);
  assert.match(scheduledApi, /isAllowedLineScheduledTime\(time\)/);
  assert.match(scheduledApi, /15分単位/);
  assert.doesNotMatch(scheduledApi, /1時間単位/);
});

test("予約日時はJST入力からUTC ISO文字列として保存する前提を維持する", () => {
  const scheduledApi = readSource("src/app/api/admin/line/scheduled/route.ts");

  assert.ok(scheduledApi.includes("new Date(`${date}T${time}:00+09:00`)"));
  assert.match(scheduledApi, /return scheduledAt\.toISOString\(\)/);
  assert.equal(
    new Date("2026-08-13T10:15:00+09:00").toISOString(),
    "2026-08-13T01:15:00.000Z",
  );
});

test("予約配信実行はdue claimと二重処理防止を維持する", () => {
  const migration = readSource(
    "supabase/migrations/202606220001_create_line_scheduled_messages.sql",
  );
  const scheduled = readSource("src/lib/line/scheduled.ts");

  assert.match(migration, /candidate\.scheduled_at <= now\(\)/);
  assert.match(migration, /for update skip locked/);
  assert.match(migration, /processing_started_at < now\(\) - interval '15 minutes'/);
  assert.match(scheduled, /claim_due_line_scheduled_messages/);
  assert.match(scheduled, /status: failed \? "失敗" : "送信済み"/);
});

test("Supabase Cron設定SQLは同一ジョブを15分ごとにする", () => {
  const cronSql = readSource("supabase/setup_line_scheduled_messages_cron.sql");

  assert.match(cronSql, /where jobname = 'line-automations-hourly'/);
  assert.match(cronSql, /'line-automations-hourly'/);
  assert.ok(cronSql.includes("'*/15 * * * *'"));
  assert.doesNotMatch(cronSql, /'0 \\* \\* \\* \\*'/);
});
