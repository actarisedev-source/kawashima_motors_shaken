import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  adminSessionCookieName,
  verifyAdminSessionValue,
} from "@/lib/auth/admin-session";
import {
  lineAutomationTypes,
  sendLineAutomation,
  type LineAutomationType,
} from "@/lib/line/automations";
import { getLineConfig } from "@/lib/line/config";
import { supabaseServer } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  if (
    !verifyAdminSessionValue(
      request.cookies.get(adminSessionCookieName)?.value,
    )
  ) {
    return NextResponse.json(
      { ok: false, message: "ログインが必要です。" },
      { status: 401 },
    );
  }
  const payload = (await request.json()) as { automationType?: unknown };
  if (
    typeof payload.automationType !== "string" ||
    !lineAutomationTypes.includes(payload.automationType as LineAutomationType)
  ) {
    return NextResponse.json(
      { ok: false, message: "自動配信種別が不正です。" },
      { status: 400 },
    );
  }
  const accessToken = getLineConfig().channelAccessToken;
  if (!accessToken) {
    return NextResponse.json(
      { ok: false, message: "LINE_CHANNEL_ACCESS_TOKEN が未設定です" },
      { status: 503 },
    );
  }

  const { data: setting, error } = await supabaseServer
    .from("line_automation_settings")
    .select("*")
    .eq("automation_type", payload.automationType as LineAutomationType)
    .single();
  if (error || !setting) {
    return NextResponse.json(
      { ok: false, message: error?.message ?? "設定が見つかりません。" },
      { status: 404 },
    );
  }

  try {
    const result = await sendLineAutomation(setting, accessToken, {
      testOnly: true,
    });
    if (!result.targetCount) {
      return NextResponse.json(
        { ok: false, message: "現在の条件に一致するテスト送信先がありません。" },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (sendError) {
    return NextResponse.json(
      {
        ok: false,
        message:
          sendError instanceof Error ? sendError.message : "テスト送信に失敗しました。",
      },
      { status: 500 },
    );
  }
}
