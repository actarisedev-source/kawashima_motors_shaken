import { NextResponse } from "next/server";
import { clearAdminAuthCookies } from "@/lib/auth/admin-session";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  clearAdminAuthCookies(response);

  return response;
}
