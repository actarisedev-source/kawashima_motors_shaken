import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";

const adminSessionCookieName = "kawashima_admin_access_token";
const adminRefreshTokenCookieName = "kawashima_admin_refresh_token";
const authCookieMaxAgeSeconds = 60 * 60 * 24 * 30;

const adminAuthCookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: authCookieMaxAgeSeconds,
} as const;

const publicAdminPaths = [
  "/admin/login",
  "/admin/reset-password",
  "/api/admin/login",
  "/api/admin/logout",
  "/api/admin/password-reset",
  "/api/admin/reset-password",
];

const createSupabaseAuthClient = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  return createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
};

const isPublicAdminPath = (pathname: string) =>
  publicAdminPaths.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicAdminPath(pathname)) {
    return NextResponse.next();
  }

  const accessToken = request.cookies.get(adminSessionCookieName)?.value;
  const refreshToken = request.cookies.get(adminRefreshTokenCookieName)?.value;

  if (!accessToken || !refreshToken) {
    return NextResponse.next();
  }

  const supabase = createSupabaseAuthClient();
  if (!supabase) {
    return NextResponse.next();
  }

  const { data, error } = await supabase.auth.getUser(accessToken);
  if (!error && data.user) {
    return NextResponse.next();
  }

  const { data: refreshed, error: refreshError } =
    await supabase.auth.refreshSession({ refresh_token: refreshToken });

  if (refreshError || !refreshed.session) {
    const response = NextResponse.next();
    response.cookies.delete(adminSessionCookieName);
    response.cookies.delete(adminRefreshTokenCookieName);
    return response;
  }

  const response = NextResponse.next();
  response.cookies.set(
    adminSessionCookieName,
    refreshed.session.access_token,
    adminAuthCookieOptions,
  );
  response.cookies.set(
    adminRefreshTokenCookieName,
    refreshed.session.refresh_token,
    adminAuthCookieOptions,
  );
  return response;
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
