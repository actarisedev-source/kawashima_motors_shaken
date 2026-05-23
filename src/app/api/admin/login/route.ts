import { NextResponse } from "next/server";
import {
  adminSessionCookieName,
  adminSessionCookieOptions,
  createAdminSessionValue,
  verifyAdminPassword,
} from "@/lib/auth/admin-session";

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

  if (!process.env.ADMIN_PASSWORD) {
    return NextResponse.json(
      { ok: false, message: "ADMIN_PASSWORD が設定されていません。" },
      { status: 500 },
    );
  }

  if (!verifyAdminPassword(body.password)) {
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
