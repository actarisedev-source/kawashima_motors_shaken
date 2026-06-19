import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  isLineAutomationDue,
  sendLineAutomation,
} from "@/lib/line/automations";
import { getLineConfig } from "@/lib/line/config";
import { supabaseServer } from "@/lib/supabase/server";

const isAuthorized = (request: NextRequest) => {
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(
    secret && request.headers.get("authorization") === `Bearer ${secret}`,
  );
};

async function run(request: NextRequest) {
  if (!process.env.CRON_SECRET?.trim()) {
    return NextResponse.json(
      { ok: false, message: "CRON_SECRET が未設定です。" },
      { status: 503 },
    );
  }
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { ok: false, message: "認証に失敗しました。" },
      { status: 401 },
    );
  }
  const accessToken = getLineConfig().channelAccessToken;
  if (!accessToken) {
    return NextResponse.json(
      { ok: false, message: "LINE_CHANNEL_ACCESS_TOKEN が未設定です" },
      { status: 503 },
    );
  }

  const { data: settings, error } = await supabaseServer
    .from("line_automation_settings")
    .select("*")
    .eq("enabled", true);
  if (error) {
    return NextResponse.json(
      { ok: false, message: error.message },
      { status: 500 },
    );
  }

  const now = new Date();
  const results = [];
  for (const setting of settings ?? []) {
    if (!isLineAutomationDue(setting, now)) continue;
    try {
      const result = await sendLineAutomation(setting, accessToken, { now });
      const finishedAt = new Date().toISOString();
      const { error: updateError } = await supabaseServer
        .from("line_automation_settings")
        .update({ last_run_at: finishedAt, updated_at: finishedAt })
        .eq("id", setting.id);
      if (updateError) throw new Error(updateError.message);
      results.push({ automationType: setting.automation_type, ok: true, ...result });
    } catch (executionError) {
      results.push({
        automationType: setting.automation_type,
        ok: false,
        message:
          executionError instanceof Error
            ? executionError.message
            : "自動配信に失敗しました。",
      });
    }
  }

  return NextResponse.json({ ok: true, executedCount: results.length, results });
}

export async function GET(request: NextRequest) {
  return run(request);
}

export async function POST(request: NextRequest) {
  return run(request);
}
