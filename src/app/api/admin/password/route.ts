import { NextResponse, type NextRequest } from "next/server";
import {
  adminSessionCookieName,
  verifyAdminSessionValue,
} from "@/lib/auth/admin-session";
import {
  saveAdminPassword,
  verifyActiveAdminPassword,
} from "@/lib/auth/admin-password";

type PasswordChangeRequest = {
  currentPassword?: unknown;
  newPassword?: unknown;
  confirmPassword?: unknown;
};

export async function PUT(request: NextRequest) {
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

  const body = (await request.json()) as PasswordChangeRequest;
  const currentPassword =
    typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword =
    typeof body.newPassword === "string" ? body.newPassword : "";
  const confirmPassword =
    typeof body.confirmPassword === "string" ? body.confirmPassword : "";

  if (!currentPassword) {
    return NextResponse.json(
      { ok: false, field: "currentPassword", message: "現在のパスワードを入力してください。" },
      { status: 400 },
    );
  }

  if (newPassword.length < 8) {
    return NextResponse.json(
      { ok: false, field: "newPassword", message: "新しいパスワードは8文字以上で入力してください。" },
      { status: 400 },
    );
  }

  if (currentPassword.length > 256) {
    return NextResponse.json(
      { ok: false, field: "currentPassword", message: "現在のパスワードが正しくありません。" },
      { status: 401 },
    );
  }

  if (newPassword.length > 128) {
    return NextResponse.json(
      { ok: false, field: "newPassword", message: "新しいパスワードは128文字以内で入力してください。" },
      { status: 400 },
    );
  }

  if (newPassword !== confirmPassword) {
    return NextResponse.json(
      { ok: false, field: "confirmPassword", message: "新しいパスワードが一致しません。" },
      { status: 400 },
    );
  }

  if (currentPassword === newPassword) {
    return NextResponse.json(
      { ok: false, field: "newPassword", message: "現在と異なるパスワードを入力してください。" },
      { status: 400 },
    );
  }

  let currentPasswordMatches = false;
  try {
    currentPasswordMatches = await verifyActiveAdminPassword(currentPassword);
  } catch (error) {
    console.error("Admin password verification failed", error);
    return NextResponse.json(
      { ok: false, message: "認証情報を確認できませんでした。" },
      { status: 500 },
    );
  }

  if (!currentPasswordMatches) {
    return NextResponse.json(
      { ok: false, field: "currentPassword", message: "現在のパスワードが正しくありません。" },
      { status: 401 },
    );
  }

  try {
    await saveAdminPassword(newPassword);
  } catch (error) {
    console.error("Failed to save admin password", error);
    return NextResponse.json(
      {
        ok: false,
        message: "パスワードの保存に失敗しました。",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, message: "パスワードを変更しました。" });
}
