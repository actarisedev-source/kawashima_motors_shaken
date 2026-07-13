import { NextResponse } from "next/server";
import { resetAdminPasswordForEmail } from "@/lib/auth/admin-session";

export async function POST(request: Request) {
  const body = (await request.json()) as { email?: unknown };
  const email = typeof body.email === "string" ? body.email.trim() : "";

  if (!email) {
    return NextResponse.json(
      { ok: false, message: "メールアドレスを入力してください。" },
      { status: 400 },
    );
  }

  const origin =
    request.headers.get("origin") ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    "http://localhost:3000";

  const { error } = await resetAdminPasswordForEmail(
    email,
    `${origin}/admin/reset-password`,
  );

  if (error) {
    console.error("Failed to send password reset email", error);
    return NextResponse.json(
      { ok: false, message: "再設定メールを送信できませんでした。" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    message: "パスワード再設定メールを送信しました。",
  });
}
