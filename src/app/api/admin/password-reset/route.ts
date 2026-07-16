import { NextResponse } from "next/server";
import { resetAdminPasswordForEmail } from "@/lib/auth/admin-session";

const getResetRedirectUrl = (request: Request) => {
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const vercelUrl = process.env.VERCEL_URL?.trim();
  const requestOrigin = request.headers.get("origin")?.trim();
  const baseUrl =
    configuredSiteUrl ||
    (vercelUrl ? `https://${vercelUrl}` : "") ||
    requestOrigin ||
    "http://localhost:3000";

  return `${baseUrl.replace(/\/$/, "")}/admin/reset-password`;
};

export async function POST(request: Request) {
  const body = (await request.json()) as { email?: unknown };
  const email = typeof body.email === "string" ? body.email.trim() : "";

  if (!email) {
    return NextResponse.json(
      { ok: false, message: "メールアドレスを入力してください。" },
      { status: 400 },
    );
  }

  const redirectTo = getResetRedirectUrl(request);
  console.info("Admin password reset requested", { redirectTo });
  const { error } = await resetAdminPasswordForEmail(email, redirectTo);
  console.info("Admin password reset completed", {
    ok: !error,
    errorMessage: error?.message ?? null,
    redirectTo,
  });

  if (error) {
    console.error("Failed to send password reset email", error);
    return NextResponse.json(
      {
        ok: false,
        message: error.message || "再設定メールを送信できませんでした。",
        redirectTo,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    message: "パスワード再設定メールを送信しました。",
    redirectTo,
  });
}
