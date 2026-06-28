import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  adminSessionCookieName,
  verifyAdminSessionValue,
} from "@/lib/auth/admin-session";
import {
  getLineAutomationPreview,
  getNextRunAt,
  lineAutomationTypes,
  type LineAutomationType,
} from "@/lib/line/automations";
import { supabaseServer } from "@/lib/supabase/server";

const isAuthenticated = (request: NextRequest) =>
  verifyAdminSessionValue(request.cookies.get(adminSessionCookieName)?.value);

const isAutomationType = (value: unknown): value is LineAutomationType =>
  typeof value === "string" &&
  lineAutomationTypes.includes(value as LineAutomationType);

export async function GET(request: NextRequest) {
  if (!isAuthenticated(request)) {
    return NextResponse.json(
      { ok: false, message: "ログインが必要です。" },
      { status: 401 },
    );
  }

  const { data, error } = await supabaseServer
    .from("line_automation_settings")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) {
    return NextResponse.json(
      { ok: false, message: error.message },
      { status: 500 },
    );
  }

  try {
    const settings = await Promise.all(
      (data ?? []).map(async (setting) => ({
        ...setting,
        send_time: setting.send_time.slice(0, 5),
        next_run_at: getNextRunAt(setting),
        preview: await getLineAutomationPreview(setting.automation_type),
      })),
    );
    return NextResponse.json({ ok: true, settings });
  } catch (previewError) {
    return NextResponse.json(
      {
        ok: false,
        message:
          previewError instanceof Error
            ? previewError.message
            : "対象件数の取得に失敗しました。",
      },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  if (!isAuthenticated(request)) {
    return NextResponse.json(
      { ok: false, message: "ログインが必要です。" },
      { status: 401 },
    );
  }

  const payload = (await request.json()) as {
    automationType?: unknown;
    enabled?: unknown;
    title?: unknown;
    body?: unknown;
    sendTime?: unknown;
  };
  if (!isAutomationType(payload.automationType)) {
    return NextResponse.json(
      { ok: false, message: "自動配信種別が不正です。" },
      { status: 400 },
    );
  }
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  const body = typeof payload.body === "string" ? payload.body.trim() : "";
  const sendTime =
    typeof payload.sendTime === "string" ? payload.sendTime.trim() : "";
  const isReservationCompletion =
    payload.automationType === "reservation_completion";
  if (!title || !body) {
    return NextResponse.json(
      { ok: false, message: "配信タイトルと配信本文を入力してください。" },
      { status: 400 },
    );
  }
  if (body.length > 5000) {
    return NextResponse.json(
      { ok: false, message: "配信本文は5000文字以内で入力してください。" },
      { status: 400 },
    );
  }
  if (
    !isReservationCompletion &&
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(sendTime)
  ) {
    return NextResponse.json(
      { ok: false, message: "配信時刻を正しく入力してください。" },
      { status: 400 },
    );
  }

  const { data, error } = await supabaseServer
    .from("line_automation_settings")
    .update({
      enabled: payload.enabled === true,
      title,
      body,
      ...(isReservationCompletion ? {} : { send_time: sendTime }),
      updated_at: new Date().toISOString(),
    })
    .eq("automation_type", payload.automationType)
    .select("*")
    .single();
  if (error) {
    return NextResponse.json(
      { ok: false, message: error.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, setting: data });
}
