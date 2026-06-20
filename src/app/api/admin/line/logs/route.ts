import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  adminSessionCookieName,
  verifyAdminSessionValue,
} from "@/lib/auth/admin-session";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
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

  const { data, error } = await supabaseServer
    .from("line_message_logs")
    .select(
      "id,customer_id,target_type,title,body,status,error_message,image_url,sent_at,created_at,automation_type",
    )
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json(
      { ok: false, message: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, logs: data ?? [] });
}
