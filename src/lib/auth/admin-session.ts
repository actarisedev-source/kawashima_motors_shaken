import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient, type Session, type User } from "@supabase/supabase-js";
import type { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";
import { type NextRequest, NextResponse } from "next/server";
import type { Database } from "@/types/database";

export const adminSessionCookieName = "kawashima_admin_access_token";
export const adminRefreshTokenCookieName = "kawashima_admin_refresh_token";

const legacySessionMaxAgeSeconds = 60 * 60 * 24 * 7;
const authCookieMaxAgeSeconds = 60 * 60 * 24 * 30;

const getAdminPassword = () => process.env.ADMIN_PASSWORD?.trim() ?? "";

const getSupabaseAuthClient = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing Supabase Auth environment variables: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }

  return createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
};

const sign = (payload: string, secret: string) =>
  createHmac("sha256", secret).update(payload).digest("hex");

const safeEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
};

export const createAdminSessionValue = () => {
  const password = getAdminPassword();

  if (!password) {
    throw new Error("ADMIN_PASSWORD is not configured.");
  }

  const issuedAt = Date.now().toString();
  return `${issuedAt}.${sign(issuedAt, password)}`;
};

export const verifyAdminPassword = (password: string) => {
  const expectedPassword = getAdminPassword();

  if (!expectedPassword) {
    return false;
  }

  return safeEqual(password, expectedPassword);
};

export const verifyAdminSessionValue = (value: string | undefined) => {
  const password = getAdminPassword();

  if (!password || !value) {
    return false;
  }

  const [issuedAt, signature] = value.split(".");

  if (!issuedAt || !signature) {
    return false;
  }

  const issuedAtMs = Number(issuedAt);

  if (
    Number.isNaN(issuedAtMs) ||
    Date.now() - issuedAtMs > legacySessionMaxAgeSeconds * 1000
  ) {
    return false;
  }

  return safeEqual(signature, sign(issuedAt, password));
};

export const adminSessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: authCookieMaxAgeSeconds,
} as const;

export type AdminAuthResult =
  | { authenticated: true; user: User; accessToken: string; refreshToken: string }
  | { authenticated: false; user: null; accessToken: null; refreshToken: null };

type CookieReader = Pick<ReadonlyRequestCookies, "get">;

export const getAdminAuthTokensFromCookies = (cookieStore: CookieReader) => {
  const accessToken = cookieStore.get(adminSessionCookieName)?.value ?? null;
  const refreshToken =
    cookieStore.get(adminRefreshTokenCookieName)?.value ?? null;

  return { accessToken, refreshToken };
};

export const getAdminUserFromTokens = async (
  accessToken: string | null | undefined,
  refreshToken: string | null | undefined,
): Promise<AdminAuthResult> => {
  if (!accessToken || !refreshToken) {
    return {
      authenticated: false,
      user: null,
      accessToken: null,
      refreshToken: null,
    };
  }

  const supabase = getSupabaseAuthClient();
  const { data, error } = await supabase.auth.getUser(accessToken);

  if (error || !data.user) {
    const { data: refreshed, error: refreshError } =
      await supabase.auth.refreshSession({ refresh_token: refreshToken });

    if (!refreshError && refreshed.session && refreshed.user) {
      return {
        authenticated: true,
        user: refreshed.user,
        accessToken: refreshed.session.access_token,
        refreshToken: refreshed.session.refresh_token,
      };
    }

    return {
      authenticated: false,
      user: null,
      accessToken: null,
      refreshToken: null,
    };
  }

  return {
    authenticated: true,
    user: data.user,
    accessToken,
    refreshToken,
  };
};

export const getAdminAuthFromCookies = async (
  cookieStore: CookieReader,
): Promise<AdminAuthResult> => {
  const { accessToken, refreshToken } =
    getAdminAuthTokensFromCookies(cookieStore);
  return getAdminUserFromTokens(accessToken, refreshToken);
};

export const getAdminAuthFromRequest = async (
  request: NextRequest,
): Promise<AdminAuthResult> => {
  const accessToken = request.cookies.get(adminSessionCookieName)?.value ?? null;
  const refreshToken =
    request.cookies.get(adminRefreshTokenCookieName)?.value ?? null;
  return getAdminUserFromTokens(accessToken, refreshToken);
};

export const unauthorizedAdminResponse = () =>
  NextResponse.json(
    { ok: false, message: "ログインが必要です。" },
    { status: 401 },
  );

export const setAdminAuthCookies = (
  response: NextResponse,
  session: Session,
) => {
  response.cookies.set(
    adminSessionCookieName,
    session.access_token,
    adminSessionCookieOptions,
  );
  response.cookies.set(
    adminRefreshTokenCookieName,
    session.refresh_token,
    adminSessionCookieOptions,
  );
};

export const clearAdminAuthCookies = (response: NextResponse) => {
  response.cookies.delete(adminSessionCookieName);
  response.cookies.delete(adminRefreshTokenCookieName);
};

export const createAdminUserScopedClient = async (
  accessToken: string,
  refreshToken: string,
) => {
  const supabase = getSupabaseAuthClient();
  const { data, error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  if (error || !data.session) {
    throw new Error(error?.message ?? "Supabase Auth session is invalid.");
  }

  return supabase;
};

export const verifySupabaseAdminPassword = async (
  email: string,
  password: string,
) => {
  const supabase = getSupabaseAuthClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    return false;
  }

  await supabase.auth.signOut({ scope: "local" });
  return true;
};

export const resetAdminPasswordForEmail = async (
  email: string,
  redirectTo: string,
) => {
  const supabase = getSupabaseAuthClient();
  return supabase.auth.resetPasswordForEmail(email, { redirectTo });
};
