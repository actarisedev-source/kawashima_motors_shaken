import { pushLineTextMessage } from "@/lib/line/messaging";
import { supabaseServer } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export type LineAutomationType =
  Database["public"]["Tables"]["line_automation_settings"]["Row"]["automation_type"];
export type LineAutomationSetting =
  Database["public"]["Tables"]["line_automation_settings"]["Row"];

type Customer = Database["public"]["Tables"]["customers"]["Row"];
type Vehicle = Database["public"]["Tables"]["vehicles"]["Row"];
type Reservation = Database["public"]["Tables"]["reservations"]["Row"];

export type LineAutomationTarget = {
  customer: Customer;
  vehicle: Vehicle | null;
  reservation: Reservation | null;
  targetDate: string;
};

export const lineAutomationDefinitions: Record<
  LineAutomationType,
  { label: string; description: string }
> = {
  shaken_60_days: {
    label: "車検満了60日前通知",
    description: "本日から60日後に車検満了日を迎える車両が対象です。",
  },
  shaken_30_days: {
    label: "車検満了30日前通知",
    description: "本日から30日後に車検満了日を迎える車両が対象です。",
  },
  reservation_previous_day: {
    label: "予約前日リマインド",
    description: "翌日の受付中・確定予約が対象です。",
  },
  reservation_completion: {
    label: "予約完了通知",
    description: "予約フォームで予約が正常に登録された直後に配信します。",
  },
};

export const lineAutomationTypes = Object.keys(
  lineAutomationDefinitions,
) as LineAutomationType[];

export const japanDateKey = (date = new Date()) =>
  new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(date);

const addDays = (value: string, days: number) => {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const linkedCustomers = async () => {
  const { data, error } = await supabaseServer
    .from("customers")
    .select("*")
    .not("line_user_id", "is", null)
    .eq("line_status", "連携済み");
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((customer) => [customer.id, customer]));
};

export async function getLineAutomationTargets(
  automationType: LineAutomationType,
  now = new Date(),
) {
  const today = japanDateKey(now);
  const customers = await linkedCustomers();
  const targets: LineAutomationTarget[] = [];

  if (automationType === "reservation_completion") {
    return targets;
  }

  if (automationType === "reservation_previous_day") {
    const targetDate = addDays(today, 1);
    const start = new Date(`${targetDate}T00:00:00+09:00`).toISOString();
    const end = new Date(`${addDays(targetDate, 1)}T00:00:00+09:00`).toISOString();
    const { data, error } = await supabaseServer
      .from("reservations")
      .select("*")
      .in("status", ["受付中", "確定"])
      .gte("reserved_at", start)
      .lt("reserved_at", end)
      .order("reserved_at", { ascending: true });
    if (error) throw new Error(error.message);

    const vehicleIds = [...new Set((data ?? []).map((item) => item.vehicle_id))];
    const vehicles = new Map<string, Vehicle>();
    if (vehicleIds.length) {
      const result = await supabaseServer
        .from("vehicles")
        .select("*")
        .in("id", vehicleIds);
      if (result.error) throw new Error(result.error.message);
      for (const vehicle of result.data ?? []) vehicles.set(vehicle.id, vehicle);
    }

    for (const reservation of data ?? []) {
      const customer = customers.get(reservation.customer_id);
      if (!customer?.line_user_id) continue;
      targets.push({
        customer,
        vehicle: vehicles.get(reservation.vehicle_id) ?? null,
        reservation,
        targetDate,
      });
    }
    return targets;
  }

  const days = automationType === "shaken_60_days" ? 60 : 30;
  const targetDate = addDays(today, days);
  const { data, error } = await supabaseServer
    .from("vehicles")
    .select("*")
    .eq("shaken_expiry_date", targetDate)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  for (const vehicle of data ?? []) {
    const customer = customers.get(vehicle.customer_id);
    if (!customer?.line_user_id) continue;
    targets.push({ customer, vehicle, reservation: null, targetDate });
  }
  return targets;
}

const formatDate = (value: string | null | undefined) =>
  value ? value.replaceAll("-", "/") : "未登録";

const formatReservationDate = (value: string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat("ja-JP", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "Asia/Tokyo",
      }).format(new Date(value))
    : "未登録";

export function renderLineAutomationMessage(
  template: string,
  target: LineAutomationTarget,
) {
  const values: Record<string, string> = {
    name: target.customer.name,
    phone: target.customer.phone ?? "未登録",
    vehicle_name: target.vehicle?.model_name ?? "未登録",
    plate_number: target.vehicle?.plate_number ?? "未登録",
    shaken_expiry_date: formatDate(target.vehicle?.shaken_expiry_date),
    reservation_date: formatReservationDate(target.reservation?.reserved_at),
  };
  return template.replace(/\{\{([a-z_]+)\}\}/g, (_, key: string) =>
    key in values ? values[key] : `{{${key}}}`,
  );
}

const successfulTargetKeys = async (
  automationType: LineAutomationType,
  targetDate: string,
) => {
  const { data, error } = await supabaseServer
    .from("line_message_logs")
    .select("customer_id,vehicle_id,reservation_id")
    .eq("automation_type", automationType)
    .eq("target_date", targetDate)
    .eq("status", "成功");
  if (error) throw new Error(error.message);
  return new Set(
    (data ?? []).map(
      (item) =>
        `${item.customer_id}:${item.vehicle_id ?? ""}:${item.reservation_id ?? ""}`,
    ),
  );
};

const targetKey = (target: LineAutomationTarget) =>
  `${target.customer.id}:${target.vehicle?.id ?? ""}:${target.reservation?.id ?? ""}`;

const getLineAutomationTestTarget = async () => {
  const { data: customer, error: customerError } = await supabaseServer
    .from("customers")
    .select("*")
    .not("line_user_id", "is", null)
    .eq("line_status", "連携済み")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (customerError) throw new Error(customerError.message);
  if (!customer?.line_user_id) return null;

  const [vehicleResult, reservationResult] = await Promise.all([
    supabaseServer
      .from("vehicles")
      .select("*")
      .eq("customer_id", customer.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseServer
      .from("reservations")
      .select("*")
      .eq("customer_id", customer.id)
      .order("reserved_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (vehicleResult.error) throw new Error(vehicleResult.error.message);
  if (reservationResult.error) throw new Error(reservationResult.error.message);
  return {
    customer,
    vehicle: vehicleResult.data ?? null,
    reservation: reservationResult.data ?? null,
    targetDate: japanDateKey(),
  } satisfies LineAutomationTarget;
};

export async function getLineAutomationPreview(
  automationType: LineAutomationType,
  now = new Date(),
) {
  if (automationType === "reservation_completion") {
    return { count: 0, duplicateCount: 0 };
  }
  const targets = await getLineAutomationTargets(automationType, now);
  if (!targets.length) return { count: 0, duplicateCount: 0 };
  const sent = await successfulTargetKeys(automationType, targets[0].targetDate);
  const duplicateCount = targets.filter((target) => sent.has(targetKey(target))).length;
  return { count: targets.length - duplicateCount, duplicateCount };
}

export async function sendLineAutomation(
  setting: LineAutomationSetting,
  accessToken: string,
  options: { testOnly?: boolean; now?: Date } = {},
) {
  let targets = await getLineAutomationTargets(
    setting.automation_type,
    options.now,
  );
  if (options.testOnly && !targets.length) {
    const fallbackTarget = await getLineAutomationTestTarget();
    targets = fallbackTarget ? [fallbackTarget] : [];
  }
  const sent = targets.length
    ? await successfulTargetKeys(setting.automation_type, targets[0].targetDate)
    : new Set<string>();
  const pending = options.testOnly
    ? targets.slice(0, 1)
    : targets.filter((target) => !sent.has(targetKey(target)));

  let successCount = 0;
  let failureCount = 0;
  let logFailureCount = 0;
  for (const target of pending) {
    const lineUserId = target.customer.line_user_id;
    if (!lineUserId) continue;
    const renderedBody = renderLineAutomationMessage(setting.body, target);
    let status: "成功" | "失敗" = "成功";
    let errorMessage: string | null = null;
    try {
      await pushLineTextMessage(accessToken, lineUserId, renderedBody);
      successCount += 1;
    } catch (error) {
      status = "失敗";
      failureCount += 1;
      errorMessage =
        error instanceof Error ? error.message.slice(0, 1000) : "送信失敗";
    }

    const { error: logError } = await supabaseServer
      .from("line_message_logs")
      .insert({
        customer_id: target.customer.id,
        line_user_id: lineUserId,
        target_type: options.testOnly
          ? `自動配信テスト: ${lineAutomationDefinitions[setting.automation_type].label}`
          : lineAutomationDefinitions[setting.automation_type].label,
        title: setting.title,
        body: renderedBody,
        status,
        error_message: errorMessage,
        sent_at: status === "成功" ? new Date().toISOString() : null,
        vehicle_id: target.vehicle?.id ?? null,
        reservation_id: target.reservation?.id ?? null,
        automation_type: options.testOnly ? null : setting.automation_type,
        target_date: target.targetDate,
      });
    if (logError) {
      logFailureCount += 1;
      console.error("Failed to save LINE automation log", logError.message);
    }
  }

  return {
    targetCount: targets.length,
    skippedCount: options.testOnly ? 0 : targets.length - pending.length,
    successCount,
    failureCount,
    logFailureCount,
  };
}

export const isLineAutomationDue = (
  setting: LineAutomationSetting,
  now = new Date(),
) => {
  if (setting.automation_type === "reservation_completion") return false;
  if (!setting.enabled) return false;
  const today = japanDateKey(now);
  if (setting.last_run_at && japanDateKey(new Date(setting.last_run_at)) === today) {
    return false;
  }
  const currentTime = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
  }).format(now);
  return currentTime >= setting.send_time.slice(0, 5);
};

export const getNextRunAt = (
  setting: Pick<
    LineAutomationSetting,
    "automation_type" | "enabled" | "send_time" | "last_run_at"
  >,
  now = new Date(),
) => {
  if (setting.automation_type === "reservation_completion") return null;
  if (!setting.enabled) return null;
  const today = japanDateKey(now);
  const ranToday =
    setting.last_run_at && japanDateKey(new Date(setting.last_run_at)) === today;
  const currentTime = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
  }).format(now);
  const date = ranToday || currentTime >= setting.send_time.slice(0, 5)
    ? addDays(today, 1)
    : today;
  return new Date(`${date}T${setting.send_time.slice(0, 5)}:00+09:00`).toISOString();
};
