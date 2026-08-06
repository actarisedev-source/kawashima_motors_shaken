import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { setAdminAuthCookies } from "@/lib/auth/admin-session";
import type { Database } from "@/types/database";

const createSupabaseAuthClient = () => {
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

export async function POST(request: Request) {
  const body = (await request.json()) as {
    email?: unknown;
    password?: unknown;
  };

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email) {
    return NextResponse.json(
      { ok: false, field: "email", message: "メールアドレスを入力してください。" },
      { status: 400 },
    );
  }

  if (!password) {
    return NextResponse.json(
      { ok: false, field: "password", message: "パスワードを入力してください。" },
      { status: 400 },
    );
  }

  if (password.length > 256) {
    return NextResponse.json(
      { ok: false, field: "password", message: "ログイン情報が正しくありません。" },
      { status: 401 },
    );
  }

  const supabase = createSupabaseAuthClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.session) {
    return NextResponse.json(
      { ok: false, message: "メールアドレスまたはパスワードが正しくありません。" },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ ok: true });
  setAdminAuthCookies(response, data.session);

  return response;
}
