import { NextResponse, type NextRequest } from "next/server";
import {
  createAdminUserScopedClient,
  getAdminAuthFromRequest,
} from "@/lib/auth/admin-session";

export async function GET(request: NextRequest) {
  const auth = await getAdminAuthFromRequest(request);
  if (!auth.authenticated) {
    return NextResponse.json(
      { ok: false, message: "ログインが必要です。" },
      { status: 401 },
    );
  }

  return NextResponse.json({
    ok: true,
    email: auth.user.email ?? "",
  });
}

export async function PUT(request: NextRequest) {
  const auth = await getAdminAuthFromRequest(request);
  if (!auth.authenticated) {
    return NextResponse.json(
      { ok: false, message: "ログインが必要です。" },
      { status: 401 },
    );
  }

  const body = (await request.json()) as { email?: unknown };
  const email = typeof body.email === "string" ? body.email.trim() : "";

  if (!email) {
    return NextResponse.json(
      { ok: false, field: "email", message: "新しいメールアドレスを入力してください。" },
      { status: 400 },
    );
  }

  if (email === auth.user.email) {
    return NextResponse.json(
      { ok: false, field: "email", message: "現在と異なるメールアドレスを入力してください。" },
      { status: 400 },
    );
  }

  try {
    const supabase = await createAdminUserScopedClient(
      auth.accessToken,
      auth.refreshToken,
    );
    const { error } = await supabase.auth.updateUser({ email });
    if (error) {
      throw error;
    }
  } catch (error) {
    console.error("Failed to update admin email", error);
    return NextResponse.json(
      { ok: false, message: "メールアドレスの変更に失敗しました。" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    message:
      "メールアドレス変更手続きを開始しました。確認メールが届いた場合は内容に従ってください。",
  });
}
