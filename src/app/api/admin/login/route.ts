import { NextResponse } from "next/server";
import {
  adminSessionCookieName,
  adminSessionCookieOptions,
  createAdminSessionValue,
} from "@/lib/auth/admin-session";
import { verifyActiveAdminPassword } from "@/lib/auth/admin-password";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    password?: unknown;
  };

  if (typeof body.password !== "string") {
    return NextResponse.json(
      { ok: false, message: "パスワードを入力してください。" },
      { status: 400 },
    );
  }

  if (body.password.length > 256) {
    return NextResponse.json(
      { ok: false, message: "パスワードが正しくありません。" },
      { status: 401 },
    );
  }

  if (!process.env.ADMIN_PASSWORD) {
    return NextResponse.json(
      { ok: false, message: "ADMIN_PASSWORD が設定されていません。" },
      { status: 500 },
    );
  }

  let passwordMatches = false;
  try {
    passwordMatches = await verifyActiveAdminPassword(body.password);
  } catch (error) {
    console.error("Admin password verification failed", error);
    return NextResponse.json(
      { ok: false, message: "認証情報を確認できませんでした。" },
      { status: 500 },
    );
  }

  if (!passwordMatches) {
    return NextResponse.json(
      { ok: false, message: "パスワードが正しくありません。" },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(
    adminSessionCookieName,
    createAdminSessionValue(),
    adminSessionCookieOptions,
  );

  return response;
}
