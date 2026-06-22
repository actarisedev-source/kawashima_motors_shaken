import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  adminSessionCookieName,
  verifyAdminSessionValue,
} from "@/lib/auth/admin-session";
import { supabaseServer } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(request: NextRequest, context: RouteContext) {
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

  const { id } = await context.params;
  const now = new Date().toISOString();
  const { data, error } = await supabaseServer
    .from("line_scheduled_messages")
    .update({
      status: "取消済み",
      cancelled_at: now,
      updated_at: now,
    })
    .eq("id", id)
    .eq("status", "予約中")
    .is("processing_started_at", null)
    .select("id,status,cancelled_at")
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { ok: false, message: error.message },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json(
      { ok: false, message: "この予約配信は取消できない状態です。" },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true, message: data });
}
