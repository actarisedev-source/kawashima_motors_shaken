import { NextResponse } from "next/server";
import {
  createAdminUserScopedClient,
  setAdminAuthCookies,
} from "@/lib/auth/admin-session";

type ResetPasswordRequest = {
  accessToken?: unknown;
  refreshToken?: unknown;
  newPassword?: unknown;
  confirmPassword?: unknown;
};

export async function POST(request: Request) {
  const body = (await request.json()) as ResetPasswordRequest;
  const accessToken =
    typeof body.accessToken === "string" ? body.accessToken : "";
  const refreshToken =
    typeof body.refreshToken === "string" ? body.refreshToken : "";
  const newPassword =
    typeof body.newPassword === "string" ? body.newPassword : "";
  const confirmPassword =
    typeof body.confirmPassword === "string" ? body.confirmPassword : "";

  if (!accessToken || !refreshToken) {
    return NextResponse.json(
      { ok: false, message: "再設定リンクの有効期限が切れています。" },
      { status: 400 },
    );
  }

  if (newPassword.length < 8) {
    return NextResponse.json(
      { ok: false, field: "newPassword", message: "新しいパスワードは8文字以上で入力してください。" },
      { status: 400 },
    );
  }

  if (newPassword !== confirmPassword) {
    return NextResponse.json(
      { ok: false, field: "confirmPassword", message: "新しいパスワードが一致しません。" },
      { status: 400 },
    );
  }

  try {
    const supabase = await createAdminUserScopedClient(
      accessToken,
      refreshToken,
    );
    const { data, error } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (error) {
      throw error;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      throw new Error("Updated session is missing.");
    }

    const response = NextResponse.json({
      ok: true,
      email: data.user.email ?? "",
      message:
        "パスワードを更新しました。\n新しいパスワードでログインしてください。",
    });
    setAdminAuthCookies(response, sessionData.session);
    return response;
  } catch (error) {
    console.error("Failed to reset admin password", error);
    return NextResponse.json(
      { ok: false, message: "パスワードの変更に失敗しました。" },
      { status: 500 },
    );
  }
}
