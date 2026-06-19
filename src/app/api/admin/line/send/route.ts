import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  adminSessionCookieName,
  verifyAdminSessionValue,
} from "@/lib/auth/admin-session";
import {
  getLineAudience,
  renderLineMessage,
  type LineAudienceFilters,
} from "@/lib/line/audience";
import { getLineConfig } from "@/lib/line/config";
import { pushLineTextMessage } from "@/lib/line/messaging";
import { supabaseServer } from "@/lib/supabase/server";

const isAuthenticated = (request: NextRequest) =>
  verifyAdminSessionValue(request.cookies.get(adminSessionCookieName)?.value);

const textValue = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

export async function POST(request: NextRequest) {
  if (!isAuthenticated(request)) {
    return NextResponse.json(
      { ok: false, message: "ログインが必要です。" },
      { status: 401 },
    );
  }

  const body = (await request.json()) as {
    title?: unknown;
    messageBody?: unknown;
    targetLabel?: unknown;
    filters?: LineAudienceFilters;
  };
  const title = textValue(body.title);
  const messageBody = textValue(body.messageBody);
  const targetLabel = textValue(body.targetLabel) || "LINE連携済み全員";
  if (!title || !messageBody) {
    return NextResponse.json(
      { ok: false, message: "配信タイトルと配信本文を入力してください。" },
      { status: 400 },
    );
  }
  if (messageBody.length > 5000) {
    return NextResponse.json(
      { ok: false, message: "配信本文は5000文字以内で入力してください。" },
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

  try {
    const filters = body.filters ?? {};
    const [audience, allMatches] = await Promise.all([
      getLineAudience(filters),
      getLineAudience(filters, false),
    ]);
    if (!audience.length) {
      return NextResponse.json(
        { ok: false, message: "配信対象のLINE連携済み顧客がいません。" },
        { status: 400 },
      );
    }

    let successCount = 0;
    let failureCount = 0;
    for (const member of audience) {
      const lineUserId = member.customer.line_user_id;
      if (!lineUserId) continue;
      const renderedBody = renderLineMessage(messageBody, member);
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
          customer_id: member.customer.id,
          line_user_id: lineUserId,
          target_type: targetLabel,
          title,
          body: renderedBody,
          status,
          error_message: errorMessage,
          sent_at: status === "成功" ? new Date().toISOString() : null,
        });
      if (logError) {
        console.error("Failed to save LINE message log", logError.message);
      }
    }

    return NextResponse.json({
      ok: true,
      successCount,
      failureCount,
      excludedCount: Math.max(allMatches.length - audience.length, 0),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "LINE配信に失敗しました。",
      },
      { status: 500 },
    );
  }
}
