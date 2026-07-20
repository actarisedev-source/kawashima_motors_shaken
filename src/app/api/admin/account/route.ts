import { NextResponse, type NextRequest } from "next/server";
import {
  createAdminUserScopedClient,
  getAdminAuthFromRequest,
} from "@/lib/auth/admin-session";

const getEmailChangeRedirectUrl = (request: NextRequest) => {
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const vercelUrl = process.env.VERCEL_URL?.trim();
  const requestOrigin = request.headers.get("origin")?.trim();
  const previewUrl = vercelUrl ? `https://${vercelUrl}` : "";
  const baseUrl =
    (process.env.VERCEL_ENV === "preview"
      ? previewUrl || requestOrigin || configuredSiteUrl
      : configuredSiteUrl || requestOrigin || previewUrl) ||
    "http://localhost:3000";
  const url = new URL("/admin/email-change-confirmed", baseUrl);

  url.search = "";
  url.hash = "";
  return url.toString();
};

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

  const body = (await request.json()) as {
    email?: unknown;
    emailConfirmation?: unknown;
  };
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const emailConfirmation =
    typeof body.emailConfirmation === "string"
      ? body.emailConfirmation.trim()
      : "";

  if (!email) {
    return NextResponse.json(
      { ok: false, field: "email", message: "新しいメールアドレスを入力してください。" },
      { status: 400 },
    );
  }

  if (!emailConfirmation) {
    return NextResponse.json(
      {
        ok: false,
        field: "emailConfirmation",
        message: "確認用メールアドレスを入力してください。",
      },
      { status: 400 },
    );
  }

  if (email !== emailConfirmation) {
    return NextResponse.json(
      {
        ok: false,
        field: "emailConfirmation",
        message: "メールアドレスが一致しません。",
      },
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
    const emailRedirectTo = getEmailChangeRedirectUrl(request);
    console.info("Admin email change redirect configured", {
      emailRedirectTo,
    });
    const { error } = await supabase.auth.updateUser(
      { email },
      { emailRedirectTo },
    );
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
      "確認メールを送信しました。\nメール内のリンクからメールアドレス変更を完了してください。",
  });
}
