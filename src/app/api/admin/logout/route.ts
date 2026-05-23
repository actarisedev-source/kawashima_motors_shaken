import { NextResponse } from "next/server";
import { adminSessionCookieName } from "@/lib/auth/admin-session";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(adminSessionCookieName);

  return response;
}
